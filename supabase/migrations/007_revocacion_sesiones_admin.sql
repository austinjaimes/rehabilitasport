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
