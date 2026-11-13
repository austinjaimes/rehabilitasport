import React, { useEffect } from 'react';
import { formatearHora12h, formatearFechaLarga } from '../../../lib/utils/adminFormatters';

export interface BloqueoEliminarData {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
}

interface ConfirmarEliminarBloqueoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmar: () => Promise<void>;
  bloqueo: BloqueoEliminarData | null;
  procesando: boolean;
}

export const ConfirmarEliminarBloqueoModal: React.FC<ConfirmarEliminarBloqueoModalProps> = ({
  isOpen,
  onClose,
  onConfirmar,
  bloqueo,
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

  if (!isOpen || !bloqueo) return null;

  const esDiaCompleto =
    (bloqueo.hora_inicio === '00:00:00' || bloqueo.hora_inicio === '00:00') &&
    (bloqueo.hora_fin === '23:59:59' || bloqueo.hora_fin === '23:59');

  const horarioStr = esDiaCompleto
    ? 'Día Completo (00:00 - 23:59)'
    : `${formatearHora12h(bloqueo.hora_inicio)} - ${formatearHora12h(bloqueo.hora_fin)}`;

  const handleConfirmar = async () => {
    if (procesando) return;
    await onConfirmar();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-eliminar-bloqueo-modal"
      onClick={() => {
        if (!procesando) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <h3 id="titulo-eliminar-bloqueo-modal" className="text-lg font-black text-slate-900 font-heading">
              Eliminar Bloqueo de Agenda
            </h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              ¿Desea desbloquear este intervalo y habilitar nuevamente la disponibilidad clínica?
            </p>
          </div>
        </div>

        {/* Resumen del Bloqueo a Eliminar */}
        <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Fecha:</span>
            <span className="font-bold text-slate-900">{formatearFechaLarga(bloqueo.fecha)}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Horario:</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
              {esDiaCompleto ? (
                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md font-bold text-[11px] border border-amber-200">
                  {horarioStr}
                </span>
              ) : (
                <span>{horarioStr}</span>
              )}
            </span>
          </div>

          <div className="pt-2 border-t border-slate-200/60">
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px] block mb-0.5">Motivo:</span>
            <p className="text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/60 text-xs leading-relaxed">
              {bloqueo.motivo}
            </p>
          </div>
        </div>

        {/* Advertencia Importante */}
        <div className="mt-4 rounded-xl bg-amber-50/80 p-3.5 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed flex items-start gap-2.5">
          <svg className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            <strong>Advertencia:</strong> Al eliminar este bloqueo, el horario quedará inmediatamente liberado y disponible para que los pacientes reserven citas a través del portal público.
          </span>
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
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
          >
            {procesando ? (
              <>
                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Eliminando...</span>
              </>
            ) : (
              <span>Sí, Eliminar Bloqueo</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

