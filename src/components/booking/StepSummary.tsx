import React from 'react';
import type { Servicio } from '../../lib/types/database.types';

interface StepSummaryProps {
  servicio: Servicio;
  fecha: string;
  horaInicio: string;
  nombreCompleto: string;
  telefonoWhatsApp: string;
  email: string;
  consentimientoWhatsApp: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  onConfirm: () => void;
  onBack: () => void;
  onChangeStep: (paso: number) => void;
  confirmacionBloqueada?: boolean;
  motivoBloqueo?: 'pendiente' | 'simulado_dev' | null;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatearFechaEspanol(fechaStr: string): string {
  const [año, mes, dia] = fechaStr.split('-').map(Number);
  const d = new Date(año, mes - 1, dia);
  return `${DIAS[d.getDay()]}, ${dia} de ${MESES[mes - 1]} de ${año}`;
}

function calcularHoraFin(horaInicioStr: string, duracionMinutos: number): string {
  const [h, m] = horaInicioStr.split(':').map(Number);
  const totalMin = h * 60 + m + duracionMinutos;
  const hFin = Math.floor(totalMin / 60);
  const mFin = totalMin % 60;
  const hStr = hFin < 10 ? `0${hFin}` : `${hFin}`;
  const mStr = mFin < 10 ? `0${mFin}` : `${mFin}`;
  return `${hStr}:${mStr}`;
}

export const StepSummary: React.FC<StepSummaryProps> = ({
  servicio,
  fecha,
  horaInicio,
  nombreCompleto,
  telefonoWhatsApp,
  email,
  consentimientoWhatsApp,
  isSubmitting,
  submitError,
  onConfirm,
  onBack,
  onChangeStep,
  confirmacionBloqueada = false,
  motivoBloqueo = null,
}) => {
  const horaFin = calcularHoraFin(horaInicio, servicio.duracion_minutos);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 font-heading">
          5. Revisa y Confirma tu Cita
        </h2>
        <p className="text-gray-600 text-sm mt-1">
          Por favor verifica los detalles antes de registrar tu reservación oficial.
        </p>
      </div>

      {/* Aviso de confirmación bloqueada cuando la disponibilidad no es real */}
      {confirmacionBloqueada && (
        <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-xl text-amber-900 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-amber-800">
            <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>
              {motivoBloqueo === 'simulado_dev'
                ? 'Confirmación Deshabilitada (Modo Simulado)'
                : 'Confirmación Deshabilitada (Disponibilidad No Verificada)'}
            </span>
          </div>
          <p className="text-xs text-amber-700 leading-relaxed pl-7">
            {motivoBloqueo === 'simulado_dev'
              ? 'Los horarios seleccionados provienen de un entorno local de prueba sin base de datos activa. Puedes revisar el resumen y volver a los pasos anteriores, pero la confirmación oficial requiere la base de datos de Supabase conectada con sus migraciones aplicadas.'
              : 'La disponibilidad del horario seleccionado aún no ha sido confirmada por el servidor oficial. Por favor regresa al paso de selección de horario para verificar.'}
          </p>
        </div>
      )}

      {submitError && (
        <div className="p-4 bg-red-50 border-2 border-red-200 rounded-xl text-sm text-red-800 space-y-2">
          <div className="flex items-start gap-2.5">
            <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-bold">No fue posible completar la reserva</p>
              <p className="mt-0.5 text-xs text-red-700 leading-relaxed">{submitError}</p>
            </div>
          </div>
          {submitError.includes('ocupado') && (
            <div className="pt-2 border-t border-red-200">
              <button
                type="button"
                onClick={() => onChangeStep(2)}
                className="text-xs font-bold text-blue-700 underline hover:text-blue-900 cursor-pointer"
              >
                &larr; Volver a seleccionar otro horario disponible
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tarjeta de Resumen */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm divide-y divide-gray-100">
        {/* Cabecera del Servicio */}
        <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50/30 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100/70 px-2.5 py-0.5 rounded-full">
              Servicio Seleccionado
            </span>
            <h3 className="text-lg font-bold text-gray-900 mt-1.5 font-heading">
              {servicio.nombre}
            </h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Duración estimada: <strong>{servicio.duracion_minutos} minutos</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChangeStep(1)}
            disabled={isSubmitting}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            Modificar
          </button>
        </div>

        {/* Fecha y Horario */}
        <div className="p-5 flex items-start justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Fecha y Horario
            </span>
            <p className="text-base font-semibold text-gray-900">
              {formatearFechaEspanol(fecha)}
            </p>
            <p className="text-sm text-blue-700 font-medium">
              {horaInicio} - {horaFin} hrs (Hora Centro México)
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChangeStep(2)}
            disabled={isSubmitting}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            Modificar
          </button>
        </div>

        {/* Datos del Paciente */}
        <div className="p-5 flex items-start justify-between">
          <div className="space-y-1.5 text-sm">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Datos de Contacto
            </span>
            <p className="text-gray-900 font-semibold">
              {nombreCompleto}
            </p>
            <p className="text-gray-600 flex items-center gap-1.5">
              <span>Teléfono: <strong>+52 {telefonoWhatsApp}</strong></span>
            </p>
            <p className="text-gray-600">
              Correo: {email ? <strong>{email}</strong> : <span className="italic text-gray-400">No proporcionado</span>}
            </p>
            <div className="pt-1">
              <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium ${
                consentimientoWhatsApp
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {consentimientoWhatsApp ? '✓ Notificaciones WhatsApp activadas' : 'Gestión directa en portal web'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChangeStep(4)}
            disabled={isSubmitting}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            Modificar
          </button>
        </div>
      </div>

      {/* Información de Garantía */}
      <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl text-xs text-gray-600 flex items-start gap-3">
        <svg className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <p className="leading-relaxed">
          Al confirmar, el horario quedará reservado exclusivamente para ti en el sistema de la clínica. Recibirás tu <strong>folio oficial</strong> y un <strong>enlace de gestión privado</strong> para reprogramar o cancelar si tus planes cambian.
        </p>
      </div>

      {/* Botones de Acción */}
      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className="px-5 py-2.5 rounded-full font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 transition cursor-pointer text-sm disabled:opacity-50"
        >
          &larr; Corregir Datos
        </button>

        {confirmacionBloqueada ? (
          <button
            type="button"
            disabled
            className="px-7 py-3.5 rounded-full font-bold text-gray-400 bg-gray-200 cursor-not-allowed shadow-none text-sm flex items-center gap-2"
            title="La confirmación se encuentra deshabilitada"
          >
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Confirmación Bloqueada</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`px-7 py-3.5 rounded-full font-bold text-white transition-all shadow-md flex items-center gap-2 text-sm ${
              isSubmitting
                ? 'bg-blue-400 cursor-not-allowed shadow-none'
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30 hover:scale-[1.02] cursor-pointer'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Confirmando Cita Médica...</span>
              </>
            ) : (
              <>
                <span>Confirmar Cita Médica</span>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

