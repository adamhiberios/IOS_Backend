import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add cert_id column to test_sessions.
 *
 * Rationale: ExamService.resolveCertId() previously fell back to examId
 * because the TestSession row had no certId column. Now the access code's
 * certId is stored at startExam time so ExamAttempts carry the correct
 * certificate reference through to Week 6 cert generation.
 *
 * Column is nullable so rows written before this migration are not broken.
 * An index is added to support the Week 6 "fetch all attempts for a cert"
 * query without a sequential scan.
 */
export class AddCertIdToTestSessions1749000000000 implements MigrationInterface {
  name = 'AddCertIdToTestSessions1749000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_sessions
        ADD COLUMN IF NOT EXISTS cert_id UUID NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_test_sessions_cert_id
        ON test_sessions (cert_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_test_sessions_cert_id
    `);

    await queryRunner.query(`
      ALTER TABLE test_sessions
        DROP COLUMN IF EXISTS cert_id
    `);
  }
}
