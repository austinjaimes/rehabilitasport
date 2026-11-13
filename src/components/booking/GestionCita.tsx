import React, { useEffect, useState } from 'react';
import type { CitaGestionPayload } from '../../lib/types/booking.types';
import { StepDatePicker } from './StepDatePicker';
import { StepTimeSlots } from './StepTimeSlots';

export const GestionCita: React.FC = () => {
  const [token, setToken] = useState<string>('');
  const [cita, setCita] = useState<CitaGestionPayload | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // Estados de Reprogramación
  const [modoReprogramar, setModoReprogramar] = useState<boolean>(false);
  const [nuevaFecha, setNuevaFecha] = useState<string | null>(null);
  const [nuevaHora, setNuevaHora] = useState<string | null>(null);
  const [reprogramando, setReprogramando] = useState<boolean>(false);
  const [errorReprogramar, setErrorReprogramar] = useState<string | null>(null);

  // Estados de Cancelación
  const [modoCancelar, setModoCancelar] = useState<boolean>(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState<string>('');
  const [cancelando, setCancelando] = useState<boolean>(false);
  const [errorCancelar, setErrorCancelar] = useState<string | null>(null);

  // 1. Extraer token del fragmento de URL (#token=...)
  useEffect(() => {
    function extraerToken() {
      if (typeof window === 'undefined') return;
      const hash = window.location.hash;
      const match = hash.match(/token=([a-f0-9]{64})/i);
      if (match && match[1]) {
        setToken(match[1]);
      } else {
        setCargando(false);
      }
    }
    extraerToken();
    window.addEventListener('hashchange', extraerToken);
    return () => window.removeEventListener('hashchange', extraerToken);
  }, []);

  // 2. Consultar cita cuando se dispone del token
  const consultarCita = async (tokenConsultar: string) => {
    setCargando(true);
    setError(null);
    try {
      let res = await fetch('/api/citas-consultar', {
        headers: {
          'Authorization': `Bearer ${tokenConsultar}`,
        },
      });

      if (!res.ok && res.status === 404) {
        res = await fetch('/.netlify/functions/citas-consultar', {
          headers: {
            'Authorization': `Bearer ${tokenConsultar}`,
          },
        });
      }

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('No se encontró ninguna cita asociada a este enlace o el plazo de gestión ha vencido.');
        } else if (res.status === 429) {
          throw new Error('Límite de consultas excedido por seguridad. Espera un momento antes de volver a consultar.');
        } else {
          throw new Error('Error al consultar la cita. Verifica que el enlace sea correcto.');
        }
      }

      const data = await res.json();
      setCita(data);
    } catch (err: any) {
      console.error('Error al consultar cita:', err);
      setError(err?.message || 'Error de conexión');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (token) {
      consultarCita(token);
    }
  }, [token]);

  // 3. Ejecutar Reprogramación
  const handleReprogramar = async () => {
    if (!nuevaFecha || !nuevaHora || !token) return;

    setReprogramando(true);
    setErrorReprogramar(null);

    try {
      let res = await fetch('/api/citas-reprogramar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          nuevaFecha,
          nuevaHoraInicio: nuevaHora,
        }),
      });

      if (!res.ok && res.status === 404) {
        res = await fetch('/.netlify/functions/citas-reprogramar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            nuevaFecha,
            nuevaHoraInicio: nuevaHora,
          }),
        });
      }

      const data = await res.json();

      if (!res.ok || data.success === false) {
        if (res.status === 409 || data.code === 'HORARIO_OCUPADO') {
          throw new Error('El nuevo horario elegido acaba de ser ocupado. Por favor selecciona otro.');
        } else if (res.status === 429) {
          throw new Error('Límite de solicitudes de reprogramación alcanzado. Espera unos minutos.');
        } else {
          throw new Error(data.message || 'Error al reprogramar la cita.');
        }
      }

      // Rotación de token en el fragmento de URL
      if (data.nuevoTokenPlano) {
        setToken(data.nuevoTokenPlano);
        if (typeof window !== 'undefined') {
          window.location.hash = `#token=${data.nuevoTokenPlano}`;
        }
      }

      setMensajeExito(`¡Tu cita ha sido reprogramada exitosamente para el ${nuevaFecha} a las ${nuevaHora}!`);
      setModoReprogramar(false);
      setNuevaFecha(null);
      setNuevaHora(null);

      // Actualizar datos locales de la cita
      if (cita) {
        setCita({
          ...cita,
          fecha: nuevaFecha,
          horaInicio: nuevaHora,
          horaFin: data.nueva_hora_fin ? data.nueva_hora_fin.slice(0, 5) : cita.horaFin,
        });
      }
    } catch (err: any) {
      console.error('Error al reprogramar:', err);
      setErrorReprogramar(err?.message || 'Error al procesar la reprogramación');
    } finally {
      setReprogramando(false);
    }
  };

  // 4. Ejecutar Cancelación
  const handleCancelar = async () => {
    if (!token) return;

    setCancelando(true);
    setErrorCancelar(null);

    try {
      let res = await fetch('/api/citas-cancelar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          motivo: motivoCancelacion.trim() || 'Cancelado por el paciente desde el portal web',
        }),
      });

      if (!res.ok && res.status === 404) {
        res = await fetch('/.netlify/functions/citas-cancelar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            motivo: motivoCancelacion.trim() || 'Cancelado por el paciente desde el portal web',
          }),
        });
      }

      const data = await res.json();

      if (!res.ok || data.success === false) {
        if (res.status === 429) {
          throw new Error('Límite de solicitudes alcanzado. Espera unos minutos.');
        }
        throw new Error(data.message || 'Error al cancelar la cita');
      }

      setMensajeExito('Tu cita ha sido cancelada. El horario ha quedado liberado en la clínica.');
      setModoCancelar(false);

      if (cita) {
        setCita({
          ...cita,
          estado: 'cancelada',
        });
      }
    } catch (err: any) {
      console.error('Error al cancelar:', err);
      setErrorCancelar(err?.message || 'Error al procesar la cancelación');
    } finally {
      setCancelando(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      <div className="bg-white rounded-2xl shadow-xl shadow-blue-900/5 border border-gray-100 p-6 sm:p-8 space-y-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
            Portal de Autoservicio
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mt-2 font-heading">
            Gestión de tu Cita Médica
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            Revisa los detalles de tu cita, reprograma tu horario o cancela si no podrás asistir.
          </p>
        </div>

        {/* Mensaje de Éxito */}
        {mensajeExito && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 flex items-start gap-2.5">
            <svg className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            <div className="flex-1">
              <p className="font-bold">Acción completada</p>
              <p className="text-xs text-emerald-700 mt-0.5">{mensajeExito}</p>
            </div>
            <button
              type="button"
              onClick={() => setMensajeExito(null)}
              className="text-xs text-emerald-600 hover:text-emerald-900 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Sin Token en URL */}
        {!token && !cargando && (
          <div className="p-6 bg-amber-50/60 border border-amber-200 rounded-xl text-center space-y-3">
            <svg className="mx-auto h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <h3 className="font-bold text-gray-900 text-base">Enlace de Gestión Requerido</h3>
            <p className="text-xs text-gray-600 max-w-md mx-auto">
              Para gestionar tu cita necesitas el enlace privado que recibiste al confirmar tu reservación (ejemplo: <code>/gestionar-cita#token=...</code>).
            </p>
            <div className="pt-2">
              <a
                href="/reservar"
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-md shadow-blue-500/20"
              >
                <span>Agendar una nueva cita</span> &rarr;
              </a>
            </div>
          </div>
        )}

        {/* Cargando */}
        {cargando && (
          <div className="py-16 text-center text-gray-500">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
            <p className="mt-3 text-sm font-medium">Localizando tu cita médica...</p>
          </div>
        )}

        {/* Error de Carga */}
        {error && !cargando && (
          <div className="p-5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 space-y-2">
            <p className="font-bold">{error}</p>
            <p className="text-xs text-red-600">
              Si consideras que es un error, por favor comunícate directamente con la recepción de la clínica.
            </p>
          </div>
        )}

        {/* Tarjeta de Detalles de la Cita */}
        {cita && !cargando && (
          <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
            {/* Encabezado con Estado */}
            <div className="p-5 bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Folio Oficial</span>
                <div className="text-2xl font-mono font-extrabold text-gray-900">
                  {cita.codigoReserva}
                </div>
              </div>
              <div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  cita.estado === 'confirmada'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : cita.estado === 'cancelada'
                    ? 'bg-red-100 text-red-800 border border-red-300'
                    : 'bg-blue-100 text-blue-800 border border-blue-300'
                }`}>
                  <span className={`h-2 w-2 rounded-full ${
                    cita.estado === 'confirmada' ? 'bg-emerald-600' : cita.estado === 'cancelada' ? 'bg-red-600' : 'bg-blue-600'
                  }`}></span>
                  {cita.estado}
                </span>
              </div>
            </div>

            {/* Datos Principales */}
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs text-gray-500 block">Paciente</span>
                <strong className="text-gray-900 text-base">{cita.nombrePaciente}</strong>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Tratamiento</span>
                <strong className="text-gray-900 text-base">{cita.nombreServicio}</strong>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Fecha Agendada</span>
                <strong className="text-blue-700 text-base">{cita.fecha}</strong>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Horario</span>
                <strong className="text-blue-700 text-base">
                  {cita.horaInicio} - {cita.horaFin} hrs
                </strong>
                <span className="text-xs text-gray-400 block mt-0.5">({cita.duracionMinutos} minutos)</span>
              </div>
            </div>

            {/* Acciones de Gestión (Disponibles solo si está confirmada) */}
            {cita.estado === 'confirmada' && !modoReprogramar && !modoCancelar && (
              <div className="p-5 bg-gray-50 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setModoReprogramar(true)}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition cursor-pointer shadow-sm shadow-blue-500/20 text-center"
                >
                  Reprogramar Fecha u Horario
                </button>
                <button
                  type="button"
                  onClick={() => setModoCancelar(true)}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-600 font-bold text-sm transition cursor-pointer text-center"
                >
                  Cancelar Cita
                </button>
              </div>
            )}
          </div>
        )}

        {/* SECCIÓN REPROGRAMAR */}
        {modoReprogramar && cita && (
          <div className="p-5 border-2 border-blue-200 rounded-xl bg-blue-50/20 space-y-5 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-base">
                Selecciona tu Nueva Fecha y Horario
              </h3>
              <button
                type="button"
                onClick={() => setModoReprogramar(false)}
                className="text-xs text-gray-500 hover:text-gray-800 font-bold"
              >
                Cerrar
              </button>
            </div>

            {errorReprogramar && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {errorReprogramar}
              </div>
            )}

            <StepDatePicker
              fechaSeleccionada={nuevaFecha}
              onSelectFecha={(f) => {
                setNuevaFecha(f);
                setNuevaHora(null);
              }}
            />

            {nuevaFecha && (
              <StepTimeSlots
                fechaSeleccionada={nuevaFecha}
                duracionMinutos={cita.duracionMinutos}
                horaSeleccionada={nuevaHora}
                onSelectHora={setNuevaHora}
              />
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModoReprogramar(false)}
                disabled={reprogramando}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReprogramar}
                disabled={!nuevaFecha || !nuevaHora || reprogramando}
                className={`px-5 py-2 rounded-lg font-bold text-white text-xs transition flex items-center gap-1.5 ${
                  nuevaFecha && nuevaHora && !reprogramando
                    ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-md shadow-blue-500/20'
                    : 'bg-gray-300 cursor-not-allowed'
                }`}
              >
                {reprogramando ? 'Guardando cambios...' : 'Confirmar Reprogramación'}
              </button>
            </div>
          </div>
        )}

        {/* SECCIÓN CANCELAR */}
        {modoCancelar && cita && (
          <div className="p-5 border-2 border-red-200 rounded-xl bg-red-50/20 space-y-4 animate-fadeIn">
            <h3 className="font-bold text-red-900 text-base">
              ¿Estás seguro de cancelar tu cita?
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Esta acción liberará tu espacio en la agenda de la clínica y no podrá deshacerse. Si lo deseas, puedes dejarnos el motivo de tu cancelación:
            </p>

            {errorCancelar && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {errorCancelar}
              </div>
            )}

            <textarea
              value={motivoCancelacion}
              onChange={(e) => setMotivoCancelacion(e.target.value)}
              placeholder="Motivo opcional (ej. Imprevisto laboral, viaje, mejoría de síntomas...)"
              rows={3}
              className="w-full p-3 rounded-lg border border-gray-300 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
            />

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModoCancelar(false)}
                disabled={cancelando}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 cursor-pointer"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleCancelar}
                disabled={cancelando}
                className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer shadow-md shadow-red-500/20"
              >
                {cancelando ? 'Cancelando...' : 'Sí, Cancelar Definitivamente'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

