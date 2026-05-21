import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds i18n infrastructure at the schema level.
 *
 *   1. Installs the pg_trgm extension (powers ILIKE-grade trigram search on
 *      translated titles via GIN indexes).
 *   2. Adds a `translations` JSONB column to every entity that carries
 *      learner-facing copy: certificates, learning_modules, lessons, exams,
 *      blog_articles. Shape: `{ "<locale>": { "title": "...", "description":
 *      "...", "content_html": "..." } }`. Default = `{}::jsonb` — never null.
 *   3. Adds CHECK constraints on the locale fields (`users.locale` already
 *      existed from Week 1; `admin_users` gets one freshly here) so the DB
 *      itself rejects any locale outside the supported set.
 *   4. Creates GIN trigram indexes on the English title of every translatable
 *      entity. Per §1 of the architecture study, English is the canonical
 *      authoring locale and the most-queried search target until Week 9.
 *
 * Reversible end-to-end. The `down()` drops every index, constraint, and
 * column in the reverse order. The pg_trgm extension is left in place —
 * it's cheap, used elsewhere later, and dropping it could break future
 * migrations run forward-from-zero.
 */
export class AddI18nSupport1748000000000 implements MigrationInterface {
  name = 'AddI18nSupport1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Extensions ────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // ── translations JSONB on every translatable entity ──────────────────
    const tables = [
      'certificates',
      'learning_modules',
      'lessons',
      'exams',
      'blog_articles',
    ];
    for (const table of tables) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
      );
    }

    // ── Locale column on admin_users (users.locale already exists) ───────
    await queryRunner.query(
      `ALTER TABLE admin_users ADD COLUMN locale VARCHAR(10) NOT NULL DEFAULT 'en'`,
    );

    // ── CHECK constraints — DB rejects any unsupported locale ────────────
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT chk_users_locale_supported
        CHECK (locale IN ('en', 'tr', 'fr', 'es', 'ar', 'de'))
    `);
    await queryRunner.query(`
      ALTER TABLE admin_users
        ADD CONSTRAINT chk_admin_users_locale_supported
        CHECK (locale IN ('en', 'tr', 'fr', 'es', 'ar', 'de'))
    `);

    // ── GIN trigram indexes for substring search on English titles ───────
    // Why English specifically: it's the canonical authoring locale per the
    // strict-publish policy described in the architecture study §1.8. Other
    // locales become searchable in Week 9 with a follow-up migration once
    // translated content is populated.
    await queryRunner.query(`
      CREATE INDEX idx_certificates_title_en_trgm
        ON certificates USING GIN ((translations -> 'en' ->> 'title') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_learning_modules_title_en_trgm
        ON learning_modules USING GIN ((translations -> 'en' ->> 'title') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_lessons_title_en_trgm
        ON lessons USING GIN ((translations -> 'en' ->> 'title') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_blog_articles_title_en_trgm
        ON blog_articles USING GIN ((translations -> 'en' ->> 'title') gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order. Drop indexes first, then constraints, then columns.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_blog_articles_title_en_trgm`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_lessons_title_en_trgm`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_learning_modules_title_en_trgm`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_certificates_title_en_trgm`,
    );

    await queryRunner.query(
      `ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS chk_admin_users_locale_supported`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_locale_supported`,
    );

    await queryRunner.query(`ALTER TABLE admin_users DROP COLUMN IF EXISTS locale`);

    const tables = [
      'blog_articles',
      'exams',
      'lessons',
      'learning_modules',
      'certificates',
    ];
    for (const table of tables) {
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS translations`,
      );
    }

    // Intentionally NOT dropping pg_trgm — see header comment.
  }
}
