import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { adminClient, AdminClientError } from '../../../lib/adminClient';
import { ServicioModal, type ServicioFormData } from '../modals/ServicioModal';

export interface ServicioItem {
  id: string;
  nombre: string;
  descripcion?: string | null;
  duracion_minutos: number;
  activo: boolean;
  orden: number;
  created_at?: string;
  updated_at?: string;
}

interface ErrorServicios {
  tipo: 'auth' | 'infraestructura' | 'red' | 'servidor';
  mensaje: string;
  statusCode?: number;
}

export interface ServiciosSectionProps {
  serviciosIniciales?: ServicioItem[] | null;
  cargandoInicial?: boolean;
  onSessionExpired?: (mensaje?: string) => void;
}

export const ServiciosSection: React.FC<ServiciosSectionProps> = ({
  serviciosIniciales = null,
  cargandoInicial,
  onSessionExpired,
}) => {
  // Estados de datos y carga
  const [servicios, setServicios] = useState<ServicioItem[] | null>(serviciosIniciales);
  const [cargando, setCargando] = useState<boolean>(cargandoInicial ?? (serviciosIniciales === null));
  const [actualizando, setActualizando] = useState<boolean>(false);
  const [error, setError] = useState<ErrorServicios | null>(null);

  // Filtro y búsqueda
  const [filtroActivo, setFiltroActivo] = useState<'todos' | 'activos' | 'inactivos'>('todos');
  const [busqueda, setBusqueda] = useState<string>('');

  // Notificaciones de éxito
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // Estados de modal y edición
  const [modalAbierto, setModalAbierto] = useState<boolean>(false);
  const [servicioAEditar, setServicioAEditar] = useState<ServicioFormData | null>(null);
  const [procesandoGuardado, setProcesandoGuardado] = useState<boolean>(false);

  // Estado para bloqueo de fila individual al hacer toggle rápido
  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  // Estado para confirmación de desactivación de servicio
  const [servicioADesactivar, setServicioADesactivar] = useState<ServicioItem | null>(null);

  // Función de consulta centralizada de servicios
  const cargarServicios = useCallback(
    async (esRefrescoManual: boolean = false) => {
      if (esRefrescoManual) {
        setActualizando(true);
      } else {
        setCargando(true);
      }
      setError(null);

      try {
        const data = await adminClient.getServicios();

        if (!data || typeof data !== 'object' || !Array.isArray(data.servicios)) {
          throw new Error('La respuesta del servidor no tiene una estructura de catálogo válida');
        }

        // Ordenar siempre por 'orden' de menor a mayor
        const ordenados = [...data.servicios].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
        setServicios(ordenados);
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
              mensaje: 'Acceso rechazado o permisos insuficientes (HTTP 403).',
            });
            return;
          }
        }

        setError({
          tipo: 'servidor',
          statusCode: err?.statusCode || 500,
          mensaje: err?.message || 'Error al consultar el catálogo de servicios.',
        });
      } finally {
        setCargando(false);
        setActualizando(false);
      }
    },
    [onSessionExpired]
  );

  // Carga inicial si no se proporcionaron datos
  useEffect(() => {
    if (serviciosIniciales === null) {
      cargarServicios();
    }
  }, [cargarServicios, serviciosIniciales]);

  // Manejo de teclado: Cerrar diálogo de desactivación con Escape
  useEffect(() => {
    if (!servicioADesactivar) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !procesandoId) {
        setServicioADesactivar(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [servicioADesactivar, procesandoId]);

  // Manejador de guardado (creación o edición)
  const handleGuardarServicio = async (formData: ServicioFormData) => {
    setProcesandoGuardado(true);
    setError(null);

    try {
      const res = await adminClient.saveServicio({
        id: formData.id,
        nombre: formData.nombre,
        descripcion: formData.descripcion,
        duracionMinutos: formData.duracionMinutos,
        activo: formData.activo,
        orden: formData.orden,
      });

      if (res && res.servicio) {
        const servicioGuardado = res.servicio;
        const esEdicion = Boolean(formData.id);

        setMensajeExito(
          esEdicion
            ? `Servicio "${servicioGuardado.nombre}" actualizado correctamente.`
            : `Servicio "${servicioGuardado.nombre}" creado exitosamente.`
        );

        // Actualizar estado local inmediatamente
        setServicios((prev) => {
          if (!prev) return [servicioGuardado];
          if (esEdicion) {
            return prev
              .map((s) => (s.id === servicioGuardado.id ? { ...s, ...servicioGuardado } : s))
              .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
          }
          return [...prev, servicioGuardado].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
        });

        setModalAbierto(false);
        setServicioAEditar(null);

        // Sincronizar con el backend
        cargarServicios(true);
      }
    } catch (err: any) {
      if (err instanceof AdminClientError) {
        if (err.statusCode === 401 || err.code === 'UNAUTHORIZED') {
          if (onSessionExpired) {
            onSessionExpired('Su sesión administrativa ha expirado. Por favor, inicie sesión nuevamente.');
            return;
          }
        }
        if (err.code === 'MISSING_CSRF' || err.statusCode === 403) {
          setError({
            tipo: 'auth',
            statusCode: 403,
            mensaje: 'Falta el token de seguridad CSRF en memoria. Por favor, inicie sesión de nuevo.',
          });
          return;
        }
      }

      setError({
        tipo: 'servidor',
        statusCode: err?.statusCode || 500,
        mensaje: err?.details?.error || err?.message || 'Error al guardar el servicio en el catálogo.',
      });
      throw err; // Re-lanzar para que ServicioModal muestre el error local
    } finally {
      setProcesandoGuardado(false);
    }
  };

  // Solicitar cambio de estado activo/inactivo (con confirmación al desactivar)
  const handleSolicitarToggleActivo = (servicio: ServicioItem) => {
    if (procesandoId || procesandoGuardado) return;
    if (servicio.activo) {
      // Desactivar servicio activo requiere confirmación explícita
      setServicioADesactivar(servicio);
    } else {
      // Activar servicio inactivo no requiere confirmación previa
      ejecutarToggleActivo(servicio, true);
    }
  };

  // Ejecución de la mutación de estado activo/inactivo
  const ejecutarToggleActivo = async (servicio: ServicioItem, nuevoActivo: boolean) => {
    if (procesandoId) return;
    setProcesandoId(servicio.id);
    setError(null);

    try {
      await adminClient.saveServicio({
        id: servicio.id,
        nombre: servicio.nombre,
        descripcion: servicio.descripcion,
        duracionMinutos: servicio.duracion_minutos,
        activo: Boolean(nuevoActivo),
        orden: servicio.orden,
      });

      // Actualización optimista del estado local
      setServicios((prev) => {
        if (!prev) return prev;
        return prev.map((s) => (s.id === servicio.id ? { ...s, activo: nuevoActivo } : s));
      });

      setMensajeExito(
        `Servicio "${servicio.nombre}" ${nuevoActivo ? 'activado' : 'desactivado'} para reservas públicas.`
      );
      setServicioADesactivar(null);
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
        mensaje: err?.details?.error || err?.message || 'No se pudo cambiar el estado del servicio.',
      });
    } finally {
      setProcesandoId(null);
    }
  };

  // Abrir modal para crear
  const handleAbrirCrear = () => {
    setServicioAEditar(null);
    setModalAbierto(true);
  };

  // Abrir modal para editar
  const handleAbrirEditar = (servicio: ServicioItem) => {
    setServicioAEditar({
      id: servicio.id,
      nombre: servicio.nombre,
      descripcion: servicio.descripcion,
      duracionMinutos: servicio.duracion_minutos,
      activo: servicio.activo,
      orden: servicio.orden,
    });
    setModalAbierto(true);
  };

  // Filtrado y búsqueda en memoria
  const serviciosFiltrados = useMemo(() => {
    if (!servicios) return [];
    let resultado = [...servicios];

    // Filtro por estado activo/inactivo
    if (filtroActivo === 'activos') {
      resultado = resultado.filter((s) => s.activo === true);
    } else if (filtroActivo === 'inactivos') {
      resultado = resultado.filter((s) => s.activo === false);
    }

    // Filtro por término de búsqueda
    const q = busqueda.trim().toLowerCase();
    if (q) {
      resultado = resultado.filter(
        (s) =>
          s.nombre.toLowerCase().includes(q) ||
          (s.descripcion && s.descripcion.toLowerCase().includes(q))
      );
    }

    return resultado;
  }, [servicios, filtroActivo, busqueda]);

  // Métricas rápidas
  const totalServicios = servicios?.length ?? 0;
  const totalActivos = servicios?.filter((s) => s.activo).length ?? 0;
  const totalInactivos = totalServicios - totalActivos;

  return (
    <div className="space-y-6">
      {/* 1. Cabecera y Barra de Acciones */}
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </span>
              <h2 className="text-lg font-bold text-slate-900 font-heading">
                Catálogo de Especialidades y Servicios
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Gestione las especialidades clínicas disponibles para reserva pública y su duración.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => cargarServicios(true)}
              disabled={cargando || actualizando || Boolean(procesandoId)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition cursor-pointer disabled:opacity-50"
              title="Actualizar catálogo desde el servidor"
            >
              <svg
                className={`h-4 w-4 text-slate-600 ${actualizando ? 'animate-spin text-blue-700' : ''}`}
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
              onClick={handleAbrirCrear}
              disabled={cargando}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>Nuevo Servicio</span>
            </button>
          </div>
        </div>

        {/* 2. Tarjetas de Métricas Rápidas */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-5 border-t border-slate-100">
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Total Servicios</span>
              <span className="text-xl font-black text-slate-900 font-heading">{totalServicios}</span>
            </div>
            <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs">
              #
            </div>
          </div>

          <div className="rounded-xl bg-emerald-50/50 p-3.5 border border-emerald-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">Activos en Portal</span>
              <span className="text-xl font-black text-emerald-900 font-heading">{totalActivos}</span>
            </div>
            <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Inactivos (Ocultos)</span>
              <span className="text-xl font-black text-slate-700 font-heading">{totalInactivos}</span>
            </div>
            <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            </div>
          </div>
        </div>

        {/* 3. Filtros y Búsqueda */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Pills de Estado */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">Filtrar:</span>
            {(['todos', 'activos', 'inactivos'] as const).map((filtro) => {
              const activo = filtroActivo === filtro;
              const labels = { todos: 'Todos', activos: 'Activos', inactivos: 'Inactivos' };
              return (
                <button
                  key={filtro}
                  type="button"
                  onClick={() => setFiltroActivo(filtro)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer border ${
                    activo
                      ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {labels[filtro]}
                </button>
              );
            })}
          </div>

          {/* Buscador */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar especialidad..."
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
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
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
            onClick={() => cargarServicios(true)}
            className="rounded-xl px-3 py-1.5 text-xs font-bold bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 transition cursor-pointer self-start sm:self-auto shrink-0 shadow-2xs"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* 6. Listado de Servicios (Skeleton o Contenido) */}
      {cargando && servicios === null ? (
        <div className="rounded-2xl bg-white p-6 shadow-xs border border-slate-200 space-y-4 animate-pulse">
          <div className="h-4 bg-slate-200 rounded-md w-1/4" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      ) : servicios !== null && serviciosFiltrados.length === 0 ? (
        <div className="rounded-2xl bg-white p-12 border border-slate-200 text-center shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="mt-3 text-sm font-bold text-slate-900 font-heading">
            {busqueda || filtroActivo !== 'todos'
              ? 'No hay servicios que coincidan con los filtros'
              : 'No hay servicios registrados en el catálogo'}
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
            {busqueda || filtroActivo !== 'todos'
              ? 'Intente modificar el criterio de búsqueda o seleccionar "Todos".'
              : 'Comience agregando las especialidades de terapia física y rehabilitación de la clínica.'}
          </p>
          {!busqueda && filtroActivo === 'todos' && (
            <button
              type="button"
              onClick={handleAbrirCrear}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 transition cursor-pointer"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>Crear Primer Servicio</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Vista Tabla Desktop */}
          <div className="hidden md:block rounded-2xl bg-white shadow-xs border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                <tr>
                  <th scope="col" className="px-5 py-3.5 w-16 text-center">Orden</th>
                  <th scope="col" className="px-5 py-3.5">Especialidad / Servicio</th>
                  <th scope="col" className="px-5 py-3.5 w-32">Duración</th>
                  <th scope="col" className="px-5 py-3.5 w-36 text-center">Estado Portal</th>
                  <th scope="col" className="px-5 py-3.5 w-32 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {serviciosFiltrados.map((servicio) => {
                  const estaProcesandoFila = procesandoId === servicio.id;
                  return (
                    <tr key={servicio.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Orden */}
                      <td className="px-5 py-4 text-center">
                        <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                          #{servicio.orden}
                        </span>
                      </td>

                      {/* Nombre y Descripción */}
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900 text-sm">{servicio.nombre}</div>
                        {servicio.descripcion ? (
                          <p className="mt-0.5 text-xs text-slate-500 line-clamp-2 leading-relaxed">
                            {servicio.descripcion}
                          </p>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Sin descripción clínica detallada</span>
                        )}
                      </td>

                      {/* Duración */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>{servicio.duracion_minutos} min</span>
                        </span>
                      </td>

                      {/* Switch Activo / Inactivo */}
                      <td className="px-5 py-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleSolicitarToggleActivo(servicio)}
                          disabled={estaProcesandoFila || procesandoGuardado}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition cursor-pointer disabled:opacity-50 ${
                            servicio.activo
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                          }`}
                          title={servicio.activo ? 'Haga clic para desactivar' : 'Haga clic para activar'}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              servicio.activo ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          <span>
                            {estaProcesandoFila ? 'Guardando...' : servicio.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </button>
                      </td>

                      {/* Acciones */}
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleAbrirEditar(servicio)}
                          disabled={estaProcesandoFila || procesandoGuardado}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          <span>Editar</span>
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
            {serviciosFiltrados.map((servicio) => {
              const estaProcesandoFila = procesandoId === servicio.id;
              return (
                <div
                  key={servicio.id}
                  className="rounded-2xl bg-white p-5 shadow-xs border border-slate-200 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md inline-block mb-1">
                        Orden #{servicio.orden}
                      </span>
                      <h3 className="font-bold text-slate-900 text-sm leading-snug">{servicio.nombre}</h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSolicitarToggleActivo(servicio)}
                      disabled={estaProcesandoFila || procesandoGuardado}
                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition cursor-pointer disabled:opacity-50 ${
                        servicio.activo
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${servicio.activo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span>{servicio.activo ? 'Activo' : 'Inactivo'}</span>
                    </button>
                  </div>

                  {servicio.descripcion && (
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">
                      {servicio.descripcion}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{servicio.duracion_minutos} minutos</span>
                    </span>

                    <button
                      type="button"
                      onClick={() => handleAbrirEditar(servicio)}
                      disabled={estaProcesandoFila || procesandoGuardado}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      <span>Editar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. Modal de Creación / Edición de Servicio */}
      <ServicioModal
        isOpen={modalAbierto}
        onClose={() => {
          if (!procesandoGuardado) {
            setModalAbierto(false);
            setServicioAEditar(null);
          }
        }}
        onSave={handleGuardarServicio}
        servicioAEditar={servicioAEditar}
        procesando={procesandoGuardado}
      />

      {/* 8. Diálogo Modal de Confirmación para Desactivar Servicio */}
      {servicioADesactivar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-desactivar-servicio"
          onClick={() => {
            if (!procesandoId) setServicioADesactivar(null);
          }}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>

              <div className="min-w-0 flex-1">
                <h3 id="titulo-desactivar-servicio" className="text-lg font-black text-slate-900 font-heading">
                  Desactivar Servicio
                </h3>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                  ¿Desea retirar este servicio del portal público de reservas?
                </p>
              </div>
            </div>

            {/* Ficha Resumen del Servicio */}
            <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Servicio:</span>
                <span className="font-bold text-slate-900">{servicioADesactivar.nombre}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Duración:</span>
                <span className="text-slate-700 font-medium">{servicioADesactivar.duracion_minutos} minutos</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Orden en Catálogo:</span>
                <span className="font-mono text-slate-700">#{servicioADesactivar.orden}</span>
              </div>
            </div>

            {/* Advertencia Clínica / Histórica */}
            <div className="mt-4 rounded-xl bg-amber-50/70 p-3.5 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed flex items-start gap-2.5">
              <svg className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                <strong>Aviso:</strong> El servicio dejará de estar disponible para citas públicas, pero todas las citas previamente agendadas con este servicio se conservarán intactas en el historial.
              </span>
            </div>

            {/* Botones de Acción */}
            <div className="mt-5 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setServicioADesactivar(null)}
                disabled={Boolean(procesandoId)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => ejecutarToggleActivo(servicioADesactivar, false)}
                disabled={Boolean(procesandoId)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {procesandoId === servicioADesactivar.id ? (
                  <>
                    <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span>Desactivando...</span>
                  </>
                ) : (
                  <span>Sí, Desactivar Servicio</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
