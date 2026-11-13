import React, { useEffect, useState } from 'react';
import type { Servicio } from '../../lib/types/database.types';

interface StepServiceProps {
  servicioSeleccionado: Servicio | null;
  onSelectServicio: (servicio: Servicio) => void;
  onNext: () => void;
}

export const StepService: React.FC<StepServiceProps> = ({
  servicioSeleccionado,
  onSelectServicio,
  onNext,
}) => {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const cargarServicios = async () => {
    setCargando(true);
    setError(null);
    try {
      let res = await fetch('/api/citas-servicios');
      if (!res.ok && res.status === 404) {
        res = await fetch('/.netlify/functions/citas-servicios');
      }

      if (!res.ok) {
        throw new Error('No fue posible cargar el catálogo de servicios');
      }

      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setServicios(data.filter((s: Servicio) => s.activo));
      } else {
        setServicios([]);
      }
    } catch (err: any) {
      console.error('Error al cargar servicios:', err);
      setError(err?.message || 'Error al conectar con la clínica');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarServicios();
  }, []);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 font-heading">
          1. Selecciona el Servicio
        </h2>
        <p className="text-gray-600 text-sm mt-1">
          Elige el tratamiento o valoración que deseas agendar en Rehabilita Sport.
        </p>
      </div>

      {cargando && (
        <div className="py-16 text-center text-gray-500">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="mt-3 text-sm font-medium">Cargando catálogo oficial de servicios...</p>
        </div>
      )}

      {error && !cargando && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 space-y-2">
          <p className="font-semibold">{error}</p>
          <button
            type="button"
            onClick={cargarServicios}
            className="text-xs font-bold text-blue-600 underline hover:text-blue-800 cursor-pointer"
          >
            Reintentar carga
          </button>
        </div>
      )}

      {!cargando && !error && servicios.length === 0 && (
        <div className="py-12 text-center text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="font-medium text-gray-700">No hay servicios disponibles en este momento.</p>
          <p className="text-xs text-gray-400 mt-1">Por favor contacta a recepción para agendar directamente.</p>
        </div>
      )}

      {!cargando && !error && servicios.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {servicios.map((servicio) => {
            const isSelected = servicioSeleccionado?.id === servicio.id;
            return (
              <button
                key={servicio.id}
                type="button"
                onClick={() => onSelectServicio(servicio)}
                className={`flex flex-col text-left p-5 rounded-xl border-2 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/60 shadow-md ring-2 ring-blue-500/20'
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                }`}
              >
                <div className="flex justify-between items-start w-full">
                  <h3 className="font-bold text-gray-900 text-base sm:text-lg leading-tight font-heading">
                    {servicio.nombre}
                  </h3>
                  {isSelected ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white shrink-0 ml-2">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-gray-300 text-transparent shrink-0 ml-2 group-hover:border-blue-400">
                      •
                    </span>
                  )}
                </div>

                {servicio.descripcion && (
                  <p className="text-sm text-gray-600 mt-2 line-clamp-3 leading-relaxed">
                    {servicio.descripcion}
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 font-medium w-full">
                  <span className="flex items-center gap-1.5 text-gray-700">
                    <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Duración: <strong>{servicio.duracion_minutos} min</strong>
                  </span>
                  <span className={`font-semibold ${isSelected ? 'text-blue-700' : 'text-blue-600'}`}>
                    {isSelected ? 'Seleccionado' : 'Elegir'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex justify-end pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={onNext}
          disabled={!servicioSeleccionado}
          className={`px-6 py-3 rounded-full font-semibold text-white transition-all shadow-md flex items-center gap-2 ${
            servicioSeleccionado
              ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-blue-500/20 hover:scale-[1.02]'
              : 'bg-gray-300 cursor-not-allowed shadow-none'
          }`}
        >
          <span>Continuar con Fecha y Hora</span>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
    </div>
  );
};
