-- ============================================================================
-- SCRIPT CANÓNICO CONSOLIDADO: MIGRACIONES 001 A 007
-- ============================================================================
-- Proyecto: Rehabilita Sport — Sistema Canónico de Citas (MVP)
-- Rama: feature/sistema-citas-mvp
-- Base de Datos: PostgreSQL 15+ (Supabase)
-- Generación: Fase F4.1 (Correcciones de Confiabilidad Post-F4)
--
-- ADVERTENCIA Y ALCANCE DE EJECUCIÓN (GREENFIELD):
-- Este script es ATÓMICO (BEGIN ... COMMIT) y está diseñado EXCLUSIVAMENTE
-- para una PRIMERA INSTALACIÓN LIMPIA en un proyecto de Supabase nuevo.
-- NO debe ejecutarse nuevamente sobre una base de datos donde ya se haya aplicado,
-- ya que la inserción de datos iniciales no restrictivos podría generar duplicados.
--
-- DESCRIPCIÓN Y TRAZABILIDAD:
-- Este script unifica en un único flujo de ejecución atómico
-- todas las definiciones de base de datos del sistema canónico de citas:
--
--   1. 001_extensiones_y_tipos.sql       -> Extensiones (uuid-ossp, btree_gist) y ENUMs
--   2. 002_tablas_canónicas.sql          -> Tablas base, constraints y exclusión temporal GIST
--   3. 003_cola_y_rate_limit.sql         -> Cola WhatsApp y control rate limiting
--   4. 007_revocacion_sesiones_admin.sql -> Lista de revocación jti y purga de sesiones admin
--   5. 004_funciones_rpc.sql             -> RPCs atómicas, locks deterministas bigint,
--                                           mantenimiento diario, recuperación y control
--   6. 005_seguridad_rls.sql             -> Políticas RLS, least privilege y revocaciones públicas
--   7. 006_datos_iniciales_prueba.sql    -> Terapeutas, horarios base y catálogo de servicios
--
-- GARANTÍAS DE CONCURRENCIA Y SEGURIDAD IMPLEMENTADAS:
-- - Jerarquía estricta de bloqueos:
--     Nivel 1: pg_advisory_xact_lock(YYYYMMDD::bigint) por fecha
--     Nivel 2: SELECT FOR UPDATE sobre fila padre en tabla citas
--     Nivel 3: SELECT FOR UPDATE SKIP LOCKED sobre cola_notificaciones_whatsapp
-- - Invalidación atómica de notificaciones obsoletas en reprogramaciones y cancelaciones.
-- - Mantenimiento diario con sub-bloque transaccional (BEGIN ... EXCEPTION) y lock 99990001.
-- - Recuperación determinista con deduplicación completa del historial por cita.
-- - Defensa perimetral y least-privilege: sin acceso público directo a datos sensibles.
--
-- INSTRUCCIONES DE EJECUCIÓN EN SUPABASE:
-- 1. Abrir Supabase Dashboard -> SQL Editor.
-- 2. Pegar la totalidad de este script.
-- 3. Ejecutar ("Run"). Todo se ejecuta dentro de un bloque BEGIN ... COMMIT atómico.
-- 4. Ejecutar las consultas de verificación situadas al final del script.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE 1: EXTENSIONES Y TIPOS ENUMERADOS
-- Archivo fuente: supabase/migrations/001_extensiones_y_tipos.sql
-- ============================================================================

-- ============================================================================
-- MIGRACIÓN 001: EXTENSIONES Y TIPOS ENUMERADOS
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
-- ============================================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA extensions; -- Requerido para la restricción de exclusión temporal

-- Tipos enumerados
DO $$ BEGIN
    CREATE TYPE estado_cita AS ENUM ('confirmada', 'atendida', 'cancelada', 'no_asistio');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE estado_notificacion AS ENUM ('pendiente', 'procesando', 'enviado', 'incierto', 'fallido', 'simulado');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_notificacion AS ENUM ('confirmacion', 'reprogramacion', 'cancelacion');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- PARTE 2: TABLAS PRINCIPALES CANÓNICAS
-- Archivo fuente: supabase/migrations/002_tablas_canónicas.sql
-- ============================================================================

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

-- ============================================================================
-- PARTE 3: COLA DE NOTIFICACIONES Y CONTROL DE RATE LIMITING
-- Archivo fuente: supabase/migrations/003_cola_y_rate_limit.sql
-- ============================================================================

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

-- ============================================================================
-- PARTE 4: REVOCACIÓN DE SESIONES ADMINISTRATIVAS
-- Archivo fuente: supabase/migrations/007_revocacion_sesiones_admin.sql
-- ============================================================================

-- ============================================================================
-- MIGRACIÓN 007: REVOCACIÓN DE SESIONES ADMINISTRATIVAS
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
--
-- NOTA DE CONTROL: Esta migración está preparada localmente. NO ha sido
-- aplicada a Supabase en la nube, conforme a las restricciones del proyecto.
-- ============================================================================

-- 1. TABLA: SESIONES ADMINISTRATIVAS REVOCADAS
-- Almacena identificadores únicos de sesión (jti) revocados antes de su expiración natural.
CREATE TABLE IF NOT EXISTS admin_sesiones_revocadas (
    jti VARCHAR(64) PRIMARY KEY,
    expira_at TIMESTAMPTZ NOT NULL,
    revocado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    motivo VARCHAR(100) DEFAULT 'logout'
);

-- 2. ÍNDICE DE CONSULTA Y VIGENCIA
-- Optimiza la verificación de revocación durante cada petición administrativa:
-- SELECT jti FROM admin_sesiones_revocadas WHERE jti = $1 AND expira_at > NOW();
CREATE INDEX IF NOT EXISTS idx_admin_sesiones_revocadas_jti_expira
ON admin_sesiones_revocadas (jti, expira_at);

-- 3. SEGURIDAD A NIVEL DE FILA (RLS) Y PRIVILEGIOS DE ACCESO
ALTER TABLE admin_sesiones_revocadas ENABLE ROW LEVEL SECURITY;

-- Revocación total de permisos a roles públicos y aplicaciones cliente (PUBLIC, anon, authenticated)
REVOKE ALL ON admin_sesiones_revocadas FROM PUBLIC;
REVOKE ALL ON admin_sesiones_revocadas FROM anon, authenticated;

-- Otorgar privilegios exclusivamente al rol de servicio del backend administrativo (service_role)
GRANT ALL ON admin_sesiones_revocadas TO service_role;

-- Eliminar cualquier política previa que haya otorgado acceso a authenticated o anon
DROP POLICY IF EXISTS "Acceso exclusivo backend para sesiones revocadas" ON admin_sesiones_revocadas;
DROP POLICY IF EXISTS "Acceso exclusivo service_role para sesiones revocadas" ON admin_sesiones_revocadas;

-- Política RLS restrictiva: Acceso permitido ÚNICAMENTE a service_role
-- Usuarios anon y authenticated quedan estrictamente denegados por defecto (default deny)
CREATE POLICY "Acceso exclusivo service_role para sesiones revocadas"
ON admin_sesiones_revocadas
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4. FUNCIÓN DE PURGA DE SESIONES EXPIRADAS
-- Garantía de seguridad: NUNCA elimina una revocación antes de que su token expire.
-- Solo cuando expira_at < NOW(), el token ya es matemáticamente inválido por HMAC/timestamp,
-- por lo que el registro de revocación ya no es necesario en base de datos.
CREATE OR REPLACE FUNCTION purgar_sesiones_revocadas_expiradas()
RETURNS INT AS $$
DECLARE
    v_eliminadas INT;
BEGIN
    DELETE FROM admin_sesiones_revocadas
    WHERE expira_at < NOW();
    GET DIAGNOSTICS v_eliminadas = ROW_COUNT;
    RETURN v_eliminadas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Revocación de privilegios de ejecución de la función de purga a roles no autorizados
REVOKE EXECUTE ON FUNCTION purgar_sesiones_revocadas_expiradas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION purgar_sesiones_revocadas_expiradas() FROM anon, authenticated;

-- Conceder ejecución de la función de purga únicamente al rol administrativo backend (service_role)
GRANT EXECUTE ON FUNCTION purgar_sesiones_revocadas_expiradas() TO service_role;

-- ============================================================================
-- PARTE 5: PROCEDIMIENTOS ALMACENADOS (RPC) DE SEGURIDAD Y CONCURRENCIA
-- Archivo fuente: supabase/migrations/004_funciones_rpc.sql
-- ============================================================================

-- ============================================================================
-- MIGRACIÓN 004: PROCEDIMIENTOS ALMACENADOS (RPC) DE SEGURIDAD Y CONCURRENCIA
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
-- ============================================================================

-- 1. OBTENER HORARIOS DISPONIBLES (Cálculo dinámico con granularidad configurable)
CREATE OR REPLACE FUNCTION obtener_horarios_disponibles(
    p_fecha DATE,
    p_duracion_minutos INT DEFAULT 60,
    p_paso_minutos INT DEFAULT 30
)
RETURNS TABLE (hora_slot TIME) AS $$
DECLARE
    v_dia_semana INT;
    v_apertura TIME;
    v_cierre TIME;
    v_slot_inicio TIME;
    v_slot_fin TIME;
    v_ahora_mexico TIME;
    v_fecha_hoy_mexico DATE;
BEGIN
    -- Validación estricta de parámetros para evitar bucles infinitos o abuso
    IF p_duracion_minutos < 15 OR p_duracion_minutos > 480 OR p_paso_minutos < 15 OR p_paso_minutos > 120 THEN
        RETURN;
    END IF;

    -- Sincronización estricta con la zona horaria oficial de la clínica (Guerrero, México)
    v_fecha_hoy_mexico := (NOW() AT TIME ZONE 'America/Mexico_City')::DATE;
    v_ahora_mexico := (NOW() AT TIME ZONE 'America/Mexico_City')::TIME;

    -- No permitir consultas para fechas pasadas ni más allá de 60 días
    IF p_fecha < v_fecha_hoy_mexico OR p_fecha > (v_fecha_hoy_mexico + INTERVAL '60 days') THEN
        RETURN;
    END IF;

    v_dia_semana := EXTRACT(DOW FROM p_fecha);

    SELECT hora_apertura, hora_cierre INTO v_apertura, v_cierre
    FROM horarios_atencion
    WHERE dia_semana = v_dia_semana AND laborable = true;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_slot_inicio := v_apertura;

    -- Iteración evaluando si cabe la duración del servicio dentro de la jornada
    WHILE (v_slot_inicio + (p_duracion_minutos || ' minutes')::INTERVAL) <= v_cierre LOOP
        v_slot_fin := (v_slot_inicio + (p_duracion_minutos || ' minutes')::INTERVAL)::TIME;

        -- Margen de anticipación mínima para citas del mismo día (2 horas antes)
        IF p_fecha = v_fecha_hoy_mexico AND v_slot_inicio <= (v_ahora_mexico + INTERVAL '2 hours') THEN
            v_slot_inicio := (v_slot_inicio + (p_paso_minutos || ' minutes')::INTERVAL)::TIME;
            CONTINUE;
        END IF;

        -- Comprobar que [v_slot_inicio, v_slot_fin) no colisione con citas activas ni bloqueos
        IF NOT EXISTS (
            SELECT 1 FROM citas
            WHERE fecha = p_fecha AND estado != 'cancelada'
              AND (v_slot_inicio, v_slot_fin) OVERLAPS (hora_inicio, hora_fin)
        ) AND NOT EXISTS (
            SELECT 1 FROM bloqueos_agenda
            WHERE fecha = p_fecha
              AND (v_slot_inicio, v_slot_fin) OVERLAPS (hora_inicio, hora_fin)
        ) THEN
            hora_slot := v_slot_inicio;
            RETURN NEXT;
        END IF;

        v_slot_inicio := (v_slot_inicio + (p_paso_minutos || ' minutes')::INTERVAL)::TIME;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 2. CREAR CITA ATÓMICA CON SERIALIZACIÓN POR FECHA (ADVISORY LOCK)
CREATE OR REPLACE FUNCTION crear_cita_atomica(
    p_servicio_id UUID,
    p_fecha DATE,
    p_hora_inicio TIME,
    p_nombre_completo VARCHAR,
    p_telefono VARCHAR,
    p_email VARCHAR,
    p_consentimiento_whatsapp BOOLEAN,
    p_codigo_reserva VARCHAR,
    p_token_hash VARCHAR,
    p_evento_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_servicio RECORD;
    v_hora_fin TIME;
    v_paciente_id UUID;
    v_cita_id UUID;
    v_terapeuta_id UUID;
    v_apertura TIME;
    v_cierre TIME;
    v_dia_semana INT;
    v_fecha_hoy_mexico DATE;
BEGIN
    v_fecha_hoy_mexico := (NOW() AT TIME ZONE 'America/Mexico_City')::DATE;
    IF p_fecha < v_fecha_hoy_mexico THEN
        RETURN jsonb_build_object('success', false, 'code', 'FECHA_PASADA', 'message', 'No es posible agendar citas en fechas pasadas');
    END IF;

    -- Candado consultivo determinista por fecha (YYYYMMDD bigint) libre de colisiones hash
    PERFORM pg_advisory_xact_lock((to_char(p_fecha, 'YYYYMMDD'))::bigint);

    -- Validar servicio activo
    SELECT * INTO v_servicio FROM servicios WHERE id = p_servicio_id AND activo = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SERVICIO_INVALIDO', 'message', 'El servicio seleccionado no está activo o no existe');
    END IF;

    -- Garantizar asignación del recurso predeterminado «Equipo General Rehabilita Sport» (sin citas huérfanas)
    SELECT id INTO v_terapeuta_id FROM terapeutas 
    WHERE nombre_completo = 'Equipo General Rehabilita Sport' LIMIT 1;

    IF v_terapeuta_id IS NULL THEN
        INSERT INTO terapeutas (nombre_completo, especialidad, activo)
        VALUES ('Equipo General Rehabilita Sport', 'Agenda Clínica Central', true)
        RETURNING id INTO v_terapeuta_id;
    END IF;

    -- Calcular hora de término
    v_hora_fin := (p_hora_inicio + (v_servicio.duracion_minutos || ' minutes')::INTERVAL)::TIME;

    -- Validar contra horario de atención
    v_dia_semana := EXTRACT(DOW FROM p_fecha);
    SELECT hora_apertura, hora_cierre INTO v_apertura, v_cierre
    FROM horarios_atencion WHERE dia_semana = v_dia_semana AND laborable = true;

    IF NOT FOUND OR p_hora_inicio < v_apertura OR v_hora_fin > v_cierre THEN
        RETURN jsonb_build_object('success', false, 'code', 'HORARIO_FUERA_DE_JORNADA', 'message', 'El horario seleccionado está fuera de la jornada de atención clínica');
    END IF;

    -- Validar contra bloqueos de agenda
    IF EXISTS (
        SELECT 1 FROM bloqueos_agenda
        WHERE fecha = p_fecha AND (p_hora_inicio, v_hora_fin) OVERLAPS (hora_inicio, hora_fin)
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'HORARIO_BLOQUEADO', 'message', 'El horario seleccionado se encuentra bloqueado por la clínica');
    END IF;

    -- Registrar o recuperar paciente con integridad de consentimiento
    INSERT INTO pacientes (
        nombre_completo, telefono_whatsapp, email,
        consentimiento_whatsapp, fecha_consentimiento,
        fuente_consentimiento, version_politica_consentimiento
    )
    VALUES (
        p_nombre_completo, p_telefono, p_email,
        p_consentimiento_whatsapp,
        CASE WHEN p_consentimiento_whatsapp THEN NOW() ELSE NULL END,
        CASE WHEN p_consentimiento_whatsapp THEN 'web_formulario_reserva' ELSE NULL END,
        CASE WHEN p_consentimiento_whatsapp THEN 'v1.0_2026-11' ELSE NULL END
    )
    RETURNING id INTO v_paciente_id;

    -- Insertar cita con asignación explícita de terapeuta obligatorio
    INSERT INTO citas (
        codigo_reserva, token_gestion_hash, token_expira_at,
        paciente_id, servicio_id, terapeuta_id, fecha, hora_inicio, hora_fin,
        duracion_minutos_historica, nombre_servicio_historico, estado
    )
    VALUES (
        p_codigo_reserva, p_token_hash,
        (((p_fecha + v_hora_fin) AT TIME ZONE 'America/Mexico_City') + INTERVAL '24 hours'),
        v_paciente_id, p_servicio_id, v_terapeuta_id, p_fecha, p_hora_inicio, v_hora_fin,
        v_servicio.duracion_minutos, v_servicio.nombre, 'confirmada'
    )
    RETURNING id INTO v_cita_id;

    -- Encolar notificación si el paciente dio su consentimiento voluntario para WhatsApp
    IF p_consentimiento_whatsapp THEN
        INSERT INTO cola_notificaciones_whatsapp (
            evento_id, cita_id, tipo, telefono_destino, payload
        )
        VALUES (
            p_evento_id, v_cita_id, 'confirmacion', p_telefono,
            jsonb_build_object(
                'paciente', p_nombre_completo,
                'servicio', v_servicio.nombre,
                'fecha', p_fecha,
                'hora', p_hora_inicio,
                'codigo_reserva', p_codigo_reserva
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'cita_id', v_cita_id,
        'codigo_reserva', p_codigo_reserva,
        'servicio', v_servicio.nombre,
        'fecha', p_fecha,
        'hora_inicio', p_hora_inicio,
        'hora_fin', v_hora_fin
    );
EXCEPTION
    WHEN exclusion_violation THEN
        RETURN jsonb_build_object('success', false, 'code', 'HORARIO_OCUPADO', 'message', 'El horario seleccionado acaba de ser ocupado por otra cita');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. REPROGRAMAR CITA ATÓMICA CON ROTACIÓN DE TOKEN
CREATE OR REPLACE FUNCTION reprogramar_cita_atomica(
    p_token_hash_actual VARCHAR,
    p_nueva_fecha DATE,
    p_nueva_hora_inicio TIME,
    p_nuevo_token_hash VARCHAR,
    p_evento_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_cita RECORD;
    v_hora_fin TIME;
    v_apertura TIME;
    v_cierre TIME;
    v_dia_semana INT;
    v_fecha_hoy_mexico DATE;
    v_primera_fecha DATE;
    v_segunda_fecha DATE;
BEGIN
    v_fecha_hoy_mexico := (NOW() AT TIME ZONE 'America/Mexico_City')::DATE;
    IF p_nueva_fecha < v_fecha_hoy_mexico THEN
        RETURN jsonb_build_object('success', false, 'code', 'FECHA_PASADA', 'message', 'No es posible reprogramar citas a fechas pasadas');
    END IF;

    -- Validar cita activa por su hash actual antes de bloquear fechas
    SELECT c.*, p.nombre_completo, p.telefono_whatsapp, p.consentimiento_whatsapp
    INTO v_cita
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    WHERE c.token_gestion_hash = p_token_hash_actual
      AND c.token_revocado_at IS NULL
      AND c.token_expira_at > NOW()
      AND c.estado = 'confirmada';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TOKEN_INVALIDO', 'message', 'El enlace de gestión es inválido, ya expiró o la cita no está activa');
    END IF;

    -- Adquirir locks de ambas fechas (fecha actual y nueva fecha) en orden determinista estricto (bigint YYYYMMDD) para evitar deadlocks
    v_primera_fecha := LEAST(v_cita.fecha, p_nueva_fecha);
    v_segunda_fecha := GREATEST(v_cita.fecha, p_nueva_fecha);

    PERFORM pg_advisory_xact_lock((to_char(v_primera_fecha, 'YYYYMMDD'))::bigint);
    IF v_primera_fecha != v_segunda_fecha THEN
        PERFORM pg_advisory_xact_lock((to_char(v_segunda_fecha, 'YYYYMMDD'))::bigint);
    END IF;

    -- Calcular hora de fin manteniendo la duración histórica
    v_hora_fin := (p_nueva_hora_inicio + (v_cita.duracion_minutos_historica || ' minutes')::INTERVAL)::TIME;

    -- Validar horario de atención
    v_dia_semana := EXTRACT(DOW FROM p_nueva_fecha);
    SELECT hora_apertura, hora_cierre INTO v_apertura, v_cierre
    FROM horarios_atencion WHERE dia_semana = v_dia_semana AND laborable = true;

    IF NOT FOUND OR p_nueva_hora_inicio < v_apertura OR v_hora_fin > v_cierre THEN
        RETURN jsonb_build_object('success', false, 'code', 'HORARIO_FUERA_DE_JORNADA', 'message', 'El nuevo horario está fuera de la jornada clínica');
    END IF;

    -- Validar bloqueos
    IF EXISTS (
        SELECT 1 FROM bloqueos_agenda
        WHERE fecha = p_nueva_fecha AND (p_nueva_hora_inicio, v_hora_fin) OVERLAPS (hora_inicio, hora_fin)
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'HORARIO_BLOQUEADO', 'message', 'El horario seleccionado está bloqueado por la clínica');
    END IF;

    -- Actualizar cita y rotar token
    UPDATE citas
    SET fecha = p_nueva_fecha,
        hora_inicio = p_nueva_hora_inicio,
        hora_fin = v_hora_fin,
        token_gestion_hash = p_nuevo_token_hash,
        token_expira_at = (((p_nueva_fecha + v_hora_fin) AT TIME ZONE 'America/Mexico_City') + INTERVAL '24 hours'),
        updated_at = NOW()
    WHERE id = v_cita.id;

    -- Invalidar notificaciones anteriores de fecha no enviadas para evitar mensajes desactualizados
    UPDATE cola_notificaciones_whatsapp
    SET estado = 'fallido',
        ultimo_error = 'INVALIDADA_POR_REPROGRAMACION'
    WHERE cita_id = v_cita.id
      AND tipo IN ('confirmacion', 'reprogramacion')
      AND estado IN ('pendiente', 'simulado', 'procesando');

    -- Encolar notificación si el paciente tiene consentimiento activo
    IF v_cita.consentimiento_whatsapp THEN
        INSERT INTO cola_notificaciones_whatsapp (
            evento_id, cita_id, tipo, telefono_destino, payload
        )
        VALUES (
            p_evento_id, v_cita.id, 'reprogramacion', v_cita.telefono_whatsapp,
            jsonb_build_object(
                'paciente', v_cita.nombre_completo,
                'servicio', v_cita.nombre_servicio_historico,
                'fecha_nueva', p_nueva_fecha,
                'hora_nueva', p_nueva_hora_inicio,
                'codigo_reserva', v_cita.codigo_reserva
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'codigo_reserva', v_cita.codigo_reserva,
        'servicio', v_cita.nombre_servicio_historico,
        'nueva_fecha', p_nueva_fecha,
        'nueva_hora_inicio', p_nueva_hora_inicio,
        'nueva_hora_fin', v_hora_fin
    );
EXCEPTION
    WHEN exclusion_violation THEN
        RETURN jsonb_build_object('success', false, 'code', 'HORARIO_OCUPADO', 'message', 'El nuevo horario seleccionado acaba de ser ocupado');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4. CANCELAR CITA ATÓMICA
CREATE OR REPLACE FUNCTION cancelar_cita_atomica(
    p_token_hash VARCHAR,
    p_motivo TEXT,
    p_evento_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_cita RECORD;
BEGIN
    SELECT c.*, p.nombre_completo, p.telefono_whatsapp, p.consentimiento_whatsapp
    INTO v_cita
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id
    WHERE c.token_gestion_hash = p_token_hash
      AND c.token_revocado_at IS NULL
      AND c.token_expira_at > NOW()
      AND c.estado = 'confirmada';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TOKEN_INVALIDO', 'message', 'El enlace es inválido o la cita ya fue cancelada');
    END IF;

    -- Actualizar estado a cancelada y revocar token
    UPDATE citas
    SET estado = 'cancelada',
        motivo_cancelacion = p_motivo,
        token_revocado_at = NOW(),
        updated_at = NOW()
    WHERE id = v_cita.id;

    -- Invalidar de forma inmediata cualquier notificación previa pendiente, simulada o en proceso de esta cita
    UPDATE cola_notificaciones_whatsapp
    SET estado = 'fallido',
        ultimo_error = 'INVALIDADA_POR_CANCELACION'
    WHERE cita_id = v_cita.id
      AND estado IN ('pendiente', 'simulado', 'procesando');

    -- Encolar notificación si aplica
    IF v_cita.consentimiento_whatsapp THEN
        INSERT INTO cola_notificaciones_whatsapp (
            evento_id, cita_id, tipo, telefono_destino, payload
        )
        VALUES (
            p_evento_id, v_cita.id, 'cancelacion', v_cita.telefono_whatsapp,
            jsonb_build_object(
                'paciente', v_cita.nombre_completo,
                'servicio', v_cita.nombre_servicio_historico,
                'fecha', v_cita.fecha,
                'hora', v_cita.hora_inicio,
                'codigo_reserva', v_cita.codigo_reserva
            )
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'codigo_reserva', v_cita.codigo_reserva);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. CREAR BLOQUEO DE AGENDA CON PREVENCIÓN DE CONFLICTOS
CREATE OR REPLACE FUNCTION crear_bloqueo_agenda(
    p_fecha DATE,
    p_hora_inicio TIME,
    p_hora_fin TIME,
    p_motivo VARCHAR
)
RETURNS JSONB AS $$
DECLARE
    v_citas_conflicto INT;
    v_bloqueo_id UUID;
BEGIN
    IF p_hora_inicio >= p_hora_fin THEN
        RETURN jsonb_build_object('success', false, 'code', 'HORAS_INVALIDAS', 'message', 'La hora de inicio debe ser anterior a la hora de fin');
    END IF;

    -- Candado consultivo determinista por fecha (YYYYMMDD bigint) libre de colisiones hash
    PERFORM pg_advisory_xact_lock((to_char(p_fecha, 'YYYYMMDD'))::bigint);

    -- Verificar si existen citas activas en el intervalo a bloquear
    SELECT COUNT(*) INTO v_citas_conflicto
    FROM citas
    WHERE fecha = p_fecha
      AND estado != 'cancelada'
      AND (p_hora_inicio, p_hora_fin) OVERLAPS (hora_inicio, hora_fin);

    IF v_citas_conflicto > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'CONFLICTO_CITAS_EXISTENTES',
            'citas_afectadas', v_citas_conflicto,
            'message', format('Existen %s cita(s) confirmada(s) en este intervalo. Cancele o reubique a los pacientes antes de proceder.', v_citas_conflicto)
        );
    END IF;

    INSERT INTO bloqueos_agenda (fecha, hora_inicio, hora_fin, motivo)
    VALUES (p_fecha, p_hora_inicio, p_hora_fin, p_motivo)
    RETURNING id INTO v_bloqueo_id;

    RETURN jsonb_build_object('success', true, 'bloqueo_id', v_bloqueo_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 6. RECLAMAR NOTIFICACIONES CON EXCLUSIÓN DE CONCURRENCIA (SKIP LOCKED) Y PROTECCIÓN CONTRA RECLAMACIÓN INSEGURA
CREATE OR REPLACE FUNCTION reclamar_notificaciones(
    p_worker_id VARCHAR,
    p_batch_size INT DEFAULT 5,
    p_lock_seconds INT DEFAULT 60
)
RETURNS SETOF cola_notificaciones_whatsapp AS $$
BEGIN
    -- 1. Cuarentena preventiva de tareas con bloqueo expirado en estado 'procesando'.
    -- Justificación de confiabilidad: Si un worker previo cayó o perdió conexión con la BD
    -- tras haber transmitido el payload a Meta, la tarea quedó en 'procesando'.
    -- Reclamarla y reenviarla ciegamente causaría duplicación de mensajes WhatsApp.
    -- Por tanto, se transicionan automáticamente a 'incierto' para revisión administrativa.
    UPDATE cola_notificaciones_whatsapp
    SET estado = 'incierto',
        ultimo_error = 'BLOQUEO_EXPIRADO_EN_PROCESANDO_CUARENTENA_PREVENTIVA'
    WHERE estado = 'procesando'
      AND bloqueado_hasta < NOW();

    -- 2. Reclamar exclusivamente tareas en estado 'pendiente' cuyo tiempo de intento haya vencido
    RETURN QUERY
    WITH tareas_bloqueadas AS (
        SELECT id FROM cola_notificaciones_whatsapp
        WHERE estado = 'pendiente'
          AND next_attempt_at <= NOW()
        ORDER BY created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE cola_notificaciones_whatsapp q
    SET estado = 'procesando',
        bloqueado_por = p_worker_id,
        bloqueado_hasta = NOW() + (p_lock_seconds || ' seconds')::INTERVAL,
        intentos = q.intentos + 1
    FROM tareas_bloqueadas
    WHERE q.id = tareas_bloqueadas.id
    RETURNING q.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 7. RATE LIMITING PERSISTENTE Y ATÓMICO (INSERT ON CONFLICT)
CREATE OR REPLACE FUNCTION verificar_rate_limit(
    p_identificador VARCHAR,
    p_max_peticiones INT DEFAULT 5,
    p_ventana_segundos INT DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
    v_peticiones INT;
BEGIN
    INSERT INTO control_rate_limit (identificador, peticiones, ventana_inicio)
    VALUES (p_identificador, 1, NOW())
    ON CONFLICT (identificador) DO UPDATE
    SET peticiones = CASE
            WHEN (NOW() - control_rate_limit.ventana_inicio) > (p_ventana_segundos || ' seconds')::INTERVAL THEN 1
            ELSE control_rate_limit.peticiones + 1
        END,
        ventana_inicio = CASE
            WHEN (NOW() - control_rate_limit.ventana_inicio) > (p_ventana_segundos || ' seconds')::INTERVAL THEN NOW()
            ELSE control_rate_limit.ventana_inicio
        END
    RETURNING peticiones INTO v_peticiones;

    IF v_peticiones > p_max_peticiones THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 8. PURGAR RATE LIMITS EXPIRADOS
CREATE OR REPLACE FUNCTION purgar_rate_limits_expirados()
RETURNS VOID AS $$
BEGIN
    DELETE FROM control_rate_limit WHERE ventana_inicio < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================================
-- 9. TABLA DE CONTROL Y AUDITORÍA DE MANTENIMIENTO DEL SISTEMA
-- ============================================================================
CREATE TABLE IF NOT EXISTS control_mantenimiento (
    tarea VARCHAR(60) PRIMARY KEY,
    ultima_ejecucion_exitosa TIMESTAMPTZ,
    ultimo_intento TIMESTAMPTZ,
    ultimo_estado VARCHAR(20) DEFAULT 'pendiente',
    detalles JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE control_mantenimiento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON control_mantenimiento FROM PUBLIC, anon, authenticated;
GRANT ALL ON control_mantenimiento TO service_role;

-- ============================================================================
-- 10. PROCEDIMIENTO RPC ATÓMICO: EJECUTAR MANTENIMIENTO DIARIO (CON SUB-BLOQUE)
-- ============================================================================
CREATE OR REPLACE FUNCTION ejecutar_mantenimiento_diario(
    p_intervalo_horas INT DEFAULT 24
)
RETURNS JSONB AS $$
DECLARE
    v_candado_id BIGINT := 99990001; -- Namespace reservado para mantenimiento
    v_ultimo_exito TIMESTAMPTZ;
    v_rate_limits_borrados INT := 0;
    v_sesiones_borradas INT := 0;
    v_error_msg TEXT;
    v_error_code TEXT;
    v_resultado JSONB;
BEGIN
    -- 0. Validación defensiva de parámetros
    IF p_intervalo_horas IS NULL OR p_intervalo_horas <= 0 OR p_intervalo_horas > 168 THEN
        p_intervalo_horas := 24;
    END IF;

    -- 1. Exclusión concurrente inmediata (no bloqueante)
    IF NOT pg_try_advisory_xact_lock(v_candado_id) THEN
        RETURN jsonb_build_object('ejecutado', false, 'motivo', 'BLOQUEO_CONCURRENTE_EN_CURSO');
    END IF;

    -- 2. Consultar última ejecución exitosa
    SELECT ultima_ejecucion_exitosa INTO v_ultimo_exito
    FROM control_mantenimiento
    WHERE tarea = 'purgas_diarias';

    IF v_ultimo_exito IS NOT NULL AND v_ultimo_exito > (NOW() - (p_intervalo_horas || ' hours')::INTERVAL) THEN
        RETURN jsonb_build_object(
            'ejecutado', false,
            'motivo', 'VENTANA_NO_CUMPLIDA',
            'ultima_ejecucion', v_ultimo_exito,
            'proxima_ejecucion_estimada', v_ultimo_exito + (p_intervalo_horas || ' hours')::INTERVAL
        );
    END IF;

    -- 3. Sub-bloque transaccional para operaciones de purga
    -- Garantiza reversión conjunta en caso de fallo sin abortar la transacción principal
    BEGIN
        -- 3.1 Purgar rate limits expirados (> 24h)
        DELETE FROM control_rate_limit WHERE ventana_inicio < NOW() - INTERVAL '1 day';
        GET DIAGNOSTICS v_rate_limits_borrados = ROW_COUNT;

        -- 3.2 Purgar sesiones administrativas revocadas y ya expiradas (con verificación dinámica de tabla)
        -- Justificación técnica: PL/pgSQL prepara las sentencias SQL estáticas en la primera llamada de la sesión.
        -- Si admin_sesiones_revocadas no existe aún (ej. migración 007 pendiente), una sentencia estática fallaría.
        -- Con EXECUTE dinámico protegido por IF EXISTS, la sentencia solo se compila y ejecuta si la tabla existe.
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_sesiones_revocadas') THEN
            EXECUTE 'DELETE FROM admin_sesiones_revocadas WHERE expira_at < NOW()';
            GET DIAGNOSTICS v_sesiones_borradas = ROW_COUNT;
        END IF;

    EXCEPTION WHEN OTHERS THEN
        v_error_msg := SQLERRM;
        v_error_code := SQLSTATE;
    END;

    -- 4. Manejo de fallos: persistir error sin actualizar 'ultima_ejecucion_exitosa'
    IF v_error_msg IS NOT NULL THEN
        INSERT INTO control_mantenimiento (
            tarea, ultimo_intento, ultimo_estado, detalles, updated_at
        )
        VALUES (
            'purgas_diarias',
            NOW(),
            'fallido',
            jsonb_build_object(
                'error', v_error_msg,
                'sqlstate', v_error_code,
                'fecha_fallo', NOW()
            ),
            NOW()
        )
        ON CONFLICT (tarea) DO UPDATE
        SET ultimo_intento = NOW(),
            ultimo_estado = 'fallido',
            detalles = jsonb_build_object(
                'error', v_error_msg,
                'sqlstate', v_error_code,
                'fecha_fallo', NOW()
            ),
            updated_at = NOW();

        RETURN jsonb_build_object(
            'ejecutado', false,
            'motivo', 'ERROR_OPERACION_PURGA',
            'error', v_error_msg,
            'sqlstate', v_error_code
        );
    END IF;

    -- 5. Manejo de éxito: actualizar 'ultima_ejecucion_exitosa'
    v_resultado := jsonb_build_object(
        'rate_limits_borrados', v_rate_limits_borrados,
        'sesiones_borradas', v_sesiones_borradas,
        'fecha_ejecucion', NOW()
    );

    INSERT INTO control_mantenimiento (
        tarea, ultima_ejecucion_exitosa, ultimo_intento, ultimo_estado, detalles, updated_at
    )
    VALUES (
        'purgas_diarias',
        NOW(),
        NOW(),
        'exitoso',
        v_resultado,
        NOW()
    )
    ON CONFLICT (tarea) DO UPDATE
    SET ultima_ejecucion_exitosa = NOW(),
        ultimo_intento = NOW(),
        ultimo_estado = 'exitoso',
        detalles = v_resultado,
        updated_at = NOW();

    RETURN jsonb_build_object(
        'ejecutado', true,
        'motivo', 'EXITO',
        'resultado', v_resultado
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================================
-- 11. RPC ADMINISTRATIVA: RECUPERAR NOTIFICACIONES SIMULADAS (DEFINITIVA)
-- ============================================================================
CREATE OR REPLACE FUNCTION recuperar_notificaciones_simuladas(
    p_limite INT DEFAULT 50,
    p_ignorar_anteriores_a DATE DEFAULT NULL
)
RETURNS TABLE (
    notificaciones_recuperadas INT,
    mensaje TEXT
) AS $$
DECLARE
    v_actualizadas INT := 0;
    v_fecha_corte DATE;
BEGIN
    -- 1. Validación defensiva de parámetros
    IF p_limite IS NULL OR p_limite <= 0 OR p_limite > 100 THEN
        p_limite := 50;
    END IF;

    -- Resolución de fecha de corte en zona horaria oficial de la clínica (America/Mexico_City)
    -- Si es NULL (por omisión o paso explícito), se ancla deterministamente al calendario de México
    IF p_ignorar_anteriores_a IS NULL THEN
        v_fecha_corte := (NOW() AT TIME ZONE 'America/Mexico_City')::DATE;
    ELSE
        v_fecha_corte := p_ignorar_anteriores_a;
    END IF;

    -- 2. Deduplicación determinista contra el historial completo de cada cita
    -- y coordinación jerárquica con la cita padre (Nivel 2 -> Nivel 3)
    WITH historial_completo AS (
        SELECT 
            q.id,
            q.estado,
            q.tipo,
            q.message_id,
            q.cita_id,
            ROW_NUMBER() OVER (
                PARTITION BY q.cita_id 
                ORDER BY q.created_at DESC, q.id DESC
            ) AS rn
        FROM cola_notificaciones_whatsapp q
        JOIN citas c ON c.id = q.cita_id
        WHERE c.estado != 'cancelada'
          AND c.fecha >= v_fecha_corte
    ),
    candidatas_recientes AS (
        SELECT h.id, h.cita_id
        FROM historial_completo h
        WHERE h.rn = 1
          AND h.estado = 'simulado'
          AND h.message_id IS NULL
          AND h.tipo IN ('confirmacion', 'reprogramacion')
    ),
    bloqueadas AS (
        SELECT q.id
        FROM cola_notificaciones_whatsapp q
        JOIN candidatas_recientes c ON c.id = q.id
        JOIN citas ct ON ct.id = c.cita_id
        WHERE ct.estado != 'cancelada'
        LIMIT p_limite
        FOR UPDATE OF q SKIP LOCKED
    ),
    actualizadas AS (
        UPDATE cola_notificaciones_whatsapp q
        SET estado = 'pendiente',
            intentos = 0,
            next_attempt_at = NOW(),
            bloqueado_hasta = NULL,
            bloqueado_por = NULL,
            ultimo_error = NULL
        FROM bloqueadas b
        WHERE q.id = b.id
        RETURNING q.id
    )
    SELECT COUNT(*) INTO v_actualizadas FROM actualizadas;

    RETURN QUERY SELECT 
        v_actualizadas,
        format('Se reactivaron exitosamente %s notificaciones simuladas para despacho real.', v_actualizadas);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================================
-- 11. CANCELAR CITA ADMINISTRATIVA CON CONTROL TRANSACCIONAL ATÓMICO (FASE F4.7)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancelar_cita_administrativa(
    p_cita_id UUID,
    p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cita RECORD;
    v_invalidadas INT := 0;
BEGIN
    -- 1. Jerarquía de Bloqueos F3.5: Nivel 2 (Fila padre en citas FOR UPDATE)
    SELECT id, estado, codigo_reserva, fecha
    INTO v_cita
    FROM public.citas
    WHERE id = p_cita_id
    FOR UPDATE;

    -- Validar existencia de la cita
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'CITA_NO_ENCONTRADA',
            'message', 'La cita especificada no existe en la base de datos'
        );
    END IF;

    -- 2. Validación estricta de la matriz de transiciones
    IF v_cita.estado NOT IN ('confirmada', 'no_asistio') THEN
        IF v_cita.estado = 'cancelada' THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'CITA_YA_CANCELADA',
                'message', 'La cita ya se encuentra en estado cancelada'
            );
        ELSIF v_cita.estado = 'atendida' THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'TRANSICION_INVALIDA',
                'message', 'No es posible cancelar una cita que ya fue atendida clínicamente'
            );
        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'code', 'TRANSICION_INVALIDA',
                'message', format('Transición no permitida desde estado "%s" hacia cancelada', v_cita.estado)
            );
        END IF;
    END IF;

    -- 3. Transición de estado y revocación inmediata de credenciales de paciente
    UPDATE public.citas
    SET estado = 'cancelada',
        motivo_cancelacion = COALESCE(p_motivo, 'Cancelada por el administrador'),
        token_revocado_at = NOW(),
        updated_at = NOW()
    WHERE id = v_cita.id;

    -- 4. Invalidación atómica de notificaciones activas (Nivel 3)
    -- Invalida de forma determinista estados: 'pendiente', 'simulado' y 'procesando'
    UPDATE public.cola_notificaciones_whatsapp
    SET estado = 'fallido',
        ultimo_error = 'INVALIDADA_POR_CANCELACION_ADMIN'
    WHERE cita_id = v_cita.id
      AND estado IN ('pendiente', 'simulado', 'procesando');

    GET DIAGNOSTICS v_invalidadas = ROW_COUNT;

    -- 5. Retorno canónico en snake_case nativo de PostgreSQL
    RETURN jsonb_build_object(
        'success', true,
        'cita_id', v_cita.id,
        'codigo_reserva', v_cita.codigo_reserva,
        'estado', 'cancelada',
        'notificaciones_invalidadas', v_invalidadas
    );
END;
$$;

ALTER FUNCTION public.cancelar_cita_administrativa(UUID, TEXT) OWNER TO postgres;

-- ============================================================================
-- PERMISOS Y PRIVILEGIOS DE EJECUCIÓN (LEAST PRIVILEGE)
-- ============================================================================

-- Revocar permisos públicos por defecto
REVOKE ALL ON FUNCTION obtener_horarios_disponibles(DATE, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION crear_cita_atomica(UUID, DATE, TIME, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, VARCHAR, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION reprogramar_cita_atomica(VARCHAR, DATE, TIME, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancelar_cita_atomica(VARCHAR, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelar_cita_administrativa(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION crear_bloqueo_agenda(DATE, TIME, TIME, VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION reclamar_notificaciones(VARCHAR, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION verificar_rate_limit(VARCHAR, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION purgar_rate_limits_expirados() FROM PUBLIC;
REVOKE ALL ON FUNCTION ejecutar_mantenimiento_diario(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION recuperar_notificaciones_simuladas(INT, DATE) FROM PUBLIC;

-- Revocación explícita preventiva para mutaciones hacia roles cliente (anon, authenticated)
REVOKE ALL ON FUNCTION crear_cita_atomica(UUID, DATE, TIME, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, VARCHAR, VARCHAR, UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION reprogramar_cita_atomica(VARCHAR, DATE, TIME, VARCHAR, UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION cancelar_cita_atomica(VARCHAR, TEXT, UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cancelar_cita_administrativa(UUID, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION crear_bloqueo_agenda(DATE, TIME, TIME, VARCHAR) FROM anon, authenticated;
REVOKE ALL ON FUNCTION reclamar_notificaciones(VARCHAR, INT, INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION verificar_rate_limit(VARCHAR, INT, INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION purgar_rate_limits_expirados() FROM anon, authenticated;
REVOKE ALL ON FUNCTION ejecutar_mantenimiento_diario(INT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION recuperar_notificaciones_simuladas(INT, DATE) FROM anon, authenticated;

-- Concesión de permisos específicos:
-- Lectura pública para consulta de slots disponibles (única RPC expuesta al frontend)
GRANT EXECUTE ON FUNCTION obtener_horarios_disponibles(DATE, INT, INT) TO anon, authenticated, service_role;

-- Procedimientos de mutación, rate limiting y mantenimiento: restringidos al backend autenticado / service_role
GRANT EXECUTE ON FUNCTION verificar_rate_limit(VARCHAR, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION crear_cita_atomica(UUID, DATE, TIME, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, VARCHAR, VARCHAR, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION reprogramar_cita_atomica(VARCHAR, DATE, TIME, VARCHAR, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION cancelar_cita_atomica(VARCHAR, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_cita_administrativa(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION crear_bloqueo_agenda(DATE, TIME, TIME, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION reclamar_notificaciones(VARCHAR, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION purgar_rate_limits_expirados() TO service_role;
GRANT EXECUTE ON FUNCTION ejecutar_mantenimiento_diario(INT) TO service_role;
GRANT EXECUTE ON FUNCTION recuperar_notificaciones_simuladas(INT, DATE) TO service_role;

-- ============================================================================
-- PARTE 6: POLÍTICAS DE ACCESO ROW LEVEL SECURITY (RLS) Y PRIVILEGIOS SQL
-- Archivo fuente: supabase/migrations/005_seguridad_rls.sql
-- ============================================================================

-- ============================================================================
-- MIGRACIÓN 005: POLÍTICAS DE ACCESO ROW LEVEL SECURITY (RLS) Y PRIVILEGIOS SQL
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
--
-- MODELO DE SEGURIDAD (FASE E1 - DEFENSE IN DEPTH / LEAST PRIVILEGE):
-- 1. El sistema administrativo de Rehabilita Sport NO utiliza Supabase Auth
--    (usuarios del rol 'authenticated'). Toda la administración opera a través
--    de Netlify Functions en servidor, autenticadas por cookies HttpOnly con
--    firmas criptográficas HMAC-SHA256 y token anti-CSRF sincronizado.
-- 2. El backend en Netlify Functions se comunica con Supabase utilizando la
--    clave de servicio privada ('service_role'), rol que cuenta por diseño
--    con el atributo BYPASSRLS en PostgreSQL.
-- 3. Los roles 'PUBLIC', 'anon' y 'authenticated' no tienen ninguna política
--    ni permiso administrativo. Se revoca todo acceso directo a tablas sensibles
--    (pacientes, citas, bloqueos_agenda, cola, rate_limit, terapeutas).
-- 4. Se autoriza lectura pública exclusivamente para servicios activos
--    (activo = true) y horarios generales de atención de la clínica.
-- ============================================================================

-- 1. HABILITAR ROW LEVEL SECURITY (RLS) EN TODAS LAS TABLAS CANÓNICAS
ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE terapeutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_atencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueos_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cola_notificaciones_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_rate_limit ENABLE ROW LEVEL SECURITY;

-- 2. LIMPIEZA IDEMPOTENTE DE POLÍTICAS PREVIAS
-- Garantiza compatibilidad tanto en bases de datos nuevas como en re-ejecuciones.
DROP POLICY IF EXISTS "Lectura pública de servicios activos" ON servicios;
DROP POLICY IF EXISTS "Lectura pública de horarios de atención" ON horarios_atencion;
DROP POLICY IF EXISTS "Admin select servicios" ON servicios;
DROP POLICY IF EXISTS "Admin insert servicios" ON servicios;
DROP POLICY IF EXISTS "Admin update servicios" ON servicios;
DROP POLICY IF EXISTS "Admin select terapeutas" ON terapeutas;
DROP POLICY IF EXISTS "Admin select horarios" ON horarios_atencion;
DROP POLICY IF EXISTS "Admin update horarios" ON horarios_atencion;
DROP POLICY IF EXISTS "Admin all bloqueos" ON bloqueos_agenda;
DROP POLICY IF EXISTS "Admin select pacientes" ON pacientes;
DROP POLICY IF EXISTS "Admin select citas" ON citas;
DROP POLICY IF EXISTS "Admin update citas" ON citas;

-- 3. DEFENSA EN PROFUNDIDAD: PRIVILEGIOS SQL A NIVEL DE TABLA (GRANT / REVOKE)
-- Revocar todos los privilegios heredados por defecto sobre tablas sensibles
REVOKE ALL ON pacientes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON citas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON bloqueos_agenda FROM PUBLIC, anon, authenticated;
REVOKE ALL ON terapeutas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON cola_notificaciones_whatsapp FROM PUBLIC, anon, authenticated;
REVOKE ALL ON control_rate_limit FROM PUBLIC, anon, authenticated;

-- En servicios y horarios_atencion: revocar mutaciones a roles cliente y permitir solo SELECT
REVOKE ALL ON servicios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON horarios_atencion FROM PUBLIC, anon, authenticated;
GRANT SELECT ON servicios TO anon, authenticated;
GRANT SELECT ON horarios_atencion TO anon, authenticated;

-- Otorgar privilegios SQL completos al rol operativo del backend (service_role)
GRANT ALL ON servicios TO service_role;
GRANT ALL ON terapeutas TO service_role;
GRANT ALL ON horarios_atencion TO service_role;
GRANT ALL ON bloqueos_agenda TO service_role;
GRANT ALL ON pacientes TO service_role;
GRANT ALL ON citas TO service_role;
GRANT ALL ON cola_notificaciones_whatsapp TO service_role;
GRANT ALL ON control_rate_limit TO service_role;

-- 4. PRIVILEGIOS PREDETERMINADOS (DEFAULT PRIVILEGES) EN ESQUEMA public (RESOLUCIÓN F64-02)
-- Neutraliza la concesión automática de permisos a roles cliente (PUBLIC, anon, authenticated)
-- para cualquier objeto futuro creado por el propietario de la aplicación ('postgres') dentro de 'public'.
-- ALCANCE ESTRICTO:
-- 1. Se restringe exclusivamente al rol ejecutor ('postgres') y al esquema 'public'.
-- 2. No intenta modificar 'supabase_admin' (cuyos ACLs son de gestión interna de la plataforma y no modificables por 'postgres').
-- 3. No altera privilegios por defecto globales fuera de 'public'.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- 5. POLÍTICAS RLS DE LECTURA PÚBLICA ESTRICTAMENTE CONTROLADAS
-- Solo se exponen catálogos de consulta general para el widget público de reserva.
CREATE POLICY "Lectura pública de servicios activos" 
ON servicios FOR SELECT 
TO anon, authenticated
USING (activo = true);

CREATE POLICY "Lectura pública de horarios de atención" 
ON horarios_atencion FOR SELECT 
TO anon, authenticated
USING (true);

-- NOTA DE CONTROL:
-- Las tablas 'pacientes', 'citas', 'bloqueos_agenda', 'terapeutas', 'cola_notificaciones_whatsapp'
-- y 'control_rate_limit' NO poseen ninguna política permisiva para 'anon' ni 'authenticated'.
-- Bajo el modelo RLS de PostgreSQL, la ausencia de políticas para un rol resulta en DENEGACIÓN TOTAL
-- (Default Deny), blindando la base de datos contra accesos directos por PostgREST.
-- El rol 'service_role' gestiona las operaciones administrativas mediante BYPASSRLS.

-- ============================================================================
-- PARTE 7: DATOS INICIALES DE PRUEBA (MOCKS)
-- Archivo fuente: supabase/migrations/006_datos_iniciales_prueba.sql
-- ============================================================================

-- ============================================================================
-- MIGRACIÓN 006: DATOS INICIALES DE PRUEBA (MOCK DATA)
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
-- ============================================================================

-- 1. Terapeuta / Recurso General predeterminado para el MVP
-- Inserción condicional idempotente ante reejecuciones secuenciales (no concurrente)
INSERT INTO terapeutas (nombre_completo, especialidad, activo)
SELECT 'Equipo General Rehabilita Sport', 'Agenda Clínica Central', true
WHERE NOT EXISTS (
    SELECT 1 FROM terapeutas WHERE nombre_completo = 'Equipo General Rehabilita Sport'
);

-- 2. Horarios de atención provisionales (Fuente: web oficial de Rehabilita Sport)
INSERT INTO horarios_atencion (dia_semana, hora_apertura, hora_cierre, laborable) VALUES
(1, '08:00', '18:00', true),  -- Lunes
(2, '08:00', '18:00', true),  -- Martes
(3, '08:00', '18:00', true),  -- Miércoles
(4, '08:00', '18:00', true),  -- Jueves
(5, '08:00', '18:00', true),  -- Viernes
(6, '09:00', '13:00', true),  -- Sábado
(0, '00:00', '00:00', false)  -- Domingo (Cerrado)
ON CONFLICT (dia_semana) DO UPDATE 
SET hora_apertura = EXCLUDED.hora_apertura, 
    hora_cierre = EXCLUDED.hora_cierre, 
    laborable = EXCLUDED.laborable;

-- 3. Catálogo dinámico de servicios de prueba iniciales (etiquetados para fácil reemplazo)
-- Inserción condicional idempotente ante reejecuciones secuenciales (no concurrente)
INSERT INTO servicios (nombre, descripcion, duracion_minutos, activo, orden)
SELECT v.nombre, v.descripcion, v.duracion_minutos, v.activo, v.orden
FROM (VALUES
    ('[PRUEBA] Fisioterapia General', 'Sesión de valoración y terapia física personalizada de prueba.', 60, true, 1),
    ('[PRUEBA] Rehabilitación Deportiva', 'Tratamiento enfocado en recuperación muscular y prevención de lesiones.', 60, true, 2),
    ('[PRUEBA] Terapia en Cámara Hiperbárica', 'Sesión de oxigenación a presión controlada.', 60, true, 3),
    ('[PRUEBA] Consulta de Valoración Ortopédica', 'Diagnóstico inicial de traumatología y lesiones articulares.', 60, true, 4)
) AS v(nombre, descripcion, duracion_minutos, activo, orden)
WHERE NOT EXISTS (
    SELECT 1 FROM servicios s WHERE s.nombre = v.nombre
);

-- ============================================================================
-- FIN DE TRANSACCIÓN ATÓMICA CONSOLIDADA
-- ============================================================================
COMMIT;

-- ============================================================================
-- CONSULTAS DE VERIFICACIÓN POST-EJECUCIÓN (SUPABASE SQL EDITOR)
-- (Ejecutar independientemente para validar la integridad del despliegue)
-- ============================================================================

-- 1. Verificar existencia de las 10 tablas canónicas del sistema
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS total_columnas
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'servicios',
    'terapeutas',
    'horarios_atencion',
    'bloqueos_agenda',
    'pacientes',
    'citas',
    'cola_notificaciones_whatsapp',
    'control_rate_limit',
    'control_mantenimiento',
    'admin_sesiones_revocadas'
  )
ORDER BY table_name;

-- 2. Verificar que Row Level Security (RLS) esté activo en las 10 tablas
SELECT 
    tablename,
    rowsecurity AS rls_habilitado
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'servicios',
    'terapeutas',
    'horarios_atencion',
    'bloqueos_agenda',
    'pacientes',
    'citas',
    'cola_notificaciones_whatsapp',
    'control_rate_limit',
    'control_mantenimiento',
    'admin_sesiones_revocadas'
  )
ORDER BY tablename;

-- 3. Verificar que las 11 funciones RPC canónicas existan con SECURITY DEFINER
SELECT 
    routine_name,
    security_type,
    external_language
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'obtener_horarios_disponibles',
    'crear_cita_atomica',
    'reprogramar_cita_atomica',
    'cancelar_cita_atomica',
    'crear_bloqueo_agenda',
    'reclamar_notificaciones',
    'verificar_rate_limit',
    'purgar_rate_limits_expirados',
    'ejecutar_mantenimiento_diario',
    'recuperar_notificaciones_simuladas',
    'purgar_sesiones_revocadas_expiradas'
  )
ORDER BY routine_name;

-- 4. Verificar datos semilla de prueba (Mocks)
SELECT 
    (SELECT COUNT(*) FROM terapeutas) AS total_terapeutas,
    (SELECT COUNT(*) FROM horarios_atencion) AS total_dias_horario,
    (SELECT COUNT(*) FROM servicios) AS total_servicios;
