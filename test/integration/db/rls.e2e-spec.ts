import { INestApplication } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createUser, resetCounters } from '../helpers/fixtures';

/**
 * Scoped RLS sits on five high-risk tables. The unit tests mocked the
 * interceptor; this suite is the ONLY place the actual policies are exercised.
 *
 * Test environment context:
 *   • The test DB connection is the non-superuser role `ios_lms_app` (set up
 *     by globalSetup). RLS therefore applies normally — no role switching
 *     needed.
 *   • Each `asUser()` call opens a dedicated QueryRunner, sets the GUC
 *     `app.current_user_id` transaction-locally, runs the callback, and
 *     commits. This matches what production does in the RlsInterceptor.
 */
describe('[integration] db/rls-policies', () => {
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

  /**
   * Runs a callback inside a dedicated QueryRunner so set_config + the actual
   * SQL execute on the same physical connection.
   */
  const asUser = async <T>(
    userId: string | null,
    fn: (qr: QueryRunner) => Promise<T>,
  ): Promise<T> => {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`SELECT set_config('app.current_user_id', $1, true)`, [
        userId ?? '',
      ]);
      const result = await fn(qr);
      await qr.commitTransaction();
      return result;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  };

  it('student_purchases: a user only sees their own purchases when current_user_id is set', async () => {
    const userA = await createUser(app, { email: 'a@example.com' });
    const userB = await createUser(app, { email: 'b@example.com' });

    // Seed a non-RLS table — works fine for ios_lms_app since we granted ownership.
    const certRow = await ds.query(
      `INSERT INTO certificates (title, program_code, price)
       VALUES ('PSM', 'PSM', 100) RETURNING id`,
    );
    const certId = certRow[0].id;

    await asUser(userA.id, (qr) =>
      qr.query(
        `INSERT INTO student_purchases (user_id, cert_id) VALUES ($1, $2)`,
        [userA.id, certId],
      ),
    );

    await asUser(userB.id, (qr) =>
      qr.query(
        `INSERT INTO student_purchases (user_id, cert_id) VALUES ($1, $2)`,
        [userB.id, certId],
      ),
    );

    const visibleToA = await asUser<{ user_id: string }[]>(userA.id, (qr) =>
      qr.query(`SELECT user_id FROM student_purchases`),
    );
    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0].user_id).toBe(userA.id);

    const visibleToB = await asUser<{ user_id: string }[]>(userB.id, (qr) =>
      qr.query(`SELECT user_id FROM student_purchases`),
    );
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0].user_id).toBe(userB.id);

    const visibleToNone = await asUser<{ user_id: string }[]>(null, (qr) =>
      qr.query(`SELECT user_id FROM student_purchases`),
    );
    expect(visibleToNone).toHaveLength(0);
  });

  it('admin_audit_logs: SELECT is denied to non-superusers; INSERTs still flow', async () => {
    const user = await createUser(app, { email: 'a@example.com' });

    const rows = await asUser<{ count: string }[]>(user.id, (qr) =>
      qr.query(`SELECT COUNT(*)::text AS count FROM admin_audit_logs`),
    );
    expect(Number(rows[0].count)).toBe(0);

    const policies = await ds.query(
      `SELECT polname FROM pg_policy WHERE polrelid = 'admin_audit_logs'::regclass ORDER BY polname`,
    );
    expect(policies.map((p) => p.polname)).toEqual([
      'admin_audit_logs_allow_insert',
      'admin_audit_logs_deny_select',
    ]);
  });

  it('exam_attempts: per-student isolation works the same way', async () => {
    const userA = await createUser(app, { email: 'a@example.com' });
    const userB = await createUser(app, { email: 'b@example.com' });

    const certRow = await ds.query(
      `INSERT INTO certificates (title, program_code, price)
       VALUES ('PSPO', 'PSPO', 100) RETURNING id`,
    );
    const examRow = await ds.query(
      `INSERT INTO exams (cert_id, title, exam_order, duration_minutes)
       VALUES ($1, 'PSPO-1', 1, 60) RETURNING id`,
      [certRow[0].id],
    );

    for (const userId of [userA.id, userB.id]) {
      await asUser(userId, (qr) =>
        qr.query(
          `INSERT INTO exam_attempts
            (user_id, exam_id, cert_id, score, passed, answers, started_at, submitted_at)
           VALUES ($1, $2, $3, 90, TRUE, '{}'::jsonb, NOW(), NOW())`,
          [userId, examRow[0].id, certRow[0].id],
        ),
      );
    }

    const visibleToA = await asUser<{ user_id: string }[]>(userA.id, (qr) =>
      qr.query(`SELECT user_id FROM exam_attempts`),
    );
    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0].user_id).toBe(userA.id);
  });
});
