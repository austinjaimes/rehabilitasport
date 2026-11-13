/**
-- ============================================================================
-- TIPOS TYPESCRIPT DEFINITIVOS: BASE DE DATOS REHABILITA SPORT
-- ============================================================================
 */

export type EstadoCita = 'confirmada' | 'atendida' | 'cancelada' | 'no_asistio';
export type EstadoNotificacion = 'pendiente' | 'procesando' | 'enviado' | 'incierto' | 'fallido' | 'simulado';
export type TipoNotificacion = 'confirmacion' | 'reprogramacion' | 'cancelacion';

export interface Servicio {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracion_minutos: number;
  activo: boolean;
  orden: number;
  created_at: string;
  updated_at: string;
}

export interface Terapeuta {
  id: string;
  nombre_completo: string;
  especialidad: string | null;
  activo: boolean;
  created_at: string;
}

export interface HorarioAtencion {
  id: string;
  dia_semana: number; // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  hora_apertura: string; // 'HH:MM:SS'
  hora_cierre: string;
  laborable: boolean;
  updated_at: string;
}

export interface BloqueoAgenda {
  id: string;
  fecha: string; // 'YYYY-MM-DD'
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
  created_at: string;
}

export interface Paciente {
  id: string;
  nombre_completo: string;
  telefono_whatsapp: string;
  email: string | null;
  consentimiento_whatsapp: boolean;
  fecha_consentimiento: string | null;
  fuente_consentimiento: string | null;
  version_politica_consentimiento: string | null;
  created_at: string;
}

export interface Cita {
  id: string;
  codigo_reserva: string;
  token_gestion_hash: string;
  token_expira_at: string;
  token_revocado_at: string | null;
  paciente_id: string;
  servicio_id: string;
  terapeuta_id: string;
  fecha: string; // 'YYYY-MM-DD'
  hora_inicio: string; // 'HH:MM'
  hora_fin: string;
  duracion_minutos_historica: number;
  nombre_servicio_historico: string;
  estado: EstadoCita;
  motivo_cancelacion: string | null;
  created_at: string;
  updated_at: string;
}

export interface ColaNotificacionWhatsApp {
  id: string;
  evento_id: string;
  cita_id: string;
  tipo: TipoNotificacion;
  telefono_destino: string;
  payload: Record<string, any>;
  estado: EstadoNotificacion;
  intentos: number;
  max_intentos: number;
  next_attempt_at: string;
  bloqueado_hasta: string | null;
  bloqueado_por: string | null;
  message_id: string | null;
  ultimo_error: string | null;
  created_at: string;
  procesado_at: string | null;
}

