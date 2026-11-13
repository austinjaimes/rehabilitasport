import {
  validarPasswordAdmin,
  createSessionToken,
  buildSessionCookie,
  buildClearSessionCookie,
  validarAdminRequest,
  validarOrigenYContexto,
  obtenerIpConfiable,
  verificarRateLimitLoginDistribuido,
  registrarFalloLoginDev,
  limpiarFallosLoginDev,
  getAdminSessionSecret,
  getAdminSessionSecretPrevious,
  extractSessionToken,
  verifySessionToken,
  revocarSesion,
} from '../../src/lib/adminAuth';

function obtenerModoEntorno(): 'real' | 'local_real' | 'simulado_dev' {
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  if (!isLocalDev) {
    return 'real';
  }

  const supabaseUrl = (process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  const esSupabaseReal =
    supabaseUrl !== '' &&
    !supabaseUrl.includes('tu-proyecto') &&
    !supabaseUrl.includes('placeholder') &&
    serviceKey !== '' &&
    !serviceKey.includes('tu-service-role-key') &&
    !serviceKey.includes('placeholder');

  return esSupabaseReal ? 'local_real' : 'simulado_dev';
}

export const handler = async (event: any) => {
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  const modoEntorno = obtenerModoEntorno();
  const method = (event.httpMethod || 'GET').toUpperCase();

  // 1. GET: Verificar estado de autenticación de la sesión actual
  if (method === 'GET') {
    const auth = await validarAdminRequest(event);
    if (!auth.autorizado) {
      return {
        statusCode: auth.statusCode || 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authenticated: false, error: auth.error || 'No autorizado' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authenticated: true,
        expiresAt: auth.session?.exp,
        modo: modoEntorno,
      }),
    };
  }

  // 2. POST: Acciones de inicio de sesión, cierre de sesión y verificación manual
  if (method === 'POST') {
    let body: any = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (_) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Cuerpo de petición JSON inválido' }),
      };
    }

    const action = body.action || 'login';

    // A. INICIAR SESIÓN (login)
    if (action === 'login') {
      // 1. Protección estricta contra peticiones entre sitios (CSRF en login)
      const valOrigen = validarOrigenYContexto(event, true);
      if (!valOrigen.valido) {
        return {
          statusCode: valOrigen.statusCode || 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: valOrigen.error || 'Origen no autorizado para inicio de sesión' }),
        };
      }

      // 2. Identificación confiable de la dirección IP
      const ipResult = obtenerIpConfiable(event);
      if (!ipResult.confiable || !ipResult.ip) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: ipResult.error || 'No se pudo determinar una dirección IP confiable' }),
        };
      }

      const clientIp = ipResult.ip;

      // 3. Rate limiting atómico distribuido en base de datos
      const rateLimit = await verificarRateLimitLoginDistribuido(clientIp);
      if (rateLimit.errorDb) {
        // En producción falla cerrado ante caída del sistema de rate limiting
        return {
          statusCode: 503,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Servicio de verificación de acceso no disponible temporalmente' }),
        };
      }

      if (!rateLimit.permitido) {
        return {
          statusCode: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimit.retryAfterSeconds || 900),
          },
          body: JSON.stringify({
            error: 'Demasiados intentos fallidos de inicio de sesión. Por seguridad, intente más tarde.',
            retryAfterSeconds: rateLimit.retryAfterSeconds || 900,
          }),
        };
      }

      // 4. Validación de la contraseña administrativa
      const password = body.password;
      const esValido = validarPasswordAdmin(password);

      if (!esValido) {
        if (isLocalDev) {
          registrarFalloLoginDev(clientIp);
        }

        // Respuesta genérica para no divulgar detalles internos
        return {
          statusCode: 401,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Credenciales inválidas' }),
        };
      }

      // Éxito: limpiar contadores locales de dev
      if (isLocalDev) {
        limpiarFallosLoginDev(clientIp);
      }

      const secret = getAdminSessionSecret();
      if (!secret) {
        console.error('ERROR CRÍTICO: No se pudo obtener ADMIN_SESSION_SECRET');
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error de configuración del servidor de autenticación' }),
        };
      }

      const { token, csrfToken, expiresAt } = createSessionToken(secret);
      const cookie = buildSessionCookie(token);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookie,
        },
        body: JSON.stringify({
          success: true,
          message: 'Autenticado correctamente',
          csrfToken,
          expiresAt,
          modo: modoEntorno,
        }),
      };
    }

    // B. CERRAR SESIÓN (logout)
    if (action === 'logout') {
      // 1. Protección contra Logout CSRF
      const valOrigen = validarOrigenYContexto(event, true);
      if (!valOrigen.valido) {
        return {
          statusCode: valOrigen.statusCode || 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: valOrigen.error || 'Origen no autorizado para cierre de sesión' }),
        };
      }

      const clearCookie = buildClearSessionCookie();

      // 2. Extraer token de la sesión actual para revocar su jti
      const { token } = extractSessionToken(event);
      if (!token) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearCookie,
          },
          body: JSON.stringify({
            success: true,
            revocado: false,
            message: 'No existía una sesión activa para revocar; cookie de sesión eliminada',
          }),
        };
      }

      const secret = getAdminSessionSecret();
      const previousSecret = getAdminSessionSecretPrevious();
      const verification = verifySessionToken(token, secret, previousSecret);

      if (!verification.valid || !verification.payload) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearCookie,
          },
          body: JSON.stringify({
            success: true,
            revocado: false,
            message: 'Token de sesión inválido o expirado; cookie eliminada sin registrar revocación',
          }),
        };
      }

      // 3. Registrar revocación persistente de la sesión válida
      const resultadoRevocacion = await revocarSesion(
        verification.payload.jti,
        verification.payload.exp,
        'logout_usuario'
      );

      if (!resultadoRevocacion.success) {
        // En producción: Si la persistencia falló, NO se devuelve falso éxito de revocación.
        // Se limpia la cookie para proteger al cliente en el navegador, pero se responde HTTP 503
        // indicando que no se pudo confirmar la revocación en el servidor.
        return {
          statusCode: 503,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearCookie,
          },
          body: JSON.stringify({
            success: false,
            revocado: false,
            error: 'No se pudo confirmar la revocación de la sesión en el servidor. La cookie local fue eliminada.',
          }),
        };
      }

      // Éxito confirmado de revocación
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearCookie,
        },
        body: JSON.stringify({
          success: true,
          revocado: true,
          message: 'Sesión cerrada y revocada correctamente',
          modo: modoEntorno,
        }),
      };
    }

    // C. VERIFICACIÓN MANUAL DE SESIÓN (verify)
    if (action === 'verify') {
      const auth = await validarAdminRequest(event);
      if (!auth.autorizado) {
        return {
          statusCode: auth.statusCode || 401,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authenticated: false, error: auth.error || 'No autorizado' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authenticated: true,
          expiresAt: auth.session?.exp,
          modo: modoEntorno,
        }),
      };
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Acción no reconocida' }),
    };
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Método no permitido' }),
  };
};
