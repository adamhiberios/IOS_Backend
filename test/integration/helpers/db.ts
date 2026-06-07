import { DataSource } from 'typeorm';

/**
 * List of tables to truncate between tests. Order doesn't matter because
 * we use TRUNCATE ... CASCADE. We explicitly leave `migrations` alone.
 */
const TRUNCATABLE_TABLES = [
  'auth_tokens',
  'blog_articles',
  'rate_limit_blocks',
  'refresh_tokens',
  'notification_queue',
  'notification_templates',
  'admin_audit_logs',
  'processed_webhooks',
  'issued_certificates',
  'transactions',
  'student_progress',
  'student_purchases',
  'test_sessions',
  'exam_attempts',
  'exam_access_codes',
  'exam_question_options',
  'exam_questions',
  'exams',
  'quiz_questions',
  'lesson_quizzes',
  'lessons',
  'learning_modules',
  'promo_codes',
  'certificates',
  'admin_users',
  'users',
];

/**
 * Wipes every test-relevant table. Fast (single TRUNCATE), serial-aware
 * (RESTART IDENTITY resets SERIAL sequences), and FK-safe (CASCADE).
 *
 * Note: TRUNCATE bypasses RLS, but we run it as a privileged connection
 * with `BYPASSRLS` or with FORCE; here we just use the regular role and
 * TypeORM's superuser-ish dev credentials are fine.
 */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  // Commented out to preserve data for post-run inspection via Adminer.
  // Re-enable when running tests normally.
  const tables = TRUNCATABLE_TABLES.map((t) => `"${t}"`).join(', ');
  await dataSource.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * Counts rows in a table. Useful for assertions like "exactly 1 audit log written".
 */
export async function countRows(
  dataSource: DataSource,
  tableName: string,
): Promise<number> {
  const result = await dataSource.query<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM "${tableName}"`,
  );
  return Number(result[0]?.count ?? 0);
}

/**
 * Fetches a single row as a plain object. Returns null if not found.
 */
export async function findOne<T = Record<string, unknown>>(
  dataSource: DataSource,
  tableName: string,
  where: Record<string, unknown>,
): Promise<T | null> {
  const keys = Object.keys(where);
  if (keys.length === 0) {
    throw new Error('findOne requires at least one WHERE condition');
  }
  const conditions = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
  const values = keys.map((k) => where[k]);
  const rows = await dataSource.query<T[]>(
    `SELECT * FROM "${tableName}" WHERE ${conditions} LIMIT 1`,
    values,
  );
  return rows[0] ?? null;
}
