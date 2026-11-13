import React, { useState, useEffect } from 'react';

export interface ServicioFormData {
  id?: string;
  nombre: string;
  descripcion?: string | null;
  duracionMinutos: number;
  activo: boolean;
  orden: number;
}

interface ServicioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (servicio: ServicioFormData) => Promise<void>;
  servicioAEditar?: ServicioFormData | null;
  procesando: boolean;
  error?: string | null;
}

const DURACIONES_COMUNES = [15, 30, 45, 60, 90, 120, 180, 240];

export const ServicioModal: React.FC<ServicioModalProps> = ({
  isOpen,
  onClose,
  onSave,
  servicioAEditar,
  procesando,
  error = null,
}) => {
  const [nombre, setNombre] = useState<string>(servicioAEditar?.nombre || '');
  const [descripcion, setDescripcion] = useState<string>(servicioAEditar?.descripcion || '');
  const [duracionMinutos, setDuracionMinutos] = useState<number>(servicioAEditar?.duracionMinutos || 60);
  const [activo, setActivo] = useState<boolean>(servicioAEditar?.activo ?? true);
  const [orden, setOrden] = useState<number>(servicioAEditar?.orden ?? 0);
  const [errorLocal, setErrorLocal] = useState<string | null>(error || null);

  // Inicializar o limpiar campos al abrir el modal
  useEffect(() => {
    if (isOpen) {
      if (servicioAEditar) {
        setNombre(servicioAEditar.nombre || '');
        setDescripcion(servicioAEditar.descripcion || '');
        setDuracionMinutos(servicioAEditar.duracionMinutos || 60);
        setActivo(servicioAEditar.activo ?? true);
        setOrden(servicioAEditar.orden ?? 0);
      } else {
        setNombre('');
        setDescripcion('');
        setDuracionMinutos(60);
        setActivo(true);
        setOrden(0);
      }
      setErrorLocal(error || null);
    }
  }, [isOpen, servicioAEditar, error]);

  // Manejo de teclado: Cerrar modal con tecla Escape si no está guardando
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

  const esEdicion = Boolean(servicioAEditar && servicioAEditar.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nombreLimpio = nombre.trim();

    if (!nombreLimpio) {
      setErrorLocal('El nombre del servicio es obligatorio.');
      return;
    }

    if (nombreLimpio.length > 120) {
      setErrorLocal('El nombre del servicio no debe exceder los 120 caracteres.');
      return;
    }

    if (descripcion.trim().length > 500) {
      setErrorLocal('La descripción no debe exceder los 500 caracteres.');
      return;
    }

    if (isNaN(duracionMinutos) || duracionMinutos < 15 || duracionMinutos > 480) {
      setErrorLocal('La duración debe estar entre 15 y 480 minutos.');
      return;
    }

    if (isNaN(orden) || orden < 0) {
      setErrorLocal('El orden debe ser un número entero mayor o igual a cero.');
      return;
    }

    setErrorLocal(null);

    try {
      await onSave({
        id: servicioAEditar?.id,
        nombre: nombreLimpio,
        descripcion: descripcion.trim() || null,
        duracionMinutos,
        activo,
        orden: Math.floor(orden),
      });
    } catch (err: any) {
      setErrorLocal(err?.details?.error || err?.message || 'Error al guardar el servicio.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-servicio-modal"
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h3 id="titulo-servicio-modal" className="text-base font-bold text-slate-900 font-heading">
                {esEdicion ? 'Editar Servicio' : 'Nuevo Servicio'}
              </h3>
              <p className="text-xs text-slate-500">
                {esEdicion ? 'Actualice la información del catálogo clínico' : 'Agregue una nueva especialidad médica o de terapia'}
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
          {/* Nombre */}
          <div>
            <div className="flex justify-between items-center">
              <label htmlFor="nombre-servicio" className="block font-bold text-slate-700">
                Nombre del Servicio <span className="text-rose-500">*</span>
              </label>
              <span className={`text-[10px] font-mono ${nombre.length > 120 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                {nombre.length} / 120
              </span>
            </div>
            <input
              type="text"
              id="nombre-servicio"
              name="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Fisioterapia Deportiva Avanzada"
              disabled={procesando}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition disabled:opacity-50"
              required
            />
          </div>

          {/* Descripción */}
          <div>
            <div className="flex justify-between items-center">
              <label htmlFor="descripcion-servicio" className="block font-bold text-slate-700">
                Descripción Clínica <span className="text-slate-400 font-normal">(Opcional)</span>
              </label>
              <span className={`text-[10px] font-mono ${descripcion.length > 500 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                {descripcion.length} / 500
              </span>
            </div>
            <textarea
              id="descripcion-servicio"
              name="descripcion"
              rows={3}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Detalle de los objetivos de la sesión, procedimientos o perfil de paciente..."
              disabled={procesando}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition resize-none disabled:opacity-50"
            />
          </div>

          {/* Duración y Orden */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="duracion-servicio" className="block font-bold text-slate-700">
                Duración (Minutos) <span className="text-rose-500">*</span>
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  id="duracion-servicio"
                  name="duracionMinutos"
                  min={15}
                  max={480}
                  step={5}
                  value={duracionMinutos}
                  onChange={(e) => setDuracionMinutos(parseInt(e.target.value, 10) || 60)}
                  disabled={procesando}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition disabled:opacity-50"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {DURACIONES_COMUNES.slice(0, 4).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuracionMinutos(d)}
                    disabled={procesando}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold border transition cursor-pointer ${
                      duracionMinutos === d
                        ? 'bg-blue-50 text-blue-700 border-blue-300'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="orden-servicio" className="block font-bold text-slate-700">
                Orden de Despliegue
              </label>
              <input
                type="number"
                id="orden-servicio"
                name="orden"
                min={0}
                value={orden}
                onChange={(e) => setOrden(parseInt(e.target.value, 10) || 0)}
                disabled={procesando}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition disabled:opacity-50"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Menor número aparece primero
              </span>
            </div>
          </div>

          {/* Activo / Inactivo */}
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/80 flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-800 block">Servicio Activo para Reservas</span>
              <span className="text-[11px] text-slate-500 block">
                Los servicios inactivos no se muestran a los pacientes en el portal público
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                name="activo"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                disabled={procesando}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Mensaje de Error Local o del Servidor */}
          {(errorLocal || error) && (
            <div role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200 animate-in fade-in">
              {errorLocal || error}
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
              disabled={procesando || !nombre.trim() || nombre.length > 120}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 text-xs font-bold text-white hover:bg-blue-800 transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              {procesando ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>Guardando...</span>
                </>
              ) : (
                <span>{esEdicion ? 'Actualizar Servicio' : 'Crear Servicio'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
