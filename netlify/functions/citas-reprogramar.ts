import * as crypto from 'crypto';
import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';

function esFechaValidaUTC(fechaStr: string): boolean {
  if (typeof fechaStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return false;
  const [año, mes, dia] = fechaStr.split('-').map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const d = new Date(Date.UTC(año, mes - 1, dia));
  return (
    d.getUTCFullYear() === año &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia
  );
}

const HORA_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
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

  const rawTokenActual = authHeader.slice(7).trim();
  if (rawTokenActual.length < 32) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Token malformado o inválido' }),
    };
  }

  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
  const ipClean = clientIp.split(',')[0].trim();
  const tokenHashActual = crypto.createHash('sha256').update(rawTokenActual).digest('hex');

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Rate Limiting combinado IP + Token (5 reprogramaciones cada 5 minutos)
    const { data: allowedIpToken, error: rateError1 } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `reprogramar_${ipClean}_${tokenHashActual.slice(0, 16)}`,
      p_max_peticiones: 5,
      p_ventana_segundos: 300,
    });

    if (rateError1 || typeof allowedIpToken !== 'boolean') {
      console.error('Error al verificar rate limit (IP) en citas-reprogramar:', rateError1 || 'Respuesta anómala');
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
          'Retry-After': '300',
        },
        body: JSON.stringify({ error: 'Demasiadas solicitudes de reprogramación. Por favor intente más tarde.' }),
      };
    }

    // 2. Rate Limiting independiente por Token (10 intentos cada 5 minutos total)
    const { data: allowedToken, error: rateError2 } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `token_reprogramar_${tokenHashActual.slice(0, 16)}`,
      p_max_peticiones: 10,
      p_ventana_segundos: 300,
    });

    if (rateError2 || typeof allowedToken !== 'boolean') {
      console.error('Error al verificar rate limit (Token) en citas-reprogramar:', rateError2 || 'Respuesta anómala');
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
          'Retry-After': '300',
        },
        body: JSON.stringify({ error: 'Límite de reprogramación alcanzado para esta cita. Por favor intente más tarde.' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { nuevaFecha, nuevaHoraInicio } = body;

    if (!nuevaFecha || !nuevaHoraInicio) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Nueva fecha y hora requeridas' }),
      };
    }

    // Validación estricta de fecha gregoriana UTC (VAL-02)
    if (typeof nuevaFecha !== 'string' || !esFechaValidaUTC(nuevaFecha)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'La nueva fecha debe ser una fecha gregoriana válida con formato YYYY-MM-DD' }),
      };
    }

    // Validación estricta de hora 24h HH:mm (VAL-02)
    if (typeof nuevaHoraInicio !== 'string' || !HORA_REGEX.test(nuevaHoraInicio)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'La nueva hora debe tener formato válido de 24 horas (HH:mm, de 00:00 a 23:59)' }),
      };
    }

    // Generar nuevo token para rotación de seguridad
    const nuevoRawToken = crypto.randomBytes(32).toString('hex');
    const nuevoTokenHash = crypto.createHash('sha256').update(nuevoRawToken).digest('hex');
    const eventoId = crypto.randomUUID();

    const { data: result, error: rpcError } = await supabaseAdmin.rpc('reprogramar_cita_atomica', {
      p_token_hash_actual: tokenHashActual,
      p_nueva_fecha: nuevaFecha,
      p_nueva_hora_inicio: nuevaHoraInicio,
      p_nuevo_token_hash: nuevoTokenHash,
      p_evento_id: eventoId,
    });

    if (rpcError) {
      console.error('Error en RPC reprogramar_cita_atomica:', rpcError);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error al reprogramar la cita' }),
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Referrer-Policy': 'no-referrer',
      },
      body: JSON.stringify({
        success: true,
        // Contrato primario camelCase
        codigoReserva: result.codigo_reserva,
        servicio: result.servicio,
        nuevaFecha: result.nueva_fecha,
        nuevaHoraInicio: typeof result.nueva_hora_inicio === 'string' ? result.nueva_hora_inicio.slice(0, 5) : result.nueva_hora_inicio,
        nuevaHoraFin: typeof result.nueva_hora_fin === 'string' ? result.nueva_hora_fin.slice(0, 5) : result.nueva_hora_fin,
        nuevoTokenPlano: nuevoRawToken,

        // Alias backward-compatible requeridos por GestionCita.tsx y SQL
        codigo_reserva: result.codigo_reserva,
        nueva_fecha: result.nueva_fecha,
        nueva_hora_inicio: result.nueva_hora_inicio,
        nueva_hora_fin: result.nueva_hora_fin,
      }),
    };
  } catch (err: any) {
    console.error('Error no controlado en citas-reprogramar:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};
