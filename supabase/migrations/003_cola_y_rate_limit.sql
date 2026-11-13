-- ============================================================================
-- MIGRACIÓN 003: COLA DE NOTIFICACIONES Y CONTROL DE RATE LIMITING
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
-- ============================================================================

-- 1. TABLA: COLA DE NOTIFICACIONES WHATSAPP
CREATE TABLE IF NOT EXISTS cola_notificaciones_whatsapp (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evento_id UUID NOT NULL UNIQUE, -- Identificador único de cada evento (reserva, reprogramación, cancelación)
    cita_id UUID NOT NULL REFERENCES citas(id) ON DELETE RESTRICT,
    tipo tipo_notificacion NOT NULL,
    telefono_destino VARCHAR(20) NOT NULL,
    payload JSONB NOT NULL,
    estado estado_notificacion NOT NULL DEFAULT 'pendiente',
    intentos INT NOT NULL DEFAULT 0,
    max_intentos INT NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bloqueado_hasta TIMESTAMPTZ,
    bloqueado_por VARCHAR(100),
    message_id VARCHAR(120), -- ID de mensaje entregado por Meta API
    ultimo_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    procesado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cola_reclamar ON cola_notificaciones_whatsapp(estado, next_attempt_at)
WHERE estado IN ('pendiente', 'procesando');

-- 2. TABLA: CONTROL DE RATE LIMITING (Atómico y persistente para Serverless)
CREATE TABLE IF NOT EXISTS control_rate_limit (
    identificador VARCHAR(150) PRIMARY KEY, -- IP del cliente o clave hash
    peticiones INT NOT NULL DEFAULT 1,
    ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
