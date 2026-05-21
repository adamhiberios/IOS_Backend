import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { ALL_ENTITIES } from '../../src/database/config/typeorm.config';

/**
 * Integration-test globalSetup. Runs ONCE before any test suite.
 *
 * Pipeline:
 *   1. Load .env so we know the admin Postgres credentials.
 *   2. Connect to maintenance DB as admin, drop + recreate ios_lms_test.
 *      Also ensure a non-superuser role `ios_lms_app` exists.
 *   3. Run all migrations against ios_lms_test as the admin role. The first
 *      migration step installs pgcrypto.
 *   4. Reassign ownership of every schema object to ios_lms_app so it has
 *      full TRUNCATE / sequence rights. ios_lms_app is NOSUPERUSER NOBYPASSRLS
 *      so FORCE ROW LEVEL SECURITY policies actually apply during tests.
 *   5. Stash the test DATABASE_URL pointing at the app role for the test
 *      suites to consume when they bootstrap their Nest app.
 */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });

  const baseUrl = parseDatabaseUrl(
    process.env.DATABASE_URL ??
      'postgresql://ios:iospass@127.0.0.1:5432/ios_lms',
  );
  const testDbName = process.env.TEST_DB_NAME ?? 'ios_lms_test';
  const appRole = process.env.TEST_DB_APP_ROLE ?? 'ios_lms_app';
  const appPass = process.env.TEST_DB_APP_PASS ?? 'apppass';

  console.log(
    `\n[integration setup] target ${baseUrl.host}:${baseUrl.port} db=${testDbName} role=${appRole}`,
  );

  // ── 1. Maintenance DB connection: drop+recreate test DB, ensure role ──
  const admin = new Client({
    host: baseUrl.host,
    port: baseUrl.port,
    user: baseUrl.user,
    password: baseUrl.password,
    database: 'postgres',
  });
  await admin.connect();

  // Kill any lingering connections to the test DB
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [testDbName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
  await admin.query(`CREATE DATABASE "${testDbName}"`);

  // Idempotently create the non-superuser app role
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
        CREATE ROLE ${appRole} NOSUPERUSER NOBYPASSRLS LOGIN PASSWORD '${appPass}';
      END IF;
    END
    $$;
  `);
  await admin.end();
  console.log(`[integration setup] test DB recreated, role ensured`);

  // ── 2. Run migrations against test DB as admin ────────────────────────
  const adminTestUrl = buildDatabaseUrl({ ...baseUrl, database: testDbName });
  const migrationDs = new DataSource({
    type: 'postgres',
    url: adminTestUrl,
    entities: ALL_ENTITIES,
    migrations: [
      path.resolve(__dirname, '../../src/database/migrations/*.{ts,js}'),
    ],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: false,
  });
  await migrationDs.initialize();

  // Pre-install every extension the migrations rely on. This runs as the
  // admin role (which is the cluster superuser in the docker setup), which
  // matters because:
  //
  //   * pgcrypto provides gen_random_uuid() used by test_sessions.
  //   * pg_trgm provides the gin_trgm_ops operator class consumed by the
  //     i18n catalog-search GIN indexes (migration 1748000000000). Letting
  //     CREATE EXTENSION pg_trgm fall to the migration would still work, but
  //     once the migration creates an index that references the operator
  //     class, a later REASSIGN OWNED on the installer cannot move the
  //     extension catalog entries and fails with "objects required by the
  //     database system". Installing it here, idempotently, sidesteps that.
  await migrationDs.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrationDs.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  const ran = await migrationDs.runMigrations();

  // ── 3. Hand ownership to the app role ─────────────────────────────────
  // After this point, ios_lms_app can TRUNCATE, RESTART IDENTITY, etc. on
  // every table without superuser privileges. RLS still applies because the
  // role is NOSUPERUSER NOBYPASSRLS and policies use FORCE.
  //
  // We deliberately AVOID the blanket `REASSIGN OWNED BY` form here. That
  // command walks every object the current user owns — including extension
  // catalog entries — and Postgres refuses to move catalog objects that are
  // "required by the database system" (pg_trgm's operator classes are pinned
  // as soon as a GIN index references them). Instead we enumerate exactly
  // what the test runner needs to truncate / mutate: public-schema tables,
  // sequences, and functions. This is robust against any future extension
  // we add to migrations.
  await migrationDs.query(`
    DO $do$
    DECLARE
      r record;
      target text := '${appRole}';
    BEGIN
      FOR r IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      LOOP
        EXECUTE format('ALTER TABLE %I.%I OWNER TO %I',
                       r.schemaname, r.tablename, target);
      END LOOP;

      FOR r IN
        SELECT schemaname, sequencename
        FROM pg_sequences
        WHERE schemaname = 'public'
      LOOP
        EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I',
                       r.schemaname, r.sequencename, target);
      END LOOP;

      FOR r IN
        SELECT n.nspname AS schemaname,
               p.oid::regprocedure::text AS funcsig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
      LOOP
        EXECUTE format('ALTER FUNCTION %s OWNER TO %I',
                       r.funcsig, target);
      END LOOP;
    END
    $do$;
  `);
  await migrationDs.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
  await migrationDs.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO ${appRole}`,
  );
  await migrationDs.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`,
  );
  await migrationDs.query(
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${appRole}`,
  );

  await migrationDs.destroy();
  console.log(
    `[integration setup] ran ${ran.length} migration(s), ownership reassigned`,
  );

  // ── 4. Export the runtime URL for the test suites ─────────────────────
  const appRuntimeUrl = buildDatabaseUrl({
    ...baseUrl,
    user: appRole,
    password: appPass,
    database: testDbName,
  });
  process.env.DATABASE_URL = appRuntimeUrl;
  process.env.NODE_ENV = 'test';

  // Jest spawns each test worker in a separate Node process whose env does
  // NOT inherit changes we make here. Persist the runtime config to a file
  // that setup-env.ts (a per-worker setupFile) reads before AppModule loads.
  const runtimeEnv = `DATABASE_URL=${appRuntimeUrl}\nNODE_ENV=test\n`;

  const fs = require('fs') as typeof import('fs');
  fs.writeFileSync(
    path.resolve(__dirname, '../../.env.test-runtime'),
    runtimeEnv,
  );

  // Stash teardown metadata
  (globalThis as Record<string, unknown>).__TEST_DB_NAME__ = testDbName;
  (globalThis as Record<string, unknown>).__BASE_DB_URL__ = baseUrl;
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface ParsedUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function parseDatabaseUrl(url: string): ParsedUrl {
  const m = /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/.exec(url);
  if (!m) throw new Error(`Cannot parse DATABASE_URL: ${url}`);
  return {
    user: m[1],
    password: m[2],
    host: m[3],
    port: Number(m[4]),
    database: m[5],
  };
}

function buildDatabaseUrl(p: ParsedUrl): string {
  return `postgresql://${p.user}:${p.password}@${p.host}:${p.port}/${p.database}`;
}
