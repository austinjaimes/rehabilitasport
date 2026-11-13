import React, { useState } from 'react';
import type { Servicio } from '../../lib/types/database.types';
import type { ReservaResponsePayload } from '../../lib/types/booking.types';
import { StepService } from './StepService';
import { StepDatePicker } from './StepDatePicker';
import { StepTimeSlots } from './StepTimeSlots';
import { StepPatientForm } from './StepPatientForm';
import { StepSummary } from './StepSummary';
import { StepSuccess } from './StepSuccess';

const PASOS = [
  { id: 1, titulo: 'Servicio' },
  { id: 2, titulo: 'Fecha' },
  { id: 3, titulo: 'Horario' },
  { id: 4, titulo: 'Tus Datos' },
  { id: 5, titulo: 'Confirmar' },
];

export const BookingWizard: React.FC = () => {
  const [pasoActual, setPasoActual] = useState<number>(1);
  const [servicioSeleccionado, setServicioSeleccionado] = useState<Servicio | null>(null);
  const [fechaSeleccionada, setFechaSeleccionada] = useState<string | null>(null);
  const [horaSeleccionada, setHoraSeleccionada] = useState<string | null>(null);
  // Rastreo seguro: inicia en 'pendiente' para bloquear confirmaciones no verificadas
  const [modoDisponibilidad, setModoDisponibilidad] = useState<'pendiente' | 'real' | 'simulado_dev'>('pendiente');

  // Datos del paciente
  const [nombreCompleto, setNombreCompleto] = useState<string>('');
  const [telefonoWhatsApp, setTelefonoWhatsApp] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [consentimientoWhatsApp, setConsentimientoWhatsApp] = useState<boolean>(false);

  // Estados de envío y respuesta
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultadoReserva, setResultadoReserva] = useState<ReservaResponsePayload | null>(null);

  // Navegación entre pasos
  const handleSelectServicio = (servicio: Servicio) => {
    setServicioSeleccionado(servicio);
  };

  const handleSelectFecha = (fecha: string) => {
    setFechaSeleccionada(fecha);
    // Al cambiar la fecha, se reinicia la hora y el modo para forzar nueva validación
    setHoraSeleccionada(null);
    setModoDisponibilidad('pendiente');
  };

  const handleSelectHora = (hora: string) => {
    setHoraSeleccionada(hora);
  };

  const handleConfirmarReserva = async () => {
    // Bloqueo estricto si no es una confirmación de disponibilidad real verificada
    if (modoDisponibilidad !== 'real') {
      if (modoDisponibilidad === 'simulado_dev') {
        setSubmitError(
          'Confirmación Bloqueada: La disponibilidad actual es simulada porque la base de datos de Supabase no está conectada o no ha sido inicializada. No es posible generar citas oficiales sin base de datos activa.'
        );
      } else {
        setSubmitError(
          'Confirmación Bloqueada: La disponibilidad no ha sido verificada contra la base de datos oficial. Por favor selecciona un horario válido antes de confirmar.'
        );
      }
      return;
    }

    if (!servicioSeleccionado || !fechaSeleccionada || !horaSeleccionada || !nombreCompleto || !telefonoWhatsApp) {
      setSubmitError('Por favor completa todos los campos requeridos antes de confirmar.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const payload = {
      servicioId: servicioSeleccionado.id,
      fecha: fechaSeleccionada,
      horaInicio: horaSeleccionada,
      nombreCompleto: nombreCompleto.trim(),
      telefonoWhatsApp: telefonoWhatsApp.replace(/\D/g, '').slice(-10),
      email: email.trim() ? email.trim().toLowerCase() : undefined,
      consentimientoWhatsApp,
    };

    try {
      let res = await fetch('/api/citas-reservar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok && res.status === 404) {
        res = await fetch('/.netlify/functions/citas-reservar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();

      if (!res.ok || data.success === false) {
        if (res.status === 409 || data.code === 'HORARIO_OCUPADO') {
          throw new Error('El horario que elegiste acaba de ser ocupado por otra persona. Por favor selecciona otro horario disponible.');
        } else if (res.status === 429) {
          throw new Error('Has realizado varios intentos recientes. Por favor espera 5 minutos antes de volver a reservar.');
        } else {
          throw new Error(data.message || data.error || 'Ocurrió un error al registrar la cita.');
        }
      }

      setResultadoReserva(data);
      setPasoActual(6); // Pantalla de éxito
    } catch (err: any) {
      console.error('Error al confirmar reserva:', err);
      setSubmitError(err?.message || 'Error de conexión. Por favor intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setPasoActual(1);
    setServicioSeleccionado(null);
    setFechaSeleccionada(null);
    setHoraSeleccionada(null);
    setNombreCompleto('');
    setTelefonoWhatsApp('');
    setEmail('');
    setConsentimientoWhatsApp(false);
    setSubmitError(null);
    setResultadoReserva(null);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
      {/* Barra de Progreso (Visible en pasos 1 a 5) */}
      {pasoActual <= 5 && (
        <div className="mb-8">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-gray-200 w-full -z-0"></div>
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-blue-600 transition-all duration-300 -z-0"
              style={{ width: `${((pasoActual - 1) / (PASOS.length - 1)) * 100}%` }}
            ></div>

            {PASOS.map((paso) => {
              const isCompleted = pasoActual > paso.id;
              const isCurrent = pasoActual === paso.id;
              return (
                <div key={paso.id} className="flex flex-col items-center z-10">
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                      isCompleted
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                        : isCurrent
                        ? 'bg-white border-2 border-blue-600 text-blue-600 shadow-md ring-4 ring-blue-100 scale-110'
                        : 'bg-white border-2 border-gray-300 text-gray-400'
                    }`}
                  >
                    {isCompleted ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      paso.id
                    )}
                  </div>
                  <span
                    className={`text-[11px] font-medium mt-1.5 hidden sm:block ${
                      isCurrent ? 'text-blue-700 font-bold' : isCompleted ? 'text-gray-700' : 'text-gray-400'
                    }`}
                  >
                    {paso.titulo}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Contenido de cada Paso */}
      <div className="bg-white rounded-2xl shadow-xl shadow-blue-900/5 border border-gray-100 p-6 sm:p-8">
        {/* PASO 1: Selección de Servicio */}
        {pasoActual === 1 && (
          <StepService
            servicioSeleccionado={servicioSeleccionado}
            onSelectServicio={handleSelectServicio}
            onNext={() => setPasoActual(2)}
          />
        )}

        {/* PASO 2: Selección de Fecha */}
        {pasoActual === 2 && (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 font-heading">
                2. Selecciona la Fecha
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                Servicio: <strong>{servicioSeleccionado?.nombre}</strong> ({servicioSeleccionado?.duracion_minutos} min)
              </p>
            </div>

            <StepDatePicker
              fechaSeleccionada={fechaSeleccionada}
              onSelectFecha={handleSelectFecha}
            />

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setPasoActual(1)}
                className="px-5 py-2.5 rounded-full font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 transition cursor-pointer text-sm"
              >
                &larr; Cambiar Servicio
              </button>

              <button
                type="button"
                onClick={() => setPasoActual(3)}
                disabled={!fechaSeleccionada}
                className={`px-6 py-3 rounded-full font-semibold text-white transition-all shadow-md flex items-center gap-2 text-sm ${
                  fechaSeleccionada
                    ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-blue-500/20 hover:scale-[1.02]'
                    : 'bg-gray-300 cursor-not-allowed shadow-none'
                }`}
              >
                <span>Consultar Horarios</span>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* PASO 3: Selección de Horario */}
        {pasoActual === 3 && (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 font-heading">
                3. Selecciona tu Horario
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                Fecha elegida: <strong>{fechaSeleccionada}</strong> • Tratamiento: <strong>{servicioSeleccionado?.nombre}</strong>
              </p>
            </div>

            <StepTimeSlots
              fechaSeleccionada={fechaSeleccionada!}
              duracionMinutos={servicioSeleccionado?.duracion_minutos || 60}
              horaSeleccionada={horaSeleccionada}
              onSelectHora={handleSelectHora}
              onModoDisponibilidadChange={setModoDisponibilidad}
            />

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setPasoActual(2)}
                className="px-5 py-2.5 rounded-full font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 transition cursor-pointer text-sm"
              >
                &larr; Cambiar Fecha
              </button>

              <button
                type="button"
                onClick={() => setPasoActual(4)}
                disabled={!horaSeleccionada}
                className={`px-6 py-3 rounded-full font-semibold text-white transition-all shadow-md flex items-center gap-2 text-sm ${
                  horaSeleccionada
                    ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-blue-500/20 hover:scale-[1.02]'
                    : 'bg-gray-300 cursor-not-allowed shadow-none'
                }`}
              >
                <span>Ingresar Mis Datos</span>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* PASO 4: Formulario del Paciente */}
        {pasoActual === 4 && (
          <StepPatientForm
            nombreCompleto={nombreCompleto}
            telefonoWhatsApp={telefonoWhatsApp}
            email={email}
            consentimientoWhatsApp={consentimientoWhatsApp}
            onChangeNombre={setNombreCompleto}
            onChangeTelefono={setTelefonoWhatsApp}
            onChangeEmail={setEmail}
            onChangeConsentimiento={setConsentimientoWhatsApp}
            onBack={() => setPasoActual(3)}
            onNext={() => setPasoActual(5)}
          />
        )}

        {/* PASO 5: Resumen y Confirmación */}
        {pasoActual === 5 && servicioSeleccionado && fechaSeleccionada && horaSeleccionada && (
          <StepSummary
            servicio={servicioSeleccionado}
            fecha={fechaSeleccionada}
            horaInicio={horaSeleccionada}
            nombreCompleto={nombreCompleto}
            telefonoWhatsApp={telefonoWhatsApp}
            email={email}
            consentimientoWhatsApp={consentimientoWhatsApp}
            isSubmitting={isSubmitting}
            submitError={submitError}
            onConfirm={handleConfirmarReserva}
            onBack={() => setPasoActual(4)}
            onChangeStep={(paso) => setPasoActual(paso)}
            confirmacionBloqueada={modoDisponibilidad !== 'real'}
            motivoBloqueo={modoDisponibilidad === 'real' ? null : modoDisponibilidad}
          />
        )}

        {/* PASO 6: Pantalla de Confirmación Exitosa */}
        {pasoActual === 6 && resultadoReserva && (
          <StepSuccess
            resultado={resultadoReserva}
            nombrePaciente={nombreCompleto}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
};
