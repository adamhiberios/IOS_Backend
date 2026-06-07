import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { http, loginAsAdmin } from '../helpers/http';
import {
  createUser,
  createAdmin,
  resetCounters,
} from '../helpers/fixtures';
import { AdminRole } from '../../../src/database/entities';

/**
 * Regression test for the security finding logged in SECURITY_REVIEW.md:
 *
 *   ExamAdminController was missing @UseGuards(RolesGuard), so any
 *   authenticated user (including a regular student) could call
 *   POST /api/v1/admin/exam/assign and mint exam access codes.
 *
 * This suite locks in the fix. Matrix:
 *
 *   POST /api/v1/admin/exam/assign  (no auth)               → 401
 *   POST /api/v1/admin/exam/assign  (student JWT)           → 403   ← was 201 before fix
 *   POST /api/v1/admin/exam/assign  (support_admin JWT)     → 403
 *   POST /api/v1/admin/exam/assign  (learning_admin JWT)    → reaches handler (≥400 fine for our purposes;
 *                                                             no Exam fixture so 404, but NOT 403)
 *
 * We deliberately don't validate the happy-path response body — that belongs
 * in a dedicated assign-flow test. What we're asserting here is exclusively
 * the authorization boundary.
 */
describe('[integration] admin/exam/assign RBAC', () => {
  let app: INestApplication;
  let ds: DataSource;

  const validBody = {
    // These UUIDs don't need to exist — RolesGuard runs before the handler,
    // so for the 401/403 cases the body is never inspected. For the 200/404
    // case (learning_admin) we tolerate either outcome because the only
    // assertion that matters is "the role gate let us through".
    userId: '00000000-0000-0000-0000-000000000001',
    examId: '00000000-0000-0000-0000-000000000002',
    certId: '00000000-0000-0000-0000-000000000003',
  };

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

  it('POST /api/v1/admin/exam/assign without auth returns 401', async () => {
    await http(app)
      .post('/api/v1/admin/exam/assign')
      .send(validBody)
      .expect(401);
  });

  it('POST /api/v1/admin/exam/assign with a student JWT returns 403 (regression: was 201 before guard fix)', async () => {
    const student = await createUser(app);
    const loginRes = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: student.email, password: student.password })
      .expect(200);
    const studentToken = (loginRes.body as { accessToken: string }).accessToken;

    const res = await http(app)
      .post('/api/v1/admin/exam/assign')
      .set('Authorization', `Bearer ${studentToken}`)
      .send(validBody);

    // The critical assertion: a student is NOT granted access. Before the
    // RolesGuard fix this returned 201 with a freshly-minted access code.
    expect(res.status).toBe(403);
    // And — crucially — no plainCode in the body.
    expect(res.body).not.toHaveProperty('plainCode');
  });

  it('POST /api/v1/admin/exam/assign with a support_admin JWT returns 403 (insufficient role)', async () => {
    const support = await createAdmin(app, {
      email: 'support@example.com',
      role: AdminRole.SUPPORT_ADMIN,
    });
    const { accessToken } = await loginAsAdmin(
      app,
      support.email,
      support.password,
    );

    await http(app)
      .post('/api/v1/admin/exam/assign')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody)
      .expect(403);
  });

  it('POST /api/v1/admin/exam/assign with a learning_admin JWT passes the role gate', async () => {
    const learn = await createAdmin(app, {
      email: 'learn@example.com',
      role: AdminRole.LEARNING_ADMIN,
    });
    const { accessToken } = await loginAsAdmin(
      app,
      learn.email,
      learn.password,
    );

    const res = await http(app)
      .post('/api/v1/admin/exam/assign')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody);

    // We don't seed an exam, so the handler 404s. What matters is we got
    // PAST the RolesGuard — anything other than 401/403 confirms that.
    expect([200, 201, 400, 404, 409, 422, 500]).toContain(res.status);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
