import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';

// Criterio exclusivo para desarrollo local (Ajuste 1)
const isLocalDev = process.env.NETLIFY_DEV === 'true';

// Rate limiter en memoria exclusivo para desarrollo local (60 req/min)
const devRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function verificarRateLimitDev(ip: string, maxPeticiones: number = 60, ventanaSegundos: number = 60): boolean {
  const ahora = Date.now();
  const registro = devRateLimitMap.get(ip);
  if (!registro || ahora > registro.resetAt) {
    devRateLimitMap.set(ip, { count: 1, resetAt: ahora + ventanaSegundos * 1000 });
    return true;
  }
  if (registro.count >= maxPeticiones) {
    return false;
  }
  registro.count++;
  return true;
}

// Validador estricto de fecha real en calendario gregoriano en UTC (Ajuste 1 y 4)
function esFechaValidaUTC(fechaStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return false;
  const [año, mes, dia] = fechaStr.split('-').map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const d = new Date(Date.UTC(año, mes - 1, dia));
  return (
    d.getUTCFullYear() === año &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia
  );
}

// Generador dinámico de horarios oficiales de Rehabilita Sport en UTC (Ajuste 1)
function generarHorariosSimuladosUTC(fechaStr: string, duracionMinutos: number, pasoMinutos: number = 30): string[] {
  const [año, mes, dia] = fechaStr.split('-').map(Number);
  const d = new Date(Date.UTC(año, mes - 1, dia));
  const diaSemana = d.getUTCDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado

  let aperturaMin = 0;
  let cierreMin = 0;

  if (diaSemana >= 1 && diaSemana <= 5) {
    // Lunes a Viernes: 08:00 a 18:00
    aperturaMin = 8 * 60;
    cierreMin = 18 * 60;
  } else if (diaSemana === 6) {
    // Sábado: 09:00 a 13:00
    aperturaMin = 9 * 60;
    cierreMin = 13 * 60;
  } else {
    // Domingo (0): cerrado
    return [];
  }

  const slots: string[] = [];
  // Ninguna cita puede terminar después de la hora de cierre
  for (let m = aperturaMin; m + duracionMinutos <= cierreMin; m += pasoMinutos) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido' }),
    };
  }

  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
  const ipClean = clientIp.split(',')[0].trim();

  const { fecha, duracion = '60', paso = '30' } = event.queryStringParameters || {};

  // Validación estricta de existencia real de fecha en UTC (Ajuste 4)
  if (!fecha || typeof fecha !== 'string' || !esFechaValidaUTC(fecha)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Parámetro fecha inválido o inexistente en el calendario. Formato requerido: YYYY-MM-DD' }),
    };
  }

  // Validación numérica estricta previa a la conversión (Ajuste 4)
  if (typeof duracion !== 'string' || !/^\d+$/.test(duracion) || typeof paso !== 'string' || !/^\d+$/.test(paso)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Parámetros duracion y paso deben ser cadenas de dígitos enteros positivos' }),
    };
  }

  const duracionNum = parseInt(duracion, 10);
  const pasoNum = parseInt(paso, 10);
  if (duracionNum < 15 || duracionNum > 240 || pasoNum < 15 || pasoNum > 120) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Parámetros duracion (15-240 min) o paso (15-120 min) fuera del rango permitido' }),
    };
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Rate Limiting Persistente: 60 consultas de disponibilidad por minuto por IP
    const { data: allowed, error: rateError } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `disponibilidad_${ipClean}`,
      p_max_peticiones: 60,
      p_ventana_segundos: 60,
    });

    // 1. HTTP 429 exclusivamente cuando el rate limiter confirma que se superó la cuota real
    if (allowed === false) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Demasiadas solicitudes de disponibilidad. Por favor intente más tarde.' }),
      };
    }

    // 2. Si no se confirmó explícitamente allowed === true (sea por rateError o resultado inesperado) (Ajuste 4)
    if (rateError || allowed !== true) {
      if (rateError) {
        console.error('Error en verificar_rate_limit de citas-disponibilidad:', rateError);
      } else {
        console.error('Resultado anómalo en verificar_rate_limit (allowed no es booleano true):', allowed);
      }

      if (!isLocalDev) {
        // En producción: Fail-closed con 503 para no permitir accesos no protegidos
        return {
          statusCode: 503,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
          },
          body: JSON.stringify({ error: 'Servicio de validación temporalmente no disponible. Por favor reintente más tarde.' }),
        };
      }

      // En desarrollo local: aplicar rate limit en memoria (60 req/min) para no quedar desprotegido
      if (!verificarRateLimitDev(ipClean, 60, 60)) {
        return {
          statusCode: 429,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Demasiadas solicitudes de disponibilidad en desarrollo local.' }),
        };
      }
      console.warn('[DEV] Rate limit de Supabase no confirmado; aplicando protección local en memoria.');
    }

    const { data, error } = await supabaseAdmin.rpc('obtener_horarios_disponibles', {
      p_fecha: fecha,
      p_duracion_minutos: duracionNum,
      p_paso_minutos: pasoNum,
    });

    if (error) {
      console.error('Error al consultar horarios:', error);

      // Clasificación estricta de errores de infraestructura o RPC inexistente (Ajuste 3)
      const codigoError = error.code || '';
      const mensajeError = error.message || '';

      const esRPCInexistente = codigoError === 'PGRST202' || codigoError === '42883';
      const esFalloRed =
        mensajeError.includes('fetch failed') ||
        mensajeError.includes('ENOTFOUND') ||
        mensajeError.includes('ECONNREFUSED') ||
        mensajeError.includes('Invalid supabaseUrl');
      const esConfigPlaceholder =
        !process.env.PUBLIC_SUPABASE_URL ||
        process.env.PUBLIC_SUPABASE_URL.includes('placeholder-rehabilitasport');

      const esErrorInfraestructura = esRPCInexistente || esFalloRed || esConfigPlaceholder;

      // Fallback dinámico SOLO en desarrollo local y SOLO ante fallos demostrables de infraestructura
      if (isLocalDev && esErrorInfraestructura) {
        const slotsSimulados = generarHorariosSimuladosUTC(fecha, duracionNum, pasoNum);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
          body: JSON.stringify({ fecha, slots: slotsSimulados, modo: 'simulado_dev' }),
        };
      }

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error al consultar disponibilidad' }),
      };
    }

    const slots = (data || []).map((row: any) => row.hora_slot.slice(0, 5)); // 'HH:MM'

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
      body: JSON.stringify({ fecha, slots }),
    };
  } catch (err: any) {
    console.error('Error inesperado en citas-disponibilidad:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};
