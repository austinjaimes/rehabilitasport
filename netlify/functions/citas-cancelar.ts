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

    // 1. Rate Limiting combinado IP + Token (5 cancelaciones cada 5 minutos)
    const { data: allowedIpToken, error: rateError1 } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `cancelar_${ipClean}_${tokenHash.slice(0, 16)}`,
      p_max_peticiones: 5,
      p_ventana_segundos: 300,
    });

    if (rateError1 || typeof allowedIpToken !== 'boolean') {
      console.error('Error al verificar rate limit (IP) en citas-cancelar:', rateError1 || 'Respuesta anómala');
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
        body: JSON.stringify({ error: 'Demasiadas solicitudes. Por favor intente más tarde.' }),
      };
    }

    // 2. Rate Limiting independiente por Token (10 intentos cada 5 minutos total)
    const { data: allowedToken, error: rateError2 } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `token_cancelar_${tokenHash.slice(0, 16)}`,
      p_max_peticiones: 10,
      p_ventana_segundos: 300,
    });

    if (rateError2 || typeof allowedToken !== 'boolean') {
      console.error('Error al verificar rate limit (Token) en citas-cancelar:', rateError2 || 'Respuesta anómala');
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
        body: JSON.stringify({ error: 'Límite de solicitudes de cancelación alcanzado para esta cita. Por favor intente más tarde.' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { motivo = 'Cancelado por el paciente' } = body;
    const eventoId = crypto.randomUUID();

    const { data: result, error: rpcError } = await supabaseAdmin.rpc('cancelar_cita_atomica', {
      p_token_hash: tokenHash,
      p_motivo: motivo,
      p_evento_id: eventoId,
    });

    if (rpcError) {
      console.error('Error en RPC cancelar_cita_atomica:', rpcError);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error al cancelar la cita' }),
      };
    }

    if (!result || result.success === false) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err: any) {
    console.error('Error no controlado en citas-cancelar:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};
