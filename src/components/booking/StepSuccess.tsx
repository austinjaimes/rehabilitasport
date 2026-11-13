import React, { useState } from 'react';
import type { ReservaResponsePayload } from '../../lib/types/booking.types';

interface StepSuccessProps {
  resultado: ReservaResponsePayload;
  nombrePaciente: string;
  onReset: () => void;
}

export const StepSuccess: React.FC<StepSuccessProps> = ({
  resultado,
  nombrePaciente,
  onReset,
}) => {
  const [copiadoFolio, setCopiadoFolio] = useState(false);
  const [copiadoEnlace, setCopiadoEnlace] = useState(false);

  // Enlace de gestión seguro utilizando el fragmento de URL (#token=...)
  // El fragmento (#) nunca se envía a los servidores en cabeceras HTTP ni se registra en logs de acceso
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://rehabilitasport.com';
  const enlaceGestion = resultado.tokenPlano
    ? `${origin}/gestionar-cita#token=${resultado.tokenPlano}`
    : `${origin}/gestionar-cita`;

  const handleCopiarFolio = () => {
    if (resultado.codigoReserva && typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(resultado.codigoReserva);
      setCopiadoFolio(true);
      setTimeout(() => setCopiadoFolio(false), 2500);
    }
  };

  const handleCopiarEnlace = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(enlaceGestion);
      setCopiadoEnlace(true);
      setTimeout(() => setCopiadoEnlace(false), 2500);
    }
  };

  const handleDescargarICS = () => {
    if (!resultado.fecha || !resultado.horaInicio) return;

    const [año, mes, dia] = resultado.fecha.split('-').map(Number);
    const [hInicio, mInicio] = resultado.horaInicio.split(':').map(Number);
    const [hFin, mFin] = (resultado.horaFin || '11:00').split(':').map(Number);

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

    // Formato iCalendar local
    const dtStart = `${año}${pad(mes)}${pad(dia)}T${pad(hInicio)}${pad(mInicio)}00`;
    const dtEnd = `${año}${pad(mes)}${pad(dia)}T${pad(hFin)}${pad(mFin)}00`;

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Rehabilita Sport//Sistema de Citas//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${resultado.codigoReserva || 'cita'}-${Date.now()}@rehabilitasport.com`,
      `DTSTAMP:${dtStart}Z`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:Cita: ${resultado.servicio || 'Fisioterapia'} - Rehabilita Sport`,
      `DESCRIPTION:Cita médica en Clínica Rehabilita Sport.\\nPaciente: ${nombrePaciente}\\nFolio: ${resultado.codigoReserva}\\nGestión: ${enlaceGestion}`,
      'LOCATION:Clínica Rehabilita Sport, Iguala, Guerrero, México',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Cita_${resultado.codigoReserva || 'RehabilitaSport'}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Icono y Encabezado de Éxito */}
      <div className="text-center space-y-3 py-4">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
          <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 font-heading">
          ¡Cita Confirmada con Éxito!
        </h2>
        <p className="text-gray-600 text-sm max-w-md mx-auto">
          Gracias, <strong className="text-gray-900">{nombrePaciente}</strong>. Tu lugar ha sido reservado en la agenda de Rehabilita Sport.
        </p>
      </div>

      {/* Tarjeta de Folio Oficial */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-4 -mr-4 h-32 w-32 rounded-full bg-white/10 blur-xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <span className="text-xs uppercase tracking-widest text-blue-200 font-semibold">
              Folio Oficial de Reserva
            </span>
            <div className="text-3xl sm:text-4xl font-mono font-extrabold tracking-wider mt-1">
              {resultado.codigoReserva || 'RS-CONFIRMADA'}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopiarFolio}
            className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer backdrop-blur-sm border border-white/20"
          >
            {copiadoFolio ? (
              <>
                <svg className="h-4 w-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>¡Copiado!</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                <span>Copiar Folio</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-white/20 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-blue-200 block">Tratamiento</span>
            <strong className="text-white text-sm">{resultado.servicio}</strong>
          </div>
          <div>
            <span className="text-blue-200 block">Fecha</span>
            <strong className="text-white text-sm">{resultado.fecha}</strong>
          </div>
          <div>
            <span className="text-blue-200 block">Horario</span>
            <strong className="text-white text-sm">
              {resultado.horaInicio?.slice(0, 5)} - {resultado.horaFin?.slice(0, 5)} hrs
            </strong>
          </div>
        </div>
      </div>

      {/* Caja de Enlace de Gestión Segura (Fragmento) */}
      <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-start gap-2.5">
          <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <div>
            <h4 className="font-bold text-gray-900 text-sm">
              Tu Enlace Privado de Gestión
            </h4>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              Guarda este enlace para consultar, reprogramar o cancelar tu cita en cualquier momento sin crear una cuenta.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 items-center">
          <input
            type="text"
            readOnly
            value={enlaceGestion}
            className="w-full px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-xs font-mono text-gray-700 select-all focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCopiarEnlace}
            className="w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg bg-gray-900 hover:bg-black text-white text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
          >
            {copiadoEnlace ? '¡Enlace Copiado!' : 'Copiar Enlace'}
          </button>
        </div>
      </div>

      {/* Botones de Acciones Secundarias */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={handleDescargarICS}
          className="w-full py-3 px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-sm font-semibold transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
        >
          <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Agregar a mi Calendario (.ics)</span>
        </button>

        <button
          type="button"
          onClick={onReset}
          className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-blue-500/20"
        >
          <span>Agendar Otra Cita</span>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Nota de Ubicación y Atención */}
      <div className="p-4 bg-gray-50 rounded-xl text-center text-xs text-gray-500 space-y-1">
        <p className="font-semibold text-gray-700">Clínica Rehabilita Sport</p>
        <p>Por favor preséntate 10 minutos antes de la hora indicada con ropa cómoda.</p>
      </div>
    </div>
  );
};

