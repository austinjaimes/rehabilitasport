import React, { useState } from 'react';

interface StepPatientFormProps {
  nombreCompleto: string;
  telefonoWhatsApp: string;
  email: string;
  consentimientoWhatsApp: boolean;
  onChangeNombre: (valor: string) => void;
  onChangeTelefono: (valor: string) => void;
  onChangeEmail: (valor: string) => void;
  onChangeConsentimiento: (valor: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

export const StepPatientForm: React.FC<StepPatientFormProps> = ({
  nombreCompleto,
  telefonoWhatsApp,
  email,
  consentimientoWhatsApp,
  onChangeNombre,
  onChangeTelefono,
  onChangeEmail,
  onChangeConsentimiento,
  onBack,
  onNext,
}) => {
  const [errores, setErrores] = useState<{ [key: string]: string }>({});

  const validarFormulario = (): boolean => {
    const nuevosErrores: { [key: string]: string } = {};

    if (!nombreCompleto.trim() || nombreCompleto.trim().length < 3) {
      nuevosErrores.nombre = 'Ingresa el nombre completo del paciente (mínimo 3 letras).';
    }

    const cleanPhone = telefonoWhatsApp.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      nuevosErrores.telefono = 'El teléfono debe contener exactamente 10 dígitos (ej. 7331234567).';
    }

    if (email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        nuevosErrores.email = 'El formato de correo electrónico no es válido.';
      }
    }

    setErrores(nuevosErrores);
    return Object.keys(nuevosErrores).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validarFormulario()) {
      onNext();
    }
  };

  const handleTelefonoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Permitir solo dígitos y limitar a 10
    const raw = e.target.value.replace(/\D/g, '').slice(0, 10);
    onChangeTelefono(raw);
    if (errores.telefono && raw.length === 10) {
      setErrores((prev) => ({ ...prev, telefono: '' }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 font-heading">
          4. Datos del Paciente
        </h2>
        <p className="text-gray-600 text-sm mt-1">
          Ingresa la información de contacto para registrar y asegurar tu cita médica.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 shadow-sm space-y-5">
        {/* Nombre Completo */}
        <div>
          <label htmlFor="nombreCompleto" className="block text-sm font-bold text-gray-700 mb-1">
            Nombre Completo del Paciente <span className="text-red-500">*</span>
          </label>
          <input
            id="nombreCompleto"
            type="text"
            value={nombreCompleto}
            onChange={(e) => {
              onChangeNombre(e.target.value);
              if (errores.nombre) setErrores((prev) => ({ ...prev, nombre: '' }));
            }}
            placeholder="Ej. María Fernández González"
            className={`w-full px-4 py-2.5 rounded-lg border text-sm text-gray-900 focus:outline-none focus:ring-2 transition ${
              errores.nombre
                ? 'border-red-400 focus:ring-red-300 bg-red-50/20'
                : 'border-gray-300 focus:ring-blue-500/30 focus:border-blue-500'
            }`}
          />
          {errores.nombre && (
            <p className="text-xs text-red-600 mt-1 font-medium">{errores.nombre}</p>
          )}
        </div>

        {/* Teléfono WhatsApp */}
        <div>
          <label htmlFor="telefonoWhatsApp" className="block text-sm font-bold text-gray-700 mb-1">
            Teléfono Móvil (10 dígitos) <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-sm font-medium text-gray-500">
              🇲🇽 +52
            </span>
            <input
              id="telefonoWhatsApp"
              type="tel"
              inputMode="numeric"
              value={telefonoWhatsApp}
              onChange={handleTelefonoChange}
              placeholder="733 123 4567"
              className={`w-full pl-16 pr-4 py-2.5 rounded-lg border text-sm text-gray-900 tracking-wider focus:outline-none focus:ring-2 transition ${
                errores.telefono
                  ? 'border-red-400 focus:ring-red-300 bg-red-50/20'
                  : 'border-gray-300 focus:ring-blue-500/30 focus:border-blue-500'
              }`}
            />
          </div>
          {errores.telefono ? (
            <p className="text-xs text-red-600 mt-1 font-medium">{errores.telefono}</p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              Ingresa tu número a 10 dígitos sin espacios ni guiones.
            </p>
          )}
        </div>

        {/* Correo Electrónico (Opcional) */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor="email" className="block text-sm font-bold text-gray-700">
              Correo Electrónico
            </label>
            <span className="text-xs text-gray-400">Opcional</span>
          </div>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              onChangeEmail(e.target.value);
              if (errores.email) setErrores((prev) => ({ ...prev, email: '' }));
            }}
            placeholder="ejemplo@correo.com"
            className={`w-full px-4 py-2.5 rounded-lg border text-sm text-gray-900 focus:outline-none focus:ring-2 transition ${
              errores.email
                ? 'border-red-400 focus:ring-red-300 bg-red-50/20'
                : 'border-gray-300 focus:ring-blue-500/30 focus:border-blue-500'
            }`}
          />
          {errores.email && (
            <p className="text-xs text-red-600 mt-1 font-medium">{errores.email}</p>
          )}
          <p className="text-xs text-gray-500 mt-1">
            Si lo proporcionas, podrás recibir un recordatorio adicional de tu cita.
          </p>
        </div>

        {/* Consentimiento Voluntario de WhatsApp (DEFAULT: FALSE / DESMARCADA) */}
        <div className="pt-2 border-t border-gray-100">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={consentimientoWhatsApp}
              onChange={(e) => onChangeConsentimiento(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <div className="text-xs text-gray-700 leading-relaxed">
              <span className="font-semibold text-gray-900">
                Deseo recibir confirmación y recordatorios de mi cita por WhatsApp.
              </span>
              <p className="text-gray-500 mt-0.5">
                (Opcional). Al marcar esta casilla autorizas a Rehabilita Sport a enviarte mensajes relacionados estrictamente con tu cita. Si prefieres no recibir mensajes, tu cita se confirmará igualmente y podrás consultarla en este portal web con tu folio de reserva.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 rounded-full font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 transition cursor-pointer text-sm"
        >
          &larr; Cambiar Horario
        </button>

        <button
          type="submit"
          className="px-6 py-3 rounded-full font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition cursor-pointer text-sm flex items-center gap-2 hover:scale-[1.02]"
        >
          <span>Revisar Resumen</span>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
    </form>
  );
};

