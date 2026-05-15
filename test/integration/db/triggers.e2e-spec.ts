import { INestApplication } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createUser, createAdmin, resetCounters } from '../helpers/fixtures';
import { AdminRole } from '../../../src/database/entities';

describe('[integration] db/triggers', () => {
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
   * Runs SQL inside a transaction with the given context vars set, on a
   * single QueryRunner so set_config + SQL stay on the same connection.
   */
  const withContext = async <T>(
    vars: { userId?: string; adminId?: string },
    fn: (qr: QueryRunner) => Promise<T>,
  ): Promise<T> => {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      if (vars.userId !== undefined) {
        await qr.query(`SELECT set_config('app.current_user_id', $1, true)`, [
          vars.userId,
        ]);
      }
      if (vars.adminId !== undefined) {
        await qr.query(`SELECT set_config('app.current_admin_id', $1, true)`, [
          vars.adminId,
        ]);
      }
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

  describe('protect_super_admin_role trigger', () => {
    it('blocks UPDATE of a super_admin row', async () => {
      const superAdmin = await createAdmin(app, {
        email: 'super@example.com',
        role: AdminRole.SUPER_ADMIN,
      });

      await expect(
        ds.query(`UPDATE admin_users SET first_name = 'Hacked' WHERE id = $1`, [
          superAdmin.id,
        ]),
      ).rejects.toThrow(/super_admin/);
    });

    it('blocks DELETE of a super_admin row', async () => {
      const superAdmin = await createAdmin(app, {
        email: 'super@example.com',
        role: AdminRole.SUPER_ADMIN,
      });

      await expect(
        ds.query(`DELETE FROM admin_users WHERE id = $1`, [superAdmin.id]),
      ).rejects.toThrow(/super_admin/);
    });

    it('allows UPDATE of non-super-admin rows', async () => {
      const learningAdmin = await createAdmin(app, {
        email: 'learn@example.com',
        role: AdminRole.LEARNING_ADMIN,
      });

      await ds.query(
        `UPDATE admin_users SET first_name = 'Updated' WHERE id = $1`,
        [learningAdmin.id],
      );

      const updated = await ds.query(
        `SELECT first_name FROM admin_users WHERE id = $1`,
        [learningAdmin.id],
      );
      expect(updated[0].first_name).toBe('Updated');
    });
  });

  describe('set_cert_sequence trigger', () => {
    it('generates IOS-{PROG}-{YYYY}-{6-digit} cert_id on INSERT', async () => {
      const user = await createUser(app);
      const admin = await createAdmin(app, {
        email: 'admin-for-cert@example.com',
        role: AdminRole.LEARNING_ADMIN,
      });

      // certificates is not RLS-protected, but the audit trigger fires on
      // INSERT and writes to admin_audit_logs — needs admin context.
      const certificateId = await withContext(
        { adminId: admin.id },
        async (qr) => {
          const rows = (await qr.query(
            `INSERT INTO certificates (title, program_code, price)
             VALUES ('Professional Scrum Master', 'PSM', 250) RETURNING id`,
          )) as { id: string }[];
          return rows[0].id;
        },
      );

      // exams: also audited, needs admin context
      const examId = await withContext({ adminId: admin.id }, async (qr) => {
        const rows = (await qr.query(
          `INSERT INTO exams (cert_id, title, exam_order, duration_minutes)
           VALUES ($1, 'PSM 1', 1, 60) RETURNING id`,
          [certificateId],
        )) as { id: string }[];
        return rows[0].id;
      });

      // exam_attempts: RLS-protected, needs user context
      const attemptId = await withContext({ userId: user.id }, async (qr) => {
        const rows = (await qr.query(
          `INSERT INTO exam_attempts
              (user_id, exam_id, cert_id, score, passed, answers, started_at, submitted_at)
             VALUES ($1, $2, $3, 95, TRUE, '{}'::jsonb, NOW(), NOW())
             RETURNING id`,
          [user.id, examId, certificateId],
        )) as { id: string }[];
        return rows[0].id;
      });

      // issued_certificates: RLS-protected — set_cert_sequence trigger fires
      const inserted = await withContext({ userId: user.id }, async (qr) => {
        const rows = (await qr.query(
          `INSERT INTO issued_certificates
              (user_id, certificate_id, exam_attempt_id, issued_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, cert_id`,
          [user.id, certificateId, attemptId],
        )) as { id: string; cert_id: string }[];
        return rows[0];
      });

      expect(inserted.cert_id).toMatch(/^IOS-PSM-\d{4}-\d{6}$/);
    });

    it('issues sequential cert IDs within the same program', async () => {
      const user = await createUser(app);
      const admin = await createAdmin(app, {
        email: 'admin-seq@example.com',
        role: AdminRole.LEARNING_ADMIN,
      });

      const certificateId = await withContext(
        { adminId: admin.id },
        async (qr) => {
          const rows = (await qr.query(
            `INSERT INTO certificates (title, program_code, price)
             VALUES ('PSPO', 'PSPO', 250) RETURNING id`,
          )) as { id: string }[];
          return rows[0].id;
        },
      );

      const examId = await withContext({ adminId: admin.id }, async (qr) => {
        const rows = (await qr.query(
          `INSERT INTO exams (cert_id, title, exam_order, duration_minutes)
           VALUES ($1, 'PSPO 1', 1, 60) RETURNING id`,
          [certificateId],
        )) as { id: string }[];
        return rows[0].id;
      });

      const issued: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const result = await withContext({ userId: user.id }, async (qr) => {
          const attempt = (await qr.query(
            `INSERT INTO exam_attempts
                (user_id, exam_id, cert_id, score, passed, answers, started_at, submitted_at)
               VALUES ($1, $2, $3, 90, TRUE, '{}'::jsonb, NOW(), NOW())
               RETURNING id`,
            [user.id, examId, certificateId],
          )) as { id: string }[];
          const cert = (await qr.query(
            `INSERT INTO issued_certificates
                (user_id, certificate_id, exam_attempt_id, issued_at)
               VALUES ($1, $2, $3, NOW())
               RETURNING cert_id`,
            [user.id, certificateId, attempt[0].id],
          )) as { cert_id: string }[];
          return cert[0].cert_id;
        });
        issued.push(result);
      }

      expect(new Set(issued).size).toBe(3);
      for (const id of issued) {
        expect(id).toMatch(/^IOS-PSPO-\d{4}-\d{6}$/);
      }
      const seqs = issued.map((id) => Number(id.split('-').slice(-1)[0]));
      expect(seqs[1]).toBeGreaterThan(seqs[0]);
      expect(seqs[2]).toBeGreaterThan(seqs[1]);
    });
  });

  describe('update_promo_usage_count trigger', () => {
    it('increments promo_codes.usage_count atomically on transaction insert', async () => {
      const user = await createUser(app);
      const admin = await createAdmin(app, {
        email: 'admin-promo@example.com',
        role: AdminRole.LEARNING_ADMIN,
      });

      const certId = await withContext({ adminId: admin.id }, async (qr) => {
        const rows = (await qr.query(
          `INSERT INTO certificates (title, program_code, price)
           VALUES ('PSD', 'PSD', 100) RETURNING id`,
        )) as { id: string }[];
        return rows[0].id;
      });

      const promo = await ds.query(
        `INSERT INTO promo_codes (code, discount_type, discount_value)
         VALUES ('SAVE20', 'percentage', 20) RETURNING id, usage_count`,
      );
      expect(promo[0].usage_count).toBe(0);

      // transactions: RLS-protected, needs user context
      for (let i = 0; i < 2; i += 1) {
        await withContext({ userId: user.id }, (qr) =>
          qr.query(
            `INSERT INTO transactions
              (user_id, cert_id, stripe_session_id, amount, status, promo_code_id)
             VALUES ($1, $2, $3, 80, 'completed', $4)`,
            [user.id, certId, `cs_test_${i}`, promo[0].id],
          ),
        );
      }

      const updated = await ds.query(
        `SELECT usage_count FROM promo_codes WHERE id = $1`,
        [promo[0].id],
      );
      expect(updated[0].usage_count).toBe(2);
    });
  });
});
