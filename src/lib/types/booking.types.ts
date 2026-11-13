/**
-- ============================================================================
-- TIPOS DE FLUJO DE RESERVA Y GESTIÓN: REHABILITA SPORT
-- ============================================================================
 */

import type { Servicio } from './database.types';

export interface BookingState {
  pasoActual: number;
  servicioSeleccionado: Servicio | null;
  fechaSeleccionada: string | null; // 'YYYY-MM-DD'
  horaSeleccionada: string | null;  // 'HH:MM'
  nombreCompleto: string;
  telefonoWhatsApp: string;
  email: string;
  consentimientoWhatsApp: boolean;
}

export interface ReservaRequestPayload {
  servicioId: string;
  fecha: string;
  horaInicio: string;
  nombreCompleto: string;
  telefonoWhatsApp: string;
  email?: string;
  consentimientoWhatsApp: boolean;
}

export interface ReservaResponsePayload {
  success: boolean;
  code?: string;
  message?: string;
  citaId?: string;
  codigoReserva?: string;
  tokenPlano?: string; // Entregado exclusivamente en la respuesta inicial para inyectar en el fragmento #token=...
  servicio?: string;
  fecha?: string;
  horaInicio?: string;
  horaFin?: string;
}

export interface CitaGestionPayload {
  codigoReserva: string;
  nombreServicio: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  duracionMinutos: number;
  estado: string;
  nombrePaciente: string;
  consentimientoWhatsApp: boolean;
}

export interface ReprogramacionRequestPayload {
  nuevaFecha: string;
  nuevaHoraInicio: string;
}

