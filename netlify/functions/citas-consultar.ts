import * as crypto from 'crypto';
import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido' }),
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Token de autorización ausente' }),
    };
  }

  const rawToken = authHeader.slice(7).trim();
  if (rawToken.length < 32) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Token malformado o inválido' }),
    };
  }

  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
  const ipClean = clientIp.split(',')[0].trim();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Rate Limiting combinado IP + Token (30 consultas por minuto)
    const { data: allowedIpToken, error: rateError1 } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `consulta_${ipClean}_${tokenHash.slice(0, 16)}`,
      p_max_peticiones: 30,
      p_ventana_segundos: 60,
    });

    if (rateError1 || typeof allowedIpToken !== 'boolean') {
      console.error('Error al verificar rate limit (IP) en citas-consultar:', rateError1 || 'Respuesta anómala');
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
        body: JSON.stringify({ error: 'Servicio de validación temporalmente no disponible. Por favor reintente más tarde.' }),
      };
    }

    if (allowedIpToken === false) {
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
        body: JSON.stringify({ error: 'Demasiadas solicitudes. Por favor intente más tarde.' }),
      };
    }

    // 2. Rate Limiting independiente por Token (60 consultas por minuto total entre cualquier IP)
    const { data: allowedToken, error: rateError2 } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `token_consulta_${tokenHash.slice(0, 16)}`,
      p_max_peticiones: 60,
      p_ventana_segundos: 60,
    });

    if (rateError2 || typeof allowedToken !== 'boolean') {
      console.error('Error al verificar rate limit (Token) en citas-consultar:', rateError2 || 'Respuesta anómala');
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
        body: JSON.stringify({ error: 'Servicio de validación temporalmente no disponible. Por favor reintente más tarde.' }),
      };
    }

    if (allowedToken === false) {
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
        body: JSON.stringify({ error: 'Límite de consultas excedido para este enlace. Por favor intente más tarde.' }),
      };
    }

    const { data: cita, error } = await supabaseAdmin
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
        token_expira_at,
        token_revocado_at,
        pacientes (
          nombre_completo,
          consentimiento_whatsapp
        )
      `)
      .eq('token_gestion_hash', tokenHash)
      .is('token_revocado_at', null)
      .gt('token_expira_at', new Date().toISOString())
      .single();

    if (error || !cita) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Cita no encontrada o el enlace ha expirado' }),
      };
    }

    const paciente = Array.isArray(cita.pacientes) ? cita.pacientes[0] : cita.pacientes;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store, max-age=0',
      },
      body: JSON.stringify({
        codigoReserva: cita.codigo_reserva,
        nombreServicio: cita.nombre_servicio_historico,
        fecha: cita.fecha,
        horaInicio: cita.hora_inicio.slice(0, 5),
        horaFin: cita.hora_fin.slice(0, 5),
        duracionMinutos: cita.duracion_minutos_historica,
        estado: cita.estado,
        nombrePaciente: (paciente as any)?.nombre_completo || 'Paciente',
        consentimientoWhatsApp: (paciente as any)?.consentimiento_whatsapp || false,
      }),
    };
  } catch (err: any) {
    console.error('Error en citas-consultar:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};
