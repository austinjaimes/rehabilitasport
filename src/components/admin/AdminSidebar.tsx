import React from 'react';

export type AdminSectionId = 'resumen' | 'citas' | 'servicios' | 'bloqueos';

interface NavItemConfig {
  id: AdminSectionId;
  label: string;
  enabled: boolean;
  badge?: string;
  badgeType?: 'upcoming' | 'active';
  description: string;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'resumen',
    label: 'Resumen',
    enabled: true,
    description: 'Métricas del día y estado general',
  },
  {
    id: 'citas',
    label: 'Citas',
    enabled: true,
    description: 'Gestión y agenda de pacientes',
  },
  {
    id: 'servicios',
    label: 'Servicios',
    enabled: true,
    description: 'Catálogo de especialidades',
  },
  {
    id: 'bloqueos',
    label: 'Bloqueos de Agenda',
    enabled: true,
    description: 'Excepciones y descansos',
  },
];

interface AdminSidebarProps {
  seccionActiva: AdminSectionId;
  onSelectSeccion: (seccion: AdminSectionId) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  modo?: 'real' | 'local_real' | 'simulado_dev';
}

function renderNavIcon(id: AdminSectionId, isActive: boolean) {
  const iconClass = `h-5 w-5 shrink-0 transition-colors ${
    isActive ? 'text-blue-700' : 'text-slate-400 group-hover:text-slate-600'
  }`;

  switch (id) {
    case 'resumen':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      );
    case 'citas':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'servicios':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      );
    case 'bloqueos':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      );
  }
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  seccionActiva,
  onSelectSeccion,
  isOpenMobile,
  onCloseMobile,
  modo,
}) => {
  const handleItemClick = (item: NavItemConfig) => {
    if (!item.enabled) return;
    onSelectSeccion(item.id);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      {/* Encabezado del Sidebar: Marca y Logotipo */}
      <div className="flex items-center justify-between h-16 px-5 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-700 text-white font-extrabold text-sm shadow-xs font-heading">
            RS
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-slate-900 font-heading text-sm tracking-tight leading-tight">
              Rehabilita Sport
            </span>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Panel Administrativo
            </span>
          </div>
        </div>

        {/* Botón de cierre exclusivo para móvil */}
        <button
          type="button"
          onClick={onCloseMobile}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          aria-label="Cerrar menú lateral"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Indicador de Entorno de Ejecución */}
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-500">Entorno:</span>
          {modo === 'local_real' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700 border border-blue-200">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              Local (Supabase Real)
            </span>
          ) : modo === 'simulado_dev' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Simulado (Dev)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Producción
            </span>
          )}
        </div>
      </div>

      {/* Lista de Navegación Principal */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto" aria-label="Navegación administrativa">
        <div className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Módulos
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive = seccionActiva === item.id;
          const isEnabled = item.enabled;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleItemClick(item)}
              disabled={!isEnabled}
              aria-current={isActive ? 'page' : undefined}
              aria-disabled={!isEnabled}
              title={!isEnabled ? `${item.label} estará disponible en una próxima fase` : item.label}
              className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold transition-all text-left ${
                isActive
                  ? 'bg-blue-50 text-blue-800 shadow-xs ring-1 ring-blue-700/10'
                  : isEnabled
                  ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer'
                  : 'text-slate-400 bg-slate-50/40 cursor-not-allowed opacity-80'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {renderNavIcon(item.id, isActive)}
                <div className="truncate">
                  <span className={`block truncate ${isActive ? 'font-extrabold text-blue-900' : ''}`}>
                    {item.label}
                  </span>
                  <span className="block text-[10px] font-normal text-slate-400 truncate">
                    {item.description}
                  </span>
                </div>
              </div>

              {/* Badge de Próximamente o Activo */}
              {item.badge && (
                <span className="ml-2 shrink-0 inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 border border-slate-200">
                  {item.badge}
                </span>
              )}
              {isActive && (
                <span className="ml-2 h-2 w-2 rounded-full bg-blue-700 shrink-0" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Pie del Sidebar: Información de Versión y Seguridad */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/50">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="font-semibold">Rehabilita Sport</span>
          <span className="font-mono">Fase B • v1.1</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-700 font-bold">
          <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Sesión Segura HttpOnly</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* 1. Sidebar Fijo para Escritorio (md en adelante) */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 z-30">
        {navContent}
      </aside>

      {/* 2. Drawer Deslizante para Dispositivos Móviles */}
      {isOpenMobile && (
        <div className="relative z-50 md:hidden" role="dialog" aria-modal="true">
          {/* Fondo difuminado (Backdrop) */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />

          {/* Panel deslizante */}
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col transform transition-transform ease-in-out duration-200">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
};

