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
