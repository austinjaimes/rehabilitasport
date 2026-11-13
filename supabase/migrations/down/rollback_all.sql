-- ============================================================================
-- SCRIPT DE REVERSIÓN TOTAL (ROLLBACK) - EXCLUSIVO PARA DESARROLLO / PRUEBAS
-- Proyecto: Sistema de Citas Rehabilita Sport (MVP)
--
-- ¡ADVERTENCIA CRÍTICA: NUNCA EJECUTAR EN AMBIENTES DE PRODUCCIÓN!
-- Este script destruye irreversiblemente todas las tablas, citas, pacientes,
-- funciones y registros de auditoría de la clínica.
-- ============================================================================

-- 1. Eliminar Procedimientos RPC
DROP FUNCTION IF EXISTS purgar_rate_limits_expirados();
DROP FUNCTION IF EXISTS verificar_rate_limit(VARCHAR, INT, INT);
DROP FUNCTION IF EXISTS reclamar_notificaciones(VARCHAR, INT, INT);
DROP FUNCTION IF EXISTS crear_bloqueo_agenda(DATE, TIME, TIME, VARCHAR);
DROP FUNCTION IF EXISTS cancelar_cita_atomica(VARCHAR, TEXT, UUID);
DROP FUNCTION IF EXISTS reprogramar_cita_atomica(VARCHAR, DATE, TIME, VARCHAR, UUID);
DROP FUNCTION IF EXISTS crear_cita_atomica(UUID, DATE, TIME, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, VARCHAR, VARCHAR, UUID);
DROP FUNCTION IF EXISTS obtener_horarios_disponibles(DATE, INT, INT);

-- 2. Eliminar Tablas en orden inverso a sus dependencias
DROP TABLE IF EXISTS control_rate_limit CASCADE;
DROP TABLE IF EXISTS cola_notificaciones_whatsapp CASCADE;
DROP TABLE IF EXISTS citas CASCADE;
DROP TABLE IF EXISTS pacientes CASCADE;
DROP TABLE IF EXISTS bloqueos_agenda CASCADE;
DROP TABLE IF EXISTS horarios_atencion CASCADE;
DROP TABLE IF EXISTS terapeutas CASCADE;
DROP TABLE IF EXISTS servicios CASCADE;

-- 3. Eliminar Tipos Enumerados
DROP TYPE IF EXISTS tipo_notificacion CASCADE;
DROP TYPE IF EXISTS estado_notificacion CASCADE;
DROP TYPE IF EXISTS estado_cita CASCADE;

