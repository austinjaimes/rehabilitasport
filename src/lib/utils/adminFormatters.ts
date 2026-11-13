export type EstadoCitaAdmin = 'confirmada' | 'atendida' | 'cancelada' | 'no_asistio';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const MESES_CORTOS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

const DIAS_SEMANA = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'
];

/**
 * Formatea una hora en formato militar 'HH:MM:SS' o 'HH:MM' a formato 12 horas con AM/PM.
 */
export function formatearHora12h(hora24: string): string {
  if (!hora24) return '--:--';
  const parts = hora24.split(':');
  if (parts.length < 2) return hora24;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  if (isNaN(h)) return hora24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const hDisplay = h < 10 ? `0${h}` : `${h}`;
  return `${hDisplay}:${m} ${ampm}`;
}

/**
 * Formatea una fecha gregoriana UTC 'YYYY-MM-DD' a formato largo en español:
 * Ej: "Lunes, 9 de Noviembre de 2026"
 */
export function formatearFechaLarga(fechaStr: string): string {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return fechaStr;
  const [añoStr, mesStr, diaStr] = fechaStr.split('-');
  const año = parseInt(añoStr, 10);
  const mesIdx = parseInt(mesStr, 10) - 1;
  const dia = parseInt(diaStr, 10);

  const fechaObj = new Date(Date.UTC(año, mesIdx, dia));
  const diaSemana = DIAS_SEMANA[fechaObj.getUTCDay()];
  const nombreMes = MESES[mesIdx];

  return `${diaSemana}, ${dia} de ${nombreMes} de ${año}`;
}

/**
 * Formatea una fecha 'YYYY-MM-DD' a formato corto latinoamericano 'DD/MM/YYYY'.
 */
export function formatearFechaCorta(fechaStr: string): string {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return fechaStr;
  const [año, mes, dia] = fechaStr.split('-');
  return `${dia}/${mes}/${año}`;
}

/**
 * Formatea una fecha 'YYYY-MM-DD' a formato compacto 'DD Mes' (ej: "8 Nov").
 */
export function formatearDiaMes(fechaStr: string): string {
  if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return fechaStr;
  const [, mesStr, diaStr] = fechaStr.split('-');
  const mesIdx = parseInt(mesStr, 10) - 1;
  const dia = parseInt(diaStr, 10);
  return `${dia} ${MESES_CORTOS[mesIdx]}`;
}

/**
 * Retorna la fecha local actual de hoy en formato gregoriano UTC 'YYYY-MM-DD'.
 */
export function obtenerFechaHoyISO(): string {
  const d = new Date();
  const año = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${año}-${mes}-${dia}`;
}

/**
 * Obtiene la configuración visual (etiqueta, estilos Tailwind) para cada estado de cita.
 */
export function obtenerConfiguracionEstado(estado: EstadoCitaAdmin | string): {
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  switch (estado) {
    case 'confirmada':
      return {
        label: 'Confirmada',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-600/20',
        dotClass: 'bg-emerald-500',
      };
    case 'atendida':
      return {
        label: 'Atendida',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 ring-blue-600/20',
        dotClass: 'bg-blue-500',
      };
    case 'cancelada':
      return {
        label: 'Cancelada',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 ring-rose-600/20',
        dotClass: 'bg-rose-500',
      };
    case 'no_asistio':
      return {
        label: 'No asistió',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-600/20',
        dotClass: 'bg-amber-500',
      };
    default:
      return {
        label: estado,
        badgeClass: 'bg-slate-50 text-slate-700 border-slate-200 ring-slate-600/20',
        dotClass: 'bg-slate-400',
      };
  }
}

/**
 * Genera un enlace de contacto directo de WhatsApp para el paciente.
 */
export function generarEnlaceWhatsApp(telefono: string, nombrePaciente?: string, codigoReserva?: string): string {
  if (!telefono) return '#';
  // Limpiar caracteres no numéricos
  const cleanPhone = telefono.replace(/\D/g, '');
  // Agregar prefijo de México (52) si no lo tiene
  const fullPhone = cleanPhone.length === 10 ? `52${cleanPhone}` : cleanPhone;

  let mensaje = 'Hola';
  if (nombrePaciente) mensaje += ` ${nombrePaciente}`;
  mensaje += ', nos comunicamos de Rehabilita Sport';
  if (codigoReserva) mensaje += ` con relación a tu cita ${codigoReserva}`;
  mensaje += '.';

  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(mensaje)}`;
}
