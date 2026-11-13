import React, { useState, useEffect } from 'react';
import { adminClient, type AdminEntornoModo, AdminClientError } from '../../lib/adminClient';

interface AdminLoginProps {
  onLoginSuccess: (sessionData: { expiresAt?: number; modo?: AdminEntornoModo }) => void;
  mensajeInicial?: string | null;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess, mensajeInicial }) => {
  const [password, setPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(mensajeInicial || null);
  const [errorTipo, setErrorTipo] = useState<'error' | 'advertencia' | 'bloqueo'>('error');
  const [segundosBloqueo, setSegundosBloqueo] = useState<number>(0);

  // Temporizador regresivo para rate limit (HTTP 429)
  useEffect(() => {
    if (segundosBloqueo <= 0) return;

    const timer = setInterval(() => {
      setSegundosBloqueo((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [segundosBloqueo]);

  const formatearTiempo = (segundos: number): string => {
    const min = Math.floor(segundos / 60);
    const seg = segundos % 60;
    return `${min}:${seg < 10 ? '0' : ''}${seg}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || cargando || segundosBloqueo > 0) return;

    setCargando(true);
    setError(null);

    try {
      const res = await adminClient.login(password.trim());
      if (res.success) {
        onLoginSuccess({
          expiresAt: res.expiresAt,
          modo: res.modo,
        });
      } else {
        setError(res.error || 'No se pudo completar el inicio de sesión.');
        setErrorTipo('error');
      }
    } catch (err: any) {
      if (err instanceof AdminClientError) {
        if (err.statusCode === 429) {
          const secs = err.retryAfterSeconds || 900;
          setSegundosBloqueo(secs);
          setError(`Demasiados intentos fallidos. Por seguridad, el acceso está bloqueado temporalmente.`);
          setErrorTipo('bloqueo');
        } else if (err.statusCode === 401) {
          setError('Contraseña administrativa incorrecta. Verifique sus credenciales.');
          setErrorTipo('error');
        } else if (err.statusCode === 503) {
          setError('Servicio de verificación no disponible temporalmente (la base de datos no responde).');
          setErrorTipo('advertencia');
        } else if (err.statusCode === 403) {
          setError('Petición rechazada por política de seguridad de origen.');
          setErrorTipo('error');
        } else {
          setError(err.message || 'Error al iniciar sesión.');
          setErrorTipo('error');
        }
      } else {
        setError('Error inesperado de red al contactar el servidor de autenticación.');
        setErrorTipo('error');
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex min-h-[85vh] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 sm:p-10 shadow-xl border border-slate-200/80">
        {/* Cabecera y Logotipo */}
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
            <svg
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <span className="mt-4 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-bold tracking-wider text-blue-700 uppercase border border-blue-200">
            Rehabilita Sport
          </span>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-900 font-heading">
            Acceso Administrativo
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Ingrese la clave de seguridad para gestionar citas, servicios y agenda.
          </p>
        </div>

        {/* Notificaciones y Mensajes de Estado */}
        {error && (
          <div
            className={`rounded-xl p-4 text-sm border flex items-start gap-3 transition-all ${
              errorTipo === 'bloqueo'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : errorTipo === 'advertencia'
                ? 'bg-sky-50 border-sky-300 text-sky-900'
                : 'bg-rose-50 border-rose-300 text-rose-900'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {errorTipo === 'bloqueo' ? (
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : errorTipo === 'advertencia' ? (
                <svg className="h-5 w-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <p className="font-semibold">{error}</p>
              {segundosBloqueo > 0 && (
                <p className="mt-1 font-mono text-xs font-bold text-amber-800">
                  Tiempo restante: {formatearTiempo(segundosBloqueo)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Formulario */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="admin-password"
              className="block text-sm font-bold text-slate-700"
            >
              Contraseña Administrativa
            </label>
            <div className="relative mt-2">
              <input
                id="admin-password"
                name="password"
                type={mostrarPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={cargando || segundosBloqueo > 0}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60 text-base"
              />
              <button
                type="button"
                onClick={() => setMostrarPassword(!mostrarPassword)}
                tabIndex={-1}
                className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {mostrarPassword ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={cargando || segundosBloqueo > 0 || !password.trim()}
              className="group relative flex w-full justify-center rounded-xl bg-blue-700 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-700/25 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all cursor-pointer"
            >
              {cargando ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Verificando credenciales...
                </span>
              ) : segundosBloqueo > 0 ? (
                `Espera de seguridad (${formatearTiempo(segundosBloqueo)})`
              ) : (
                'Iniciar Sesión'
              )}
            </button>
          </div>
        </form>

        <div className="border-t border-slate-100 pt-4 text-center">
          <p className="text-xs text-slate-400">
            Conexión protegida mediante tokens criptográficos y cookies seguras SameSite=Strict.
          </p>
        </div>
      </div>
    </div>
  );
};

