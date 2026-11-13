import React, { useState, useEffect } from 'react';
import { obtenerFechaHoyISO } from '../../../lib/utils/adminFormatters';
import { AdminClientError } from '../../../lib/adminClient';

export interface NuevoBloqueoPayload {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
}

interface NuevoBloqueoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bloqueo: NuevoBloqueoPayload) => Promise<void>;
  procesando: boolean;
  fechaInicial?: string;
}

interface ConflictoCitasInfo {
  citasAfectadas: number;
  mensaje: string;
}

export const NuevoBloqueoModal: React.FC<NuevoBloqueoModalProps> = ({
  isOpen,
  onClose,
  onSave,
  procesando,
  fechaInicial,
}) => {
  const hoyISO = obtenerFechaHoyISO();
  const [fecha, setFecha] = useState<string>(fechaInicial || hoyISO);
  const [esDiaCompleto, setEsDiaCompleto] = useState<boolean>(false);
  const [horaInicio, setHoraInicio] = useState<string>('08:00');
  const [horaFin, setHoraFin] = useState<string>('12:00');
  const [motivo, setMotivo] = useState<string>('');

  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [conflictoCitas, setConflictoCitas] = useState<ConflictoCitasInfo | null>(null);

  // Inicializar o resetear campos al abrir
  useEffect(() => {
    if (isOpen) {
      setFecha(fechaInicial || hoyISO);
      setEsDiaCompleto(false);
      setHoraInicio('08:00');
      setHoraFin('12:00');
      setMotivo('');
      setErrorLocal(null);
      setConflictoCitas(null);
    }
  }, [isOpen, fechaInicial, hoyISO]);

  // Manejo de teclado: Cerrar modal con tecla Escape si no se está procesando
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !procesando) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, procesando, onClose]);

  if (!isOpen) return null;

  // Normalizar hora a formato estricto HH:MM:SS
  const normalizarHora = (h: string): string => {
    const trimmed = h.trim();
    if (/^\d{2}:\d{2}$/.test(trimmed)) {
      return `${trimmed}:00`;
    }
    return trimmed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorLocal(null);
    setConflictoCitas(null);

    // Validación de fecha
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      setErrorLocal('Seleccione una fecha válida en formato YYYY-MM-DD.');
      return;
    }

    // Validación de motivo
    const motivoLimpio = motivo.trim();
    if (!motivoLimpio) {
      setErrorLocal('El motivo o justificación del bloqueo es obligatorio.');
      return;
    }

    if (motivoLimpio.length > 200) {
      setErrorLocal('El motivo no debe exceder los 200 caracteres.');
      return;
    }

    // Configuración y validación de horas
    let horaInicioFinal = '00:00:00';
    let horaFinFinal = '23:59:59';

    if (!esDiaCompleto) {
      if (!horaInicio || !horaFin) {
        setErrorLocal('Debe especificar la hora inicial y final del bloqueo.');
        return;
      }

      horaInicioFinal = normalizarHora(horaInicio);
      horaFinFinal = normalizarHora(horaFin);

      if (horaInicioFinal >= horaFinFinal) {
        setErrorLocal('La hora de inicio debe ser estrictamente anterior a la hora de fin.');
        return;
      }
    }

    try {
      await onSave({
        fecha,
        hora_inicio: horaInicioFinal,
        hora_fin: horaFinFinal,
        motivo: motivoLimpio,
      });
      // Si la mutación fue exitosa, el componente padre cerrará el modal y actualizará la lista
    } catch (err: any) {
      // Manejo específico de Conflicto 409 con citas existentes
      if (
        (err instanceof AdminClientError && err.statusCode === 409) ||
        err?.statusCode === 409 ||
        err?.details?.code === 'CONFLICTO_CITAS_EXISTENTES'
      ) {
        const cantAfectadas =
          err?.details?.citas_afectadas ??
          (typeof err?.details?.message === 'string'
            ? parseInt(err.details.message.match(/\d+/)?.[0] || '1', 10)
            : 1);

        setConflictoCitas({
          citasAfectadas: cantAfectadas,
          mensaje:
            err?.details?.error ||
            err?.details?.message ||
            `Existen ${cantAfectadas} cita(s) confirmada(s) en este intervalo de tiempo.`,
        });
        return;
      }

      // Otros errores (validación de servidor, 500, red, etc.)
      setErrorLocal(
        err?.details?.error || err?.message || 'Error al intentar registrar el bloqueo en la agenda.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-nuevo-bloqueo-modal"
      onClick={() => {
        if (!procesando) onClose();
      }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <div>
              <h3 id="titulo-nuevo-bloqueo-modal" className="text-base font-bold text-slate-900 font-heading">
                Nuevo Bloqueo de Agenda
              </h3>
              <p className="text-xs text-slate-500">
                Inhabilite reservas públicas para descansos, mantenimientos o capacitaciones
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={procesando}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
            aria-label="Cerrar modal"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          {/* Fecha */}
          <div>
            <label htmlFor="fecha-bloqueo" className="block font-bold text-slate-700">
              Fecha del Bloqueo <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              id="fecha-bloqueo"
              name="fecha"
              value={fecha}
              min={hoyISO}
              onChange={(e) => {
                setFecha(e.target.value);
                setConflictoCitas(null);
              }}
              disabled={procesando}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition disabled:opacity-50"
              required
            />
          </div>

          {/* Selector de Tipo: Intervalo vs Día Completo */}
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 block">Bloquear Día Completo</span>
                <span className="text-[11px] text-slate-500 block">
                  Cierra la agenda clínica completa para la fecha seleccionada (00:00:00 - 23:59:59)
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="esDiaCompleto"
                  checked={esDiaCompleto}
                  onChange={(e) => {
                    setEsDiaCompleto(e.target.checked);
                    setConflictoCitas(null);
                  }}
                  disabled={procesando}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
              </label>
            </div>

            {/* Selectores de Horas (Solo si no es Día Completo) */}
            {!esDiaCompleto ? (
              <div className="pt-3 border-t border-slate-200/60 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in">
                <div>
                  <label htmlFor="hora-inicio-bloqueo" className="block font-bold text-slate-700">
                    Hora Inicio <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="time"
                    id="hora-inicio-bloqueo"
                    name="hora_inicio"
                    value={horaInicio}
                    onChange={(e) => {
                      setHoraInicio(e.target.value);
                      setConflictoCitas(null);
                    }}
                    disabled={procesando}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition disabled:opacity-50"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="hora-fin-bloqueo" className="block font-bold text-slate-700">
                    Hora Fin <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="time"
                    id="hora-fin-bloqueo"
                    name="hora_fin"
                    value={horaFin}
                    onChange={(e) => {
                      setHoraFin(e.target.value);
                      setConflictoCitas(null);
                    }}
                    disabled={procesando}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition disabled:opacity-50"
                    required
                  />
                </div>

                {/* Accesos rápidos */}
                <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mr-1">Rápido:</span>
                  <button
                    type="button"
                    onClick={() => { setHoraInicio('08:00'); setHoraFin('14:00'); setConflictoCitas(null); }}
                    disabled={procesando}
                    className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 transition cursor-pointer"
                  >
                    Mañana (08:00 - 14:00)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHoraInicio('14:00'); setHoraFin('18:00'); setConflictoCitas(null); }}
                    disabled={procesando}
                    className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 transition cursor-pointer"
                  >
                    Tarde (14:00 - 18:00)
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2 border-t border-slate-200/60 flex items-center gap-2 text-[11px] text-amber-800 bg-amber-50/60 p-2.5 rounded-lg border border-amber-200/60 animate-in fade-in">
                <svg className="h-4 w-4 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Horario bloqueado: <strong>00:00:00</strong> hasta <strong>23:59:59</strong> (Jornada clínica completa).
                </span>
              </div>
            )}
          </div>

          {/* Motivo */}
          <div>
            <div className="flex justify-between items-center">
              <label htmlFor="motivo-bloqueo" className="block font-bold text-slate-700">
                Motivo / Justificación Clínica <span className="text-rose-500">*</span>
              </label>
              <span className={`text-[10px] font-mono ${motivo.length > 200 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                {motivo.length} / 200
              </span>
            </div>
            <textarea
              id="motivo-bloqueo"
              name="motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. Capacitación interna del equipo de fisioterapeutas / Mantenimiento de equipo / Día festivo..."
              disabled={procesando}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition resize-none disabled:opacity-50"
              required
            />
          </div>

          {/* Alerta Destacada de Conflicto 409 con Citas Existentes */}
          {conflictoCitas && (
            <div
              role="alert"
              className="rounded-2xl bg-amber-50 border border-amber-300 p-4 text-amber-900 shadow-xs space-y-2 animate-in fade-in"
            >
              <div className="flex items-start gap-2.5">
                <svg className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="space-y-1">
                  <h4 className="font-bold text-xs font-heading text-amber-950">
                    Conflicto con Citas Existentes (HTTP 409)
                  </h4>
                  <p className="text-[11px] leading-relaxed">
                    Existen <strong className="underline font-black">{conflictoCitas.citasAfectadas} cita(s) confirmada(s)</strong> agendadas en este intervalo horario.
                  </p>
                  <p className="text-[11px] text-amber-800 leading-relaxed pt-1">
                    Para poder aplicar este bloqueo, debe ingresar primero a la sección <strong>Citas</strong> para cancelar o reubicar a los pacientes afectados. También puede ajustar las horas del bloqueo para evitar el solapamiento.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Local General */}
          {errorLocal && !conflictoCitas && (
            <div role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200 animate-in fade-in">
              {errorLocal}
            </div>
          )}

          {/* Botones de Acción */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={procesando}
              className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={procesando || !motivo.trim() || motivo.length > 200}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 px-5 py-2 text-xs font-bold text-white transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              {procesando ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>Registrando...</span>
                </>
              ) : (
                <span>Crear Bloqueo</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

