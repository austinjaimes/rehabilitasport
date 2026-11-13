import * as crypto from 'crypto';
import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido' }),
    };
  }

  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Rate Limiting Persistente
    const { data: allowed, error: rateError } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `reserva_${clientIp.split(',')[0].trim()}`,
      p_max_peticiones: 5,
      p_ventana_segundos: 300, // 5 peticiones cada 5 minutos
    });

    if (rateError || typeof allowed !== 'boolean') {
      console.error('Error al verificar rate limit en citas-reservar:', rateError || 'Respuesta anómala');
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
        body: JSON.stringify({ error: 'Servicio de validación temporalmente no disponible. Por favor reintente más tarde.' }),
      };
    }

    if (allowed === false) {
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '300',
        },
        body: JSON.stringify({ error: 'Demasiadas solicitudes. Por favor intente más tarde.' }),
      };
    }

    // 2. Parseo y Validación
    const body = JSON.parse(event.body || '{}');
    const {
      servicioId,
      fecha,
      horaInicio,
      nombreCompleto,
      telefonoWhatsApp,
      email,
      consentimientoWhatsApp = false,
    } = body;

    if (!servicioId || !fecha || !horaInicio || !nombreCompleto || !telefonoWhatsApp) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Campos requeridos incompletos' }),
      };
    }

    // Formatear teléfono a 10 dígitos limpios
    const cleanPhone = telefonoWhatsApp.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El número de teléfono debe contener 10 dígitos válidos' }),
      };
    }

    // Validación de formato de correo si fue provisto
    if (email && email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El correo electrónico proporcionado tiene un formato inválido' }),
        };
      }
    }

    // 3. Generación criptográfica del token (32 bytes aleatorios = 64 hex)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Generar código de reserva corto (ej. RS-8A2F)
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    const codigoReserva = `RS-${randomHex}`;

    // Generar evento único para idempotencia de notificación
    const eventoId = crypto.randomUUID();

    // 4. Invocación atómica en Supabase
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('crear_cita_atomica', {
      p_servicio_id: servicioId,
      p_fecha: fecha,
      p_hora_inicio: horaInicio,
      p_nombre_completo: nombreCompleto.trim(),
      p_telefono: cleanPhone,
      p_email: email ? email.trim().toLowerCase() : null,
      p_consentimiento_whatsapp: Boolean(consentimientoWhatsApp),
      p_codigo_reserva: codigoReserva,
      p_token_hash: tokenHash,
      p_evento_id: eventoId,
    });

    if (rpcError) {
      console.error('Error en RPC crear_cita_atomica:', rpcError);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error al procesar la reserva' }),
      };
    }

    if (!result || result.success === false) {
      const status = result?.code === 'HORARIO_OCUPADO' ? 409 : 400;
      return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      };
    }

    // Respuesta exitosa: el token en texto plano se entrega exclusivamente aquí
    // para que el cliente lo monte en el fragmento (#token=...)
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        // Contrato primario camelCase (consumido por StepSuccess.tsx y booking.types.ts)
        citaId: result.cita_id,
        codigoReserva: result.codigo_reserva,
        servicio: result.servicio,
        fecha: result.fecha,
        horaInicio: typeof result.hora_inicio === 'string' ? result.hora_inicio.slice(0, 5) : result.hora_inicio,
        horaFin: typeof result.hora_fin === 'string' ? result.hora_fin.slice(0, 5) : result.hora_fin,
        tokenPlano: rawToken,

        // Alias de compatibilidad backward-compatible con SQL nativo
        cita_id: result.cita_id,
        codigo_reserva: result.codigo_reserva,
        hora_inicio: result.hora_inicio,
        hora_fin: result.hora_fin,
      }),
    };
  } catch (err: any) {
    console.error('Error no controlado en citas-reservar:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};

