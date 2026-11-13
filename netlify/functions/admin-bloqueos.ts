import { getSupabaseAdmin } from '../../src/lib/supabaseAdmin';
import { validarAdminRequest, esFechaValidaUTC } from '../../src/lib/adminAuth';

const BLOQUEOS_MOCK = [
  {
    id: 'bloqueo-mock-1',
    fecha: new Date().toISOString().slice(0, 10),
    hora_inicio: '14:00:00',
    hora_fin: '15:00:00',
    motivo: 'Capacitación interna de fisioterapeutas',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'bloqueo-mock-2',
    fecha: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    hora_inicio: '13:00:00',
    hora_fin: '14:00:00',
    motivo: 'Mantenimiento de equipo de electroterapia',
    created_at: new Date(Date.now() - 43200000).toISOString(),
  },
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

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

  // 1. GET: Listar bloqueos de agenda con filtros opcionales de fecha
  if (method === 'GET') {
    const { fecha, desde, hasta } = event.queryStringParameters || {};

    if (fecha && !esFechaValidaUTC(fecha)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El parámetro fecha debe ser una fecha gregoriana válida (YYYY-MM-DD)' }),
      };
    }
    if (desde && !esFechaValidaUTC(desde)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El parámetro desde debe ser una fecha gregoriana válida (YYYY-MM-DD)' }),
      };
    }
    if (hasta && !esFechaValidaUTC(hasta)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El parámetro hasta debe ser una fecha gregoriana válida (YYYY-MM-DD)' }),
      };
    }

    try {
      const supabaseAdmin = getSupabaseAdmin();
      let query = supabaseAdmin
        .from('bloqueos_agenda')
        .select('id, fecha, hora_inicio, hora_fin, motivo, created_at')
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true });

      if (fecha) query = query.eq('fecha', fecha);
      if (desde) query = query.gte('fecha', desde);
      if (hasta) query = query.lte('fecha', hasta);

      const { data, error } = await query;

      if (error) {
        console.error('Error al consultar bloqueos en Supabase:', error);

        if (isLocalDev) {
          let filtrados = [...BLOQUEOS_MOCK];
          if (fecha) filtrados = filtrados.filter((b) => b.fecha === fecha);
          if (desde) filtrados = filtrados.filter((b) => b.fecha >= desde);
          if (hasta) filtrados = filtrados.filter((b) => b.fecha <= hasta);

          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bloqueos: filtrados, modo: 'simulado_dev' }),
          };
        }

        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error al consultar los bloqueos de agenda' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bloqueos: data || [], modo: 'real' }),
      };
    } catch (err: any) {
      console.error('Error inesperado en admin-bloqueos GET:', err);

      if (isLocalDev) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bloqueos: BLOQUEOS_MOCK, modo: 'simulado_dev' }),
        };
      }

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error interno del servidor' }),
      };
    }
  }

  // 2. POST: Crear un nuevo bloqueo de agenda (utiliza la RPC canónica crear_bloqueo_agenda)
  if (method === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { fecha, hora_inicio, hora_fin, motivo } = body;

      // Validaciones sintácticas
      if (!fecha || !hora_inicio || !hora_fin || !motivo) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Faltan parámetros requeridos (fecha, hora_inicio, hora_fin, motivo)',
          }),
        };
      }

      // Validación estricta de fecha gregoriana en UTC
      if (!esFechaValidaUTC(fecha)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Formato de fecha inválido o inexistente en calendario gregoriano. Utilice YYYY-MM-DD' }),
        };
      }

      // Validación estricta de formato de hora
      if (!HORA_REGEX.test(hora_inicio) || !HORA_REGEX.test(hora_fin)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Formato de hora inválido. Utilice HH:MM o HH:MM:SS (24 horas)' }),
        };
      }

      if (hora_inicio >= hora_fin) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'La hora de inicio debe ser anterior a la hora de fin' }),
        };
      }

      if (typeof motivo !== 'string' || motivo.trim().length === 0 || motivo.trim().length > 200) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El motivo es obligatorio y no debe exceder 200 caracteres' }),
        };
      }

      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin.rpc('crear_bloqueo_agenda', {
        p_fecha: fecha,
        p_hora_inicio: hora_inicio,
        p_hora_fin: hora_fin,
        p_motivo: motivo.trim(),
      });

      if (error) {
        console.error('Error al invocar RPC crear_bloqueo_agenda:', error);

        if (isLocalDev) {
          const fakeId = `bloqueo_dev_${Date.now()}`;
          return {
            statusCode: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: true,
              bloqueo_id: fakeId,
              bloqueo: {
                id: fakeId,
                fecha,
                hora_inicio,
                hora_fin,
                motivo: motivo.trim(),
                created_at: new Date().toISOString(),
              },
              modo: 'simulado_dev',
            }),
          };
        }

        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error al registrar el bloqueo en la base de datos' }),
        };
      }

      // Procesar resultado de la RPC
      if (data && data.success === false) {
        if (data.code === 'CONFLICTO_CITAS_EXISTENTES') {
          return {
            statusCode: 409,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: data.message,
              code: data.code,
              citas_afectadas: data.citas_afectadas,
            }),
          };
        }

        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: data.message || 'No se pudo crear el bloqueo de agenda',
            code: data.code,
          }),
        };
      }

      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          bloqueo_id: data?.bloqueo_id,
          modo: 'real',
        }),
      };
    } catch (err: any) {
      console.error('Error inesperado en admin-bloqueos POST:', err);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error interno del servidor al crear bloqueo' }),
      };
    }
  }

  // 3. DELETE: Eliminar un bloqueo de agenda existente
  if (method === 'DELETE') {
    try {
      let id = event.queryStringParameters?.id;
      if (!id && event.body) {
        try {
          const body = JSON.parse(event.body);
          id = body.id;
        } catch (_) {}
      }

      if (!id) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El parámetro id del bloqueo es obligatorio' }),
        };
      }

      // Validación estricta de UUID en DELETE
      const esUuidValido = UUID_REGEX.test(id);
      const esMockDev = isLocalDev && typeof id === 'string' && (id.startsWith('bloqueo-mock-') || id.startsWith('bloqueo_dev_'));

      if (!esUuidValido && !esMockDev) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'El parámetro id debe ser un identificador UUID válido' }),
        };
      }

      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin
        .from('bloqueos_agenda')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error al eliminar bloqueo en Supabase:', error);

        if (isLocalDev) {
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, id, modo: 'simulado_dev' }),
          };
        }

        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error al eliminar el bloqueo de agenda' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, id, modo: 'real' }),
      };
    } catch (err: any) {
      console.error('Error inesperado en admin-bloqueos DELETE:', err);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error interno del servidor al eliminar bloqueo' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Método no permitido' }),
  };
};
