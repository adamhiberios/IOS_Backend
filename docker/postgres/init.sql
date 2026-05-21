-- =============================================================================
-- Postgres init script for IOS LMS
--
-- Runs once on first container startup (when the data volume is empty).
-- Subsequent starts skip this; data persists in the Docker volume.
-- =============================================================================

-- pgcrypto provides gen_random_uuid() used by the test_sessions table.
-- Postgres 13+ has this built-in, but the extension must be explicitly
-- created in the target database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Optional: btree_gin for any future composite indexes we may want.
-- Free to enable — costs nothing if unused.
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- pg_trgm powers the GIN trigram indexes on translated titles (i18n catalog
-- search). Installed here so it's pre-created by the postgres superuser at
-- first container start — extensions that register operator classes used by
-- indexes cannot be cleanly REASSIGN'd later, so we must avoid letting a
-- non-superuser run their first CREATE EXTENSION pg_trgm.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
