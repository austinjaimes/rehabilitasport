import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';
import { validarAdminRequest, esFechaValidaUTC } from '../../src/lib/adminAuth';

const CITAS_MOCK = [
  {
    id: 'cita-mock-1',
    codigo_reserva: 'RS-8A2F',
    fecha: new Date().toISOString().slice(0, 10),
    hora_inicio: '10:00:00',
    hora_fin: '11:00:00',
    duracion_minutos_historica: 60,
    nombre_servicio_historico: '[PRUEBA] Fisioterapia General',
    estado: 'confirmada',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    pacientes: {
      nombre_completo: 'Carlos Eduardo Ramírez',
      telefono_whatsapp: '7331122334',
      email: 'carlos.ramirez@ejemplo.com',
      consentimiento_whatsapp: true,
    },
  },
  {
    id: 'cita-mock-2',
    codigo_reserva: 'RS-4B9C',
    fecha: new Date().toISOString().slice(0, 10),
    hora_inicio: '12:00:00',
    hora_fin: '13:00:00',
    duracion_minutos_historica: 60,
    nombre_servicio_historico: '[PRUEBA] Rehabilitación Deportiva',
    estado: 'confirmada',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    pacientes: {
      nombre_completo: 'Mariana López Castro',
      telefono_whatsapp: '7339876543',
      email: null,
      consentimiento_whatsapp: false,
    },
  },
  {
    id: 'cita-mock-3',
    codigo_reserva: 'RS-1D7E',
    fecha: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    hora_inicio: '09:00:00',
    hora_fin: '10:00:00',
    duracion_minutos_historica: 60,
    nombre_servicio_historico: '[PRUEBA] Terapia en Cámara Hiperbárica',
    estado: 'confirmada',
    created_at: new Date(Date.now() - 10800000).toISOString(),
    pacientes: {
      nombre_completo: 'Roberto Gómez Bolaños',
      telefono_whatsapp: '7335551234',
      email: 'roberto.gomez@ejemplo.com',
      consentimiento_whatsapp: true,
    },
  },
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  confirmada: ['atendida', 'no_asistio', 'cancelada'],
  no_asistio: ['atendida', 'confirmada', 'cancelada'],
};

export const handler = async (event: any) => {
  const isLocalDev = process.env.NETLIFY_DEV === 'true';

  // Validación de seguridad y autorización administrativa en servidor (Asíncrono)
  const auth = await validarAdminRequest(event);
  if (!auth.autorizado) {
    return {
      statusCode: auth.statusCode || 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: auth.error || 'No autorizado' }),
    };
  }

  const method = (event.httpMethod || 'GET').toUpperCase();

  // 1. GET: Consultar citas con filtros opcionales de fecha y estado
  if (method === 'GET') {
    const { fecha, estado } = event.queryStringParameters || {};

    // Validación de fecha si fue provista
    if (fecha) {
      if (!esFechaValidaUTC(fecha)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'El parámetro fecha debe ser una fecha gregoriana válida con formato YYYY-MM-DD',
          }),
        };
      }
    }

    // Validación de estado si fue provisto
    const estadosValidos = ['todas', 'confirmada', 'atendida', 'cancelada', 'no_asistio'];
    if (estado && !estadosValidos.includes(estado)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'El filtro de estado no es válido. Opciones: todas, confirmada, atendida, cancelada, no_asistio',
        }),
      };
    }

    try {
      const supabaseAdmin = getSupabaseAdmin();
      let query = supabaseAdmin
        .from('citas')
        .select(`
          id,
          codigo_reserva,
          fecha,
          hora_inicio,
          hora_fin,
          duracion_minutos_historica,
          nombre_servicio_historico,
          estado,
          motivo_cancelacion,
          created_at,
          pacientes (
            id,
            nombre_completo,
            telefono_whatsapp,
            email,
            consentimiento_whatsapp
          )
        `)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true });

      if (fecha) {
        query = query.eq('fecha', fecha);
      }
      if (estado && estado !== 'todas') {
        query = query.eq('estado', estado);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error al consultar citas en Supabase:', error);

        // Fallback simulado ÚNICAMENTE en entorno de desarrollo local
        if (isLocalDev) {
          let filtradas = [...CITAS_MOCK];
          if (fecha) filtradas = filtradas.filter((c) => c.fecha === fecha);
          if (estado && estado !== 'todas') filtradas = filtradas.filter((c) => c.estado === estado);

          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ citas: filtradas, modo: 'simulado_dev' }),
          };
        }

        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error al consultar las citas' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ citas: data || [], modo: 'real' }),
      };
    } catch (err: any) {
      console.error('Error inesperado en admin-citas GET:', err);

      if (isLocalDev) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ citas: CITAS_MOCK, modo: 'simulado_dev' }),
        };
      }

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error interno del servidor' }),
      };
    }
  }

  // 2. PATCH o POST: Actualizar estado de una cita (atendida, cancelada, no_asistio, confirmada)
  if (method === 'PATCH' || method === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { citaId, nuevoEstado, motivoCancelacion } = body;

      if (!citaId || !nuevoEstado) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Faltan parámetros requeridos (citaId, nuevoEstado)' }),
        };
      }

      // Validación de UUID
      const esUuidValido = UUID_REGEX.test(citaId);
      const esMockDevValido = isLocalDev && typeof citaId === 'string' && citaId.startsWith('cita-mock-');

      if (!esUuidValido && !esMockDevValido) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El parámetro citaId debe ser un identificador UUID válido' }),
        };
      }

      const estadosValidos = ['confirmada', 'atendida', 'cancelada', 'no_asistio'];
      if (!estadosValidos.includes(nuevoEstado)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Estado no válido. Opciones: confirmada, atendida, cancelada, no_asistio' }),
        };
      }

      // Validación de longitud de motivoCancelacion
      if (motivoCancelacion !== undefined && motivoCancelacion !== null) {
        if (typeof motivoCancelacion !== 'string' || motivoCancelacion.trim().length > 500) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'El motivo de cancelación no debe exceder los 500 caracteres' }),
          };
        }
      }

      const supabaseAdmin = getSupabaseAdmin();

      // Desarrollo local con mocks simulados
      if (esMockDevValido) {
        const citaMock = CITAS_MOCK.find((c) => c.id === citaId);
        if (!citaMock) {
          return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Cita no encontrada' }),
          };
        }

        const transicionesPermitidas = TRANSICIONES_VALIDAS[citaMock.estado] || [];
        if (!transicionesPermitidas.includes(nuevoEstado)) {
          return {
            statusCode: 409,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: `Transición de estado no permitida de "${citaMock.estado}" a "${nuevoEstado}"`,
              code: 'TRANSICION_INVALIDA',
            }),
          };
        }

        citaMock.estado = nuevoEstado;
        if (nuevoEstado === 'cancelada') {
          (citaMock as any).motivo_cancelacion = motivoCancelacion?.trim() || 'Cancelada por el administrador';
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, citaId, nuevoEstado, modo: 'simulado_dev' }),
        };
      }

      // Paso 1: Consultar estado actual en la base de datos
      const { data: citaActual, error: consultaError } = await supabaseAdmin
        .from('citas')
        .select('id, estado')
        .eq('id', citaId)
        .maybeSingle();

      if (consultaError) {
        console.error('Error al consultar cita en Supabase:', consultaError);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error al consultar la cita' }),
        };
      }

      if (!citaActual) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Cita no encontrada' }),
        };
      }

      // Paso 2: Validar que la transición esté autorizada en la matriz de estados
      const transicionesPermitidas = TRANSICIONES_VALIDAS[citaActual.estado] || [];
      if (!transicionesPermitidas.includes(nuevoEstado)) {
        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: `Transición de estado no permitida de "${citaActual.estado}" a "${nuevoEstado}"`,
            code: 'TRANSICION_INVALIDA',
          }),
        };
      }

      // Si el nuevo estado es 'cancelada', invocar la RPC canónica con bloqueo FOR UPDATE
      // e invalidación atómica de cola de notificaciones dentro de la misma transacción PostgreSQL
      if (nuevoEstado === 'cancelada') {
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('cancelar_cita_administrativa', {
          p_cita_id: citaId,
          p_motivo: motivoCancelacion?.trim() || 'Cancelada por el administrador',
        });

        if (rpcError) {
          console.error('Error al invocar RPC cancelar_cita_administrativa:', rpcError);
          return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Error al cancelar la cita en la base de datos' }),
          };
        }

        if (!rpcResult || rpcResult.success === false) {
          const code = rpcResult?.code;
          const status = (code === 'CITA_YA_CANCELADA' || code === 'TRANSICION_INVALIDA')
            ? 409
            : (code === 'CITA_NO_ENCONTRADA' ? 404 : 400);

          return {
            statusCode: status,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: rpcResult?.message || 'No se pudo cancelar la cita',
              code: rpcResult?.code || 'ERROR_CANCELACION',
            }),
          };
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            citaId,
            nuevoEstado: 'cancelada',
            notificacionesInvalidadas: rpcResult.notificaciones_invalidadas,
            modo: 'real',
          }),
        };
      }

      // Paso 3: Control de concurrencia mediante actualización optimista (OCC) para otros estados (atendida, no_asistio, confirmada)
      // La condición .eq('estado', citaActual.estado) garantiza atómicamente a nivel de fila
      // que ninguna transacción paralela haya alterado el estado entre la lectura y este update.
      const updateData: any = {
        estado: nuevoEstado,
        updated_at: new Date().toISOString(),
      };

      const { data: citaActualizada, error: updateError } = await supabaseAdmin
        .from('citas')
        .update(updateData)
        .eq('id', citaId)
        .eq('estado', citaActual.estado)
        .select('id, estado')
        .maybeSingle();

      if (updateError) {
        console.error('Error al actualizar cita en Supabase:', updateError);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error al actualizar el estado de la cita' }),
        };
      }

      // Si no se actualizó ninguna fila, otra operación modificó el estado concurrentemente
      if (!citaActualizada) {
        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Conflicto de concurrencia: el estado de la cita fue modificado por otra operación simultánea',
            code: 'CONFLICTO_CONCURRENCIA',
          }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, citaId, nuevoEstado, modo: 'real' }),
      };
    } catch (err: any) {
      console.error('Error inesperado en admin-citas update:', err);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error al actualizar el estado de la cita' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Método no permitido' }),
  };
};
