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

