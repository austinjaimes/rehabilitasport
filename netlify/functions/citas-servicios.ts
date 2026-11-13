import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';
import type { Servicio } from '../../src/lib/types/database.types';

const SERVICIOS_FALLBACK: Servicio[] = [
  {
    id: '00000000-0000-0000-0000-000000000010',
    nombre: '[PRUEBA] Fisioterapia General',
    descripcion: 'Sesión integral de valoración y terapia física personalizada para alivio del dolor y recuperación de movilidad.',
    duracion_minutos: 60,
    activo: true,
    orden: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000020',
    nombre: '[PRUEBA] Rehabilitación Deportiva',
    descripcion: 'Tratamiento especializado en readaptación funcional, recuperación muscular y prevención de lesiones.',
    duracion_minutos: 60,
    activo: true,
    orden: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000030',
    nombre: '[PRUEBA] Terapia en Cámara Hiperbárica',
    descripcion: 'Sesión de oxigenación a presión controlada para regeneración tisular y desinflamación.',
    duracion_minutos: 60,
    activo: true,
    orden: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000040',
    nombre: '[PRUEBA] Consulta de Valoración Ortopédica',
    descripcion: 'Evaluación y diagnóstico inicial de traumatología, articulaciones y columna.',
    duracion_minutos: 60,
    activo: true,
    orden: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const handler = async (event: any) => {
  const isLocalDev = process.env.NETLIFY_DEV === 'true';

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido' }),
    };
  }

  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
  const ipClean = clientIp.split(',')[0].trim();

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Rate Limiting: 60 solicitudes por minuto por IP
    const { data: allowed, error: rateError } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: `servicios_${ipClean}`,
      p_max_peticiones: 60,
      p_ventana_segundos: 60,
    });

    if (rateError || typeof allowed !== 'boolean') {
      console.error('Error al verificar rate limit en citas-servicios:', rateError || 'Respuesta anómala');
      if (!isLocalDev) {
        return {
          statusCode: 503,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
          },
          body: JSON.stringify({ error: 'Servicio temporalmente no disponible. Por favor reintente más tarde.' }),
        };
      }
    }

    if (!rateError && allowed === false) {
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
        body: JSON.stringify({ error: 'Demasiadas solicitudes. Por favor intente más tarde.' }),
      };
    }

    const { data: servicios, error } = await supabaseAdmin
      .from('servicios')
      .select('id, nombre, descripcion, duracion_minutos, activo, orden, created_at, updated_at')
      .eq('activo', true)
      .order('orden', { ascending: true });

    if (error) {
      console.error('Error al consultar servicios en Supabase:', error);
      if (isLocalDev) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
          body: JSON.stringify(SERVICIOS_FALLBACK),
        };
      }
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
        body: JSON.stringify({ error: 'Servicio de catálogo temporalmente no disponible' }),
      };
    }

    if (!servicios || servicios.length === 0) {
      if (isLocalDev) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
          body: JSON.stringify(SERVICIOS_FALLBACK),
        };
      }
      return {
        statusCode: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
        body: JSON.stringify({ error: 'No hay servicios disponibles en este momento. Por favor intente más tarde.' }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60',
      },
      body: JSON.stringify(servicios),
    };
  } catch (err: any) {
    console.error('Error inesperado en citas-servicios:', err);
    if (isLocalDev) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify(SERVICIOS_FALLBACK),
      };
    }
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '30',
      },
      body: JSON.stringify({ error: 'Servicio temporalmente no disponible' }),
    };
  }
};

