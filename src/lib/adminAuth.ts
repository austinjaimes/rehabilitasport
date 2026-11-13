import crypto from 'node:crypto';
import net from 'node:net';
import { getSupabaseAdmin } from './supabaseAdmin';

export const checkIsLocalDev = () => process.env.NETLIFY_DEV === 'true';

// Duración estándar de la sesión administrativa: 8 horas (en segundos)
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 28800s
export const COOKIE_NAME = 'admin_session';

export interface AdminSessionPayload {
  sub: 'admin';
  iat: number; // Unix timestamp en segundos
  exp: number; // Unix timestamp en segundos
  csrfHash: string; // Hash SHA-256 del CSRF token (64 hex chars)
  jti: string; // Identificador criptográfico único de sesión (24 hex chars)
}

export interface AdminAuthResult {
  autorizado: boolean;
  statusCode?: number;
  error?: string;
  session?: AdminSessionPayload;
}

// Registro en memoria de sesiones revocadas (Fallback exclusivo para desarrollo local o caché)
const revokedSessionsDev = new Set<string>();

let _customSupabaseAdmin: any = null;

export function _setMockSupabaseAdmin(mock: any): void {
  _customSupabaseAdmin = mock;
}

function getAdminClient() {
  return _customSupabaseAdmin || getSupabaseAdmin();
}

export function _resetRevocacionesDev(): void {
  revokedSessionsDev.clear();
}

/**
 * Obtiene la contraseña administrativa configurada en variables de entorno.
 * En producción: exige mínimo 12 caracteres y prohíbe el valor por defecto de desarrollo.
 * Si no cumple, retorna cadena vacía (fails closed con HTTP 401).
 */
export function getAdminPassword(): string {
  const envPass = process.env.ADMIN_PASSWORD;

  if (checkIsLocalDev()) {
    if (envPass) return envPass;
    console.warn('[DEV] ADMIN_PASSWORD no está definida en .env; usando valor temporal de desarrollo: "admin123"');
    return 'admin123';
  }

  // Validación estricta en producción
  if (!envPass || typeof envPass !== 'string' || envPass.trim() === '') {
    console.error('[AUTH PROD] ADMIN_PASSWORD no está configurada en variables de entorno.');
    return '';
  }

  if (envPass.length < 12) {
    console.error('[AUTH PROD] ADMIN_PASSWORD debe tener al menos 12 caracteres por política de seguridad.');
    return '';
  }

  if (envPass === 'admin123') {
    console.error('[AUTH PROD] ADMIN_PASSWORD no puede ser la contraseña predeterminada de desarrollo ("admin123").');
    return '';
  }

  return envPass;
}

/**
 * Obtiene la clave secreta actual para firmar tokens HMAC-SHA256 de sesión.
 * En producción: exige mínimo 32 bytes UTF-8 y prohíbe el valor por defecto de desarrollo.
 * Si no cumple, retorna cadena vacía (fails closed con HTTP 500).
 */
export function getAdminSessionSecret(): string {
  const envSecret = process.env.ADMIN_SESSION_SECRET;

  if (checkIsLocalDev()) {
    if (envSecret) return envSecret;
    return 'rehabilita_sport_dev_secret_key_fixed_for_local_testing_only_32chars';
  }

  // Validación estricta en producción
  if (!envSecret || typeof envSecret !== 'string' || envSecret.trim() === '') {
    console.error('[AUTH PROD] ADMIN_SESSION_SECRET no está configurada en variables de entorno.');
    return '';
  }

  const byteLength = Buffer.byteLength(envSecret, 'utf8');
  if (byteLength < 32) {
    console.error(`[AUTH PROD] ADMIN_SESSION_SECRET debe tener al menos 32 bytes UTF-8 (actual: ${byteLength} bytes).`);
    return '';
  }

  if (envSecret === 'rehabilita_sport_dev_secret_key_fixed_for_local_testing_only_32chars') {
    console.error('[AUTH PROD] ADMIN_SESSION_SECRET no puede ser la clave predeterminada de desarrollo.');
    return '';
  }

  return envSecret;
}

/**
 * Obtiene la clave secreta anterior para rotación segura de secretos (opcional).
 * Se utiliza EXCLUSIVAMENTE para verificar tokens antiguos durante el periodo de rotación.
 * Las sesiones nuevas NUNCA se firman con esta clave.
 */
export function getAdminSessionSecretPrevious(): string | undefined {
  const prev = process.env.ADMIN_SESSION_SECRET_PREVIOUS;
  if (!prev) return undefined;

  if (!checkIsLocalDev()) {
    const byteLength = Buffer.byteLength(prev, 'utf8');
    if (byteLength < 32 || prev === 'rehabilita_sport_dev_secret_key_fixed_for_local_testing_only_32chars') {
      console.error('[AUTH PROD] ADMIN_SESSION_SECRET_PREVIOUS es inseguro (< 32 bytes o valor de desarrollo). Se ignora.');
      return undefined;
    }
  }

  return prev;
}

/**
 * Helper para lectura de encabezados sin distinción entre mayúsculas y minúsculas.
 */
export function getHeader(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return undefined;
}

/**
 * Identifica la dirección IP del cliente utilizando únicamente encabezados confiables
 * inyectados y garantizados por la infraestructura perimetral de Netlify.
 * En producción NUNCA confía ciegamente en X-Forwarded-For manipulable por clientes.
 * Valida formatos IPv4 e IPv6 (incluyendo representaciones comprimidas como ::1 o 2001:db8::1)
 * utilizando el módulo estándar node:net sin dependencias externas.
 */
export function obtenerIpConfiable(event: any): { ip: string | null; confiable: boolean; error?: string } {
  // Encabezados directos garantizados por Netlify Edge CDN
  const netlifyClientIp = getHeader(event.headers, 'client-ip')?.trim();
  const netlifyConnIp = getHeader(event.headers, 'x-nf-client-connection-ip')?.trim();

  const ipCandidate = netlifyClientIp || netlifyConnIp;

  if (ipCandidate) {
    const ipVersion = net.isIP(ipCandidate);
    if (ipVersion === 4 || ipVersion === 6) {
      return { ip: ipCandidate, confiable: true };
    }
    return {
      ip: null,
      confiable: false,
      error: 'La dirección IP proporcionada en los encabezados perimetrales no tiene un formato válido',
    };
  }

  // En entorno local de pruebas (Netlify Dev o Node runner local sin headers CDN)
  if (checkIsLocalDev()) {
    // Si no viene client-ip en dev local, permitir loopback de desarrollo
    return { ip: '127.0.0.1', confiable: true };
  }

  // En producción, si la capa de red no entrega una IP verificable, se rechaza
  return {
    ip: null,
    confiable: false,
    error: 'No se pudo determinar una dirección IP confiable y validada por la infraestructura',
  };
}

/**
 * Parsea el encabezado Cookie en un mapa clave -> valor.
 * Manejo seguro frente a secuencias de escape URI malformadas (evita URIError).
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const rawKey = trimmed.slice(0, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    if (!rawKey) continue;

    try {
      cookies[rawKey] = decodeURIComponent(rawVal);
    } catch (_) {
      // Si la cookie contiene secuencias malformadas (%...), se almacena tal cual sin lanzar excepción
      cookies[rawKey] = rawVal;
    }
  }
  return cookies;
}

/**
 * Compara dos contraseñas en tiempo constante usando SHA-256 y timingSafeEqual.
 */
export function validarPasswordAdmin(providedPassword: string): boolean {
  const expectedPassword = getAdminPassword();
  if (!expectedPassword || !providedPassword || typeof providedPassword !== 'string') {
    return false;
  }

  try {
    const bufProvided = crypto.createHash('sha256').update(providedPassword).digest();
    const bufExpected = crypto.createHash('sha256').update(expectedPassword).digest();
    return crypto.timingSafeEqual(bufProvided, bufExpected);
  } catch (_) {
    return false;
  }
}

/**
 * Genera un token de sesión criptográfico (payload en base64url + firma HMAC-SHA256 de 43 caracteres)
 * junto con su CSRF token emparejado mediante hash.
 * SIEMPRE se firma con la clave actual ADMIN_SESSION_SECRET.
 */
export function createSessionToken(
  secret: string,
  expiresInSeconds: number = SESSION_MAX_AGE_SECONDS
): { token: string; csrfToken: string; expiresAt: number; jti: string } {
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET no disponible para firmar token');
  }

  // Token CSRF aleatorio e impredecible (48 caracteres hex)
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const csrfHash = crypto.createHash('sha256').update(csrfToken).digest('hex');

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + expiresInSeconds;
  const jti = crypto.randomBytes(12).toString('hex'); // 24 caracteres hex

  const payload: AdminSessionPayload = {
    sub: 'admin',
    iat: now,
    exp: expiresAt,
    csrfHash,
    jti,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const token = `${encodedPayload}.${signature}`;

  return { token, csrfToken, expiresAt, jti };
}

/**
 * Verifica la firma HMAC-SHA256, la longitud de la firma, el formato de todos los campos
 * y la validez temporal del token de sesión.
 * Admite de forma opcional ADMIN_SESSION_SECRET_PREVIOUS exclusivamente para verificación.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  previousSecret?: string
): { valid: boolean; payload?: AdminSessionPayload; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token no proporcionado' };
  }

  if (!secret) {
    return { valid: false, error: 'Secreto de firma no configurado en el servidor' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Formato de token de sesión inválido' };
  }

  const [encodedPayload, signature] = parts;

  // Validación estricta de longitud y caracteres de la firma HMAC-SHA256 en base64url (exactamente 43 caracteres)
  if (signature.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return { valid: false, error: 'Formato o longitud de firma de sesión inválida' };
  }

  // 1. Verificar firma contra el secreto actual
  const expectedSig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSig);

  let isSignatureValid = sigBuffer.length === expBuffer.length && crypto.timingSafeEqual(sigBuffer, expBuffer);

  // 2. Si no coincide y existe un secreto anterior de rotación, verificar contra previousSecret
  if (!isSignatureValid && previousSecret) {
    const expectedSigPrev = crypto.createHmac('sha256', previousSecret).update(encodedPayload).digest('base64url');
    const expBufferPrev = Buffer.from(expectedSigPrev);
    if (sigBuffer.length === expBufferPrev.length && crypto.timingSafeEqual(sigBuffer, expBufferPrev)) {
      isSignatureValid = true;
    }
  }

  if (!isSignatureValid) {
    return { valid: false, error: 'Firma de sesión inválida o adulterada' };
  }

  // 3. Inspección estricta de la estructura del payload
  try {
    const payloadStr = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const payload: any = JSON.parse(payloadStr);

    if (payload.sub !== 'admin') {
      return { valid: false, error: 'Sujeto de token no autorizado' };
    }

    const now = Math.floor(Date.now() / 1000);

    // Validación estricta de fecha de emisión (iat)
    if (typeof payload.iat !== 'number' || !Number.isInteger(payload.iat)) {
      return { valid: false, error: 'Fecha de emisión de sesión inválida' };
    }
    // Tolerancia temporal de hasta 60 segundos hacia el futuro por clock skew
    if (payload.iat > now + 60) {
      return { valid: false, error: 'Token emitido en el futuro (desincronización temporal)' };
    }
    // No permitir tokens con fecha de emisión mayor a 24 horas en el pasado
    if (payload.iat < now - 86400) {
      return { valid: false, error: 'Token emitido hace demasiado tiempo' };
    }

    // Validación estricta de expiración (exp)
    if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp)) {
      return { valid: false, error: 'Fecha de expiración de sesión inválida' };
    }
    if (now > payload.exp) {
      return { valid: false, error: 'Sesión expirada' };
    }
    // Ventana máxima permitida de vigencia
    if (payload.exp - payload.iat > SESSION_MAX_AGE_SECONDS) {
      return { valid: false, error: 'Vigencia de sesión excede la ventana máxima autorizada' };
    }

    // Validación de formato de hash CSRF (64 hex lowercase)
    if (typeof payload.csrfHash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.csrfHash)) {
      return { valid: false, error: 'Hash CSRF en sesión inválido' };
    }

    // Validación de formato de JTI (24 hex lowercase)
    if (typeof payload.jti !== 'string' || !/^[0-9a-f]{24}$/.test(payload.jti)) {
      return { valid: false, error: 'Identificador único de sesión (jti) inválido' };
    }

    return { valid: true, payload: payload as AdminSessionPayload };
  } catch (_) {
    return { valid: false, error: 'Carga de token corrupta o ilegible' };
  }
}

/**
 * Extrae el token de sesión de la petición, prefiriendo la cookie HttpOnly
 * y permitiendo el header Authorization Bearer como alternativa.
 */
export function extractSessionToken(event: any): { token: string | null; source: 'cookie' | 'bearer' | null } {
  // 1. Cookie HttpOnly
  const cookieHeader = getHeader(event.headers, 'cookie');
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies[COOKIE_NAME]) {
      return { token: cookies[COOKIE_NAME], source: 'cookie' };
    }
  }

  // 2. Authorization: Bearer <token>
  const authHeader = getHeader(event.headers, 'authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken) {
      return { token: bearerToken, source: 'bearer' };
    }
  }

  return { token: null, source: null };
}

/**
 * Valida si una URL de origen o referer pertenece al host legítimo o a localhost en dev.
 */
export function esOrigenPermitido(origin: string, hostHeader?: string): boolean {
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host;

    if (checkIsLocalDev()) {
      if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
        return true;
      }
    }

    if (hostHeader) {
      const cleanHost = hostHeader.trim();
      if (originHost === cleanHost || originUrl.hostname === cleanHost.split(':')[0]) {
        return true;
      }
    }

    if (process.env.URL) {
      try {
        const netlifyUrl = new URL(process.env.URL);
        if (originUrl.host === netlifyUrl.host) return true;
      } catch (_) {}
    }

    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Validador estricto de Origen, Referer y Sec-Fetch-Site para prevenir CSRF.
 */
export function validarOrigenYContexto(
  event: any,
  requiereOrigen: boolean = false
): { valido: boolean; statusCode?: number; error?: string } {
  const origin = getHeader(event.headers, 'origin');
  const referer = getHeader(event.headers, 'referer');
  const host = getHeader(event.headers, 'host');
  const secFetchSite = getHeader(event.headers, 'sec-fetch-site');

  // 1. Bloqueo estricto de peticiones explícitamente cross-site
  if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
    return {
      valido: false,
      statusCode: 403,
      error: 'Petición rechazada: Solicitud entre sitios no autorizada (Sec-Fetch-Site: cross-site)',
    };
  }

  // 2. Si se proporciona Origin, debe pertenecer al origen legítimo
  if (origin) {
    if (!esOrigenPermitido(origin, host)) {
      return {
        valido: false,
        statusCode: 403,
        error: 'Petición rechazada: Origen no autorizado',
      };
    }
  }

  // 3. Si se proporciona Referer, debe pertenecer al host legítimo
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (!esOrigenPermitido(refererUrl.origin, host)) {
        return {
          valido: false,
          statusCode: 403,
          error: 'Petición rechazada: Referer no autorizado',
        };
      }
    } catch (_) {
      return {
        valido: false,
        statusCode: 403,
        error: 'Petición rechazada: Referer malformado',
      };
    }
  }

  // 4. Si se exige origen explícito (mutaciones con cookie, login, logout):
  // No aceptar solicitudes donde falten ambos encabezados
  if (requiereOrigen && !origin && !referer) {
    return {
      valido: false,
      statusCode: 403,
      error: 'Petición rechazada: Se requiere encabezado Origin o Referer para esta operación',
    };
  }

  return { valido: true };
}

/**
 * Registra una sesión como revocada.
 * En producción la persiste en la tabla admin_sesiones_revocadas.
 * En desarrollo local la mantiene en el Set en memoria.
 */
export async function revocarSesion(
  jti: string,
  expiraAtSeconds: number,
  motivo: string = 'logout'
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseAdmin = getAdminClient();
    const { error } = await supabaseAdmin.from('admin_sesiones_revocadas').insert({
      jti,
      expira_at: new Date(expiraAtSeconds * 1000).toISOString(),
      motivo,
    });

    if (error) {
      if (checkIsLocalDev()) {
        console.warn('[DEV] Fallback local: sesión revocada registrada en memoria para jti:', jti);
        revokedSessionsDev.add(jti);
        return { success: true };
      }
      console.error('Error al registrar revocación de sesión en Supabase:', error);
      return { success: false, error: 'Error al registrar revocación de sesión en base de datos' };
    }

    // Persistencia confirmada exitosa
    revokedSessionsDev.add(jti);
    return { success: true };
  } catch (err: any) {
    if (checkIsLocalDev()) {
      revokedSessionsDev.add(jti);
      return { success: true };
    }
    console.error('Error inesperado al revocar sesión:', err);
    return { success: false, error: 'Fallo al contactar servicio de revocación' };
  }
}

/**
 * Comprueba si una sesión ha sido revocada.
 * En producción, si falla la consulta a la base de datos, falla cerrado (fail closed).
 */
export async function esSesionRevocada(jti: string): Promise<{ revocada: boolean; errorDb?: boolean }> {
  // Comprobar primero set en memoria
  if (revokedSessionsDev.has(jti)) {
    return { revocada: true };
  }

  try {
    const supabaseAdmin = getAdminClient();
    const { data, error } = await supabaseAdmin
      .from('admin_sesiones_revocadas')
      .select('jti')
      .eq('jti', jti)
      .gt('expira_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      if (checkIsLocalDev()) {
        // En desarrollo local, la tabla puede no estar migrada aún; permitir fallback en memoria
        return { revocada: revokedSessionsDev.has(jti) };
      }
      // En producción: Fail closed estricto
      console.error('Error al verificar revocación en producción:', error);
      return { revocada: false, errorDb: true };
    }

    return { revocada: Boolean(data?.jti) };
  } catch (err: any) {
    if (checkIsLocalDev()) {
      return { revocada: revokedSessionsDev.has(jti) };
    }
    console.error('Error de conexión al verificar revocación:', err);
    return { revocada: false, errorDb: true };
  }
}

/**
 * Rate Limiting distribuido atómico mediante la RPC canónica verificar_rate_limit.
 * En producción es fail-closed ante errores de base de datos.
 * En desarrollo local admite fallback en memoria si Supabase no está conectado.
 */
interface RateLimitEntryDev {
  fallos: number;
  bloqueadoHasta: number;
  primerFallo: number;
}
const loginAttemptsDev = new Map<string, RateLimitEntryDev>();

export async function verificarRateLimitLoginDistribuido(
  ip: string
): Promise<{ permitido: boolean; retryAfterSeconds?: number; errorDb?: boolean }> {
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
  const identificador = `admin_login_${ipHash}`;

  try {
    const supabaseAdmin = getAdminClient();
    // RPC canónica: verificar_rate_limit(p_identificador, p_max_peticiones, p_ventana_segundos)
    const { data: permitido, error } = await supabaseAdmin.rpc('verificar_rate_limit', {
      p_identificador: identificador,
      p_max_peticiones: 5,
      p_ventana_segundos: 900, // 15 minutos
    });

    if (error) {
      if (checkIsLocalDev()) {
        // Fallback en memoria exclusivo para desarrollo local
        return verificarRateLimitLoginDev(ip);
      }
      // En producción: Fail closed
      console.error('Error en RPC verificar_rate_limit de producción:', error);
      return { permitido: false, errorDb: true };
    }

    if (permitido === false) {
      return { permitido: false, retryAfterSeconds: 900 };
    }

    return { permitido: true };
  } catch (err: any) {
    if (checkIsLocalDev()) {
      return verificarRateLimitLoginDev(ip);
    }
    console.error('Fallo de red al verificar rate limit de login en producción:', err);
    return { permitido: false, errorDb: true };
  }
}

function verificarRateLimitLoginDev(ip: string): { permitido: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const entry = loginAttemptsDev.get(ip);
  if (!entry) return { permitido: true };
  if (entry.bloqueadoHasta > now) {
    return { permitido: false, retryAfterSeconds: Math.ceil((entry.bloqueadoHasta - now) / 1000) };
  }
  if (now - entry.primerFallo > 15 * 60 * 1000) {
    loginAttemptsDev.delete(ip);
    return { permitido: true };
  }
  return { permitido: true };
}

export function registrarFalloLoginDev(ip: string): { bloqueado: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  let entry = loginAttemptsDev.get(ip);
  if (!entry || now - entry.primerFallo > 15 * 60 * 1000) {
    entry = { fallos: 1, bloqueadoHasta: 0, primerFallo: now };
  } else {
    entry.fallos += 1;
  }
  if (entry.fallos >= 5) {
    entry.bloqueadoHasta = now + 15 * 60 * 1000;
    loginAttemptsDev.set(ip, entry);
    return { bloqueado: true, retryAfterSeconds: 900 };
  }
  loginAttemptsDev.set(ip, entry);
  return { bloqueado: false };
}

export function limpiarFallosLoginDev(ip: string): void {
  loginAttemptsDev.delete(ip);
}

/**
 * Validador integral de peticiones administrativas (Asíncrono).
 * Ejecuta validaciones de token, expiración, origen, token CSRF y revocación en base de datos.
 */
export async function validarAdminRequest(event: any): Promise<AdminAuthResult> {
  const method = (event.httpMethod || 'GET').toUpperCase();
  const secret = getAdminSessionSecret();
  const previousSecret = getAdminSessionSecretPrevious();

  if (!secret) {
    return {
      autorizado: false,
      statusCode: 500,
      error: 'Error de configuración: ADMIN_SESSION_SECRET no disponible',
    };
  }

  // 1. Extraer sesión
  const { token, source } = extractSessionToken(event);
  if (!token) {
    return {
      autorizado: false,
      statusCode: 401,
      error: 'Acceso no autorizado: Se requiere una sesión administrativa activa',
    };
  }

  // 2. Verificar firma, temporalidad y formato estricto
  const verification = verifySessionToken(token, secret, previousSecret);
  if (!verification.valid || !verification.payload) {
    return {
      autorizado: false,
      statusCode: 401,
      error: verification.error || 'Sesión administrativa inválida o expirada',
    };
  }

  const session = verification.payload;

  // 3. Verificación de revocación de sesión en almacenamiento compartido
  const estadoRevocacion = await esSesionRevocada(session.jti);
  if (estadoRevocacion.errorDb) {
    return {
      autorizado: false,
      statusCode: 503,
      error: 'Error de infraestructura al verificar el estado de la sesión',
    };
  }
  if (estadoRevocacion.revocada) {
    return {
      autorizado: false,
      statusCode: 401,
      error: 'Sesión administrativa revocada: inicie sesión nuevamente',
    };
  }

  // 4. Validación de Origen y Sec-Fetch-Site
  const esMutante = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  const requiereOrigen = esMutante && source === 'cookie';
  const valOrigen = validarOrigenYContexto(event, requiereOrigen);

  if (!valOrigen.valido) {
    return {
      autorizado: false,
      statusCode: valOrigen.statusCode || 403,
      error: valOrigen.error || 'Petición rechazada por política de origen',
    };
  }

  // 5. Si es mutación con cookie, exigir validación de token CSRF
  if (esMutante && source === 'cookie') {
    const csrfHeader = getHeader(event.headers, 'x-admin-csrf') || getHeader(event.headers, 'x-csrf-token');
    if (!csrfHeader) {
      return {
        autorizado: false,
        statusCode: 403,
        error: 'Petición rechazada: Falta el encabezado de protección CSRF (X-Admin-CSRF)',
      };
    }

    const providedCsrfHash = crypto.createHash('sha256').update(csrfHeader).digest('hex');
    const hashBuf = Buffer.from(providedCsrfHash);
    const expBuf = Buffer.from(session.csrfHash);

    if (hashBuf.length !== expBuf.length || !crypto.timingSafeEqual(hashBuf, expBuf)) {
      return {
        autorizado: false,
        statusCode: 403,
        error: 'Petición rechazada: Token CSRF no coincide con la sesión activa',
      };
    }
  }

  return { autorizado: true, session };
}

/**
 * Construye la cadena Set-Cookie con SameSite=Strict para máxima protección CSRF.
 */
export function buildSessionCookie(token: string, maxAge: number = SESSION_MAX_AGE_SECONDS): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (!checkIsLocalDev()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Construye la cadena Set-Cookie para revocar/eliminar la sesión administrativa.
 */
export function buildClearSessionCookie(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (!checkIsLocalDev()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Validador de fechas del calendario gregoriano en formato UTC (YYYY-MM-DD).
 */
export function esFechaValidaUTC(fechaStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return false;
  const [año, mes, dia] = fechaStr.split('-').map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const fecha = new Date(Date.UTC(año, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === año &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}
