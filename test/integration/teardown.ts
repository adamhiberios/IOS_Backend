import { Client } from 'pg';

/**
 * Global teardown. Drops the test database so the next run starts clean.
 * If KEEP_TEST_DB=1 is set, the DB is preserved for post-mortem inspection.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.KEEP_TEST_DB === '1') {
    console.log(
      '\n[integration teardown] KEEP_TEST_DB=1 set — test DB preserved',
    );
    return;
  }

  const testDbName = (globalThis as Record<string, unknown>)
    .__TEST_DB_NAME__ as string | undefined;
  const baseUrl = (globalThis as Record<string, unknown>).__BASE_DB_URL__ as
    | { host: string; port: number; user: string; password: string }
    | undefined;

  if (!testDbName || !baseUrl) {
    console.warn('[integration teardown] no test DB metadata in globalThis');
    return;
  }

  const admin = new Client({
    host: baseUrl.host,
    port: baseUrl.port,
    user: baseUrl.user,
    password: baseUrl.password,
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [testDbName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
  await admin.end();
  console.log(`[integration teardown] dropped ${testDbName}`);

  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const runtimePath = path.resolve(__dirname, '../../.env.test-runtime');
  if (fs.existsSync(runtimePath)) {
    fs.unlinkSync(runtimePath);
  }
}
