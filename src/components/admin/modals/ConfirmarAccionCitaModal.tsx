import React, { useEffect } from 'react';
import { formatearHora12h, obtenerConfiguracionEstado } from '../../../lib/utils/adminFormatters';

export interface ConfirmarAccionCitaData {
  id: string;
  codigo_reserva: string;
  hora_inicio: string;
  hora_fin: string;
  nombre_servicio_historico: string;
  paciente_nombre?: string;
  nuevoEstado: 'confirmada' | 'atendida' | 'no_asistio';
}

interface ConfirmarAccionCitaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmar: () => Promise<void>;
  cita: ConfirmarAccionCitaData | null;
  procesando: boolean;
}

export const ConfirmarAccionCitaModal: React.FC<ConfirmarAccionCitaModalProps> = ({
  isOpen,
  onClose,
  onConfirmar,
  cita,
  procesando,
}) => {
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

  if (!isOpen || !cita) return null;

  const horarioStr = `${formatearHora12h(cita.hora_inicio)} - ${formatearHora12h(cita.hora_fin)}`;
  const configNuevoEstado = obtenerConfiguracionEstado(cita.nuevoEstado);

  let titulo = 'Confirmar Cambio de Estado';
  let descripcion = '¿Desea actualizar el estado de esta cita en la agenda?';
  let botonTexto = 'Confirmar';
  let botonClase = 'bg-blue-700 hover:bg-blue-800 text-white';

  if (cita.nuevoEstado === 'atendida') {
    titulo = 'Confirmar Cita Atendida';
    descripcion = '¿Desea registrar que el paciente asistió y fue atendido satisfactoriamente?';
    botonTexto = 'Confirmar como Atendida';
    botonClase = 'bg-emerald-600 hover:bg-emerald-700 text-white';
  } else if (cita.nuevoEstado === 'no_asistio') {
    titulo = 'Registrar Inasistencia';
    descripcion = '¿Desea registrar que el paciente no asistió a su cita médica programada?';
    botonTexto = 'Registrar No Asistió';
    botonClase = 'bg-amber-600 hover:bg-amber-700 text-white';
  } else if (cita.nuevoEstado === 'confirmada') {
    titulo = 'Restablecer a Confirmada';
    descripcion = '¿Desea volver a colocar esta cita en estado Confirmada?';
    botonTexto = 'Restablecer Cita';
    botonClase = 'bg-blue-700 hover:bg-blue-800 text-white';
  }

  const handleConfirmar = async () => {
    if (procesando) return;
    await onConfirmar();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-confirmar-modal"
      onClick={() => {
        if (!procesando) onClose();
      }}
    >
      {/* Tarjeta del Modal */}
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="flex items-start gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
              cita.nuevoEstado === 'atendida'
                ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                : cita.nuevoEstado === 'no_asistio'
                ? 'bg-amber-50 text-amber-600 border-amber-100'
                : 'bg-blue-50 text-blue-600 border-blue-100'
            }`}
          >
            {cita.nuevoEstado === 'atendida' ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : cita.nuevoEstado === 'no_asistio' ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 id="titulo-confirmar-modal" className="text-lg font-black text-slate-900 font-heading">
              {titulo}
            </h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              {descripcion}
            </p>
          </div>
        </div>

        {/* Resumen de la Cita */}
        <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Código de Reserva:</span>
            <span className="font-mono font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60">
              {cita.codigo_reserva}
            </span>
          </div>

          {cita.paciente_nombre && (
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Paciente:</span>
              <span className="font-bold text-slate-800">{cita.paciente_nombre}</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Servicio:</span>
            <span className="text-slate-700 font-medium">{cita.nombre_servicio_historico}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Horario:</span>
            <span className="text-slate-700 font-medium">{horarioStr}</span>
          </div>

          <div className="flex justify-between items-center pt-1 border-t border-slate-200/60">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Nuevo Estado:</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${configNuevoEstado.badgeClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${configNuevoEstado.dotClass}`} />
              {configNuevoEstado.label}
            </span>
          </div>
        </div>

        {/* Botones de Acción */}
        <div className="mt-5 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={procesando}
            className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleConfirmar}
            disabled={procesando}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50 ${botonClase}`}
          >
            {procesando ? (
              <>
                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Procesando...</span>
              </>
            ) : (
              <span>{botonTexto}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

