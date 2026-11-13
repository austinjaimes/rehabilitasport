import React from 'react';
import type { AdminSectionId } from './AdminSidebar';
import { formatearFechaLarga, obtenerFechaHoyISO } from '../../lib/utils/adminFormatters';

interface AdminHeaderProps {
  seccionActiva: AdminSectionId;
  onToggleMobileMenu: () => void;
  onLogout: () => void;
  cerrandoSesion: boolean;
  modo?: 'real' | 'local_real' | 'simulado_dev';
}

function obtenerTituloSeccion(seccion: AdminSectionId): { titulo: string; subtitulo: string } {
  switch (seccion) {
    case 'resumen':
      return {
        titulo: 'Resumen General',
        subtitulo: 'Métricas clave y estado de la agenda del día',
      };
    case 'citas':
      return {
        titulo: 'Gestión de Citas',
        subtitulo: 'Agenda detallada y estados de atención',
      };
    case 'servicios':
      return {
        titulo: 'Catálogo de Servicios',
        subtitulo: 'Especialidades clínicas y duraciones',
      };
    case 'bloqueos':
      return {
        titulo: 'Bloqueos de Agenda',
        subtitulo: 'Excepciones y horarios no disponibles',
      };
    default:
      return {
        titulo: 'Panel Administrativo',
        subtitulo: 'Rehabilita Sport',
      };
  }
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  seccionActiva,
  onToggleMobileMenu,
  onLogout,
  cerrandoSesion,
  modo,
}) => {
  const { titulo, subtitulo } = obtenerTituloSeccion(seccionActiva);
  const fechaHoyStr = formatearFechaLarga(obtenerFechaHoyISO());

  return (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200 shadow-xs">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {/* Lado izquierdo: Botón hamburguesa móvil + Título dinámico */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="md:hidden inline-flex items-center justify-center p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer border border-slate-200"
            aria-label="Abrir menú de navegación"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-black text-slate-900 font-heading tracking-tight truncate leading-tight">
              {titulo}
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-500 truncate hidden xs:block">
              {subtitulo}
            </p>
          </div>
        </div>

        {/* Lado derecho: Fecha en español + Badge de entorno + Botón de Cerrar Sesión */}
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          {/* Fecha actual en español (oculta en pantallas muy pequeñas) */}
          <div className="hidden lg:flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 border border-slate-200 text-xs font-semibold text-slate-600">
            <svg className="h-3.5 w-3.5 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="capitalize">{fechaHoyStr}</span>
          </div>

          {/* Badge de Entorno en tablet / escritorio */}
          <div className="hidden sm:block">
            {modo === 'local_real' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 border border-blue-200">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                Local (Supabase Real)
              </span>
            ) : modo === 'simulado_dev' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 border border-amber-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                Dev Simulado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Producción
              </span>
            )}
          </div>

          {/* Botón Logout */}
          <button
            type="button"
            onClick={onLogout}
            disabled={cerrandoSesion}
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-bold text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition shadow-xs cursor-pointer disabled:opacity-50"
            title="Cerrar sesión administrativa de forma segura"
          >
            {cerrandoSesion ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin text-rose-600" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Cerrando...</span>
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Cerrar Sesión</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

