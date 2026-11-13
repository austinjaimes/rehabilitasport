/**
 * Cliente HTTP Centralizado para el Dashboard Administrativo de Rehabilita Sport.
 *
 * Características de seguridad y diseño:
 * - Utiliza `credentials: 'include'` para el envío y recepción segura de la cookie HttpOnly `admin_session`.
 * - Inyecta automáticamente el encabezado `X-Admin-CSRF` en peticiones mutantes (POST, PATCH, DELETE).
 * - Conserva el CSRF Token exclusivamente en memoria y en `sessionStorage` para soportar recargas de página.
 * - NUNCA almacena contraseñas ni datos sensibles de pacientes en almacenamiento persistente.
 * - Clasifica con precisión los códigos de estado HTTP (400, 401, 403, 409, 429, 500, 503).
 * - Garantiza que un error 503 (caída de infraestructura) NO provoque un cierre de sesión automático.
 * - Resiliencia ante entornos con proxy (/api/ con fallback a /.netlify/functions/).
 */

export type AdminErrorCode =
  | 'INVALID_REQUEST'      // 400
  | 'UNAUTHORIZED'         // 401
  | 'FORBIDDEN'            // 403
  | 'CONFLICT'             // 409
  | 'RATE_LIMITED'         // 429
  | 'INTERNAL_ERROR'       // 500
  | 'SERVICE_UNAVAILABLE'  // 503
  | 'NETWORK_ERROR'        // Fallo de red
  | 'MISSING_CSRF';        // Falta token CSRF en mutación

export class AdminClientError extends Error {
  public statusCode: number;
  public code: AdminErrorCode;
  public retryAfterSeconds?: number;
  public details?: any;

  constructor(
    message: string,
    statusCode: number,
    code: AdminErrorCode,
    retryAfterSeconds?: number,
    details?: any
  ) {
    super(message);
    this.name = 'AdminClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
  }
}

export type AdminEntornoModo = 'real' | 'local_real' | 'simulado_dev';

export interface AdminSessionState {
  authenticated: boolean;
  expiresAt?: number;
  modo?: AdminEntornoModo;
  hasCsrfToken: boolean;
}

export interface LoginResult {
  success: boolean;
  message?: string;
  expiresAt?: number;
  modo?: AdminEntornoModo;
  error?: string;
}

export interface LogoutResult {
  success: boolean;
  revocado: boolean;
  message?: string;
  error?: string;
}

const CSRF_STORAGE_KEY = 'rs_admin_csrf';

// Token CSRF en memoria volátil de la aplicación
let inMemoryCsrfToken: string | null = null;

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage;
    }
  } catch (_) {}
  return null;
}

/**
 * Obtiene el CSRF Token actual desde la memoria o desde sessionStorage si la página fue recargada.
 */
export function getCsrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;

  const storage = getSessionStorage();
  if (storage) {
    try {
      const stored = storage.getItem(CSRF_STORAGE_KEY);
      if (stored && /^[0-9a-f]{48}$/i.test(stored)) {
        inMemoryCsrfToken = stored;
        return stored;
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Establece el CSRF Token en memoria y lo sincroniza con sessionStorage.
 */
export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;

  const storage = getSessionStorage();
  if (storage) {
    try {
      if (token) {
        storage.setItem(CSRF_STORAGE_KEY, token);
      } else {
        storage.removeItem(CSRF_STORAGE_KEY);
      }
    } catch (_) {}
  }
}

/**
 * Limpia el CSRF Token de memoria y sessionStorage.
 */
export function clearCsrfToken(): void {
  setCsrfToken(null);
}

/**
 * Parsea el encabezado Retry-After que puede venir expresado como segundos (delay-seconds)
 * o como una fecha HTTP (HTTP-date según RFC 7231 / RFC 9110).
 * Garantiza que siempre devuelva un número entero finito y positivo (mínimo 1 segundo).
 * Si no está presente o no es válido, retorna el valor predeterminado (por defecto 900s / 15 min).
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  bodyValue?: number | string | null,
  defaultSeconds: number = 900
): number {
  // 1. Si viene un valor numérico explícito en el body JSON
  if (bodyValue !== undefined && bodyValue !== null) {
    const num = typeof bodyValue === 'number' ? bodyValue : parseInt(String(bodyValue), 10);
    if (Number.isFinite(num) && num > 0) {
      return Math.ceil(num);
    }
  }

  // 2. Si no hay encabezado, retornar fallback predeterminado
  if (!headerValue || typeof headerValue !== 'string') {
    return defaultSeconds;
  }

  const trimmed = headerValue.trim();
  if (!trimmed) {
    return defaultSeconds;
  }

  // 3. Caso A: delay-seconds (número entero de segundos)
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds;
    }
    return 1;
  }

  // 4. Caso B: HTTP-date (ej: "Wed, 21 Oct 2026 07:28:00 GMT")
  const parsedDateMs = Date.parse(trimmed);
  if (!isNaN(parsedDateMs)) {
    const diffMs = parsedDateMs - Date.now();
    const diffSeconds = Math.ceil(diffMs / 1000);
    if (Number.isFinite(diffSeconds) && diffSeconds > 0) {
      return diffSeconds;
    }
    return 1;
  }

  // 5. Fallback ante valores no parseables o inválidos
  return defaultSeconds;
}

/**
 * Ejecutor base de peticiones con fallback de enrutamiento y control de errores.
 */
async function adminFetch(
  endpointPath: string,
  options: RequestInit = {},
  requiereCsrf: boolean = false
): Promise<any> {
  const method = (options.method || 'GET').toUpperCase();
  const esMutante = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const csrfToken = getCsrfToken();

  // Inyectar protección CSRF
  if (requiereCsrf) {
    if (!csrfToken) {
      throw new AdminClientError(
        'La sesión está activa pero falta el token de protección CSRF (pudo perderse tras cerrar la pestaña). Por seguridad, inicie sesión nuevamente.',
        403,
        'MISSING_CSRF'
      );
    }
    headers['X-Admin-CSRF'] = csrfToken;
  } else if (csrfToken && esMutante) {
    // Si es mutación pero no exige estrictamente CSRF (ej: logout), adjuntarlo si está disponible
    headers['X-Admin-CSRF'] = csrfToken;
  }

  const fetchOptions: RequestInit = {
    ...options,
    method,
    headers,
    credentials: 'include', // Obligatorio para envío y recepción de la cookie HttpOnly admin_session
  };

  const primaryUrl = `/api${endpointPath}`;
  const fallbackUrl = `/.netlify/functions${endpointPath}`;

  let res: Response;
  try {
    res = await fetch(primaryUrl, fetchOptions);
    // Si el proxy local de desarrollo devuelve 404, reintentar en /.netlify/functions/
    if (!res.ok && res.status === 404) {
      res = await fetch(fallbackUrl, fetchOptions);
    }
  } catch (err: any) {
    try {
      res = await fetch(fallbackUrl, fetchOptions);
    } catch (_) {
      throw new AdminClientError(
        'No se pudo establecer conexión con el servidor. Verifique su red.',
        0,
        'NETWORK_ERROR'
      );
    }
  }

  if (!res.ok) {
    let parsedBody: any = {};
    try {
      parsedBody = await res.json();
    } catch (_) {}

    const errorMessage =
      parsedBody.error || parsedBody.message || `Error del servidor (${res.status})`;

    switch (res.status) {
      case 400:
        throw new AdminClientError(errorMessage, 400, 'INVALID_REQUEST', undefined, parsedBody);
      case 401:
        // Sesión inválida, revocada o expirada: Limpiar CSRF local
        clearCsrfToken();
        throw new AdminClientError(errorMessage, 401, 'UNAUTHORIZED', undefined, parsedBody);
      case 403:
        throw new AdminClientError(errorMessage, 403, 'FORBIDDEN', undefined, parsedBody);
      case 409:
        throw new AdminClientError(errorMessage, 409, 'CONFLICT', undefined, parsedBody);
      case 429: {
        const retryHeader = res.headers.get('Retry-After');
        const retrySeconds = parseRetryAfter(retryHeader, parsedBody.retryAfterSeconds, 900);
        throw new AdminClientError(errorMessage, 429, 'RATE_LIMITED', retrySeconds, parsedBody);
      }
      case 503:
        // Infraestructura no disponible: NO provoca logout automático ni borra CSRF
        throw new AdminClientError(errorMessage, 503, 'SERVICE_UNAVAILABLE', undefined, parsedBody);
      default:
        throw new AdminClientError(errorMessage, res.status, 'INTERNAL_ERROR', undefined, parsedBody);
    }
  }

  try {
    return await res.json();
  } catch (_) {
    return {};
  }
}

/**
 * Métodos del Cliente Administrativo
 */
export const adminClient = {
  /**
   * Verifica el estado actual de autenticación mediante GET /api/admin-auth.
   * Manejo estricto de errores:
   * - 401: Devuelve { authenticated: false, hasCsrfToken: false } y limpia CSRF.
   * - 503: Lanza AdminClientError (SERVICE_UNAVAILABLE) sin borrar CSRF.
   * - 403: Lanza AdminClientError (FORBIDDEN) sin convertirlo en sesión inexistente.
   * - 500 / 5xx: Lanza AdminClientError (INTERNAL_ERROR) sin convertirlo en sesión inexistente.
   * - NETWORK_ERROR: Lanza AdminClientError (NETWORK_ERROR) comunicando problema de red.
   */
  async checkSession(): Promise<AdminSessionState> {
    try {
      const data = await adminFetch('/admin-auth', { method: 'GET' }, false);
      const hasCsrf = Boolean(getCsrfToken());

      return {
        authenticated: Boolean(data?.authenticated),
        expiresAt: data?.expiresAt,
        modo: data?.modo,
        hasCsrfToken: hasCsrf,
      };
    } catch (err: any) {
      if (err instanceof AdminClientError) {
        // HTTP 401 es el único caso donde la sesión no existe, expiró o fue revocada
        if (err.statusCode === 401) {
          clearCsrfToken();
          return { authenticated: false, hasCsrfToken: false };
        }
        // Cualquier otro error (503, 403, 500, NETWORK_ERROR) se lanza expresamente
        throw err;
      }
      throw err;
    }
  },

  /**
   * Inicia sesión enviando la contraseña administrativa a POST /api/admin-auth.
   * Guarda el CSRF Token en memoria y sessionStorage si es exitoso.
   */
  async login(password: string): Promise<LoginResult> {
    if (!password || typeof password !== 'string') {
      throw new AdminClientError('Debe ingresar la contraseña administrativa', 400, 'INVALID_REQUEST');
    }

    try {
      const data = await adminFetch('/admin-auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'login', password }),
      }, false);

      if (data?.success && data?.csrfToken) {
        setCsrfToken(data.csrfToken);
        return {
          success: true,
          message: data.message || 'Autenticado correctamente',
          expiresAt: data.expiresAt,
          modo: data.modo,
        };
      }

      return {
        success: false,
        error: 'Respuesta de autenticación incompleta del servidor',
      };
    } catch (err: any) {
      throw err;
    }
  },

  /**
   * Cierra la sesión administrativa en el servidor (POST /api/admin-auth action: 'logout')
   * y limpia el estado local de seguridad.
   */
  async logout(): Promise<LogoutResult> {
    try {
      const data = await adminFetch('/admin-auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'logout' }),
      }, false);

      clearCsrfToken();

      return {
        success: Boolean(data?.success),
        revocado: Boolean(data?.revocado),
        message: data?.message || 'Sesión cerrada correctamente',
      };
    } catch (err: any) {
      // Siempre limpiar CSRF local para proteger al cliente
      clearCsrfToken();

      if (err instanceof AdminClientError && err.statusCode === 503) {
        return {
          success: false,
          revocado: false,
          error: 'No se pudo confirmar la revocación en el servidor (infraestructura no disponible). La sesión local fue limpiada.',
        };
      }

      throw err;
    }
  },

  /**
   * Consulta la lista de citas con filtros opcionales de fecha y estado.
   */
  async getCitas(fecha?: string, estado?: string): Promise<{ citas: any[]; modo: AdminEntornoModo }> {
    const params = new URLSearchParams();
    if (fecha) params.append('fecha', fecha);
    if (estado && estado !== 'todas') params.append('estado', estado);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return await adminFetch(`/admin-citas${queryString}`, { method: 'GET' }, false);
  },

  /**
   * Actualiza el estado de una cita existente (atendida, cancelada, no_asistio, confirmada).
   * Requiere CSRF Token.
   */
  async updateCitaEstado(
    citaId: string,
    nuevoEstado: 'confirmada' | 'atendida' | 'cancelada' | 'no_asistio',
    motivoCancelacion?: string
  ): Promise<{ success: boolean; citaId: string; nuevoEstado: string; modo: string }> {
    return await adminFetch('/admin-citas', {
      method: 'POST',
      body: JSON.stringify({ citaId, nuevoEstado, motivoCancelacion }),
    }, true);
  },

  /**
   * Consulta el catálogo de servicios.
   */
  async getServicios(): Promise<{ servicios: any[]; modo: AdminEntornoModo }> {
    return await adminFetch('/admin-servicios', { method: 'GET' }, false);
  },

  /**
   * Guarda o actualiza un servicio. No admite campo precio.
   * Requiere CSRF Token.
   */
  async saveServicio(servicio: {
    id?: string;
    nombre: string;
    descripcion?: string | null;
    duracionMinutos: number;
    activo: boolean;
    orden: number;
  }): Promise<{ servicio: any; modo: string }> {
    return await adminFetch('/admin-servicios', {
      method: 'POST',
      body: JSON.stringify(servicio),
    }, true);
  },

  /**
   * Consulta los bloqueos de agenda programados.
   */
  async getBloqueos(filtros?: { fecha?: string; desde?: string; hasta?: string }): Promise<{ bloqueos: any[]; modo: AdminEntornoModo }> {
    const params = new URLSearchParams();
    if (filtros?.fecha) params.append('fecha', filtros.fecha);
    if (filtros?.desde) params.append('desde', filtros.desde);
    if (filtros?.hasta) params.append('hasta', filtros.hasta);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return await adminFetch(`/admin-bloqueos${queryString}`, { method: 'GET' }, false);
  },

  /**
   * Crea un nuevo bloqueo de agenda.
   * Requiere CSRF Token.
   */
  async createBloqueo(bloqueo: {
    fecha: string;
    hora_inicio: string;
    hora_fin: string;
    motivo: string;
  }): Promise<{ success: boolean; bloqueo_id: string; modo: string }> {
    return await adminFetch('/admin-bloqueos', {
      method: 'POST',
      body: JSON.stringify(bloqueo),
    }, true);
  },

  /**
   * Elimina un bloqueo de agenda por su ID.
   * Requiere CSRF Token.
   */
  async deleteBloqueo(id: string): Promise<{ success: boolean; id: string; modo: string }> {
    return await adminFetch(`/admin-bloqueos?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }, true);
  },
};
