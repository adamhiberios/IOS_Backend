import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { http, loginAsAdmin } from '../helpers/http';
import { createUser, createAdmin, resetCounters } from '../helpers/fixtures';
import { AdminRole } from '../../../src/database/entities';

/**
 * /health is a public liveness probe (no auth). /health/full is restricted
 * to super_admin because it leaks internal connectivity status (DB, Redis,
 * etc.) that we do not want exposed publicly.
 *
 * Matrix:
 *   GET /health                              → 200 (anyone)
 *   GET /api/v1/health/full   (no auth)      → 401
 *   GET /api/v1/health/full   (student)      → 403
 *   GET /api/v1/health/full   (learning_admin) → 403
 *   GET /api/v1/health/full   (super_admin)  → 200 with services payload
 */
describe('[integration] health/full rbac', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    app = await buildTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(ds);
    resetCounters();
  });

  it('GET /health is publicly accessible (no auth required)', async () => {
    const res = await http(app).get('/health').expect(200);
    const body = res.body as {
      status: string;
      version: string;
      uptime: number;
      timestamp: string;
    };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    // Critically: this endpoint must NOT leak service details
    expect(body).not.toHaveProperty('services');
  });

  it('GET /api/v1/health/full without auth returns 401', async () => {
    await http(app).get('/api/v1/health/full').expect(401);
  });

  it('GET /api/v1/health/full with a student JWT returns 403', async () => {
    const student = await createUser(app);
    const loginRes = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: student.email, password: student.password })
      .expect(200);
    const studentToken = (loginRes.body as { accessToken: string }).accessToken;

    await http(app)
      .get('/api/v1/health/full')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
  });

  it('GET /api/v1/health/full with a learning_admin JWT returns 403', async () => {
    const learn = await createAdmin(app, {
      email: 'learn@example.com',
      role: AdminRole.LEARNING_ADMIN,
    });
    const { accessToken } = await loginAsAdmin(
      app,
      learn.email,
      learn.password,
    );

    await http(app)
      .get('/api/v1/health/full')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('GET /api/v1/health/full with a super_admin JWT returns 200 with services payload', async () => {
    const su = await createAdmin(app, {
      email: 'su@example.com',
      role: AdminRole.SUPER_ADMIN,
    });
    const { accessToken } = await loginAsAdmin(app, su.email, su.password);

    const res = await http(app)
      .get('/api/v1/health/full')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as {
      status: string;
      services: {
        database: string;
        storage?: { status: string; buckets: Record<string, boolean> };
      };
      version: string;
      uptime: number;
      timestamp: string;
    };
    // Database is the only critical service for the suite's purposes — it
    // must be 'ok'. Storage (added Week 3) hits MinIO; if MinIO isn't running
    // in the test stack, storage reports degraded and so does the overall
    // status. Both are valid runtime states, so we accept either.
    expect(['ok', 'degraded']).toContain(body.status);
    expect(body.services).toBeDefined();
    expect(body.services.database).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /health/full (old path) is no longer reachable — moved under /api/v1', async () => {
    // 404 because we removed it from the prefix-exclude list. This guards
    // against accidentally re-exposing the route at its old public path.
    await http(app).get('/health/full').expect(404);
  });
});
