import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for IOS LMS.
 *
 * Creates all tables, enums, indexes, RLS policies, Postgres functions,
 * triggers, and the per-program cert ID sequences (mock codes).
 *
 * ID strategy:
 *   • User-facing entities use UUID v4 (gen_random_uuid()) — non-enumerable.
 *   • Internal-only entities (audit logs, queues, tokens) use SERIAL.
 *
 * Requires the pgcrypto extension (installed by docker/postgres/init.sql).
 */
export class InitialSchema1747000000000 implements MigrationInterface {
  name = 'InitialSchema1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Required extensions (idempotent) ──────────────────────────────────
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // ── Enums ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE admin_role_enum AS ENUM (
        'super_admin', 'learning_admin', 'content_creator',
        'finance_admin', 'support_admin'
      )
    `);
    await queryRunner.query(
      `CREATE TYPE exam_status_enum AS ENUM ('draft', 'published')`,
    );
    await queryRunner.query(
      `CREATE TYPE question_type_enum AS ENUM ('mcq', 'true_false')`,
    );
    await queryRunner.query(
      `CREATE TYPE attempt_status_enum AS ENUM ('submitted', 'auto_submitted')`,
    );
    await queryRunner.query(`
      CREATE TYPE test_session_status_enum AS ENUM (
        'active', 'submitted', 'expired', 'auto_submitted'
      )
    `);
    await queryRunner.query(
      `CREATE TYPE payment_type_enum AS ENUM ('enrollment', 'retake')`,
    );
    await queryRunner.query(`
      CREATE TYPE transaction_status_enum AS ENUM (
        'pending', 'completed', 'failed', 'refunded'
      )
    `);
    await queryRunner.query(
      `CREATE TYPE discount_type_enum AS ENUM ('percentage', 'full_waiver')`,
    );
    await queryRunner.query(
      `CREATE TYPE notification_status_enum AS ENUM ('pending', 'sent', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE token_owner_type_enum AS ENUM ('user', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TYPE blog_status_enum AS ENUM ('draft', 'published', 'archived')`,
    );
    await queryRunner.query(`
      CREATE TYPE auth_token_purpose_enum AS ENUM (
        'email_verification', 'password_reset'
      )
    `);

    // ── users ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE users (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        email             VARCHAR(255) NOT NULL,
        password_hash     VARCHAR(255) NOT NULL,
        first_name        VARCHAR(100) NOT NULL,
        last_name         VARCHAR(100) NOT NULL,
        phone             VARCHAR(50),
        avatar_url        VARCHAR(500),
        country           VARCHAR(100),
        city              VARCHAR(100),
        street            VARCHAR(255),
        address           VARCHAR(255),
        postal_code       VARCHAR(20),
        occupation        VARCHAR(255),
        position          VARCHAR(255),
        company           VARCHAR(255),
        locale            VARCHAR(10)  NOT NULL DEFAULT 'en',
        email_verified    BOOLEAN      NOT NULL DEFAULT FALSE,
        email_verified_at TIMESTAMPTZ,
        active            BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_users_email ON users(email)`,
    );

    // ── admin_users ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE admin_users (
        id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
        email           VARCHAR(255)    NOT NULL,
        password_hash   VARCHAR(255)    NOT NULL,
        first_name      VARCHAR(100)    NOT NULL,
        last_name       VARCHAR(100)    NOT NULL,
        role            admin_role_enum NOT NULL,
        active          BOOLEAN         NOT NULL DEFAULT TRUE,
        created_by_id   UUID REFERENCES admin_users(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_admin_users_email ON admin_users(email)`,
    );

    // ── certificates ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE certificates (
        id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
        title         VARCHAR(255)    NOT NULL,
        program_code  VARCHAR(50)     NOT NULL,
        description   TEXT,
        price         NUMERIC(10,2)   NOT NULL,
        currency      VARCHAR(3)      NOT NULL DEFAULT 'USD',
        active        BOOLEAN         NOT NULL DEFAULT TRUE,
        thumbnail_url VARCHAR(500),
        created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_certificates_program_code ON certificates(program_code)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_certificates_title ON certificates(title)`,
    );

    // ── learning_modules ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE learning_modules (
        id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        cert_id     UUID          NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
        title       VARCHAR(255)  NOT NULL,
        description TEXT,
        position    INT           NOT NULL DEFAULT 0,
        active      BOOLEAN       NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_learning_modules_cert_id ON learning_modules(cert_id)`,
    );

    // ── lessons ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE lessons (
        id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        module_id        UUID         NOT NULL REFERENCES learning_modules(id) ON DELETE CASCADE,
        title            VARCHAR(255) NOT NULL,
        video_url        VARCHAR(500),
        content_text     TEXT,
        position         INT          NOT NULL DEFAULT 0,
        duration_seconds INT,
        active           BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_lessons_module_id ON lessons(module_id)`,
    );

    // ── lesson_quizzes ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE lesson_quizzes (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        lesson_id   UUID         NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        title       VARCHAR(255) NOT NULL,
        active      BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_lesson_quizzes_lesson_id ON lesson_quizzes(lesson_id)`,
    );

    // ── quiz_questions ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE quiz_questions (
        id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        quiz_id        UUID    NOT NULL REFERENCES lesson_quizzes(id) ON DELETE CASCADE,
        question_text  TEXT    NOT NULL,
        correct_answer TEXT    NOT NULL,
        options        JSONB,
        position       INT     NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_quiz_questions_quiz_id ON quiz_questions(quiz_id)`,
    );

    // ── exams ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE exams (
        id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
        cert_id          UUID             NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
        title            VARCHAR(255)     NOT NULL,
        exam_order       INT              NOT NULL CHECK (exam_order BETWEEN 1 AND 6),
        status           exam_status_enum NOT NULL DEFAULT 'draft',
        passing_score    INT              NOT NULL DEFAULT 80 CHECK (passing_score BETWEEN 1 AND 100),
        duration_minutes INT              NOT NULL,
        created_by_id    UUID,
        created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        UNIQUE (cert_id, exam_order)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_exams_cert_id ON exams(cert_id)`);

    // ── exam_questions ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE exam_questions (
        id             UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
        exam_id        UUID                 NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        question_text  TEXT                 NOT NULL,
        question_type  question_type_enum   NOT NULL DEFAULT 'mcq',
        position       INT                  NOT NULL DEFAULT 0,
        marks          INT                  NOT NULL DEFAULT 1,
        created_at     TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ          NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_exam_questions_exam_id ON exam_questions(exam_id)`,
    );

    // ── exam_question_options ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE exam_question_options (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        question_id  UUID        NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
        option_text  TEXT        NOT NULL,
        is_correct   BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_exam_question_options_question_id ON exam_question_options(question_id)`,
    );

    // ── exam_access_codes ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE exam_access_codes (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
        exam_id     UUID        NOT NULL REFERENCES exams(id)        ON DELETE CASCADE,
        cert_id     UUID        NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
        token_hash  VARCHAR(255) NOT NULL,
        expires_at  TIMESTAMPTZ  NOT NULL,
        used_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_exam_access_codes_user_id ON exam_access_codes(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_exam_access_codes_exam_id ON exam_access_codes(exam_id)`,
    );

    // ── exam_attempts ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE exam_attempts (
        id               UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID                 NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
        exam_id          UUID                 NOT NULL REFERENCES exams(id)        ON DELETE CASCADE,
        cert_id          UUID                 NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
        score            NUMERIC(5,2)         NOT NULL CHECK (score BETWEEN 0 AND 100),
        passed           BOOLEAN              NOT NULL,
        answers          JSONB                NOT NULL,
        duration_seconds INT,
        started_at       TIMESTAMPTZ          NOT NULL,
        submitted_at     TIMESTAMPTZ          NOT NULL,
        status           attempt_status_enum  NOT NULL DEFAULT 'submitted',
        late_flag        BOOLEAN              NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_exam_attempts_user_id ON exam_attempts(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_exam_attempts_exam_id ON exam_attempts(exam_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_exam_attempts_cert_id ON exam_attempts(cert_id)`,
    );

    // ── test_sessions ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE test_sessions (
        id               UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exam_id          UUID                     NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        session_token    TEXT                     NOT NULL,
        started_at       TIMESTAMPTZ              NOT NULL,
        duration_seconds INT                      NOT NULL,
        expires_at       TIMESTAMPTZ              NOT NULL,
        status           test_session_status_enum NOT NULL DEFAULT 'active',
        submitted_at     TIMESTAMPTZ,
        snapshot         JSONB,
        created_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_test_sessions_user_id ON test_sessions(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_test_sessions_exam_id ON test_sessions(exam_id)`,
    );

    // ── student_purchases ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE student_purchases (
        id                 UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            UUID              NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
        cert_id            UUID              NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
        payment_intent_id  VARCHAR(255),
        payment_type       payment_type_enum NOT NULL DEFAULT 'enrollment',
        pre_exam_confirmed BOOLEAN           NOT NULL DEFAULT FALSE,
        exam_completed     BOOLEAN           NOT NULL DEFAULT FALSE,
        created_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, cert_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_student_purchases_user_id ON student_purchases(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_student_purchases_cert_id ON student_purchases(cert_id)`,
    );

    // ── student_progress ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE student_progress (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        lesson_id    UUID        NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        completed_at TIMESTAMPTZ NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, lesson_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_student_progress_user_id   ON student_progress(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_student_progress_lesson_id ON student_progress(lesson_id)`,
    );

    // ── promo_codes ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE promo_codes (
        id                  UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
        code                VARCHAR(100)       NOT NULL,
        discount_type       discount_type_enum NOT NULL,
        discount_value      NUMERIC(5,2),
        applicable_cert_ids UUID[],
        max_uses            INT,
        usage_count         INT                NOT NULL DEFAULT 0,
        expires_at          TIMESTAMPTZ,
        created_by_id       UUID REFERENCES admin_users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_promo_codes_code ON promo_codes(code)`,
    );

    // ── transactions ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE transactions (
        id                UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID                     NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
        cert_id           UUID                     NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
        stripe_session_id VARCHAR(255)             NOT NULL,
        amount            NUMERIC(10,2)            NOT NULL,
        currency          VARCHAR(3)               NOT NULL DEFAULT 'USD',
        status            transaction_status_enum  NOT NULL DEFAULT 'pending',
        promo_code_id     UUID REFERENCES promo_codes(id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_transactions_stripe_session_id ON transactions(stripe_session_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transactions_user_id ON transactions(user_id)`,
    );

    // ── issued_certificates ───────────────────────────────────────────────
    // cert_id is the PUBLIC identifier (IOS-PROG-YYYY-NNNNNN), set by trigger.
    // The UUID `id` column is the primary key, used for internal references.
    await queryRunner.query(`
      CREATE TABLE issued_certificates (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        cert_id          VARCHAR(50),
        user_id          UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
        certificate_id   UUID        NOT NULL REFERENCES certificates(id)  ON DELETE CASCADE,
        exam_attempt_id  UUID        NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
        s3_url           VARCHAR(500),
        qr_url           VARCHAR(500),
        is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
        issued_at        TIMESTAMPTZ NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_issued_certificates_cert_id ON issued_certificates(cert_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_issued_certificates_user_id ON issued_certificates(user_id)`,
    );

    // ── processed_webhooks (serial — internal) ────────────────────────────
    await queryRunner.query(`
      CREATE TABLE processed_webhooks (
        id            SERIAL PRIMARY KEY,
        event_id      VARCHAR(255) NOT NULL,
        event_type    VARCHAR(100) NOT NULL,
        processed_at  TIMESTAMPTZ  NOT NULL,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_processed_webhooks_event_id ON processed_webhooks(event_id)`,
    );

    // ── admin_audit_logs (serial — internal) ──────────────────────────────
    await queryRunner.query(`
      CREATE TABLE admin_audit_logs (
        id          SERIAL PRIMARY KEY,
        actor_id    UUID         NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
        action      VARCHAR(100) NOT NULL,
        table_name  VARCHAR(100) NOT NULL,
        record_id   VARCHAR(100),
        old_data    JSONB,
        new_data    JSONB,
        ip_address  INET,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_admin_audit_logs_actor_id   ON admin_audit_logs(actor_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_admin_audit_logs_table_name ON admin_audit_logs(table_name)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_admin_audit_logs_created_at ON admin_audit_logs(created_at DESC)`,
    );

    // ── notification_templates (serial — internal) ────────────────────────
    await queryRunner.query(`
      CREATE TABLE notification_templates (
        id          SERIAL PRIMARY KEY,
        type        VARCHAR(100) NOT NULL,
        locale      VARCHAR(10)  NOT NULL DEFAULT 'en',
        subject     VARCHAR(255) NOT NULL,
        html_body   TEXT         NOT NULL,
        text_body   TEXT         NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (type, locale)
      )
    `);

    // ── notification_queue (serial — internal) ────────────────────────────
    await queryRunner.query(`
      CREATE TABLE notification_queue (
        id            SERIAL PRIMARY KEY,
        user_id       UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_type VARCHAR(100)             NOT NULL,
        payload       JSONB                    NOT NULL,
        status        notification_status_enum NOT NULL DEFAULT 'pending',
        scheduled_at  TIMESTAMPTZ,
        sent_at       TIMESTAMPTZ,
        retry_count   INT                      NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ              NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_notification_queue_user_id ON notification_queue(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_notification_queue_status  ON notification_queue(status)`,
    );

    // ── refresh_tokens (serial — internal) ────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id           SERIAL PRIMARY KEY,
        user_id      UUID                   REFERENCES users(id)       ON DELETE CASCADE,
        admin_id     UUID                   REFERENCES admin_users(id) ON DELETE CASCADE,
        owner_type   token_owner_type_enum  NOT NULL,
        token_hash   VARCHAR(255)           NOT NULL,
        expires_at   TIMESTAMPTZ            NOT NULL,
        revoked_at   TIMESTAMPTZ,
        created_at   TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ            NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_user_id  ON refresh_tokens(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_admin_id ON refresh_tokens(admin_id)`,
    );

    // ── rate_limit_blocks (serial — internal) ─────────────────────────────
    await queryRunner.query(`
      CREATE TABLE rate_limit_blocks (
        id            SERIAL PRIMARY KEY,
        ip_address    INET         NOT NULL,
        endpoint      VARCHAR(100) NOT NULL,
        blocked_until TIMESTAMPTZ  NOT NULL,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_rate_limit_blocks_ip_endpoint ON rate_limit_blocks(ip_address, endpoint)`,
    );

    // ── blog_articles ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE blog_articles (
        id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
        title            VARCHAR(255)     NOT NULL,
        slug             VARCHAR(255)     NOT NULL,
        content_html     TEXT             NOT NULL,
        status           blog_status_enum NOT NULL DEFAULT 'draft',
        author_id        UUID REFERENCES admin_users(id) ON DELETE SET NULL,
        meta_description TEXT,
        published_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_blog_articles_slug ON blog_articles(slug)`,
    );

    // ── auth_tokens (serial — internal) ───────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE auth_tokens (
        id          SERIAL PRIMARY KEY,
        user_id     UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose     auth_token_purpose_enum  NOT NULL,
        token_hash  VARCHAR(255)             NOT NULL,
        expires_at  TIMESTAMPTZ              NOT NULL,
        used_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ              NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_auth_tokens_purpose_expires ON auth_tokens(purpose, expires_at)`,
    );

    // ── RLS on high-risk tables ───────────────────────────────────────────
    // UUID-cast policies: app.current_user_id is set to the UUID string at
    // request time; the policy compares it against the row's user_id::text.
    for (const table of [
      'student_purchases',
      'exam_attempts',
      'issued_certificates',
      'transactions',
      'admin_audit_logs',
    ]) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }

    await queryRunner.query(`
      CREATE POLICY student_purchases_isolation ON student_purchases
        USING (user_id::text = NULLIF(current_setting('app.current_user_id', TRUE), ''))
    `);
    await queryRunner.query(`
      CREATE POLICY exam_attempts_isolation ON exam_attempts
        USING (user_id::text = NULLIF(current_setting('app.current_user_id', TRUE), ''))
    `);
    await queryRunner.query(`
      CREATE POLICY issued_certificates_isolation ON issued_certificates
        USING (user_id::text = NULLIF(current_setting('app.current_user_id', TRUE), ''))
    `);
    await queryRunner.query(`
      CREATE POLICY transactions_isolation ON transactions
        USING (user_id::text = NULLIF(current_setting('app.current_user_id', TRUE), ''))
    `);
    await queryRunner.query(`
      CREATE POLICY admin_audit_logs_deny_select ON admin_audit_logs
        FOR SELECT
        USING (FALSE)
    `);
    // INSERTs are allowed (audit trigger writes here). No UPDATE/DELETE policy
    // means those are blocked by default (table is RLS-enabled).
    await queryRunner.query(`
      CREATE POLICY admin_audit_logs_allow_insert ON admin_audit_logs
        FOR INSERT
        WITH CHECK (TRUE)
    `);

    // ── Per-program cert ID sequences (mock codes) ───────────────────────
    const programCodes = ['PSM', 'PSPO', 'PSD', 'PAL', 'SPS', 'PMP'];
    for (const code of programCodes) {
      await queryRunner.query(
        `CREATE SEQUENCE IF NOT EXISTS cert_seq_${code.toLowerCase()} START 1 INCREMENT 1 NO MAXVALUE`,
      );
    }

    // ── Functions ─────────────────────────────────────────────────────────

    // check_rate_limit — boolean check, writes 30-min block on threshold breach
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_rate_limit(
        p_ip       INET,
        p_endpoint VARCHAR
      ) RETURNS BOOLEAN
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM rate_limit_blocks
          WHERE ip_address = p_ip
            AND endpoint   = p_endpoint
            AND blocked_until > NOW()
        ) THEN
          RETURN FALSE;
        END IF;
        RETURN TRUE;
      END;
      $$
    `);

    // ── Triggers ──────────────────────────────────────────────────────────

    // 1. protect_super_admin_role — block any modification of super_admin rows.
    // Returns NEW on UPDATE so the new row is applied; returns OLD on DELETE
    // (the trigger only runs BEFORE DELETE/UPDATE, never INSERT).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION protect_super_admin_role()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.role = 'super_admin' THEN
          RAISE EXCEPTION 'super_admin account cannot be modified or deleted';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_protect_super_admin
        BEFORE DELETE OR UPDATE ON admin_users
        FOR EACH ROW EXECUTE FUNCTION protect_super_admin_role()
    `);

    // 2. update_promo_usage_count — atomic increment on new transaction
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_promo_usage_count()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.promo_code_id IS NOT NULL THEN
          UPDATE promo_codes
          SET usage_count = usage_count + 1,
              updated_at  = NOW()
          WHERE id = NEW.promo_code_id;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_update_promo_usage_count
        AFTER INSERT ON transactions
        FOR EACH ROW EXECUTE FUNCTION update_promo_usage_count()
    `);

    // 3. audit_admin_action — JSONB old/new + actor + IP
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_admin_action()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_actor_id UUID;
        v_ip       INET;
        v_rec      TEXT;
      BEGIN
        v_actor_id := NULLIF(current_setting('app.current_admin_id', TRUE), '')::UUID;
        v_ip       := NULLIF(current_setting('app.current_ip', TRUE), '')::INET;
        v_rec      := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END;

        -- Skip audit if no actor is in context (e.g., direct DB access).
        IF v_actor_id IS NULL THEN
          RETURN COALESCE(NEW, OLD);
        END IF;

        INSERT INTO admin_audit_logs
          (actor_id, action, table_name, record_id, old_data, new_data, ip_address, created_at, updated_at)
        VALUES (
          v_actor_id,
          TG_OP,
          TG_TABLE_NAME,
          v_rec,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
          v_ip,
          NOW(), NOW()
        );
        RETURN COALESCE(NEW, OLD);
      END;
      $$
    `);
    for (const table of ['certificates', 'exams', 'admin_users']) {
      await queryRunner.query(`
        CREATE TRIGGER trg_audit_${table}
          AFTER INSERT OR UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION audit_admin_action()
      `);
    }

    // 4. set_cert_sequence — generates IOS-{PROG}-{YYYY}-{NNNNNN} ID
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_cert_sequence()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_program_code VARCHAR;
        v_seq          BIGINT;
        v_year         VARCHAR;
        v_seq_name     VARCHAR;
      BEGIN
        SELECT c.program_code INTO v_program_code
        FROM certificates c
        WHERE c.id = NEW.certificate_id;

        v_seq_name := 'cert_seq_' || LOWER(v_program_code);
        v_year     := TO_CHAR(NOW(), 'YYYY');
        EXECUTE format('SELECT nextval(%L)', v_seq_name) INTO v_seq;

        NEW.cert_id := 'IOS-' || v_program_code || '-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_set_cert_sequence
        BEFORE INSERT ON issued_certificates
        FOR EACH ROW EXECUTE FUNCTION set_cert_sequence()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_set_cert_sequence ON issued_certificates`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_audit_admin_users ON admin_users`,
    );
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_exams ON exams`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_audit_certificates ON certificates`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_update_promo_usage_count ON transactions`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_protect_super_admin ON admin_users`,
    );

    await queryRunner.query(`DROP FUNCTION IF EXISTS set_cert_sequence()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_admin_action()`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS update_promo_usage_count()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS protect_super_admin_role()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS check_rate_limit(INET, VARCHAR)`,
    );

    for (const code of ['psm', 'pspo', 'psd', 'pal', 'sps', 'pmp']) {
      await queryRunner.query(`DROP SEQUENCE IF EXISTS cert_seq_${code}`);
    }

    const tables = [
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
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }

    const enums = [
      'auth_token_purpose_enum',
      'admin_role_enum',
      'exam_status_enum',
      'question_type_enum',
      'attempt_status_enum',
      'test_session_status_enum',
      'payment_type_enum',
      'transaction_status_enum',
      'discount_type_enum',
      'notification_status_enum',
      'token_owner_type_enum',
      'blog_status_enum',
    ];
    for (const e of enums) {
      await queryRunner.query(`DROP TYPE IF EXISTS ${e}`);
    }
  }
}
