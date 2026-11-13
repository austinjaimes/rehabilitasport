import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';
import { validarAdminRequest } from '../../src/lib/adminAuth';

const SERVICIOS_DEFAULT = [
  {
    id: 's1-fisioterapia-general',
    nombre: '[PRUEBA] Fisioterapia General',
    descripcion: 'Sesión integral de valoración y terapia física personalizada para alivio del dolor y movilidad.',
    duracion_minutos: 60,
    activo: true,
    orden: 1,
  },
  {
    id: 's2-rehabilitacion-deportiva',
    nombre: '[PRUEBA] Rehabilitación Deportiva',
    descripcion: 'Tratamiento especializado en readaptación funcional, recuperación muscular y prevención de lesiones.',
    duracion_minutos: 60,
    activo: true,
    orden: 2,
  },
  {
    id: 's3-camara-hiperbarica',
    nombre: '[PRUEBA] Terapia en Cámara Hiperbárica',
    descripcion: 'Sesión de oxigenación a presión controlada para regeneración tisular y desinflamación.',
    duracion_minutos: 60,
    activo: true,
    orden: 3,
  },
  {
    id: 's4-valoracion-ortopedica',
    nombre: '[PRUEBA] Consulta de Valoración Ortopédica',
    descripcion: 'Evaluación y diagnóstico inicial de traumatología, articulaciones y columna.',
    duracion_minutos: 60,
    activo: false,
    orden: 4,
  },
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // 1. GET: Listar todos los servicios (activos e inactivos)
  if (method === 'GET') {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin
        .from('servicios')
        .select('*')
        .order('orden', { ascending: true });

      if (error) {
        console.error('Error al consultar servicios en Supabase:', error);

        if (isLocalDev) {
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ servicios: SERVICIOS_DEFAULT, modo: 'simulado_dev' }),
          };
        }

        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error al consultar los servicios' }),
        };
      }

      if ((!data || data.length === 0) && isLocalDev) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servicios: SERVICIOS_DEFAULT, modo: 'simulado_dev' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servicios: data || [], modo: 'real' }),
      };
    } catch (err: any) {
      console.error('Error inesperado en admin-servicios GET:', err);

      if (isLocalDev) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servicios: SERVICIOS_DEFAULT, modo: 'simulado_dev' }),
        };
      }

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error interno del servidor' }),
      };
    }
  }

  // 2. POST: Crear o Editar Servicio
  if (method === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { id, nombre, descripcion, duracionMinutos = 60, orden = 0 } = body;

      // Validación estricta del campo activo (VAL-01)
      let activoVal = true;
      if ('activo' in body && body.activo !== undefined) {
        if (typeof body.activo !== 'boolean') {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'El campo activo debe ser un valor booleano (true o false)' }),
          };
        }
        activoVal = body.activo;
      }

      // Validación de nombre (obligatorio, máximo 120 caracteres)
      if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El nombre del servicio es obligatorio' }),
        };
      }

      if (nombre.trim().length > 120) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El nombre del servicio no debe exceder los 120 caracteres' }),
        };
      }

      // Validación de descripción (máximo 500 caracteres)
      if (descripcion !== undefined && descripcion !== null) {
        if (typeof descripcion !== 'string' || descripcion.trim().length > 500) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'La descripción no debe exceder los 500 caracteres' }),
          };
        }
      }

      // Validación de duración
      const duracion = parseInt(duracionMinutos, 10);
      if (isNaN(duracion) || duracion < 15 || duracion > 480) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'La duración debe ser un número entero entre 15 y 480 minutos' }),
        };
      }

      // Validación de orden (entero >= 0)
      const ordenNum = parseInt(orden, 10);
      if (isNaN(ordenNum) || ordenNum < 0) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El orden debe ser un número entero mayor o igual a cero' }),
        };
      }

      // Validación de ID si se proporciona (edición)
      if (id !== undefined && id !== null) {
        const esUuidValido = UUID_REGEX.test(id);
        const esMockDev = isLocalDev && typeof id === 'string' && (id.startsWith('s') || id.startsWith('serv_'));
        if (!esUuidValido && !esMockDev) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'El identificador id del servicio debe ser un UUID válido' }),
          };
        }
      }

      const supabaseAdmin = getSupabaseAdmin();

      if (id) {
        // Actualizar servicio existente
        const { data, error } = await supabaseAdmin
          .from('servicios')
          .update({
            nombre: nombre.trim(),
            descripcion: descripcion?.trim() || null,
            duracion_minutos: duracion,
            activo: activoVal,
            orden: ordenNum,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .select()
          .single();

        if (error) {
          console.error('Error al actualizar servicio en Supabase:', error);

          if (isLocalDev) {
            console.warn('Simulando guardado para servicio mock en desarrollo local:', id);
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                servicio: {
                  id,
                  nombre: nombre.trim(),
                  descripcion: descripcion?.trim() || null,
                  duracion_minutos: duracion,
                  activo: activoVal,
                  orden: ordenNum,
                },
                modo: 'simulado_dev',
              }),
            };
          }

          return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Error al actualizar el servicio' }),
          };
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servicio: data, modo: 'real' }),
        };
      } else {
        // Insertar nuevo servicio
        const { data, error } = await supabaseAdmin
          .from('servicios')
          .insert({
            nombre: nombre.trim(),
            descripcion: descripcion?.trim() || null,
            duracion_minutos: duracion,
            activo: activoVal,
            orden: ordenNum,
          })
          .select()
          .single();

        if (error) {
          console.error('Error al crear servicio en Supabase:', error);

          if (isLocalDev) {
            const fakeId = `serv_${Date.now()}`;
            return {
              statusCode: 201,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                servicio: {
                  id: fakeId,
                  nombre: nombre.trim(),
                  descripcion: descripcion?.trim() || null,
                  duracion_minutos: duracion,
                  activo: activoVal,
                  orden: ordenNum,
                },
                modo: 'simulado_dev',
              }),
            };
          }

          return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Error al crear el servicio' }),
          };
        }

        return {
          statusCode: 201,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servicio: data, modo: 'real' }),
        };
      }
    } catch (err: any) {
      console.error('Error inesperado en admin-servicios POST:', err);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error al procesar el servicio' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Método no permitido' }),
  };
};
