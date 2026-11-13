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
