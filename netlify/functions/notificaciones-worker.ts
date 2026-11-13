import { schedule } from '@netlify/functions';
import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';

/**
 * Reconcilia de forma segura el estado de una tarea cuando Meta ya confirmó el envío físico
 * (metaMessageId presente), pero una actualización optimista (primaria o de fallback)
 * devolvió cero filas debido a modificaciones concurrentes (ej. cambio a 'pendiente',
 * cancelación a 'fallido', etc.).
 *
 * Estrategia acotada (máx 2 reintentos):
 * - Consulta estado actual e inspecciona explícitamente tanto error como data.
 * - Si es reclamable ('pendiente', 'procesando', 'simulado'), transiciona a 'incierto' para
 *   impedir reenvíos duplicados por reclamar_notificaciones().
 * - Si es terminal de negocio ('fallido', 'incierto'), preserva el estado y acopla message_id.
 * - Si el estado ya es 'enviado', no realiza cambios redundantes.
 * - Si la condición optimista devuelve 0 filas por una segunda carrera, reevalúa en una segunda pasada.
 * - Si falla la lectura de Supabase, aplica actualización preventiva de emergencia con filtro in(...).
 */
export async function reconciliarEstadoConcurrentePostMeta(
  supabaseAdmin: any,
  tareaId: string,
  metaMessageId: string
): Promise<void> {
  const MAX_REINTENTOS_CONCURRENCIA = 2;

  for (let intento = 1; intento <= MAX_REINTENTOS_CONCURRENCIA; intento++) {
    let tareaConcurrente: any = null;
    let readError: any = null;

    try {
      const resRead = await supabaseAdmin
        .from('cola_notificaciones_whatsapp')
        .select('estado, ultimo_error')
        .eq('id', tareaId)
        .single();
      tareaConcurrente = resRead.data;
      readError = resRead.error;
    } catch (errRead: any) {
      readError = errRead;
    }

    if (readError || !tareaConcurrente) {
      console.error(`[CRÍTICO] Falló la consulta del estado concurrente para tarea ${tareaId} tras éxito en Meta (ID: ${metaMessageId}):`, readError);
      // Actualización preventiva de emergencia contra estados reclamables
      try {
        const { data: emergData, error: emergencyErr } = await supabaseAdmin
          .from('cola_notificaciones_whatsapp')
          .update({
            estado: 'incierto',
            message_id: metaMessageId,
            ultimo_error: `Despachado a Meta (ID: ${metaMessageId}) pero falló consulta de estado concurrente: ${readError?.message || readError}`,
            procesado_at: new Date().toISOString(),
          })
          .eq('id', tareaId)
          .in('estado', ['pendiente', 'procesando', 'simulado'])
          .select('id, estado');

        if (emergencyErr) {
          console.error(`[CRÍTICO] Supabase devolvió error en actualización de emergencia para tarea ${tareaId}:`, emergencyErr);
        } else if (emergData && emergData.length > 0) {
          console.warn(`[CONCURRENCIA] Tarea ${tareaId} transicionada preventivamente a 'incierto' tras error de lectura.`);
        } else {
          console.warn(`[CONCURRENCIA] Actualización preventiva de emergencia no modificó filas para tarea ${tareaId} (el estado no era reclamable).`);
        }
      } catch (emergEx) {
        console.error(`[CRÍTICO] Excepción en actualización de emergencia para tarea ${tareaId}:`, emergEx);
      }
      return;
    }

    const estadoActual = tareaConcurrente.estado;

    if (estadoActual === 'enviado') {
      // Caso A: Ya se encuentra confirmado como 'enviado'. Terminal y seguro.
      console.log(`[CONCURRENCIA] Tarea ${tareaId} ya se encuentra en estado 'enviado'.`);
      return;
    }

    if (['pendiente', 'procesando', 'simulado'].includes(estadoActual)) {
      // Caso B: Estado RECLAMABLE ('pendiente', 'simulado', 'procesando').
      // CRÍTICO: Meta ya aceptó el mensaje. Si la tarea permanece en 'pendiente',
      // reclamar_notificaciones() volvería a reclamarla y enviarla a Meta, duplicando el WhatsApp.
      // Debe transicionarse a 'incierto' con condición optimista para impedir reenvío automático.
      console.warn(`[CONCURRENCIA] Tarea ${tareaId} en estado reclamable '${estadoActual}' tras éxito de Meta (Intento ${intento}/${MAX_REINTENTOS_CONCURRENCIA}). Transicionando a 'incierto'.`);
      try {
        const { data: updateData, error: updateAuditError } = await supabaseAdmin
          .from('cola_notificaciones_whatsapp')
          .update({
            estado: 'incierto',
            message_id: metaMessageId,
            ultimo_error: `Despachado a Meta (ID: ${metaMessageId}) pero estado concurrente era '${estadoActual}'. Transicionado a 'incierto' para prevenir reenvío duplicado.`,
            procesado_at: new Date().toISOString(),
          })
          .eq('id', tareaId)
          .eq('estado', estadoActual)
          .select('id, estado');

        if (updateAuditError) {
          console.error(`[CRÍTICO] Supabase devolvió error al transicionar tarea concurrente ${tareaId} a 'incierto':`, updateAuditError);
          return;
        }

        if (!updateData || updateData.length === 0) {
          console.warn(`[CONCURRENCIA] Carrera detectada en tarea ${tareaId}: el estado '${estadoActual}' cambió antes de transicionar.`);
          if (intento < MAX_REINTENTOS_CONCURRENCIA) {
            continue; // Reevaluar en la siguiente iteración
          } else {
            console.error(`[CRÍTICO] Se agotaron los reintentos de concurrencia para tarea ${tareaId}. Ejecutando neutralización de emergencia.`);
            try {
              const { data: emergData, error: emergError } = await supabaseAdmin
                .from('cola_notificaciones_whatsapp')
                .update({
                  estado: 'incierto',
                  message_id: metaMessageId,
                  ultimo_error: `Despachado a Meta (ID: ${metaMessageId}) pero persistieron carreras concurrentes tras ${MAX_REINTENTOS_CONCURRENCIA} intentos.`,
                  procesado_at: new Date().toISOString(),
                })
                .eq('id', tareaId)
                .in('estado', ['pendiente', 'procesando', 'simulado'])
                .select('id, estado');

              if (emergError) {
                console.error(`[CRÍTICO] Supabase devolvió error en neutralización de emergencia tras agotar reintentos para tarea ${tareaId}:`, emergError);
              } else if (!emergData || emergData.length === 0) {
                console.warn(`[CONCURRENCIA] Neutralización de emergencia no modificó filas para tarea ${tareaId} (el estado actual ya no era reclamable).`);
              } else {
                console.log(`[CONCURRENCIA] Tarea ${tareaId} neutralizada exitosamente a 'incierto' tras agotar reintentos.`);
              }
            } catch (emergEx) {
              console.error(`[CRÍTICO] Excepción en neutralización de emergencia tras agotar reintentos para tarea ${tareaId}:`, emergEx);
            }
            return;
          }
        }

        console.log(`[CONCURRENCIA] Tarea ${tareaId} transicionada exitosamente de '${estadoActual}' a 'incierto'.`);
        return;
      } catch (auditEx) {
        console.error(`[CRÍTICO] Excepción al transicionar tarea ${tareaId} a 'incierto':`, auditEx);
        return;
      }
    }

    // Caso C: Estados terminales o no reclamables ('fallido', 'incierto').
    // Preservamos el estado de negocio (ej. 'fallido' por cancelación de cita),
    // pero acoplamos el message_id y el detalle de auditoría sin sobrescribir el estado.
    console.log(`[CONCURRENCIA] Preservando estado no reclamable '${estadoActual}' para tarea ${tareaId} y acoplando message_id.`);
    const nuevoUltimoError = `${tareaConcurrente.ultimo_error || ''} [Meta ID: ${metaMessageId} emitido durante invalidación concurrente]`.trim();

    try {
      const { data: updateData, error: updateAuditError } = await supabaseAdmin
        .from('cola_notificaciones_whatsapp')
        .update({
          message_id: metaMessageId,
          ultimo_error: nuevoUltimoError,
        })
        .eq('id', tareaId)
        .eq('estado', estadoActual)
        .select('id, estado');

      if (updateAuditError) {
        console.error(`[CRÍTICO] Supabase devolvió error al acoplar auditoría a tarea ${tareaId}:`, updateAuditError);
        return;
      }

      if (!updateData || updateData.length === 0) {
        console.warn(`[CONCURRENCIA] Carrera detectada en tarea ${tareaId}: estado '${estadoActual}' cambió antes de acoplar auditoría.`);
        if (intento < MAX_REINTENTOS_CONCURRENCIA) {
          continue; // Reevaluar en la siguiente iteración
        } else {
          console.warn(`[CONCURRENCIA] Agotados reintentos para acoplar auditoría a tarea ${tareaId}. Verificando neutralización preventiva.`);
          try {
            const { data: auditEmergData, error: auditEmergError } = await supabaseAdmin
              .from('cola_notificaciones_whatsapp')
              .update({
                estado: 'incierto',
                message_id: metaMessageId,
                ultimo_error: `Despachado a Meta (ID: ${metaMessageId}) pero persistieron cambios de estado tras acoplar auditoría.`,
                procesado_at: new Date().toISOString(),
              })
              .eq('id', tareaId)
              .in('estado', ['pendiente', 'procesando', 'simulado'])
              .select('id, estado');

            if (auditEmergError) {
              console.error(`[CRÍTICO] Supabase devolvió error en neutralización preventiva tras fallo de auditoría para tarea ${tareaId}:`, auditEmergError);
            } else if (!auditEmergData || auditEmergData.length === 0) {
              console.warn(`[CONCURRENCIA] Neutralización preventiva no modificó filas para tarea ${tareaId} (el estado actual ya no era reclamable).`);
            } else {
              console.log(`[CONCURRENCIA] Tarea ${tareaId} neutralizada preventivamente a 'incierto' tras fallo de auditoría.`);
            }
          } catch (auditEmergEx) {
            console.error(`[CRÍTICO] Excepción en neutralización preventiva tras fallo de auditoría para tarea ${tareaId}:`, auditEmergEx);
          }
          return;
        }
      }

      console.log(`[CONCURRENCIA] Auditoría acoplada exitosamente a tarea ${tareaId} en estado '${estadoActual}'.`);
      return;
    } catch (auditEx) {
      console.error(`[CRÍTICO] Excepción al acoplar auditoría a tarea ${tareaId}:`, auditEx);
      return;
    }
  }
}

export const coreWorkerHandler = async (event?: any) => {
  // 0. Seguridad de invocación HTTP
  // Si la función es invocada mediante una petición HTTP (curl, navegador, script externo, dev):
  // Se exige de forma estricta que presente el token secreto de autorización (CRON_SECRET).
  // Las llamadas del scheduler interno de Netlify se ejecutan como eventos de infraestructura.
  if (event?.httpMethod) {
    const authHeader = event.headers?.['authorization'] || event.headers?.['Authorization'];
    const cronHeader = event.headers?.['x-cron-secret'] || event.headers?.['X-Cron-Secret'];
    const expectedSecret = process.env.CRON_SECRET;

    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const providedSecret = token || cronHeader;

    if (!expectedSecret || providedSecret !== expectedSecret) {
      console.warn('[WORKER] Intento de acceso HTTP no autorizado al worker de notificaciones.');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'No autorizado. Se requiere CRON_SECRET válido.' }),
      };
    }
  }

  const workerId = `netlify_worker_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Ejecutar mantenimiento y purgas automáticas diarias (idempotente y no bloqueante)
    try {
      const { data: resMantenimiento, error: errMantenimiento } = await supabaseAdmin.rpc('ejecutar_mantenimiento_diario');
      if (errMantenimiento) {
        console.error('[WORKER] Error al ejecutar mantenimiento diario:', errMantenimiento);
      } else if (resMantenimiento?.ejecutado) {
        console.log('[WORKER] Mantenimiento diario ejecutado:', resMantenimiento.resultado);
      }
    } catch (maintErr) {
      console.error('[WORKER] Excepción al invocar mantenimiento diario:', maintErr);
    }

    // 2. Reclamar lote de notificaciones pendientes o abandonadas (SKIP LOCKED)
    const { data: tareas, error: rpcError } = await supabaseAdmin.rpc('reclamar_notificaciones', {
      p_worker_id: workerId,
      p_batch_size: 5,
      p_lock_seconds: 60,
    });

    if (rpcError) {
      console.error('Error al reclamar notificaciones:', rpcError);
      return { statusCode: 500, body: JSON.stringify({ error: 'Error en base de datos' }) };
    }

    if (!tareas || tareas.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ processed: 0, message: 'Cola vacía' }) };
    }

    const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    let procesadas = 0;

    for (const tarea of tareas) {
      try {
        // 3. Pre-Flight Check: Verificar que la cita sigue activa y la tarea no fue invalidada
        const { data: tareaActual, error: checkError } = await supabaseAdmin
          .from('cola_notificaciones_whatsapp')
          .select('estado, citas!inner(estado)')
          .eq('id', tarea.id)
          .single();

        if (
          checkError ||
          !tareaActual ||
          tareaActual.estado !== 'procesando' ||
          (tarea.tipo !== 'cancelacion' && (tareaActual as any).citas?.estado === 'cancelada')
        ) {
          console.log(`[WORKER] Tarea ${tarea.id} descartada en pre-flight: cita cancelada o tarea invalidada.`);
          continue;
        }

        // 4. Modo Simulación (sin credenciales de Meta configuradas):
        if (!whatsappToken || !whatsappPhoneId || whatsappToken.includes('placeholder')) {
          console.log(`[Modo Simulación] Notificación encolada ${tarea.id} para ${tarea.telefono_destino} (${tarea.tipo})`);

          await supabaseAdmin
            .from('cola_notificaciones_whatsapp')
            .update({
              estado: 'simulado',
              message_id: null,
              ultimo_error: 'Modo simulación activo: sin credenciales de Meta WhatsApp configuradas',
              procesado_at: new Date().toISOString(),
            })
            .eq('id', tarea.id)
            .eq('estado', 'procesando');

          procesadas++;
          continue;
        }

        // 5. Llamada real a Meta WhatsApp Cloud API con timeout de 8 segundos
        let metaResponse: Response;
        let metaData: any = null;

        try {
          metaResponse = await fetch(`https://graph.facebook.com/v21.0/${whatsappPhoneId}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${whatsappToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: `52${tarea.telefono_destino}`,
              type: 'text',
              text: { body: `Rehabilita Sport: Tu cita para ${tarea.payload.servicio} el ${tarea.payload.fecha} a las ${tarea.payload.hora} está confirmada. Folio: ${tarea.payload.codigo_reserva}.` },
              biz_opaque_callback_data: tarea.evento_id, // Identificador de correlación para webhooks
            }),
            signal: AbortSignal.timeout(8000),
          });

          try {
            metaData = await metaResponse.json();
          } catch {
            metaData = null;
          }
        } catch (fetchErr: any) {
          console.error(`Fallo de red al conectar con Meta para tarea ${tarea.id}:`, fetchErr);

          // Inspección profunda de causas anidadas (Node 24 / Undici / fetch)
          const code = fetchErr?.cause?.code || fetchErr?.code || '';
          const name = fetchErr?.cause?.name || fetchErr?.name || '';
          const msg = fetchErr?.message || '';

          // 1. Fallos pre-conexión demostrados (DNS o conexión rechazada antes del handshake TCP):
          // En estos casos existe certeza de que ningún paquete HTTP llegó a los servidores de Meta.
          const esFalloPreConexionDemostrado = (
            code === 'ENOTFOUND' ||
            code === 'EAI_AGAIN' ||
            code === 'ECONNREFUSED'
          );

          if (esFalloPreConexionDemostrado) {
            console.log(`[WORKER] Imposibilidad de envío demostrada (${code}). Reprogramando tarea ${tarea.id}.`);
            const nextAttempt = new Date(Date.now() + Math.pow(2, tarea.intentos) * 60000).toISOString();
            const finalStatus = tarea.intentos >= tarea.max_intentos ? 'fallido' : 'pendiente';

            await supabaseAdmin
              .from('cola_notificaciones_whatsapp')
              .update({
                estado: finalStatus,
                ultimo_error: `Fallo pre-conexión demostrado (${code}): ${msg}`,
                next_attempt_at: nextAttempt,
              })
              .eq('id', tarea.id)
              .eq('estado', 'procesando');
            continue;
          }

          // 2. Errores de transporte con resultado externo ambiguo:
          // Timeout (pre/post transmisión), cortes de socket (ECONNRESET, ETIMEDOUT, UND_ERR_SOCKET), etc.
          // El resultado es desconocido: Meta pudo haber procesado la petición. Se marca 'incierto' para no reintentar ciegamente.
          console.warn(`[WORKER] Resultado ambiguo de red (${name} / ${code}) para tarea ${tarea.id}. Marcando como 'incierto'.`);
          await supabaseAdmin
            .from('cola_notificaciones_whatsapp')
            .update({
              estado: 'incierto',
              ultimo_error: `Resultado externo incierto (${name || code}): ${msg}`,
            })
            .eq('id', tarea.id)
            .eq('estado', 'procesando');
          continue;
        }

        // 6. Tratamiento exhaustivo de respuestas HTTP de Meta
        if (metaResponse.ok) {
          const metaMessageId = metaData?.messages?.[0]?.id || null;

          if (metaMessageId) {
            // Caso 6A: Éxito confirmado de Meta con ID válido
            let updatedRows: any = null;
            let updateError: any = null;

            try {
              const resUpdate = await supabaseAdmin
                .from('cola_notificaciones_whatsapp')
                .update({
                  estado: 'enviado',
                  message_id: metaMessageId,
                  procesado_at: new Date().toISOString(),
                })
                .eq('id', tarea.id)
                .eq('estado', 'procesando')
                .select('id');
              updatedRows = resUpdate.data;
              updateError = resUpdate.error;
            } catch (errEx: any) {
              updateError = errEx;
            }

            if (updateError) {
              // 1. Error devuelto o excepción lanzada durante la actualización primaria.
              // Meta YA despachó el mensaje físico. Se debe intentar persistir como 'incierto' con condición optimista.
              console.error(`[CRÍTICO] Mensaje enviado a Meta (ID ${metaMessageId}) pero falló Supabase (Intento 1):`, updateError);

              try {
                const { data: fallbackData, error: fallbackError } = await supabaseAdmin
                  .from('cola_notificaciones_whatsapp')
                  .update({
                    estado: 'incierto',
                    message_id: metaMessageId,
                    ultimo_error: `Despachado a Meta (ID: ${metaMessageId}) pero falló actualización primaria: ${updateError.message || updateError}`,
                    procesado_at: new Date().toISOString(),
                  })
                  .eq('id', tarea.id)
                  .eq('estado', 'procesando')
                  .select('id');

                if (fallbackError) {
                  // 2. Segundo intento de persistencia también fallido:
                  // La BD no respondió o devolvió error. Reclamar_notificaciones() mandará la tarea a cuarentena preventiva al expirar el bloqueo
                  console.error(`[CRÍTICO - SEGUNDO INTENTO FALLIDO] Supabase devolvió error al persistir estado incierto para tarea ${tarea.id}:`, fallbackError);
                } else if (!fallbackData || fallbackData.length === 0) {
                  // HALLAZGO F4.4: Fallback devolvió CERO filas (la tarea ya no estaba en 'procesando', ej. cambió a 'pendiente').
                  // No basta con una advertencia; se debe reconciliar el estado concurrente para no dejarla en estado reclamable.
                  console.warn(`[CONCURRENCIA] Fallback devolvió CERO filas para tarea ${tarea.id} (estado ya no era 'procesando'). Reconciliando estado concurrente...`);
                  await reconciliarEstadoConcurrentePostMeta(supabaseAdmin, tarea.id, metaMessageId);
                } else {
                  console.log(`[WORKER] Tarea ${tarea.id} transicionada exitosamente a 'incierto' en fallback.`);
                }
              } catch (secondErr: any) {
                console.error(`[CRÍTICO - EXCEPCIÓN SEGUNDO INTENTO] Excepción al persistir estado incierto para tarea ${tarea.id}:`, secondErr);
              }
            } else if (!updatedRows || updatedRows.length === 0) {
              // 3. Actualización optimista primaria devolvió CERO filas:
              // Significa que el estado ya no era 'procesando'. Una cancelación, reprogramación o evento concurrente
              // modificó la cita y la cola mientras la petición HTTP a Meta estaba en vuelo.
              console.warn(`[CONCURRENCIA] Tarea ${tarea.id} despachada a Meta (ID: ${metaMessageId}) pero actualización primaria devolvió CERO filas (estado no era 'procesando'). Reconciliando estado concurrente...`);
              await reconciliarEstadoConcurrentePostMeta(supabaseAdmin, tarea.id, metaMessageId);
            }

            procesadas++;
            continue;
          } else {
            // Caso 6B: HTTP 200 pero sin identificador de mensaje (resultado ambiguo)
            console.warn(`[WORKER] Meta devolvió HTTP 200 pero sin messages[0].id para tarea ${tarea.id}. Marcando como 'incierto'.`);
            await supabaseAdmin
              .from('cola_notificaciones_whatsapp')
              .update({
                estado: 'incierto',
                ultimo_error: `Resultado externo ambiguo: HTTP 200 de Meta sin identificador válido (${JSON.stringify(metaData)})`,
                procesado_at: new Date().toISOString(),
              })
              .eq('id', tarea.id)
              .eq('estado', 'procesando');
            continue;
          }
        }

        // Caso 6C: Errores HTTP no exitosos
        const status = metaResponse.status;

        if (status >= 500 && status < 600) {
          // Errores HTTP 5xx: Servidor de Meta con fallo interno. No se garantiza si se procesó.
          // Se trata conservadoramente como 'incierto' para no provocar duplicados.
          console.warn(`[WORKER] Meta devolvió HTTP ${status} para tarea ${tarea.id}. Marcando como 'incierto'.`);
          await supabaseAdmin
            .from('cola_notificaciones_whatsapp')
            .update({
              estado: 'incierto',
              ultimo_error: `Meta HTTP ${status} (Servicio externo no garantizado): ${JSON.stringify(metaData)}`,
            })
            .eq('id', tarea.id)
            .eq('estado', 'procesando');
          continue;
        }

        if (status === 429) {
          // Error HTTP 429: Rate limit de Meta (No procesado, seguro reintentar con backoff exponencial)
          console.warn(`[WORKER] Rate limit HTTP 429 de Meta para tarea ${tarea.id}. Reintentando con backoff.`);
          const nextAttempt = new Date(Date.now() + Math.pow(2, tarea.intentos) * 60000).toISOString();
          await supabaseAdmin
            .from('cola_notificaciones_whatsapp')
            .update({
              estado: 'pendiente',
              ultimo_error: `Meta HTTP 429 Rate Limit: ${JSON.stringify(metaData)}`,
              next_attempt_at: nextAttempt,
            })
            .eq('id', tarea.id)
            .eq('estado', 'procesando');
          continue;
        }

        // Otros errores HTTP 4xx (400, 401, 403, 404): Rechazos definitivos de Meta (no enviado)
        console.warn(`[WORKER] Error de cliente HTTP ${status} de Meta para tarea ${tarea.id}:`, metaData);
        const finalStatus = tarea.intentos >= tarea.max_intentos ? 'fallido' : 'pendiente';
        const nextAttempt = new Date(Date.now() + Math.pow(2, tarea.intentos) * 60000).toISOString();
        await supabaseAdmin
          .from('cola_notificaciones_whatsapp')
          .update({
            estado: finalStatus,
            ultimo_error: `Meta HTTP ${status}: ${JSON.stringify(metaData)}`,
            next_attempt_at: nextAttempt,
          })
          .eq('id', tarea.id)
          .eq('estado', 'procesando');
      } catch (errTarea: any) {
        console.error(`Error procesando tarea ${tarea.id}:`, errTarea);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ processed: procesadas, total: tareas.length }),
    };
  } catch (err: any) {
    console.error('Error general en worker de notificaciones:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error en worker' }) };
  }
};

// Exportación como Netlify Scheduled Function (ejecución periódica cada 1 minuto mediante cron estándar)
// con compatibilidad para invocación manual y local en desarrollo.
export const handler = schedule('* * * * *', coreWorkerHandler);
