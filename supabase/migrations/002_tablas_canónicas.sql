-- ============================================================================
-- MIGRACIÓN 002: TABLAS PRINCIPALES CANÓNICAS
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
-- ============================================================================

-- 1. TABLA: SERVICIOS (Catálogo dinámico editable desde el panel administrativo)
CREATE TABLE IF NOT EXISTS servicios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(120) NOT NULL,
    descripcion TEXT,
    duracion_minutos INT NOT NULL DEFAULT 60 CHECK (duracion_minutos > 0),
    activo BOOLEAN NOT NULL DEFAULT true,
    orden INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TABLA: TERAPEUTAS / RECURSOS (Estructura lista para múltiples agendas en fases futuras)
CREATE TABLE IF NOT EXISTS terapeutas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre_completo VARCHAR(150) NOT NULL,
    especialidad VARCHAR(100),
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TABLA: HORARIOS DE ATENCIÓN BASE (Lunes a Domingo)
CREATE TABLE IF NOT EXISTS horarios_atencion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dia_semana INT NOT NULL UNIQUE CHECK (dia_semana BETWEEN 0 AND 6), -- 0=Dom, 1=Lun, ..., 6=Sáb
    hora_apertura TIME NOT NULL,
    hora_cierre TIME NOT NULL,
    laborable BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_horario_coherente CHECK (hora_apertura < hora_cierre OR laborable = false)
);

-- 4. TABLA: BLOQUEOS DE AGENDA Y FERIADOS
CREATE TABLE IF NOT EXISTS bloqueos_agenda (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    motivo VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_bloqueo_coherente CHECK (hora_inicio < hora_fin)
);

-- 5. TABLA: PACIENTES (Minimización estricta de datos personales)
CREATE TABLE IF NOT EXISTS pacientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre_completo VARCHAR(150) NOT NULL,
    telefono_whatsapp VARCHAR(20) NOT NULL,
    email VARCHAR(120),
    consentimiento_whatsapp BOOLEAN NOT NULL DEFAULT false,
    fecha_consentimiento TIMESTAMPTZ,
    fuente_consentimiento VARCHAR(100),
    version_politica_consentimiento VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_consistencia_consentimiento CHECK (
        (consentimiento_whatsapp = true 
         AND fecha_consentimiento IS NOT NULL 
         AND fuente_consentimiento IS NOT NULL 
         AND version_politica_consentimiento IS NOT NULL)
        OR
        (consentimiento_whatsapp = false 
         AND fecha_consentimiento IS NULL 
         AND fuente_consentimiento IS NULL 
         AND version_politica_consentimiento IS NULL)
    )
);

-- 6. TABLA: CITAS (Integridad histórica, token hasheado y exclusión temporal)
CREATE TABLE IF NOT EXISTS citas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo_reserva VARCHAR(12) UNIQUE NOT NULL,
    token_gestion_hash VARCHAR(64) UNIQUE NOT NULL, -- Hash SHA-256 (32 bytes criptográficos generados en servidor)
    token_expira_at TIMESTAMPTZ NOT NULL,
    token_revocado_at TIMESTAMPTZ,
    paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE RESTRICT,
    servicio_id UUID NOT NULL REFERENCES servicios(id) ON DELETE RESTRICT,
    terapeuta_id UUID NOT NULL REFERENCES terapeutas(id) ON DELETE RESTRICT,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    duracion_minutos_historica INT NOT NULL CHECK (duracion_minutos_historica > 0),
    nombre_servicio_historico VARCHAR(120) NOT NULL,
    estado estado_cita NOT NULL DEFAULT 'confirmada',
    motivo_cancelacion TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT check_horas_secuenciales CHECK (hora_inicio < hora_fin),
    CONSTRAINT no_solapamiento_citas_activas
    EXCLUDE USING gist (
        terapeuta_id WITH =,
        (tsrange(fecha + hora_inicio, fecha + hora_fin, '[)')) WITH &&
    )
    WHERE (estado != 'cancelada')
);

CREATE INDEX IF NOT EXISTS idx_citas_fecha_estado ON citas(fecha, estado);
CREATE INDEX IF NOT EXISTS idx_citas_token_hash ON citas(token_gestion_hash) WHERE token_revocado_at IS NULL;
