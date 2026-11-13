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
