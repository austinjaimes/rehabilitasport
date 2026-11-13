import React, { useEffect, useState, useCallback } from 'react';
import { adminClient, type AdminSessionState, type AdminEntornoModo, AdminClientError, clearCsrfToken } from '../../lib/adminClient';
import { AdminLogin } from './AdminLogin';
import { AdminSidebar, type AdminSectionId } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { ResumenSection } from './sections/ResumenSection';
import { CitasSection } from './sections/CitasSection';
import { ServiciosSection } from './sections/ServiciosSection';
import { BloqueosSection } from './sections/BloqueosSection';

export const AdminApp: React.FC = () => {
  // Estados de inicialización y sesión
  const [comprobando, setComprobando] = useState<boolean>(true);
  const [session, setSession] = useState<AdminSessionState | null>(null);
  const [errorInfraestructura, setErrorInfraestructura] = useState<string | null>(null);
  const [mensajeLogout, setMensajeLogout] = useState<string | null>(null);
  const [cerrandoSesion, setCerrandoSesion] = useState<boolean>(false);

  // Estados de navegación interna del dashboard
  const [seccionActiva, setSeccionActiva] = useState<AdminSectionId>('resumen');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // 1. Verificación inicial de sesión al montar el componente en el navegador
  const verificarEstadoSesion = useCallback(async () => {
    setComprobando(true);
    setErrorInfraestructura(null);

    try {
      const estado = await adminClient.checkSession();
      setSession(estado);
    } catch (err: any) {
      if (err instanceof AdminClientError && err.statusCode === 503) {
        setErrorInfraestructura(
          'El servicio de autenticación no puede contactar la base de datos de producción (503). Por favor, verifique el estado del servidor.'
        );
      } else {
        setSession({ authenticated: false, hasCsrfToken: false });
      }
    } finally {
      setComprobando(false);
    }
  }, []);

  useEffect(() => {
    verificarEstadoSesion();
  }, [verificarEstadoSesion]);

  // 2. Callback tras login exitoso
  const handleLoginSuccess = (sessionData: { expiresAt?: number; modo?: AdminEntornoModo }) => {
    setSession({
      authenticated: true,
      expiresAt: sessionData.expiresAt,
      modo: sessionData.modo,
      hasCsrfToken: true,
    });
    setMensajeLogout(null);
  };

  // 3. Cierre de sesión (Logout)
  const handleLogout = async () => {
    setCerrandoSesion(true);
    setMensajeLogout(null);

    try {
      const res = await adminClient.logout();
      setSession({ authenticated: false, hasCsrfToken: false });

      if (res.revocado) {
        setMensajeLogout('Sesión cerrada y revocada correctamente en el servidor.');
      } else if (!res.success && res.error) {
        setMensajeLogout(res.error);
      } else {
        setMensajeLogout('Sesión finalizada localmente.');
      }
    } catch (err: any) {
      setSession({ authenticated: false, hasCsrfToken: false });
      setMensajeLogout('La sesión local fue cerrada, pero ocurrió un error al comunicar con el servidor.');
    } finally {
      setCerrandoSesion(false);
    }
  };

  // 4. Manejador estabilizado de expiración de sesión (HTTP 401 detectado en consultas de módulos hijos)
  const handleSessionExpired = useCallback((mensaje?: string) => {
    clearCsrfToken();
    setSession({ authenticated: false, hasCsrfToken: false });
    setMensajeLogout(
      mensaje || 'Su sesión administrativa ha expirado o ya no es válida. Por favor, inicie sesión nuevamente.'
    );
  }, []);

  // Render 1: Pantalla de carga mientras se verifica la cookie
  if (comprobando) {
    return (
      <div className="flex min-h-[85vh] flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
          <svg className="h-10 w-10 animate-spin text-blue-700" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <div className="text-center">
            <h3 className="text-base font-bold text-slate-800 font-heading">
              Verificando sesión administrativa...
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Comprobando credenciales criptográficas y vigencia del token
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render 2: Alerta de infraestructura no disponible (503)
  if (errorInfraestructura) {
    return (
      <div className="flex min-h-[85vh] items-center justify-center p-4">
        <div className="max-w-md rounded-2xl bg-white p-8 shadow-lg border border-amber-300">
          <div className="flex items-center gap-3 text-amber-700">
            <svg className="h-8 w-8 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-lg font-bold">Servicio No Disponible (HTTP 503)</h3>
          </div>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            {errorInfraestructura}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={verificarEstadoSesion}
              className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 transition cursor-pointer"
            >
              Reintentar Conexión
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render 3: No autenticado -> Mostrar Formulario de Login
  if (!session || !session.authenticated) {
    return <AdminLogin onLoginSuccess={handleLoginSuccess} mensajeInicial={mensajeLogout} />;
  }

  // Render 4: Sesión Autenticada -> Layout con Navegación y Resumen General (Fase B)
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row">
      {/* 1. Sidebar de navegación lateral (Fijo en desktop, drawer modal en móvil) */}
      <AdminSidebar
        seccionActiva={seccionActiva}
        onSelectSeccion={setSeccionActiva}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        modo={session.modo}
      />

      {/* 2. Área principal con margen compensatorio para el sidebar en desktop */}
      <div className="flex-1 flex flex-col md:pl-64 min-w-0">
        {/* Encabezado superior con título de sección, fecha en español y logout */}
        <AdminHeader
          seccionActiva={seccionActiva}
          onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
          onLogout={handleLogout}
          cerrandoSesion={cerrandoSesion}
          modo={session.modo}
        />

        {/* Contenedor del contenido principal */}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
          {/* Advertencia si la sesión está activa pero falta el CSRF Token */}
          {!session.hasCsrfToken && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-xs flex items-start gap-3">
              <svg className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="text-sm">
                <p className="font-bold">Token de seguridad CSRF no encontrado en memoria</p>
                <p className="mt-1 text-amber-800">
                  La sesión con cookie está activa, pero el token de protección contra falsificación entre sitios se perdió (ocurre si se abre la URL en otra pestaña). Para realizar operaciones de guardado o modificación de citas, por favor cierre sesión e ingrese nuevamente.
                </p>
              </div>
            </div>
          )}

          {/* Renderizado de la sección activa */}
          {seccionActiva === 'resumen' ? (
            <ResumenSection onSessionExpired={handleSessionExpired} />
          ) : seccionActiva === 'citas' ? (
            <CitasSection onSessionExpired={handleSessionExpired} />
          ) : seccionActiva === 'servicios' ? (
            <ServiciosSection onSessionExpired={handleSessionExpired} />
          ) : seccionActiva === 'bloqueos' ? (
            <BloqueosSection onSessionExpired={handleSessionExpired} />
          ) : (
            <div className="rounded-2xl bg-white p-8 border border-slate-200 text-center shadow-xs">
              <h3 className="text-base font-bold text-slate-800 font-heading">Sección en desarrollo</h3>
              <p className="text-xs text-slate-500 mt-1">Este módulo estará disponible en las siguientes fases.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
