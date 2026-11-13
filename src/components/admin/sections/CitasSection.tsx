import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { adminClient, AdminClientError } from '../../../lib/adminClient';
import {
  formatearFechaLarga,
  formatearHora12h,
  obtenerConfiguracionEstado,
  obtenerFechaHoyISO,
  type EstadoCitaAdmin,
} from '../../../lib/utils/adminFormatters';
import { DetalleCitaModal, type CitaDetalleData } from '../modals/DetalleCitaModal';
import { CancelarCitaModal, type CitaParaCancelar } from '../modals/CancelarCitaModal';
import { ConfirmarAccionCitaModal, type ConfirmarAccionCitaData } from '../modals/ConfirmarAccionCitaModal';

interface ErrorCitas {
  tipo: 'auth' | 'infraestructura' | 'red' | 'servidor';
  mensaje: string;
  statusCode?: number;
}

export interface CitasSectionProps {
  citasIniciales?: any[] | null;
  cargandoInicial?: boolean;
  onSessionExpired?: (mensaje?: string) => void;
  fechaInicial?: string;
}

const ESTADOS_FILTRO: Array<{ id: string; label: string }> = [
  { id: 'todas', label: 'Todas' },
  { id: 'confirmada', label: 'Confirmada' },
  { id: 'atendida', label: 'Atendida' },
  { id: 'cancelada', label: 'Cancelada' },
  { id: 'no_asistio', label: 'No asistió' },
];

/**
 * Calcula la fecha de mañana en formato ISO 'YYYY-MM-DD'.
 */
function obtenerFechaMananaISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const año = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${año}-${mes}-${dia}`;
}

/**
 * Desplaza una fecha ISO gregoriana UTC por una cantidad determinada de días.
 */
function desplazarFechaISO(fechaISO: string, dias: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return obtenerFechaHoyISO();
  const [año, mes, dia] = fechaISO.split('-').map(Number);
  const d = new Date(Date.UTC(año, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const CitasSection: React.FC<CitasSectionProps> = ({
  citasIniciales = null,
  cargandoInicial,
  onSessionExpired,
  fechaInicial,
}) => {
  const fechaHoy = obtenerFechaHoyISO();
  const fechaManana = obtenerFechaMananaISO();

  // Estados de control de consulta
  const [fechaSeleccionada, setFechaSeleccionada] = useState<string>(fechaInicial || fechaHoy);
  const [filtroEstado, setFiltroEstado] = useState<string>('todas');
  const [busquedaPaciente, setBusquedaPaciente] = useState<string>('');

  // Estados de datos y carga
  const [citas, setCitas] = useState<any[] | null>(citasIniciales);
  const [cargando, setCargando] = useState<boolean>(cargandoInicial ?? (citasIniciales === null));
  const [actualizando, setActualizando] = useState<boolean>(false);
  const [error, setError] = useState<ErrorCitas | null>(null);

  // Estados de feedback y notificaciones de operaciones
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [advertenciaActualizacion, setAdvertenciaActualizacion] = useState<string | null>(null);

  // Estados del modal de detalle
  const [citaSeleccionada, setCitaSeleccionada] = useState<CitaDetalleData | null>(null);
  const [modalDetalleAbierto, setModalDetalleAbierto] = useState<boolean>(false);

  // Estados de mutación y confirmación (Fase C2)
  const [procesandoAccion, setProcesandoAccion] = useState<boolean>(false);
  const [procesandoCitaId, setProcesandoCitaId] = useState<string | null>(null);

  const [citaParaConfirmar, setCitaParaConfirmar] = useState<ConfirmarAccionCitaData | null>(null);
  const [modalConfirmarAbierto, setModalConfirmarAbierto] = useState<boolean>(false);

  const [citaParaCancelar, setCitaParaCancelar] = useState<CitaParaCancelar | null>(null);
  const [modalCancelarAbierto, setModalCancelarAbierto] = useState<boolean>(false);

  // Función de consulta centralizada de citas
  const cargarCitas = useCallback(
    async (fecha: string, estado: string, esRefrescoManual: boolean = false) => {
      if (esRefrescoManual) {
        setActualizando(true);
      } else {
        setCargando(true);
      }
      setError(null);

      try {
        const data = await adminClient.getCitas(fecha, estado);

        // Validación estricta del contrato de respuesta: data.citas DEBE ser un arreglo
        if (!data || typeof data !== 'object' || !Array.isArray(data.citas)) {
          throw new Error('La respuesta del servidor no tiene una estructura de citas válida');
        }

        setCitas(data.citas);
        setError(null);
      } catch (err: any) {
        if (err instanceof AdminClientError) {
          // 1. Manejo estricto de HTTP 401 (Sesión expirada o no autorizada)
          if (err.statusCode === 401 || err.code === 'UNAUTHORIZED') {
            if (onSessionExpired) {
              onSessionExpired(
                'Su sesión administrativa ha expirado o no es válida. Por favor, inicie sesión nuevamente.'
              );
              return;
            }
            setError({
              tipo: 'auth',
              statusCode: 401,
              mensaje: 'La sesión administrativa ha expirado. Por favor, vuelva a iniciar sesión.',
            });
            return;
          }

          // 2. Errores 403, 429, 500, 503 y de red NO deben cerrar sesión:
          if (err.statusCode === 503 || err.code === 'SERVICE_UNAVAILABLE') {
            setError({
              tipo: 'infraestructura',
              statusCode: 503,
              mensaje:
                'El servicio de base de datos no está disponible temporalmente (HTTP 503). La sesión sigue activa.',
            });
          } else if (err.code === 'NETWORK_ERROR' || err.statusCode === 0) {
            setError({
              tipo: 'red',
              statusCode: 0,
              mensaje: 'No se pudo conectar con el servidor. Verifique su conexión de red.',
            });
          } else if (err.statusCode === 403 || err.code === 'FORBIDDEN') {
            setError({
              tipo: 'auth',
              statusCode: 403,
              mensaje: 'Acceso rechazado por política de origen o permisos insuficientes (HTTP 403).',
            });
          } else if (err.statusCode === 429) {
            setError({
              tipo: 'servidor',
              statusCode: 429,
              mensaje:
                'Demasiadas solicitudes al servidor (HTTP 429). Por favor, espere unos momentos antes de reintentar.',
            });
          } else {
            setError({
              tipo: 'servidor',
              statusCode: err.statusCode || 500,
              mensaje: err.message || 'Error del servidor al consultar la agenda de citas.',
            });
          }
        } else {
          setError({
            tipo: 'servidor',
            statusCode: 500,
            mensaje: err?.message || 'Error inesperado al cargar la lista de citas.',
          });
        }
        // NOTA: Si ya existían citas en memoria (por ejemplo al actualizar), se conservan
        // para no vaciar la tabla abruptamente ante un fallo temporal.
      } finally {
        setCargando(false);
        setActualizando(false);
      }
    },
    [onSessionExpired]
  );

  // Efecto: Cargar datos cuando cambia la fecha o el filtro de estado
  useEffect(() => {
    // Si se proveyeron citasIniciales y no se ha cambiado la fecha inicial, no reconsultar inmediatamente
    if (citasIniciales !== null && fechaSeleccionada === (fechaInicial || fechaHoy) && filtroEstado === 'todas') {
      return;
    }
    cargarCitas(fechaSeleccionada, filtroEstado, false);
  }, [fechaSeleccionada, filtroEstado, cargarCitas]);

  // Manejadores de cambio de fecha
  const handleSeleccionarHoy = () => setFechaSeleccionada(fechaHoy);
  const handleSeleccionarManana = () => setFechaSeleccionada(fechaManana);
  const handleFechaAnterior = () => setFechaSeleccionada((prev) => desplazarFechaISO(prev, -1));
  const handleFechaSiguiente = () => setFechaSeleccionada((prev) => desplazarFechaISO(prev, 1));
  const handleCambioFechaInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nuevaFecha = e.target.value;
    if (nuevaFecha && /^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha)) {
      setFechaSeleccionada(nuevaFecha);
    }
  };

  // Manejador de actualización manual
  const handleRefrescoManual = () => {
    cargarCitas(fechaSeleccionada, filtroEstado, true);
  };

  // Apertura y cierre de detalle de cita
  const handleAbrirDetalle = (cita: any) => {
    setCitaSeleccionada(cita);
    setModalDetalleAbierto(true);
  };

  const handleCerrarDetalle = () => {
    if (procesandoAccion) return;
    setModalDetalleAbierto(false);
    setCitaSeleccionada(null);
    setError(null);
  };

  // ==========================================================================
  // OPERACIONES DE ESTADO (Fase C2)
  // ==========================================================================

  // Ejecutor centralizado de mutaciones
  const ejecutarCambioEstado = async (
    citaId: string,
    codigoReserva: string,
    nuevoEstado: 'confirmada' | 'atendida' | 'cancelada' | 'no_asistio',
    motivoCancelacion?: string
  ) => {
    setProcesandoAccion(true);
    setProcesandoCitaId(citaId);
    setError(null);
    setMensajeExito(null);
    setAdvertenciaActualizacion(null);

    try {
      const res = await adminClient.updateCitaEstado(citaId, nuevoEstado, motivoCancelacion);

      if (res && res.success) {
        const configEstado = obtenerConfiguracionEstado(nuevoEstado);
        setMensajeExito(`Cita ${codigoReserva} actualizada a "${configEstado.label}" correctamente.`);

        // 1. Actualización inmediata y optimista en memoria local
        setCitas((prev) => {
          if (!prev) return prev;
          return prev.map((c) => {
            if (c.id === citaId) {
              return {
                ...c,
                estado: nuevoEstado,
                motivo_cancelacion:
                  nuevoEstado === 'cancelada'
                    ? motivoCancelacion?.trim() || 'Cancelada por el administrador'
                    : c.motivo_cancelacion,
              };
            }
            return c;
          });
        });

        // 2. Si la cita seleccionada en el modal de detalle es la misma, sincronizarla
        setCitaSeleccionada((prev) => {
          if (prev && prev.id === citaId) {
            return {
              ...prev,
              estado: nuevoEstado,
              motivo_cancelacion:
                nuevoEstado === 'cancelada'
                  ? motivoCancelacion?.trim() || 'Cancelada por el administrador'
                  : prev.motivo_cancelacion,
            };
          }
          return prev;
        });

        // 3. Re-consultar la agenda completa desde el servidor para máxima consistencia
        try {
          const freshData = await adminClient.getCitas(fechaSeleccionada, filtroEstado);
          if (freshData && Array.isArray(freshData.citas)) {
            setCitas(freshData.citas);
          }
        } catch {
          // Requisito estricto: Si la reconsulta falla, informar sin revertir la mutación exitosa
          setAdvertenciaActualizacion(
            'El estado fue guardado en el servidor, pero no se pudo sincronizar la agenda completa. Los datos locales se conservan.'
          );
        }
      }
    } catch (err: any) {
      if (err instanceof AdminClientError) {
        if (err.statusCode === 401 || err.code === 'UNAUTHORIZED') {
          if (onSessionExpired) {
            onSessionExpired('Su sesión administrativa ha expirado. Por favor, inicie sesión nuevamente.');
            return;
          }
        } else if (err.code === 'MISSING_CSRF') {
          setError({
            tipo: 'auth',
            statusCode: 403,
            mensaje: 'Falta el token de seguridad CSRF en memoria. Por favor, inicie sesión de nuevo.',
          });
          return;
        } else if (err.statusCode === 409) {
          setError({
            tipo: 'servidor',
            statusCode: 409,
            mensaje:
              err.details?.error ||
              err.message ||
              'Conflicto: La cita ya fue modificada por otro usuario o proceso.',
          });
          return;
        } else if (err.statusCode === 400) {
          setError({
            tipo: 'servidor',
            statusCode: 400,
            mensaje: err.details?.error || err.message || 'Solicitud no válida.',
          });
          return;
        } else if (err.statusCode === 429) {
          setError({
            tipo: 'servidor',
            statusCode: 429,
            mensaje: 'Demasiadas solicitudes al servidor (HTTP 429). Por favor espere antes de reintentar.',
          });
          return;
        } else if (err.statusCode === 503 || err.code === 'SERVICE_UNAVAILABLE') {
          setError({
            tipo: 'infraestructura',
            statusCode: 503,
            mensaje: 'No se pudo actualizar el estado: base de datos no disponible temporalmente (503).',
          });
          return;
        } else if (err.code === 'NETWORK_ERROR' || err.statusCode === 0) {
          setError({
            tipo: 'red',
            statusCode: 0,
            mensaje: 'Error de conexión de red al actualizar la cita. Verifique su internet.',
          });
          return;
        }
      }

      setError({
        tipo: 'servidor',
        statusCode: err?.statusCode || 500,
        mensaje: err?.message || 'Error al actualizar el estado de la cita.',
      });
    } finally {
      setProcesandoAccion(false);
      setProcesandoCitaId(null);
    }
  };

  // Apertura de modal de confirmación para Atendida, Inasistencia o Restablecer
  const handlePedirConfirmacion = (cita: any, nuevoEstado: 'confirmada' | 'atendida' | 'no_asistio') => {
    // Reglas de negocio estrictas: Validar que la transición sea válida
    if (cita.estado === 'cancelada') {
      setError({
        tipo: 'servidor',
        statusCode: 409,
        mensaje: 'No es posible modificar el estado de una cita que ya fue cancelada.',
      });
      return;
    }

    if (cita.estado === 'atendida') {
      setError({
        tipo: 'servidor',
        statusCode: 409,
        mensaje: 'Una cita atendida no puede cambiar a otro estado.',
      });
      return;
    }

    setError(null);
    setCitaParaConfirmar({
      id: cita.id,
      codigo_reserva: cita.codigo_reserva,
      hora_inicio: cita.hora_inicio,
      hora_fin: cita.hora_fin,
      nombre_servicio_historico: cita.nombre_servicio_historico,
      paciente_nombre: cita.pacientes?.nombre_completo,
      nuevoEstado,
    });
    setModalConfirmarAbierto(true);
  };

  const handleConfirmarAccionModal = async () => {
    if (!citaParaConfirmar) return;
    const { id, codigo_reserva, nuevoEstado } = citaParaConfirmar;
    await ejecutarCambioEstado(id, codigo_reserva, nuevoEstado);
    setModalConfirmarAbierto(false);
    setCitaParaConfirmar(null);
  };

  // Apertura de modal de cancelación
  const handlePedirCancelacion = (cita: any) => {
    if (cita.estado === 'cancelada') {
      setError({
        tipo: 'servidor',
        statusCode: 409,
        mensaje: 'La cita ya se encuentra cancelada.',
      });
      return;
    }

    if (cita.estado === 'atendida') {
      setError({
        tipo: 'servidor',
        statusCode: 409,
        mensaje: 'No se puede cancelar una cita que ya fue atendida.',
      });
      return;
    }

    setError(null);
    setCitaParaCancelar({
      id: cita.id,
      codigo_reserva: cita.codigo_reserva,
      hora_inicio: cita.hora_inicio,
      hora_fin: cita.hora_fin,
      nombre_servicio_historico: cita.nombre_servicio_historico,
      paciente_nombre: cita.pacientes?.nombre_completo,
    });
    setModalCancelarAbierto(true);
  };

  const handleConfirmarCancelarModal = async (motivo: string) => {
    if (!citaParaCancelar) return;
    const { id, codigo_reserva } = citaParaCancelar;
    await ejecutarCambioEstado(id, codigo_reserva, 'cancelada', motivo);
    setModalCancelarAbierto(false);
    setCitaParaCancelar(null);
  };

  // Filtrado en memoria por búsqueda de paciente y orden cronológico estricto
  const citasFiltradasYOrdenadas = useMemo(() => {
    if (!citas || !Array.isArray(citas)) return [];

    let resultado = [...citas];

    // Búsqueda insensible a mayúsculas/minúsculas y espacios
    const termino = busquedaPaciente.trim().toLowerCase();
    if (termino.length > 0) {
      resultado = resultado.filter((cita) => {
        const nombre = cita.pacientes?.nombre_completo?.toLowerCase() || '';
        const codigo = cita.codigo_reserva?.toLowerCase() || '';
        return nombre.includes(termino) || codigo.includes(termino);
      });
    }

    // Ordenamiento cronológico por hora_inicio sin mutar el arreglo original
    return resultado.sort((a, b) => {
      const horaA = a.hora_inicio || '';
      const horaB = b.hora_inicio || '';
      return horaA.localeCompare(horaB);
    });
  }, [citas, busquedaPaciente]);

  const esHoy = fechaSeleccionada === fechaHoy;
  const esManana = fechaSeleccionada === fechaManana;

  return (
    <div className="space-y-6">
      {/* 1. Encabezado de la Sección */}
      <div className="rounded-2xl bg-white p-6 shadow-xs border border-slate-200">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </span>
              <h2 className="text-xl font-black text-slate-900 font-heading tracking-tight">
                Agenda de Citas
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Gestión activa de pacientes, control de asistencia, atención clínica y cancelaciones.
            </p>
          </div>

          {/* Botón de Actualización Manual */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRefrescoManual}
              disabled={cargando || actualizando || procesandoAccion}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition cursor-pointer disabled:opacity-50"
              title="Actualizar agenda desde el servidor"
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
          </div>
        </div>

        {/* 2. Barra de Navegación por Fechas */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Accesos rápidos de fecha */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSeleccionarHoy}
              disabled={procesandoAccion}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer border ${
                esHoy
                  ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Hoy
            </button>

            <button
              type="button"
              onClick={handleSeleccionarManana}
              disabled={procesandoAccion}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer border ${
                esManana
                  ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Mañana
            </button>

            {/* Selector de Fecha Nativo y Botones Anterior / Siguiente */}
            <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-2xs">
              <button
                type="button"
                onClick={handleFechaAnterior}
                disabled={procesandoAccion}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-l-xl transition cursor-pointer disabled:opacity-50"
                aria-label="Día anterior"
                title="Día anterior"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <input
                type="date"
                value={fechaSeleccionada}
                onChange={handleCambioFechaInput}
                disabled={procesandoAccion}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 border-0 focus:outline-hidden focus:ring-0 bg-transparent cursor-pointer disabled:opacity-50"
                aria-label="Seleccionar fecha de consulta"
              />

              <button
                type="button"
                onClick={handleFechaSiguiente}
                disabled={procesandoAccion}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-r-xl transition cursor-pointer disabled:opacity-50"
                aria-label="Día siguiente"
                title="Día siguiente"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Fecha visualizada en formato largo */}
          <div className="text-xs font-bold text-slate-600 capitalize bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200/80">
            {formatearFechaLarga(fechaSeleccionada)}
          </div>
        </div>
      </div>

      {/* 3. Filtros y Búsqueda */}
      <div className="rounded-2xl bg-white p-5 shadow-xs border border-slate-200 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Campo de Búsqueda Local por Paciente */}
          <div className="relative flex-1 max-w-md">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={busquedaPaciente}
              onChange={(e) => setBusquedaPaciente(e.target.value)}
              placeholder="Buscar por nombre de paciente o código..."
              className="w-full rounded-xl border border-slate-200 pl-10 pr-9 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition"
            />
            {busquedaPaciente.length > 0 && (
              <button
                type="button"
                onClick={() => setBusquedaPaciente('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Limpiar búsqueda"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Contador de Citas */}
          <div className="text-xs font-semibold text-slate-500">
            {citas !== null && (
              <span>
                {citasFiltradasYOrdenadas.length === citas.length ? (
                  <>
                    <strong className="text-slate-900 font-bold">{citas.length}</strong>{' '}
                    {citas.length === 1 ? 'cita programada' : 'citas programadas'}
                  </>
                ) : (
                  <>
                    Mostrando <strong className="text-slate-900 font-bold">{citasFiltradasYOrdenadas.length}</strong> de{' '}
                    <strong className="text-slate-900 font-bold">{citas.length}</strong> citas
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Filtro por Estado (Pills) */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1.5">Estado:</span>
          {ESTADOS_FILTRO.map((item) => {
            const activo = filtroEstado === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFiltroEstado(item.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer border ${
                  activo
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Notificaciones de Éxito y Advertencias de Sincronización */}
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

      {advertenciaActualizacion && (
        <div className="rounded-2xl p-4 border border-amber-300 bg-amber-50 text-amber-900 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <svg className="h-5 w-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-xs">{advertenciaActualizacion}</span>
          </div>
          <button
            type="button"
            onClick={() => setAdvertenciaActualizacion(null)}
            className="text-amber-700 hover:text-amber-900 text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 5. Banner de Error (si ocurre alguno) */}
      {error && (
        <div
          className={`rounded-2xl p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs ${
            error.tipo === 'infraestructura'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : error.tipo === 'red'
              ? 'bg-sky-50 border-sky-300 text-sky-900'
              : error.tipo === 'auth'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
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
                  : error.tipo === 'auth'
                  ? 'Acceso denegado o sesión no autorizada'
                  : error.statusCode === 409
                  ? 'Conflicto de estado (HTTP 409)'
                  : 'Error del servidor'}
              </p>
              <p className="text-xs opacity-90 mt-0.5">{error.mensaje}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRefrescoManual}
            className="rounded-xl px-3 py-1.5 text-xs font-bold bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 transition cursor-pointer self-start sm:self-auto shrink-0 shadow-2xs"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* 6. Contenido Principal: Skeleton, Citas o Estados Vacíos */}
      {cargando && citas === null ? (
        /* Skeleton de carga inicial */
        <div className="rounded-2xl bg-white p-6 shadow-xs border border-slate-200 space-y-4 animate-pulse">
          <div className="h-4 bg-slate-200 rounded-md w-1/4" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      ) : citas !== null && citas.length === 0 ? (
        /* Estado vacío: Sin citas en la fecha seleccionada */
        <div className="rounded-2xl bg-white p-12 text-center shadow-xs border border-slate-200 space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-slate-800 font-heading">
            No hay citas programadas
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No se encontraron citas registradas para el {formatearFechaLarga(fechaSeleccionada)}. Puedes seleccionar otra fecha o actualizar la agenda.
          </p>
        </div>
      ) : citas !== null && citasFiltradasYOrdenadas.length === 0 ? (
        /* Estado vacío: Citas existen pero los filtros o búsqueda no arrojaron coincidencias */
        <div className="rounded-2xl bg-white p-10 text-center shadow-xs border border-slate-200 space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-slate-800 font-heading">
            Sin resultados para los filtros aplicados
          </h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            No se encontraron citas que coincidan con los criterios de búsqueda o estado seleccionados.
          </p>
          <div className="pt-2 flex justify-center gap-2">
            {busquedaPaciente.length > 0 && (
              <button
                type="button"
                onClick={() => setBusquedaPaciente('')}
                className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                Limpiar búsqueda
              </button>
            )}
            {filtroEstado !== 'todas' && (
              <button
                type="button"
                onClick={() => setFiltroEstado('todas')}
                className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition cursor-pointer"
              >
                Ver todos los estados
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Vista de Citas: Tabla en Desktop y Tarjetas en Móvil */
        <div className="rounded-2xl bg-white shadow-xs border border-slate-200 overflow-hidden">
          {/* Vista Desktop / Tablet: Tabla Completa */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th scope="col" className="px-5 py-3.5">Hora</th>
                  <th scope="col" className="px-5 py-3.5">Paciente</th>
                  <th scope="col" className="px-5 py-3.5">Servicio</th>
                  <th scope="col" className="px-5 py-3.5">Duración</th>
                  <th scope="col" className="px-5 py-3.5">Estado</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {citasFiltradasYOrdenadas.map((cita) => {
                  const config = obtenerConfiguracionEstado(cita.estado);
                  const horaInicio12h = formatearHora12h(cita.hora_inicio);
                  const horaFin12h = formatearHora12h(cita.hora_fin);
                  const estaProcesando = procesandoAccion && procesandoCitaId === cita.id;

                  return (
                    <tr key={cita.id} className="hover:bg-slate-50/70 transition">
                      {/* Columna Hora */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="font-bold text-slate-900 block text-xs">{horaInicio12h}</span>
                        <span className="text-[11px] text-slate-400 block">{horaFin12h}</span>
                      </td>

                      {/* Columna Paciente */}
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-900 text-xs">
                            {cita.pacientes?.nombre_completo || 'Paciente no registrado'}
                          </span>
                          <span className="font-mono text-[10px] text-blue-700 font-bold mt-0.5">
                            {cita.codigo_reserva || 'SIN-CÓDIGO'}
                          </span>
                        </div>
                      </td>

                      {/* Columna Servicio */}
                      <td className="px-5 py-4">
                        <span className="text-slate-700 font-medium line-clamp-1 max-w-[220px]">
                          {cita.nombre_servicio_historico || 'Servicio no especificado'}
                        </span>
                      </td>

                      {/* Columna Duración */}
                      <td className="px-5 py-4 whitespace-nowrap text-slate-500">
                        {cita.duracion_minutos_historica ? `${cita.duracion_minutos_historica} min` : '--'}
                      </td>

                      {/* Columna Estado */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
                          {config.label}
                        </span>
                      </td>

                      {/* Columna Acciones Administrativas (Fase C2) */}
                      <td className="px-5 py-4 whitespace-nowrap text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {/* Botones de acción según el estado actual */}
                          {cita.estado === 'confirmada' && (
                            <>
                              <button
                                type="button"
                                disabled={procesandoAccion}
                                onClick={() => handlePedirConfirmacion(cita, 'atendida')}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-1 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                                title="Marcar como atendida"
                              >
                                {estaProcesando ? (
                                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                  </svg>
                                ) : (
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                                <span>Atendida</span>
                              </button>

                              <button
                                type="button"
                                disabled={procesandoAccion}
                                onClick={() => handlePedirConfirmacion(cita, 'no_asistio')}
                                className="inline-flex items-center gap-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-2 py-1 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                                title="Registrar inasistencia"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>No asistió</span>
                              </button>

                              <button
                                type="button"
                                disabled={procesandoAccion}
                                onClick={() => handlePedirCancelacion(cita)}
                                className="inline-flex items-center gap-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2 py-1 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                                title="Cancelar cita"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span>Cancelar</span>
                              </button>
                            </>
                          )}

                          {cita.estado === 'no_asistio' && (
                            <>
                              <button
                                type="button"
                                disabled={procesandoAccion}
                                onClick={() => handlePedirConfirmacion(cita, 'atendida')}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-1 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                                title="Marcar como atendida si asistió tarde"
                              >
                                <span>Atender</span>
                              </button>

                              <button
                                type="button"
                                disabled={procesandoAccion}
                                onClick={() => handlePedirConfirmacion(cita, 'confirmada')}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2 py-1 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                                title="Restablecer a Confirmada"
                              >
                                <span>Reactivar</span>
                              </button>
                            </>
                          )}

                          {/* Botón Detalle siempre disponible */}
                          <button
                            type="button"
                            onClick={() => handleAbrirDetalle(cita)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2.5 py-1 text-xs font-bold transition cursor-pointer border border-transparent hover:border-blue-200"
                            title="Consultar expediente y detalles"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            <span>Detalle</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Vista Móvil: Tarjetas Responsivas con Acciones */}
          <div className="md:hidden divide-y divide-slate-100">
            {citasFiltradasYOrdenadas.map((cita) => {
              const config = obtenerConfiguracionEstado(cita.estado);
              const horaInicio12h = formatearHora12h(cita.hora_inicio);
              const estaProcesando = procesandoAccion && procesandoCitaId === cita.id;

              return (
                <div key={cita.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm font-heading">{horaInicio12h}</span>
                        <span className="font-mono text-[10px] text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          {cita.codigo_reserva || 'SIN-CÓDIGO'}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-xs mt-1">
                        {cita.pacientes?.nombre_completo || 'Paciente no registrado'}
                      </h4>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border shrink-0 ${config.badgeClass}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
                      {config.label}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex items-center justify-between pt-1 border-t border-slate-50">
                    <span className="truncate pr-2 font-medium">
                      {cita.nombre_servicio_historico || 'Servicio no especificado'}
                    </span>
                    <span className="text-slate-400 shrink-0">
                      {cita.duracion_minutos_historica ? `${cita.duracion_minutos_historica} min` : ''}
                    </span>
                  </div>

                  {/* Acciones para Móvil */}
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    {cita.estado === 'confirmada' && (
                      <>
                        <button
                          type="button"
                          disabled={procesandoAccion}
                          onClick={() => handlePedirConfirmacion(cita, 'atendida')}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span>{estaProcesando ? '...' : 'Atendida'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={procesandoAccion}
                          onClick={() => handlePedirConfirmacion(cita, 'no_asistio')}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          <span>No asistió</span>
                        </button>

                        <button
                          type="button"
                          disabled={procesandoAccion}
                          onClick={() => handlePedirCancelacion(cita)}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          <span>Cancelar</span>
                        </button>
                      </>
                    )}

                    {cita.estado === 'no_asistio' && (
                      <>
                        <button
                          type="button"
                          disabled={procesandoAccion}
                          onClick={() => handlePedirConfirmacion(cita, 'atendida')}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          <span>Atender</span>
                        </button>

                        <button
                          type="button"
                          disabled={procesandoAccion}
                          onClick={() => handlePedirConfirmacion(cita, 'confirmada')}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          <span>Reactivar</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => handleAbrirDetalle(cita)}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-xs font-bold transition cursor-pointer"
                    >
                      <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span>Consultar Detalle</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. Modal de Detalle de Cita */}
      <DetalleCitaModal
        cita={citaSeleccionada}
        isOpen={modalDetalleAbierto}
        onClose={handleCerrarDetalle}
        onMarcarAtendida={async (citaId, codigo) => {
          if (citaSeleccionada) {
            handlePedirConfirmacion(citaSeleccionada, 'atendida');
          }
        }}
        onMarcarNoAsistio={async (citaId, codigo) => {
          if (citaSeleccionada) {
            handlePedirConfirmacion(citaSeleccionada, 'no_asistio');
          }
        }}
        onAbrirCancelar={(cita) => {
          handlePedirCancelacion(cita);
        }}
        onMarcarConfirmada={async (citaId, codigo) => {
          if (citaSeleccionada) {
            handlePedirConfirmacion(citaSeleccionada, 'confirmada');
          }
        }}
        procesando={procesandoAccion}
        hayModalSuperiorAbierto={modalConfirmarAbierto || modalCancelarAbierto}
        error={error}
        onLimpiarError={() => setError(null)}
      />

      {/* 8. Modal de Confirmación de Cambio de Estado (Fase C2) */}
      <ConfirmarAccionCitaModal
        isOpen={modalConfirmarAbierto}
        onClose={() => {
          if (!procesandoAccion) {
            setModalConfirmarAbierto(false);
            setCitaParaConfirmar(null);
          }
        }}
        onConfirmar={handleConfirmarAccionModal}
        cita={citaParaConfirmar}
        procesando={procesandoAccion}
      />

      {/* 9. Modal de Cancelación con Motivo (Fase C2) */}
      <CancelarCitaModal
        isOpen={modalCancelarAbierto}
        onClose={() => {
          if (!procesandoAccion) {
            setModalCancelarAbierto(false);
            setCitaParaCancelar(null);
          }
        }}
        onConfirmar={handleConfirmarCancelarModal}
        cita={citaParaCancelar}
        procesando={procesandoAccion}
      />
    </div>
  );
};
