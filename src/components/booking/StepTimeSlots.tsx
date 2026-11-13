import React, { useEffect, useState } from 'react';

interface StepTimeSlotsProps {
  fechaSeleccionada: string;
  duracionMinutos: number;
  horaSeleccionada: string | null;
  onSelectHora: (hora: string) => void;
  onModoDisponibilidadChange?: (modo: 'pendiente' | 'real' | 'simulado_dev') => void;
}

function formatearHora12h(hora24: string): string {
  const [hStr, mStr] = hora24.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const hDisplay = h < 10 ? `0${h}` : `${h}`;
  return `${hDisplay}:${mStr} ${ampm}`;
}

export const StepTimeSlots: React.FC<StepTimeSlotsProps> = ({
  fechaSeleccionada,
  duracionMinutos,
  horaSeleccionada,
  onSelectHora,
  onModoDisponibilidadChange,
}) => {
  const [slots, setSlots] = useState<string[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [modoSimuladoDev, setModoSimuladoDev] = useState<boolean>(false);

  const cargarDisponibilidad = async () => {
    setCargando(true);
    setError(null);
    setSlots([]);
    setModoSimuladoDev(false);
    onModoDisponibilidadChange?.('pendiente');

    try {
      // Intenta vía proxy /api/ y con fallback directo a /.netlify/functions/
      let res = await fetch(
        `/api/citas-disponibilidad?fecha=${encodeURIComponent(fechaSeleccionada)}&duracion=${duracionMinutos}`
      );

      if (!res.ok && res.status === 404) {
        res = await fetch(
          `/.netlify/functions/citas-disponibilidad?fecha=${encodeURIComponent(fechaSeleccionada)}&duracion=${duracionMinutos}`
        );
      }

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('Demasiadas solicitudes. Espera un momento antes de volver a consultar.');
        }
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al consultar la disponibilidad');
      }

      const data = await res.json();

      // Validación estricta de estructura y contenido de horarios (Ajuste 1)
      if (!data || typeof data !== 'object' || !Array.isArray(data.slots)) {
        onModoDisponibilidadChange?.('pendiente');
        setModoSimuladoDev(false);
        setSlots([]);
        throw new Error('Estructura de respuesta inválida al consultar disponibilidad.');
      }

      // Validar que cada elemento sea una cadena con formato de hora HH:MM válida
      const slotsValidos = data.slots.every(
        (s: any) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
      );

      if (!slotsValidos) {
        onModoDisponibilidadChange?.('pendiente');
        setModoSimuladoDev(false);
        setSlots([]);
        throw new Error('Formato de horarios recibido inválido desde el servidor.');
      }

      const esSimulado = data.modo === 'simulado_dev';
      setModoSimuladoDev(esSimulado);
      onModoDisponibilidadChange?.(esSimulado ? 'simulado_dev' : 'real');
      setSlots(data.slots);
    } catch (err: any) {
      console.error('Error al obtener disponibilidad:', err);
      setError(err?.message || 'No fue posible obtener los horarios disponibles.');
      onModoDisponibilidadChange?.('pendiente');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (fechaSeleccionada) {
      cargarDisponibilidad();
    }
  }, [fechaSeleccionada, duracionMinutos]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <div>
          <h3 className="font-bold text-gray-900 text-base sm:text-lg font-heading">
            Horarios Disponibles
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Citas de {duracionMinutos} minutos • Horario oficial de la clínica
          </p>
        </div>
        {modoSimuladoDev ? (
          <span className="text-xs text-amber-800 bg-amber-100 font-bold px-2.5 py-1 rounded-full border border-amber-300 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            Modo Simulado (Dev)
          </span>
        ) : (
          <span className="text-xs text-blue-700 bg-blue-50 font-medium px-2.5 py-1 rounded-full border border-blue-200">
            Hora local (México)
          </span>
        )}
      </div>

      {/* Aviso visible de modo simulado */}
      {modoSimuladoDev && !cargando && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-amber-800">
            <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Disponibilidad Simulada para Pruebas Locales</span>
          </div>
          <p className="text-amber-700 pl-5 leading-relaxed">
            La base de datos de Supabase no está conectada o no ha sido migrada. Los horarios se generan respetando la jornada de atención de la clínica, pero corresponden a un entorno de prueba y no a disponibilidad real.
          </p>
        </div>
      )}

      {cargando && (
        <div className="py-12 text-center text-gray-500">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="mt-3 text-sm font-medium">Consultando agenda en tiempo real...</p>
        </div>
      )}

      {error && !cargando && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <svg className="w-5 h-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={cargarDisponibilidad}
            className="text-xs font-semibold text-blue-600 underline hover:text-blue-800 cursor-pointer"
          >
            Reintentar consulta
          </button>
        </div>
      )}

      {!cargando && !error && slots.length === 0 && (
        <div className="py-10 text-center text-gray-500 space-y-2">
          <svg className="mx-auto h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-sm font-medium">No hay horarios disponibles para la fecha seleccionada.</p>
          <p className="text-xs text-gray-400">Por favor intenta seleccionando otro día en el calendario.</p>
        </div>
      )}

      {!cargando && !error && slots.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Selecciona una hora para tu consulta:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {slots.map((hora) => {
              const seleccionada = horaSeleccionada === hora;
              return (
                <button
                  key={hora}
                  type="button"
                  onClick={() => onSelectHora(hora)}
                  className={`py-3 px-3 rounded-lg border text-sm font-medium transition-all text-center flex flex-col items-center justify-center cursor-pointer ${
                    seleccionada
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-[1.02] ring-2 ring-blue-400'
                      : 'bg-gray-50 text-gray-800 border-gray-200 hover:bg-blue-50 hover:border-blue-300'
                  }`}
                >
                  <span className="font-bold">{formatearHora12h(hora)}</span>
                  <span className={`text-[10px] mt-0.5 ${seleccionada ? 'text-blue-100' : 'text-gray-400'}`}>
                    ({hora})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
