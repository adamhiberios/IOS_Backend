/**
 * Per-worker setup. Runs in the Jest worker process BEFORE any test code
 * (and therefore before AppModule and its decorators) is imported.
 *
 * Why this file exists:
 *   globalSetup runs in a *separate* Node process and its `process.env`
 *   changes don't propagate to test workers. We need NODE_ENV=test and a
 *   DATABASE_URL pointing at ios_lms_test to be set before AppModule
 *   evaluates its `ThrottlerModule.forRoot([...])` literal (which reads
 *   process.env.NODE_ENV at module-load time).
 *
 *   globalSetup writes the runtime URL to .env.test-runtime; this file
 *   reads it back. It also pins NODE_ENV=test.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

process.env.NODE_ENV = 'test';

// Prefer the .env.test-runtime file the globalSetup wrote, but fall back
// to whatever DATABASE_URL the developer has if it points at ios_lms_test.
const runtimeEnvPath = path.resolve(__dirname, '../../.env.test-runtime');
if (fs.existsSync(runtimeEnvPath)) {
  dotenv.config({ path: runtimeEnvPath, override: true });
} else {
  // Fallback: derive from .env by swapping db/user
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  const url = process.env.DATABASE_URL ?? '';
  const m = /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/.exec(url);
  if (m) {
    process.env.DATABASE_URL = `postgresql://ios_lms_app:apppass@${m[3]}:${m[4]}/ios_lms_test`;
  }
}
