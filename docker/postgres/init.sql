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
