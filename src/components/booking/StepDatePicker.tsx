import React, { useState } from 'react';

interface StepDatePickerProps {
  fechaSeleccionada: string | null; // 'YYYY-MM-DD'
  onSelectFecha: (fecha: string) => void;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Helper para obtener la fecha civil actual de la clínica en 'America/Mexico_City'
function getHoyMexico(): { fechaMinimaStr: string; año: number; mes: number; dia: number } {
  const formateador = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const fechaMinimaStr = formateador.format(new Date()); // Formato estricto 'YYYY-MM-DD'
  const [año, mes, dia] = fechaMinimaStr.split('-').map(Number);
  return { fechaMinimaStr, año, mes: mes - 1, dia };
}

// Helper para calcular horizonte temporal sumando días a 'YYYY-MM-DD' en tiempo UTC puro
function sumarDias(fechaStr: string, dias: number): string {
  const [año, mes, dia] = fechaStr.split('-').map(Number);
  const d = new Date(Date.UTC(año, mes - 1, dia + dias));
  const a = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const diaNum = String(d.getUTCDate()).padStart(2, '0');
  return `${a}-${m}-${diaNum}`;
}

export const StepDatePicker: React.FC<StepDatePickerProps> = ({
  fechaSeleccionada,
  onSelectFecha,
}) => {
  const hoyMexico = getHoyMexico();
  const fechaMinimaStr = hoyMexico.fechaMinimaStr; // Mínimo seleccionable como 'YYYY-MM-DD'
  const fechaLimiteStr = sumarDias(fechaMinimaStr, 60); // Límite de horizonte (60 días a futuro)

  const [mesActual, setMesActual] = useState<number>(() => hoyMexico.mes);
  const [añoActual, setAñoActual] = useState<number>(() => hoyMexico.año);

  const primerDiaMes = new Date(Date.UTC(añoActual, mesActual, 1)).getUTCDay();
  const diasEnMes = new Date(Date.UTC(añoActual, mesActual + 1, 0)).getUTCDate();

  const handleMesAnterior = () => {
    if (mesActual === hoyMexico.mes && añoActual === hoyMexico.año) return;
    if (mesActual === 0) {
      setMesActual(11);
      setAñoActual(añoActual - 1);
    } else {
      setMesActual(mesActual - 1);
    }
  };

  const handleMesSiguiente = () => {
    const proxAño = mesActual === 11 ? añoActual + 1 : añoActual;
    const proxMes = mesActual === 11 ? 0 : mesActual + 1;
    const primerDiaProxMesStr = `${proxAño}-${String(proxMes + 1).padStart(2, '0')}-01`;
    if (primerDiaProxMesStr > fechaLimiteStr) return;

    setMesActual(proxMes);
    setAñoActual(proxAño);
  };

  const formatearFecha = (dia: number): string => {
    const d = dia < 10 ? `0${dia}` : `${dia}`;
    const m = mesActual + 1 < 10 ? `0${mesActual + 1}` : `${mesActual + 1}`;
    return `${añoActual}-${m}-${d}`;
  };

  const celdasVacias = Array.from({ length: primerDiaMes });
  const diasDelMes = Array.from({ length: diasEnMes }, (_, i) => i + 1);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      {/* Encabezado del Mes y Controles */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 text-lg font-heading">
          {MESES[mesActual]} {añoActual}
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleMesAnterior}
            disabled={mesActual === hoyMexico.mes && añoActual === hoyMexico.año}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition"
            aria-label="Mes anterior"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleMesSiguiente}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer transition"
            aria-label="Mes siguiente"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Días de la semana */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-500 mb-2">
        {DIAS_SEMANA.map((dia, idx) => (
          <div key={dia} className={idx === 0 ? 'text-red-500' : ''}>
            {dia}
          </div>
        ))}
      </div>

      {/* Cuadrícula de días */}
      <div className="grid grid-cols-7 gap-1">
        {celdasVacias.map((_, i) => (
          <div key={`empty-${i}`} className="h-10" />
        ))}

        {diasDelMes.map((dia) => {
          const fechaStr = formatearFecha(dia);
          const diaSemana = new Date(Date.UTC(añoActual, mesActual, dia)).getUTCDay();

          const esPasado = fechaStr < fechaMinimaStr;
          const esDomingo = diaSemana === 0; // Domingos cerrado
          const excedeLimite = fechaStr > fechaLimiteStr;
          const deshabilitado = esPasado || esDomingo || excedeLimite;
          const esHoy = fechaStr === fechaMinimaStr;
          const esSeleccionado = fechaSeleccionada === fechaStr;

          return (
            <button
              key={dia}
              type="button"
              disabled={deshabilitado}
              onClick={() => onSelectFecha(fechaStr)}
              className={`h-10 w-full rounded-lg text-sm font-semibold flex items-center justify-center transition-all ${
                esSeleccionado
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 font-bold scale-105'
                  : deshabilitado
                  ? 'text-gray-300 cursor-not-allowed bg-transparent'
                  : esHoy
                  ? 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 cursor-pointer'
                  : 'text-gray-800 hover:bg-blue-50 hover:text-blue-600 cursor-pointer'
              }`}
            >
              {dia}
            </button>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600 inline-block"></span>
          Seleccionado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-blue-600 inline-block"></span>
          Hoy
        </span>
        <span className="flex items-center gap-1.5 text-gray-400">
          Domingos cerrado
        </span>
      </div>
    </div>
  );
};

