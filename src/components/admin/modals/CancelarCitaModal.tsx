import React, { useState, useEffect } from 'react';
import { formatearHora12h } from '../../../lib/utils/adminFormatters';

export interface CitaParaCancelar {
  id: string;
  codigo_reserva: string;
  hora_inicio: string;
  hora_fin: string;
  nombre_servicio_historico: string;
  paciente_nombre?: string;
}

interface CancelarCitaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmar: (motivo: string) => Promise<void>;
  cita: CitaParaCancelar | null;
  procesando: boolean;
}

export const CancelarCitaModal: React.FC<CancelarCitaModalProps> = ({
  isOpen,
  onClose,
  onConfirmar,
  cita,
  procesando,
}) => {
  const [motivo, setMotivo] = useState<string>('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  // Reiniciar estado al abrir el modal para una cita específica
  useEffect(() => {
    if (isOpen) {
      setMotivo('');
      setErrorLocal(null);
    }
  }, [isOpen, cita]);

  // Manejo de teclado: Cerrar modal con tecla Escape
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const motivoLimpio = motivo.trim();

    if (!motivoLimpio) {
      setErrorLocal('Debe proporcionar un motivo para la cancelación de la cita.');
      return;
    }

    if (motivoLimpio.length > 500) {
      setErrorLocal('El motivo de cancelación no debe exceder los 500 caracteres.');
      return;
    }

    setErrorLocal(null);
    await onConfirmar(motivoLimpio);
  };

  const horarioStr = `${formatearHora12h(cita.hora_inicio)} - ${formatearHora12h(cita.hora_fin)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-cancelar-modal"
    >
      {/* Tarjeta del Modal */}
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera del Modal */}
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="titulo-cancelar-modal" className="text-lg font-black text-slate-900 font-heading">
              Cancelar Cita
            </h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Esta acción marcará la cita como cancelada e invalidará el token de gestión del paciente.
            </p>
          </div>
        </div>

        {/* Resumen de la Cita */}
        <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs space-y-1.5">
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
        </div>

        {/* Formulario de Cancelación */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="motivo-cancelacion" className="block text-xs font-bold text-slate-700">
                Motivo de la Cancelación
              </label>
              <span className={`text-[10px] font-mono ${motivo.length > 500 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                {motivo.length} / 500
              </span>
            </div>
            <textarea
              id="motivo-cancelacion"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Indica el motivo (ej. Solicitud directa del paciente vía WhatsApp, reprogramación, etc.)..."
              disabled={procesando}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition resize-none disabled:opacity-50"
            />
          </div>

          {errorLocal && (
            <div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 border border-rose-200">
              {errorLocal}
            </div>
          )}

          {/* Botones de Acción */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={procesando}
              className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={procesando || !motivo.trim() || motivo.length > 500}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              {procesando ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>Cancelando...</span>
                </>
              ) : (
                <span>Confirmar Cancelación</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

