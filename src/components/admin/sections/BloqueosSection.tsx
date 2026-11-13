import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { adminClient, AdminClientError } from '../../../lib/adminClient';
import {
  formatearHora12h,
  formatearFechaLarga,
  formatearFechaCorta,
  obtenerFechaHoyISO,
} from '../../../lib/utils/adminFormatters';
import { NuevoBloqueoModal, type NuevoBloqueoPayload } from '../modals/NuevoBloqueoModal';
import {
  ConfirmarEliminarBloqueoModal,
  type BloqueoEliminarData,
} from '../modals/ConfirmarEliminarBloqueoModal';

export interface BloqueoItem {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
  created_at?: string;
}

interface ErrorBloqueos {
  tipo: 'auth' | 'infraestructura' | 'red' | 'servidor';
  mensaje: string;
  statusCode?: number;
}

export interface BloqueosSectionProps {
  bloqueosIniciales?: BloqueoItem[] | null;
  cargandoInicial?: boolean;
  onSessionExpired?: (mensaje?: string) => void;
}

export const BloqueosSection: React.FC<BloqueosSectionProps> = ({
  bloqueosIniciales = null,
  cargandoInicial,
  onSessionExpired,
}) => {
  const hoyISO = obtenerFechaHoyISO();

  // Estados de datos
  const [bloqueos, setBloqueos] = useState<BloqueoItem[] | null>(bloqueosIniciales);
  const [cargando, setCargando] = useState<boolean>(cargandoInicial ?? (bloqueosIniciales === null));
  const [actualizando, setActualizando] = useState<boolean>(false);
  const [error, setError] = useState<ErrorBloqueos | null>(null);

  // Estados de filtrado
  const [modoFiltro, setModoFiltro] = useState<'todos' | 'proximos' | 'hoy' | 'especifico' | 'rango'>('proximos');
  const [fechaEspecifica, setFechaEspecifica] = useState<string>(hoyISO);
  const [fechaDesde, setFechaDesde] = useState<string>(hoyISO);
  const [fechaHasta, setFechaHasta] = useState<string>(hoyISO);
  const [busquedaMotivo, setBusquedaMotivo] = useState<string>('');
  const [errorRango, setErrorRango] = useState<string | null>(null);

  // Notificaciones de éxito
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // Estados de modales
  const [modalCrearAbierto, setModalCrearAbierto] = useState<boolean>(false);
  const [procesandoCreacion, setProcesandoCreacion] = useState<boolean>(false);

  const [bloqueoAEliminar, setBloqueoAEliminar] = useState<BloqueoEliminarData | null>(null);
  const [procesandoEliminacion, setProcesandoEliminacion] = useState<boolean>(false);

  // Consulta de bloqueos desde el backend
  const cargarBloqueos = useCallback(
    async (esRefrescoManual: boolean = false) => {
      setErrorRango(null);

      // Preparar parámetros según el modo de filtro activo
      const filtros: { fecha?: string; desde?: string; hasta?: string } = {};

      if (modoFiltro === 'hoy') {
        filtros.fecha = hoyISO;
      } else if (modoFiltro === 'proximos') {
        filtros.desde = hoyISO;
      } else if (modoFiltro === 'especifico') {
        if (!fechaEspecifica || !/^\d{4}-\d{2}-\d{2}$/.test(fechaEspecifica)) {
          return;
        }
        filtros.fecha = fechaEspecifica;
      } else if (modoFiltro === 'rango') {
        if (!fechaDesde || !fechaHasta) {
          return;
        }
        if (fechaDesde > fechaHasta) {
          setErrorRango('La fecha inicial ("Desde") no puede ser posterior a la fecha final ("Hasta").');
          return;
        }
        filtros.desde = fechaDesde;
        filtros.hasta = fechaHasta;
      }

      if (esRefrescoManual) {
        setActualizando(true);
      } else {
        setCargando(true);
      }
      setError(null);

      try {
        const data = await adminClient.getBloqueos(filtros);

        if (!data || typeof data !== 'object' || !Array.isArray(data.bloqueos)) {
          throw new Error('La respuesta del servidor no tiene un formato de lista de bloqueos válido');
        }

        // Ordenar cronológicamente por fecha ASC y luego por hora_inicio ASC
        const ordenados = [...data.bloqueos].sort((a, b) => {
          if (a.fecha !== b.fecha) {
            return a.fecha.localeCompare(b.fecha);
          }
          return a.hora_inicio.localeCompare(b.hora_inicio);
        });

        setBloqueos(ordenados);
        setError(null);
      } catch (err: any) {
        if (err instanceof AdminClientError) {
          if (err.statusCode === 401 || err.code === 'UNAUTHORIZED') {
            if (onSessionExpired) {
              onSessionExpired('Su sesión administrativa ha expirado. Por favor, inicie sesión nuevamente.');
              return;
            }
            setError({
              tipo: 'auth',
              statusCode: 401,
              mensaje: 'La sesión administrativa ha expirado. Por favor, vuelva a iniciar sesión.',
            });
            return;
          }

          if (err.statusCode === 503 || err.code === 'SERVICE_UNAVAILABLE') {
            setError({
              tipo: 'infraestructura',
              statusCode: 503,
              mensaje: 'La base de datos no está disponible temporalmente (HTTP 503). La sesión sigue activa.',
            });
            return;
          }

          if (err.code === 'NETWORK_ERROR' || err.statusCode === 0) {
            setError({
              tipo: 'red',
              statusCode: 0,
              mensaje: 'No se pudo conectar con el servidor. Verifique su conexión de red.',
            });
            return;
          }

          if (err.statusCode === 403 || err.code === 'FORBIDDEN') {
            setError({
              tipo: 'auth',
              statusCode: 403,
              mensaje: 'Acceso denegado o permisos insuficientes (HTTP 403).',
            });
            return;
          }
        }

        setError({
          tipo: 'servidor',
          statusCode: err?.statusCode || 500,
          mensaje: err?.message || 'Error al consultar los bloqueos de agenda.',
        });
      } finally {
        setCargando(false);
        setActualizando(false);
      }
    },
    [modoFiltro, fechaEspecifica, fechaDesde, fechaHasta, hoyISO, onSessionExpired]
  );

  // Carga inicial
  useEffect(() => {
    if (bloqueosIniciales === null) {
      cargarBloqueos();
    }
  }, [cargarBloqueos, bloqueosIniciales]);

  // Manejador para crear bloqueo
  const handleCrearBloqueo = async (payload: NuevoBloqueoPayload) => {
    setProcesandoCreacion(true);
    try {
      const res = await adminClient.createBloqueo(payload);

      if (res && res.success) {
        setMensajeExito(
          `Bloqueo de agenda registrado exitosamente para el ${formatearFechaCorta(payload.fecha)}.`
        );
        setModalCrearAbierto(false);
        // Sincronizar catálogo
        cargarBloqueos(true);
      }
    } catch (err: any) {
      if (err instanceof AdminClientError && (err.statusCode === 401 || err.code === 'UNAUTHORIZED')) {
        if (onSessionExpired) {
          onSessionExpired('Su sesión administrativa ha expirado. Por favor, inicie sesión nuevamente.');
          return;
        }
      }
      throw err; // Re-lanzar para que NuevoBloqueoModal gestione 409 u otros errores
    } finally {
      setProcesandoCreacion(false);
    }
  };

  // Manejador para confirmar y ejecutar la eliminación
  const handleConfirmarEliminacion = async () => {
    if (!bloqueoAEliminar || procesandoEliminacion) return;

    setProcesandoEliminacion(true);
    try {
      await adminClient.deleteBloqueo(bloqueoAEliminar.id);

      setMensajeExito(
        `Bloqueo de agenda del ${formatearFechaCorta(bloqueoAEliminar.fecha)} eliminado. El horario ha sido liberado.`
      );

      // Actualización optimista local
      setBloqueos((prev) => (prev ? prev.filter((b) => b.id !== bloqueoAEliminar.id) : prev));
      setBloqueoAEliminar(null);

      // Sincronización en segundo plano
      cargarBloqueos(true);
    } catch (err: any) {
      if (err instanceof AdminClientError && (err.statusCode === 401 || err.code === 'UNAUTHORIZED')) {
        if (onSessionExpired) {
          onSessionExpired('Su sesión administrativa ha expirado. Por favor, inicie sesión nuevamente.');
          return;
        }
      }

      setError({
        tipo: 'servidor',
        statusCode: err?.statusCode || 500,
        mensaje: err?.details?.error || err?.message || 'Error al eliminar el bloqueo de agenda.',
      });
      setBloqueoAEliminar(null);
    } finally {
      setProcesandoEliminacion(false);
    }
  };

  // Filtrado adicional en memoria por motivo
  const bloqueosFiltrados = useMemo(() => {
    if (!bloqueos) return [];
    const q = busquedaMotivo.trim().toLowerCase();
    if (!q) return bloqueos;
    return bloqueos.filter((b) => b.motivo.toLowerCase().includes(q));
  }, [bloqueos, busquedaMotivo]);

  // Métricas
  const totalEnVista = bloqueosFiltrados.length;
  const totalDiaCompleto = bloqueosFiltrados.filter(
    (b) =>
      (b.hora_inicio === '00:00:00' || b.hora_inicio === '00:00') &&
      (b.hora_fin === '23:59:59' || b.hora_fin === '23:59')
  ).length;
  const totalFuturos = bloqueosFiltrados.filter((b) => b.fecha >= hoyISO).length;

  return (
    <div className="space-y-6">
      {/* 1. Cabecera y Barra de Acciones */}
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </span>
              <h2 className="text-lg font-bold text-slate-900 font-heading">
                Bloqueos y Excepciones de Agenda
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Gestione periodos de indisponibilidad horaria, días festivos o capacitaciones clínicas que inhabilitan la reserva pública.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => cargarBloqueos(true)}
              disabled={cargando || actualizando || procesandoCreacion || procesandoEliminacion}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition cursor-pointer disabled:opacity-50"
              title="Actualizar bloqueos desde el servidor"
            >
              <svg
                className={`h-4 w-4 text-slate-600 ${actualizando ? 'animate-spin text-amber-700' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{actualizando ? 'Actualizando...' : 'Actualizar'}</span>
            </button>

            <button
              type="button"
              onClick={() => setModalCrearAbierto(true)}
              disabled={cargando}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>Nuevo Bloqueo</span>
            </button>
          </div>
        </div>

        {/* 2. Tarjetas de Métricas Rápidas */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-5 border-t border-slate-100">
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Total en Vista</span>
              <span className="text-xl font-black text-slate-900 font-heading">{totalEnVista}</span>
            </div>
            <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs">
              #
            </div>
          </div>

          <div className="rounded-xl bg-amber-50/50 p-3.5 border border-amber-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 block">Día Completo</span>
              <span className="text-xl font-black text-amber-900 font-heading">{totalDiaCompleto}</span>
            </div>
            <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
              24h
            </div>
          </div>

          <div className="rounded-xl bg-blue-50/50 p-3.5 border border-blue-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">Próximos / Futuros</span>
              <span className="text-xl font-black text-blue-900 font-heading">{totalFuturos}</span>
            </div>
            <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
              📅
            </div>
          </div>
        </div>

        {/* 3. Filtros y Búsqueda */}
        <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
          {/* Pills de Modalidad de Consulta */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">Filtrar por:</span>
            {[
              { id: 'proximos', label: 'Próximos (Desde hoy)' },
              { id: 'hoy', label: 'Solo Hoy' },
              { id: 'todos', label: 'Histórico Completo' },
              { id: 'especifico', label: 'Fecha Específica' },
              { id: 'rango', label: 'Rango de Fechas' },
            ].map((p) => {
              const activo = modoFiltro === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setModoFiltro(p.id as any);
                    setErrorRango(null);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer border ${
                    activo
                      ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Sub-barra de filtros según la modalidad seleccionada */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100/80">
            {/* Controles de fecha */}
            <div className="flex flex-wrap items-center gap-2">
              {modoFiltro === 'especifico' && (
                <div className="flex items-center gap-2 animate-in fade-in">
                  <label htmlFor="filtro-fecha-especifica" className="text-xs font-bold text-slate-600">
                    Fecha:
                  </label>
                  <input
                    type="date"
                    id="filtro-fecha-especifica"
                    value={fechaEspecifica}
                    onChange={(e) => setFechaEspecifica(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden"
                  />
                </div>
              )}

              {modoFiltro === 'rango' && (
                <div className="flex flex-wrap items-center gap-2 animate-in fade-in">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="filtro-fecha-desde" className="text-xs font-bold text-slate-600">
                      Desde:
                    </label>
                    <input
                      type="date"
                      id="filtro-fecha-desde"
                      value={fechaDesde}
                      onChange={(e) => setFechaDesde(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label htmlFor="filtro-fecha-hasta" className="text-xs font-bold text-slate-600">
                      Hasta:
                    </label>
                    <input
                      type="date"
                      id="filtro-fecha-hasta"
                      value={fechaHasta}
                      onChange={(e) => setFechaHasta(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden"
                    />
                  </div>
                </div>
              )}

              {/* Botón de limpiar filtros si se usaron filtros avanzados */}
              {(modoFiltro !== 'proximos' || busquedaMotivo) && (
                <button
                  type="button"
                  onClick={() => {
                    setModoFiltro('proximos');
                    setBusquedaMotivo('');
                    setFechaEspecifica(hoyISO);
                    setFechaDesde(hoyISO);
                    setFechaHasta(hoyISO);
                    setErrorRango(null);
                  }}
                  className="text-xs font-bold text-blue-700 hover:text-blue-900 transition underline cursor-pointer ml-1"
                >
                  Restablecer filtros
                </button>
              )}
            </div>

            {/* Buscador de texto por Motivo */}
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                value={busquedaMotivo}
                onChange={(e) => setBusquedaMotivo(e.target.value)}
                placeholder="Buscar por motivo..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition"
              />
              <svg
                className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {busquedaMotivo && (
                <button
                  type="button"
                  onClick={() => setBusquedaMotivo('')}
                  className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Advertencia de rango de fechas invertido */}
          {errorRango && (
            <div className="rounded-xl bg-rose-50 p-2.5 border border-rose-200 text-xs text-rose-800 flex items-center gap-2 animate-in fade-in">
              <svg className="h-4 w-4 shrink-0 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{errorRango}</span>
            </div>
          )}
        </div>
      </div>

      {/* 4. Notificaciones de Éxito */}
      {mensajeExito && (
        <div className="rounded-2xl p-4 border border-emerald-300 bg-emerald-50 text-emerald-900 flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <svg className="h-5 w-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs font-bold">{mensajeExito}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensajeExito(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 5. Banner de Error */}
      {error && (
        <div
          className={`rounded-2xl p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs ${
            error.tipo === 'infraestructura'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : error.tipo === 'red'
              ? 'bg-sky-50 border-sky-300 text-sky-900'
              : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-xs font-bold">
                {error.tipo === 'infraestructura'
                  ? 'Base de datos temporalmente no disponible (HTTP 503)'
                  : error.tipo === 'red'
                  ? 'Error de conexión de red'
                  : 'Error del servidor'}
              </p>
              <p className="text-xs opacity-90 mt-0.5">{error.mensaje}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => cargarBloqueos(true)}
            className="rounded-xl px-3 py-1.5 text-xs font-bold bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 transition cursor-pointer self-start sm:self-auto shrink-0 shadow-2xs"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* 6. Listado de Bloqueos (Skeleton, Vacío o Contenido) */}
      {cargando && bloqueos === null ? (
        <div className="rounded-2xl bg-white p-6 shadow-xs border border-slate-200 space-y-4 animate-pulse">
          <div className="h-4 bg-slate-200 rounded-md w-1/4" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      ) : bloqueos !== null && bloqueosFiltrados.length === 0 ? (
        <div className="rounded-2xl bg-white p-12 border border-slate-200 text-center shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h3 className="mt-3 text-sm font-bold text-slate-900 font-heading">
            {busquedaMotivo || modoFiltro !== 'proximos'
              ? 'No hay bloqueos que coincidan con los filtros aplicados'
              : 'No hay bloqueos de agenda programados'}
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
            {busquedaMotivo || modoFiltro !== 'proximos'
              ? 'Intente modificar la fecha, el rango o borrar el término de búsqueda.'
              : 'La agenda clínica se encuentra completamente disponible para reservas según el horario habitual.'}
          </p>
          <button
            type="button"
            onClick={() => setModalCrearAbierto(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 transition cursor-pointer"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>Crear Primer Bloqueo</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Vista Tabla Desktop */}
          <div className="hidden md:block rounded-2xl bg-white shadow-xs border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                <tr>
                  <th scope="col" className="px-5 py-3.5 w-44">Fecha</th>
                  <th scope="col" className="px-5 py-3.5 w-52">Horario / Cobertura</th>
                  <th scope="col" className="px-5 py-3.5">Motivo del Bloqueo</th>
                  <th scope="col" className="px-5 py-3.5 w-28 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bloqueosFiltrados.map((bloqueo) => {
                  const esDiaCompleto =
                    (bloqueo.hora_inicio === '00:00:00' || bloqueo.hora_inicio === '00:00') &&
                    (bloqueo.hora_fin === '23:59:59' || bloqueo.hora_fin === '23:59');

                  const horarioDisplay = esDiaCompleto
                    ? 'Día Completo (00:00 - 23:59)'
                    : `${formatearHora12h(bloqueo.hora_inicio)} - ${formatearHora12h(bloqueo.hora_fin)}`;

                  return (
                    <tr key={bloqueo.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Fecha */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{formatearFechaLarga(bloqueo.fecha)}</div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {bloqueo.fecha} {bloqueo.fecha === hoyISO && '(Hoy)'}
                        </span>
                      </td>

                      {/* Horario */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        {esDiaCompleto ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            <span>{horarioDisplay}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">
                            <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{horarioDisplay}</span>
                          </span>
                        )}
                      </td>

                      {/* Motivo */}
                      <td className="px-5 py-4">
                        <p className="text-xs text-slate-800 font-medium leading-relaxed max-w-xl">
                          {bloqueo.motivo}
                        </p>
                      </td>

                      {/* Acción Eliminar */}
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setBloqueoAEliminar(bloqueo)}
                          disabled={procesandoCreacion || procesandoEliminacion}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 px-3 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                          title="Eliminar bloqueo y liberar horario"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span>Eliminar</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Vista Tarjetas Mobile */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {bloqueosFiltrados.map((bloqueo) => {
              const esDiaCompleto =
                (bloqueo.hora_inicio === '00:00:00' || bloqueo.hora_inicio === '00:00') &&
                (bloqueo.hora_fin === '23:59:59' || bloqueo.hora_fin === '23:59');

              const horarioDisplay = esDiaCompleto
                ? 'Día Completo (00:00 - 23:59)'
                : `${formatearHora12h(bloqueo.hora_inicio)} - ${formatearHora12h(bloqueo.hora_fin)}`;

              return (
                <div
                  key={bloqueo.id}
                  className="rounded-2xl bg-white p-5 shadow-xs border border-slate-200 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md inline-block mb-1">
                        {bloqueo.fecha} {bloqueo.fecha === hoyISO && '• HOY'}
                      </span>
                      <h3 className="font-bold text-slate-900 text-sm leading-snug">
                        {formatearFechaLarga(bloqueo.fecha)}
                      </h3>
                    </div>

                    {esDiaCompleto ? (
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        Día Completo
                      </span>
                    ) : (
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                        Intervalo
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100 leading-relaxed">
                    {bloqueo.motivo}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{horarioDisplay}</span>
                    </span>

                    <button
                      type="button"
                      onClick={() => setBloqueoAEliminar(bloqueo)}
                      disabled={procesandoCreacion || procesandoEliminacion}
                      className="inline-flex items-center gap-1 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 px-3 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Eliminar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. Modal para Crear Nuevo Bloqueo */}
      <NuevoBloqueoModal
        isOpen={modalCrearAbierto}
        onClose={() => {
          if (!procesandoCreacion) {
            setModalCrearAbierto(false);
          }
        }}
        onSave={handleCrearBloqueo}
        procesando={procesandoCreacion}
      />

      {/* 8. Modal para Confirmar Eliminación de Bloqueo */}
      <ConfirmarEliminarBloqueoModal
        isOpen={bloqueoAEliminar !== null}
        onClose={() => {
          if (!procesandoEliminacion) {
            setBloqueoAEliminar(null);
          }
        }}
        onConfirmar={handleConfirmarEliminacion}
        bloqueo={bloqueoAEliminar}
        procesando={procesandoEliminacion}
      />
    </div>
  );
};

