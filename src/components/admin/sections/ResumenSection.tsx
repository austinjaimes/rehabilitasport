import React, { useEffect, useState, useCallback } from 'react';
import { adminClient, AdminClientError } from '../../../lib/adminClient';
import { formatearFechaLarga, obtenerFechaHoyISO } from '../../../lib/utils/adminFormatters';

interface ErrorResumen {
  tipo: 'auth' | 'infraestructura' | 'red' | 'servidor';
  mensaje: string;
}

export interface ResumenSectionProps {
  citasIniciales?: any[] | null;
  cargandoInicial?: boolean;
  onSessionExpired?: (mensaje?: string) => void;
}

export const ResumenSection: React.FC<ResumenSectionProps> = ({
  citasIniciales = null,
  cargandoInicial,
  onSessionExpired,
}) => {
  const [citas, setCitas] = useState<any[] | null>(citasIniciales);
  const [cargando, setCargando] = useState<boolean>(cargandoInicial ?? (citasIniciales === null));
  const [actualizando, setActualizando] = useState<boolean>(false);
  const [error, setError] = useState<ErrorResumen | null>(null);
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(
    citasIniciales ? new Date() : null
  );

  const fechaHoy = obtenerFechaHoyISO();
  const fechaHoyFormateada = formatearFechaLarga(fechaHoy);

  const cargarResumen = useCallback(async (esRefrescoManual: boolean = false) => {
    if (esRefrescoManual) {
      setActualizando(true);
    } else {
      setCargando(true);
    }
    setError(null);

    try {
      // Consulta estricta del día de hoy mediante el cliente administrativo
      const data = await adminClient.getCitas(fechaHoy);

      // Validación estricta del contrato de respuesta: data.citas DEBE ser un arreglo
      if (!data || typeof data !== 'object' || !Array.isArray(data.citas)) {
        throw new Error('La respuesta del servidor no tiene una estructura de citas válida');
      }

      setCitas(data.citas);
      setUltimaActualizacion(new Date());
      setError(null);
    } catch (err: any) {
      if (err instanceof AdminClientError) {
        // 1. Manejo estricto de HTTP 401 (Sesión expirada o no autorizada)
        if (err.statusCode === 401 || err.code === 'UNAUTHORIZED') {
          if (onSessionExpired) {
            onSessionExpired('Su sesión administrativa ha expirado o no es válida. Por favor, inicie sesión nuevamente.');
            return;
          }
          setError({
            tipo: 'auth',
            mensaje: 'La sesión administrativa ha expirado o no es válida. Por favor, vuelva a iniciar sesión.',
          });
          return;
        }

        // 2. Errores 503, 403, 500 y de red NO deben cerrar sesión:
        if (err.statusCode === 503 || err.code === 'SERVICE_UNAVAILABLE') {
          setError({
            tipo: 'infraestructura',
            mensaje: 'El servicio de base de datos no está disponible temporalmente (HTTP 503). La sesión sigue activa.',
          });
        } else if (err.code === 'NETWORK_ERROR' || err.statusCode === 0) {
          setError({
            tipo: 'red',
            mensaje: 'No se pudo conectar con el servidor. Verifique su conexión de red.',
          });
        } else if (err.statusCode === 403 || err.code === 'FORBIDDEN') {
          setError({
            tipo: 'auth',
            mensaje: 'Acceso rechazado por política de origen o seguridad (HTTP 403).',
          });
        } else {
          setError({
            tipo: 'servidor',
            mensaje: err.message || 'Error del servidor al consultar el resumen de citas.',
          });
        }
      } else {
        setError({
          tipo: 'servidor',
          mensaje: err?.message || 'Error inesperado al cargar las métricas.',
        });
      }
      // NOTA: Si ya existían datos válidos (actualización manual), NO se resetea citas a null
      // para conservar los últimos datos válidos en pantalla.
    } finally {
      setCargando(false);
      setActualizando(false);
    }
  }, [fechaHoy, onSessionExpired]);

  useEffect(() => {
    if (citasIniciales === null) {
      cargarResumen(false);
    }
  }, [cargarResumen, citasIniciales]);

  // Cálculo de Métricas (en memoria exclusivamente, solo cuando citas !== null)
  const listaCitas = citas ?? [];
  const totalCitas = listaCitas.length;
  const citasConfirmadas = listaCitas.filter((c) => c.estado === 'confirmada').length;
  const citasAtendidas = listaCitas.filter((c) => c.estado === 'atendida').length;
  const citasNoAsistio = listaCitas.filter((c) => c.estado === 'no_asistio').length;
  const citasCanceladas = listaCitas.filter((c) => c.estado === 'cancelada').length;

  // Tasa de Asistencia: Las canceladas NO son atendidas ni inasistencias.
  // Denominador estricto: únicamente atendidas + no_asistio.
  const denominadorAsistencia = citasAtendidas + citasNoAsistio;
  const tasaAsistencia = denominadorAsistencia > 0
    ? Math.round((citasAtendidas / denominadorAsistencia) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* 1. Barra de Control y Actualización Manual */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl bg-white p-5 shadow-xs border border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-700" />
            <h2 className="text-lg font-black text-slate-900 font-heading tracking-tight">
              Agenda del Día
            </h2>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 capitalize">
            {fechaHoyFormateada}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {ultimaActualizacion && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Actualizado: {ultimaActualizacion.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

          <button
            type="button"
            onClick={() => cargarResumen(true)}
            disabled={cargando || actualizando}
            aria-label="Actualizar resumen manualmente"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-blue-700 border border-slate-200 transition shadow-2xs cursor-pointer disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${actualizando ? 'animate-spin text-blue-700' : 'text-slate-500'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{actualizando ? 'Actualizando...' : 'Actualizar'}</span>
          </button>
        </div>
      </div>

      {/* 2. Visualización de Errores Tipados */}
      {error && (
        <div
          role="alert"
          className={`rounded-2xl p-5 border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            error.tipo === 'infraestructura'
              ? 'bg-amber-50/80 border-amber-300 text-amber-900'
              : error.tipo === 'red'
              ? 'bg-sky-50/80 border-sky-300 text-sky-900'
              : error.tipo === 'auth'
              ? 'bg-rose-50/80 border-rose-300 text-rose-900'
              : 'bg-red-50/80 border-red-300 text-red-900'
          }`}
        >
          <div className="flex items-start gap-3">
            <svg className="h-6 w-6 shrink-0 mt-0.5 opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h3 className="text-sm font-bold">
                {error.tipo === 'infraestructura' && 'Servicio Temporalmente No Disponible (503)'}
                {error.tipo === 'red' && 'Fallo de Conexión de Red'}
                {error.tipo === 'auth' && 'Acceso No Autorizado (403)'}
                {error.tipo === 'servidor' && (citas !== null ? 'Error al Actualizar Métricas' : 'Error al Obtener Resumen')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed opacity-95">
                {error.mensaje}
                {citas !== null && ' (Se muestran los últimos datos válidos cargados previamente)'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => cargarResumen(true)}
            className="self-end sm:self-center shrink-0 rounded-xl bg-white px-3.5 py-2 text-xs font-bold shadow-2xs border border-slate-200 hover:bg-slate-50 transition cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* 3. Skeleton Loading inicial (Solamente durante la primera carga si citas === null y no hay error) */}
      {cargando && citas === null && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-busy="true" aria-label="Cargando métricas">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl bg-white p-5 shadow-xs border border-slate-200">
              <div className="flex items-center justify-between">
                <div className="h-4 w-24 bg-slate-200 rounded" />
                <div className="h-8 w-8 bg-slate-200 rounded-xl" />
              </div>
              <div className="mt-4 h-9 w-16 bg-slate-200 rounded" />
              <div className="mt-2 h-3 w-32 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* 4. Tarjetas de Métricas del Día (SOLAMENTE si se recibió una respuesta válida con citas !== null) */}
      {citas !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Tarjeta A: Total Citas */}
            <div className="rounded-2xl bg-white p-5 shadow-xs border border-slate-200 transition-all hover:border-slate-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Total Citas
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <div className="mt-2">
                <span className="text-3xl font-black text-slate-900 font-heading tracking-tight">
                  {totalCitas}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Registradas para hoy
              </p>
            </div>

            {/* Tarjeta B: Citas Confirmadas */}
            <div className="rounded-2xl bg-white p-5 shadow-xs border border-slate-200 transition-all hover:border-emerald-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Confirmadas
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="mt-2">
                <span className="text-3xl font-black text-emerald-700 font-heading tracking-tight">
                  {citasConfirmadas}
                </span>
              </div>
              <p className="mt-1 text-xs text-emerald-600/80 font-medium">
                En espera de atención
              </p>
            </div>

            {/* Tarjeta C: Citas Atendidas */}
            <div className="rounded-2xl bg-white p-5 shadow-xs border border-slate-200 transition-all hover:border-blue-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
                  Atendidas
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="mt-2">
                <span className="text-3xl font-black text-blue-700 font-heading tracking-tight">
                  {citasAtendidas}
                </span>
              </div>
              <p className="mt-1 text-xs text-blue-600/80 font-medium">
                Consultas completadas
              </p>
            </div>

            {/* Tarjeta D: No Asistió */}
            <div className="rounded-2xl bg-white p-5 shadow-xs border border-slate-200 transition-all hover:border-amber-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  No Asistió
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              </div>
              <div className="mt-2">
                <span className="text-3xl font-black text-amber-700 font-heading tracking-tight">
                  {citasNoAsistio}
                </span>
              </div>
              <p className="mt-1 text-xs text-amber-600/80 font-medium">
                Inasistencias registradas
              </p>
            </div>
          </div>

          {/* 5. Panel de Rendimiento y Tasa de Asistencia */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Tasa de Asistencia (Denominador: únicamente atendidas + no_asistio) */}
            <div className="lg:col-span-2 rounded-2xl bg-white p-6 shadow-xs border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-heading">
                    Tasa de Asistencia Efectiva
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Proporción de pacientes que asistieron frente al total de consultas programadas concluidas
                  </p>
                </div>
                {tasaAsistencia !== null ? (
                  <span className="text-2xl font-black text-blue-700 font-heading">
                    {tasaAsistencia}%
                  </span>
                ) : (
                  <span className="text-sm font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                    Sin datos
                  </span>
                )}
              </div>

              {/* Barra de progreso visual */}
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200/60">
                <div
                  className="bg-blue-700 h-3 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${tasaAsistencia ?? 0}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2 pt-2 border-t border-slate-100">
                <span>
                  <strong>{citasAtendidas}</strong> asistencias de <strong>{denominadorAsistencia}</strong> citas concluidas (atendidas + inasistencias).
                </span>
                <span className="text-slate-400">
                  Las cancelaciones se excluyen del denominador.
                </span>
              </div>
            </div>

            {/* Canceladas y Próxima Fase */}
            <div className="rounded-2xl bg-white p-6 shadow-xs border border-slate-200 flex flex-col justify-between space-y-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-rose-700">
                  Cancelaciones del Día
                </span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-rose-700 font-heading">
                    {citasCanceladas}
                  </span>
                  <span className="text-xs text-slate-500">
                    citas canceladas
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                  Las cancelaciones no se computan como consultas atendidas ni como inasistencias.
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200 text-xs text-slate-600">
                <span className="font-bold text-slate-700 block">Fase C en desarrollo:</span>
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  La tabla de citas, el filtrado de agenda y el cambio de estados se habilitarán en la siguiente fase.
                </span>
              </div>
            </div>
          </div>

          {/* 6. Estado "Sin Citas" si el total es cero */}
          {totalCitas === 0 && (
            <div className="rounded-2xl bg-white p-8 text-center border border-slate-200 shadow-xs">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-800 font-heading">
                Agenda sin citas programadas para hoy
              </h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                No se registraron citas para la fecha de hoy. Las nuevas citas agendadas por los pacientes en el portal público aparecerán aquí.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
