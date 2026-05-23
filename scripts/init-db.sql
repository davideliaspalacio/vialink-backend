-- ============================================
-- Vialink — DB initialization SQL
-- Run ONCE on a fresh Supabase project before `prisma migrate dev`
-- (or after `prisma migrate reset`).
--
-- Extensions postgis, pg_trgm, uuid-ossp are required by the schema.
-- pgcrypto, pg_stat_statements, supabase_vault are pre-installed by Supabase.
-- ============================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verify
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('postgis', 'pg_trgm', 'uuid-ossp')
ORDER BY extname;
