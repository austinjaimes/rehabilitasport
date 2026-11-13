import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Obtiene el cliente de Supabase con privilegios administrativos (service_role).
 * Exclusivo para ejecución en el servidor (Netlify Functions / Astro SSR).
 *
 * Implementa fail-closed: lanza un error explícito si las variables de entorno
 * requeridas no están configuradas, sin exponer valores de secretos.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('Seguridad: supabaseAdmin contiene privilegios de servidor y no puede ejecutarse en el navegador.');
  }

  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  // Resolución segura en Node.js (Netlify Functions) y Astro SSR (import.meta.env)
  const supabaseUrl =
    (typeof process !== 'undefined' && (process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)) ||
    (typeof import.meta !== 'undefined' && ((import.meta as any).env?.PUBLIC_SUPABASE_URL || (import.meta as any).env?.SUPABASE_URL));

  const serviceRoleKey =
    (typeof process !== 'undefined' && process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || typeof supabaseUrl !== 'string' || supabaseUrl.trim() === '') {
    throw new Error('Configuración inválida: La URL de Supabase no está configurada en las variables de entorno del servidor.');
  }

  if (!serviceRoleKey || typeof serviceRoleKey !== 'string' || serviceRoleKey.trim() === '') {
    throw new Error('Configuración inválida: SUPABASE_SERVICE_ROLE_KEY no está configurada en las variables de entorno del servidor.');
  }

  cachedAdminClient = createClient(supabaseUrl.trim(), serviceRoleKey.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
}

/**
 * Restablece la instancia en caché del cliente administrativo.
 * Utilidad exclusiva para pruebas y escenarios controlados de ciclo de vida.
 */
export function _resetSupabaseAdminCache(): void {
  cachedAdminClient = null;
}
