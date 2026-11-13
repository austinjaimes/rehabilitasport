import React, { useEffect } from 'react';
import {
  formatearFechaLarga,
  formatearHora12h,
  obtenerConfiguracionEstado,
  generarEnlaceWhatsApp,
} from '../../../lib/utils/adminFormatters';

export interface CitaDetalleData {
  id: string;
  codigo_reserva: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  duracion_minutos_historica: number;
  nombre_servicio_historico: string;
  estado: string;
  motivo_cancelacion?: string | null;
  created_at: string;
  pacientes?: {
    id?: string;
    nombre_completo: string;
    telefono_whatsapp: string;
    email?: string | null;
    consentimiento_whatsapp?: boolean;
  } | null;
}

export interface ErrorDetalleModal {
  tipo?: 'auth' | 'infraestructura' | 'red' | 'servidor';
  mensaje: string;
  statusCode?: number;
}

export interface DetalleCitaModalProps {
  cita: CitaDetalleData | null;
  isOpen: boolean;
  onClose: () => void;
  onMarcarAtendida?: (citaId: string, codigo: string) => Promise<void>;
  onMarcarNoAsistio?: (citaId: string, codigo: string) => Promise<void>;
  onAbrirCancelar?: (cita: any) => void;
  onMarcarConfirmada?: (citaId: string, codigo: string) => Promise<void>;
  procesando?: boolean;
  hayModalSuperiorAbierto?: boolean;
  error?: ErrorDetalleModal | null;
  onLimpiarError?: () => void;
}

export const DetalleCitaModal: React.FC<DetalleCitaModalProps> = ({
  cita,
  isOpen,
  onClose,
  onMarcarAtendida,
  onMarcarNoAsistio,
  onAbrirCancelar,
  onMarcarConfirmada,
  procesando = false,
  hayModalSuperiorAbierto = false,
  error = null,
  onLimpiarError,
}) => {
  // Manejo de teclado: Cerrar modal con tecla Escape
  // Si hay un modal superior apilado (confirmar/cancelar), NO responder a Escape aquí para permitir que se cierre solo el superior.
  // Mientras esté procesando una acción en curso, Escape no debe cerrar ningún modal.
  useEffect(() => {
    if (!isOpen || hayModalSuperiorAbierto) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !procesando) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hayModalSuperiorAbierto, procesando, onClose]);

  if (!isOpen || !cita) {
    return null;
  }

  const configEstado = obtenerConfiguracionEstado(cita.estado);
  const paciente = cita.pacientes;
  const tieneTelefono = Boolean(paciente?.telefono_whatsapp && paciente.telefono_whatsapp.trim().length >= 10);
  const enlaceWhatsApp = tieneTelefono
    ? generarEnlaceWhatsApp(paciente!.telefono_whatsapp, paciente?.nombre_completo, cita.codigo_reserva)
    : null;

  // Formato seguro de fecha de creación si está disponible
  let fechaCreacionStr = 'No disponible';
  if (cita.created_at) {
    try {
      const fechaCreacion = new Date(cita.created_at);
      if (!isNaN(fechaCreacion.getTime())) {
        fechaCreacionStr = fechaCreacion.toLocaleDateString('es-MX', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    } catch {
      fechaCreacionStr = cita.created_at;
    }
  }

  return (
    <div
      className={`fixed inset-0 ${
        hayModalSuperiorAbierto ? 'z-40' : 'z-50'
      } flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="detalle-cita-title"
      onClick={() => {
        // No cerrar si hay un modal superior apilado o si se está procesando una acción
        if (!hayModalSuperiorAbierto && !procesando) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <div>
              <h2 id="detalle-cita-title" className="text-base font-bold text-slate-900 font-heading">
                Detalle de Cita
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                  {cita.codigo_reserva || 'SIN-CÓDIGO'}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold border ${configEstado.badgeClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${configEstado.dotClass}`} />
                  {configEstado.label}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={procesando}
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
            aria-label="Cerrar detalle de cita"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cuerpo del Modal con scroll si el contenido desborda */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* Banner de Error en Acción (Fase C2 - Corrección UX de Visibilidad) */}
          {error && (
            <div
              role="alert"
              className={`rounded-xl p-3.5 border flex items-start gap-3 animate-in fade-in duration-150 ${
                error.tipo === 'red'
                  ? 'bg-sky-50 border-sky-200 text-sky-900'
                  : error.tipo === 'infraestructura' || error.statusCode === 503
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="shrink-0 mt-0.5">
                <svg className="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-bold">
                  {error.statusCode === 409
                    ? 'Conflicto al actualizar cita'
                    : error.tipo === 'red'
                    ? 'Error de conexión'
                    : error.tipo === 'infraestructura' || error.statusCode === 503
                    ? 'Servicio no disponible'
                    : 'Error al procesar la acción'}
                </div>
                <p className="mt-0.5 leading-relaxed text-slate-700">{error.mensaje}</p>
              </div>
              {onLimpiarError && (
                <button
                  type="button"
                  onClick={onLimpiarError}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition cursor-pointer"
                  aria-label="Cerrar alerta de error"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
          {/* Bloque 1: Horario y Servicio */}
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/80 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Información del Horario</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-slate-500 block">Fecha</span>
                <span className="font-semibold text-slate-800 capitalize">
                  {formatearFechaLarga(cita.fecha)}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Horario</span>
                <span className="font-semibold text-slate-800">
                  {formatearHora12h(cita.hora_inicio)} - {formatearHora12h(cita.hora_fin)}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Servicio Solicitado</span>
                <span className="font-semibold text-slate-800">
                  {cita.nombre_servicio_historico || 'Servicio no especificado'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Duración Estimada</span>
                <span className="font-semibold text-slate-800">
                  {cita.duracion_minutos_historica ? `${cita.duracion_minutos_historica} minutos` : 'No especificada'}
                </span>
              </div>
            </div>
          </div>

          {/* Bloque 2: Información del Paciente */}
          <div className="rounded-xl bg-white p-4 border border-slate-200/80 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Datos del Paciente</h3>

            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-500 block">Nombre Completo</span>
                <span className="font-bold text-slate-900 text-base">
                  {paciente?.nombre_completo || 'Paciente no registrado'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-xs text-slate-500 block">WhatsApp / Teléfono</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-semibold text-slate-800 font-mono text-xs">
                      {paciente?.telefono_whatsapp || 'No registrado'}
                    </span>
                    {enlaceWhatsApp && (
                      <a
                        href={enlaceWhatsApp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition"
                        title="Abrir chat en WhatsApp"
                      >
                        <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                        </svg>
                        WhatsApp
                      </a>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-xs text-slate-500 block">Correo Electrónico</span>
                  <span className="font-semibold text-slate-800 break-all text-xs">
                    {paciente?.email || 'No registrado'}
                  </span>
                </div>
              </div>

              <div className="pt-1">
                <span className="text-xs text-slate-500 block">Consentimiento de Contacto por WhatsApp</span>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold mt-0.5 ${
                    paciente?.consentimiento_whatsapp ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      paciente?.consentimiento_whatsapp ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                  {paciente?.consentimiento_whatsapp ? 'Autorizado por el paciente' : 'No autorizado o no registrado'}
                </span>
              </div>
            </div>
          </div>

          {/* Bloque 3: Motivo de Cancelación (Solo si la cita está cancelada) */}
          {cita.estado === 'cancelada' && (
            <div className="rounded-xl bg-rose-50 p-4 border border-rose-200 space-y-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rose-800 flex items-center gap-1.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Motivo de Cancelación
              </h3>
              <p className="text-xs text-rose-900 leading-relaxed">
                {cita.motivo_cancelacion || 'No se registró un motivo específico para esta cancelación.'}
              </p>
            </div>
          )}

          {/* Bloque 4: Metadatos del Sistema */}
          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-slate-400">
            <div>
              <span>Fecha de Registro: </span>
              <span className="text-slate-600 font-medium">{fechaCreacionStr}</span>
            </div>
            <div className="font-mono text-[10px] text-slate-400 truncate max-w-[200px]" title={cita.id}>
              ID: {cita.id}
            </div>
          </div>
        </div>

        {/* Pie del Modal con acciones de estado si están habilitadas */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {cita.estado === 'confirmada' && onMarcarAtendida && (
              <button
                type="button"
                disabled={procesando}
                onClick={async () => {
                  await onMarcarAtendida(cita.id, cita.codigo_reserva);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Atendida</span>
              </button>
            )}

            {cita.estado === 'confirmada' && onMarcarNoAsistio && (
              <button
                type="button"
                disabled={procesando}
                onClick={async () => {
                  await onMarcarNoAsistio(cita.id, cita.codigo_reserva);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>No asistió</span>
              </button>
            )}

            {cita.estado === 'confirmada' && onAbrirCancelar && (
              <button
                type="button"
                disabled={procesando}
                onClick={() => {
                  onAbrirCancelar(cita);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3.5 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Cancelar Cita</span>
              </button>
            )}

            {cita.estado === 'no_asistio' && onMarcarAtendida && (
              <button
                type="button"
                disabled={procesando}
                onClick={async () => {
                  await onMarcarAtendida(cita.id, cita.codigo_reserva);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Atender (Tardía)</span>
              </button>
            )}

            {cita.estado === 'no_asistio' && onMarcarConfirmada && (
              <button
                type="button"
                disabled={procesando}
                onClick={async () => {
                  await onMarcarConfirmada(cita.id, cita.codigo_reserva);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3.5 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                <span>Reactivar a Confirmada</span>
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={procesando}
            onClick={onClose}
            className="rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 px-5 py-2 text-xs font-bold transition cursor-pointer ml-auto disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

