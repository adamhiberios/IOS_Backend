import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, IsNull, In, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

import { Exam, ExamQuestion, ExamStatus } from '../../database/entities/exam.entity';
import { ExamAccessCode } from '../../database/entities/exam-access-code.entity';
import { ExamAttempt, AttemptStatus } from '../../database/entities/exam-attempt.entity';
import { TestSession, TestSessionStatus } from '../../database/entities/test-session.entity';
import { TestSessionService } from './test-session.service';

/** Bcrypt cost for access-code hashes (same as refresh/verify tokens). */
const ACCESS_CODE_BCRYPT_COST = 10;

/** Access codes expire 24 hours after assignment. */
const ACCESS_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** Passing score threshold in percent. */
export const PASSING_SCORE = 80;

export interface ScoreResult {
  score: number; // 0–100, two decimal places
  passed: boolean;
  correctCount: number;
  totalCount: number;
}

/**
 * ExamService — orchestrates the full exam lifecycle:
 *
 *  1. Admin assigns exam → one-time access code issued (crypto.randomBytes + bcrypt)
 *  2. Student validates code (without consuming it)
 *  3. Student starts exam → code consumed atomically, TestSession created in DB + Redis
 *  4. Student autosaves answers → TestSessionService.autosave (no TTL reset)
 *  5. Student submits → score, persist ExamAttempt, delete Redis key
 *  6. Late submit (within 2-min grace) → same as submit but lateFlag=true
 *  7. Auto-submit (grace expired) → ExamKeyspaceHandler calls autoSubmitFromSnapshot
 */
@Injectable()
export class ExamService {
  private readonly logger = new Logger(ExamService.name);

  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,

    @InjectRepository(ExamAccessCode)
    private readonly accessCodeRepo: Repository<ExamAccessCode>,

    @InjectRepository(TestSession)
    private readonly testSessionRepo: Repository<TestSession>,

    @InjectRepository(ExamAttempt)
    private readonly attemptRepo: Repository<ExamAttempt>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly testSessionSvc: TestSessionService,
  ) {}

  // ── Admin: assign exam ───────────────────────────────────────────────────

  /**
   * Generate a one-time access code for a student to take a specific exam.
   * Returns the plain-text code (shown to the admin / sent via email).
   * Only the bcrypt hash is stored in the DB.
   */
  async assignExam(
    userId: string,
    examId: string,
    certId: string,
  ): Promise<{ plainCode: string; expiresAt: Date; examId: string }> {
    const exam = await this.examRepo.findOne({ where: { id: examId } });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.certId !== certId) {
      throw new BadRequestException(
        'Exam does not belong to the given certificate',
      );
    }
    // M9 (audit 2026-06-11): draft exams must never be assignable.
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new UnprocessableEntityException('Exam is not published');
    }

    return this.issueAccessCode(userId, exam);
  }

  /**
   * SoT §2.3 assignment algorithm (G1, audit 2026-06-11): pick the student's
   * next exam for a certificate automatically — published exams ordered by
   * exam_order ASC, excluding any the student has already attempted. 403 when
   * the pool is exhausted. This is also the primitive Week 5's retake
   * checkout (BE-021C) builds on.
   */
  async assignNextExam(
    userId: string,
    certId: string,
  ): Promise<{
    plainCode: string;
    expiresAt: Date;
    examId: string;
    examOrder: number;
    examTitle: string;
  }> {
    const pool = await this.examRepo.find({
      where: { certId, status: ExamStatus.PUBLISHED },
      order: { examOrder: 'ASC' },
    });
    if (pool.length === 0) {
      throw new NotFoundException(
        'No published exams exist for this certificate',
      );
    }

    const attempted = await this.getAttemptedExamIds(userId, certId);
    const next = pool.find((exam) => !attempted.has(exam.id));
    if (!next) {
      throw new ForbiddenException(
        'Exam pool exhausted: the student has attempted every published exam for this certificate',
      );
    }

    // One outstanding code per exam per student — re-issuing would orphan the
    // first code and confuse the audit trail.
    const outstanding = await this.accessCodeRepo.findOne({
      where: { userId, examId: next.id, usedAt: IsNull() },
    });
    if (outstanding && outstanding.expiresAt > new Date()) {
      throw new ConflictException(
        'Student already has an unused access code for their next exam',
      );
    }

    const issued = await this.issueAccessCode(userId, next);
    return {
      ...issued,
      examOrder: next.examOrder,
      examTitle: next.title,
    };
  }

  // ── Student: validate access code ────────────────────────────────────────

  /**
   * Verify that a code is valid for the given exam and student WITHOUT
   * consuming it. Returns exam metadata on success.
   */
  async validateAccess(
    userId: string,
    code: string,
    examId: string,
  ): Promise<{ exam: Exam; accessCodeId: string }> {
    const { code: accessCode, exam } = await this.findAndVerifyCode(
      userId,
      code,
      examId,
    );
    return { exam, accessCodeId: accessCode.id };
  }

  // ── Student: start exam ──────────────────────────────────────────────────

  /**
   * Consume the access code atomically, create a TestSession in Postgres
   * and a Redis session key with a TTL equal to the exam's duration.
   */
  async startExam(
    userId: string,
    code: string,
    examId: string,
  ): Promise<{
    sessionId: string;
    durationSeconds: number;
    expiresAt: Date;
    questions: ExamQuestion[];
  }> {
    const { code: accessCode, exam } = await this.findAndVerifyCode(
      userId,
      code,
      examId,
    );

    // Guard: student cannot have an active session for this exam.
    const existing = await this.testSessionRepo.findOne({
      where: { userId, examId, status: TestSessionStatus.ACTIVE },
    });
    if (existing) {
      throw new ConflictException(
        'An active session already exists for this exam',
      );
    }

    const durationSeconds = exam.durationMinutes * 60;
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + durationSeconds * 1000);

    // M3 (audit 2026-06-11): code consumption and session creation are one
    // transaction — a failure between the two can no longer burn the one-time
    // code without producing a session.
    const session = await this.dataSource.transaction(async (em) => {
      // Atomically mark the access code as used (first-write-wins).
      const consumed = await em.update(
        ExamAccessCode,
        { id: accessCode.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      if (consumed.affected === 0) {
        throw new ConflictException('Access code has already been used');
      }

      // Persist the TestSession row — this is the authoritative DB record.
      return em.save(
        em.create(TestSession, {
          userId,
          examId,
          certId: accessCode.certId,   // carry certId from the access code
          sessionToken: accessCode.id, // link back to the access code
          startedAt,
          durationSeconds,
          expiresAt,
          status: TestSessionStatus.ACTIVE,
          snapshot: null,
        }),
      );
    });

    // Create the Redis session key — this is the authoritative countdown.
    // If this fails, compensate: remove the dangling session row (it never
    // logically existed — no Redis key means no countdown and no expiry
    // event would ever clear it) and free the code so the student can retry.
    try {
      await this.testSessionSvc.start(
        {
          sessionId: session.id,
          userId,
          examId,
          certId: accessCode.certId,
          startedAt: startedAt.toISOString(),
        },
        durationSeconds,
      );
    } catch (err) {
      await this.dataSource.transaction(async (em) => {
        await em.delete(TestSession, { id: session.id });
        await em.update(
          ExamAccessCode,
          { id: accessCode.id },
          { usedAt: null },
        );
      });
      this.logger.error(
        `startExam compensation: Redis start failed for session ${session.id}; code ${accessCode.id} restored`,
      );
      throw err;
    }

    // Load questions (without revealing which option is correct).
    const examWithQuestions = await this.examRepo.findOne({
      where: { id: examId },
      relations: ['questions', 'questions.options'],
      order: { questions: { position: 'ASC' } },
    });

    this.logger.log(
      `Exam started: sessionId=${session.id} examId=${examId} userId=${userId}`,
    );

    return {
      sessionId: session.id,
      durationSeconds,
      expiresAt,
      questions: examWithQuestions?.questions ?? [],
    };
  }

  // ── Student: autosave ─────────────────────────────────────────────────────

  /**
   * Persist the latest answers to Redis and the DB snapshot (no TTL reset).
   * Throws if the session has expired.
   */
  async autosave(
    sessionId: string,
    userId: string,
    answers: Record<string, string>,
  ): Promise<void> {
    const session = await this.getOwnedActiveSession(sessionId, userId);

    // Update Redis snapshot (no TTL reset).
    const saved = await this.testSessionSvc.autosave(sessionId, answers);

    if (!saved) {
      // Redis key already gone — session expired between guard and autosave.
      throw new UnprocessableEntityException(
        'Session has expired; autosave rejected',
      );
    }

    // Mirror snapshot in Postgres so the keyspace handler always has a
    // safe answer set to score even if Redis restarts.
    await this.testSessionRepo.update(session.id, { snapshot: answers });
  }

  // ── Student: get session status ──────────────────────────────────────────

  async getSessionStatus(
    sessionId: string,
    userId: string,
  ): Promise<{
    sessionId: string;
    remainingSeconds: number;
    answers: Record<string, string>;
    status: TestSessionStatus;
  }> {
    const session = await this.getOwnedSession(sessionId, userId);

    const { data, pttlMs } = await this.testSessionSvc.getSession(sessionId);
    const remainingSeconds = pttlMs > 0 ? Math.ceil(pttlMs / 1000) : 0;

    return {
      sessionId,
      remainingSeconds,
      answers: data?.answers ?? (session.snapshot as Record<string, string>) ?? {},
      status: session.status,
    };
  }

  // ── Student: submit ──────────────────────────────────────────────────────

  /**
   * Score the final answers, persist an ExamAttempt, and delete the Redis key.
   */
  async submitExam(
    sessionId: string,
    userId: string,
    answers: Record<string, string>,
  ): Promise<ScoreResult> {
    const session = await this.getOwnedActiveSession(sessionId, userId);
    return this.scoreAndPersist(session, answers, AttemptStatus.SUBMITTED, false);
  }

  // ── Student: late submit (BE-037) ─────────────────────────────────────────

  /**
   * Submit within the 2-minute grace window after session expiry.
   * Sets lateFlag=true on the resulting ExamAttempt.
   */
  async lateSubmitExam(
    sessionId: string,
    userId: string,
    answers: Record<string, string>,
  ): Promise<ScoreResult> {
    // Ownership + status check MUST run before the grace key is consumed —
    // consuming first let any authenticated student destroy another student's
    // grace window (DEL fires no expiry event → no auto-submit, attempt lost
    // forever). (H3, audit 2026-06-11)
    const session = await this.getOwnedSession(sessionId, userId, [
      TestSessionStatus.EXPIRED,
    ]);

    // Grace window check — consumeGrace atomically deletes the grace key
    // (GETDEL), so concurrent late-submits cannot both pass this gate.
    const graceSnapshot = await this.testSessionSvc.consumeGrace(sessionId);
    if (graceSnapshot === null) {
      throw new ForbiddenException(
        'Grace window has closed; late submission is no longer accepted',
      );
    }

    // Use the student-provided answers if given; fall back to last autosave snapshot.
    const finalAnswers =
      Object.keys(answers).length > 0 ? answers : graceSnapshot;

    return this.scoreAndPersist(
      session,
      finalAnswers,
      AttemptStatus.SUBMITTED,
      true,
    );
  }

  // ── Internal: auto-submit from grace snapshot (called by keyspace handler) ─

  /**
   * Auto-submit a session from its last DB snapshot after the grace window expires.
   * Called by ExamKeyspaceHandler — NOT exposed via HTTP.
   */
  async autoSubmitFromSnapshot(sessionId: string): Promise<void> {
    const session = await this.testSessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      this.logger.warn(`autoSubmitFromSnapshot: session ${sessionId} not found`);
      return;
    }

    if (
      session.status !== TestSessionStatus.EXPIRED &&
      session.status !== TestSessionStatus.ACTIVE
    ) {
      // Already submitted or auto-submitted — skip.
      return;
    }

    const answers =
      (session.snapshot as Record<string, string> | null) ?? {};

    try {
      await this.scoreAndPersist(session, answers, AttemptStatus.AUTO_SUBMITTED, false);
      this.logger.log(`Auto-submitted session ${sessionId}`);
    } catch (err) {
      if (err instanceof ConflictException) {
        // A manual (late-)submit won the race — nothing to do.
        this.logger.debug(
          `Auto-submit skipped for session ${sessionId}: already submitted`,
        );
        return;
      }
      this.logger.error(
        `Auto-submit failed for session ${sessionId}: ${(err as Error).message}`,
      );
    }
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  async scoreAnswers(
    examId: string,
    answers: Record<string, string>,
  ): Promise<ScoreResult> {
    const exam = await this.examRepo.findOne({
      where: { id: examId },
      relations: ['questions', 'questions.options'],
    });

    if (!exam || exam.questions.length === 0) {
      return { score: 0, passed: false, correctCount: 0, totalCount: 0 };
    }

    // M9 (audit 2026-06-11): score is weighted by exam_questions.marks
    // (default 1, so unweighted exams behave exactly as before).
    // correctCount/totalCount remain plain question counts for the response.
    let correctCount = 0;
    let earnedMarks = 0;
    let totalMarks = 0;

    for (const question of exam.questions) {
      const weight = question.marks ?? 1;
      totalMarks += weight;
      const selectedOptionId = answers[question.id];
      if (!selectedOptionId) continue;
      const selected = question.options.find((o) => o.id === selectedOptionId);
      if (selected?.isCorrect) {
        correctCount++;
        earnedMarks += weight;
      }
    }

    const totalCount = exam.questions.length;
    const score =
      totalMarks > 0
        ? parseFloat(((earnedMarks / totalMarks) * 100).toFixed(2))
        : 0;
    const passingThreshold = exam.passingScore ?? PASSING_SCORE;
    const passed = score >= passingThreshold;

    return { score, passed, correctCount, totalCount };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Generate + persist a one-time access code for a published exam. */
  private async issueAccessCode(
    userId: string,
    exam: Exam,
  ): Promise<{ plainCode: string; expiresAt: Date; examId: string }> {
    const plainCode = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(plainCode, ACCESS_CODE_BCRYPT_COST);
    const expiresAt = new Date(Date.now() + ACCESS_CODE_TTL_MS);

    await this.accessCodeRepo.save(
      this.accessCodeRepo.create({
        userId,
        examId: exam.id,
        certId: exam.certId,
        tokenHash,
        expiresAt,
      }),
    );

    this.logger.log(`Access code assigned: examId=${exam.id} userId=${userId}`);
    return { plainCode, expiresAt, examId: exam.id };
  }

  /**
   * Exam IDs the student has already attempted for a certificate.
   *
   * exam_attempts has FORCE RLS keyed on app.current_user_id — querying it on
   * the default pool (where the GUC is unset, or set to the calling ADMIN's
   * id) silently returns zero rows under a non-BYPASSRLS role, which would
   * make the algorithm re-assign already-attempted exams in production. Same
   * trap as C2: run in a dedicated transaction with the STUDENT's id set.
   */
  private async getAttemptedExamIds(
    userId: string,
    certId: string,
  ): Promise<Set<string>> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `SELECT set_config('app.current_user_id', $1, true)`,
        [String(userId)],
      );
      const rows: Array<{ exam_id: string }> = await runner.query(
        `SELECT DISTINCT exam_id FROM exam_attempts WHERE user_id = $1 AND cert_id = $2`,
        [userId, certId],
      );
      await runner.commitTransaction();
      return new Set(rows.map((r) => r.exam_id));
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw err;
    } finally {
      if (!runner.isReleased) {
        await runner.release();
      }
    }
  }

  private async scoreAndPersist(
    session: TestSession,
    answers: Record<string, string>,
    status: AttemptStatus,
    lateFlag: boolean,
  ): Promise<ScoreResult> {
    const { score, passed, correctCount, totalCount } = await this.scoreAnswers(
      session.examId,
      answers,
    );

    const submittedAt = new Date();

    const attempt = this.attemptRepo.create({
      userId: session.userId,
      examId: session.examId,
      certId: this.resolveCertId(session),
      score,
      passed,
      answers,
      durationSeconds: Math.round(
        (submittedAt.getTime() - session.startedAt.getTime()) / 1000,
      ),
      startedAt: session.startedAt,
      submittedAt,
      status,
      lateFlag,
    });

    const newStatus =
      status === AttemptStatus.AUTO_SUBMITTED
        ? TestSessionStatus.AUTO_SUBMITTED
        : TestSessionStatus.SUBMITTED;

    // exam_attempts has ENABLE + FORCE ROW LEVEL SECURITY: the INSERT must run
    // inside a transaction where app.current_user_id is set, or it fails with
    // 42501 under any non-BYPASSRLS role (C2, audit 2026-06-11). We cannot use
    // req.rlsRunner here — the keyspace auto-submit path has no request
    // context — so this opens its own short-lived, transaction-scoped runner.
    // The session-status update rides in the same transaction for atomicity.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `SELECT set_config('app.current_user_id', $1, true)`,
        [String(session.userId)],
      );

      // Conditional state transition FIRST — only one submitter can move the
      // session out of ACTIVE/EXPIRED. Double-click submits and submit-vs-
      // auto-submit races lose here instead of inserting a duplicate attempt
      // (H4, audit 2026-06-11).
      const transition = await runner.manager.update(
        TestSession,
        {
          id: session.id,
          status: In([TestSessionStatus.ACTIVE, TestSessionStatus.EXPIRED]),
        },
        {
          status: newStatus,
          submittedAt,
          snapshot: answers,
        },
      );
      if (transition.affected !== 1) {
        throw new ConflictException('Session has already been submitted');
      }

      await runner.manager.save(ExamAttempt, attempt);
      await runner.commitTransaction();
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw err;
    } finally {
      if (!runner.isReleased) {
        await runner.release();
      }
    }

    // Delete Redis key (only relevant if the session was still alive).
    await this.testSessionSvc.deleteSession(session.id);

    this.logger.log(
      `Session ${session.id} ${status}: score=${score}% passed=${passed} ` +
        `correct=${correctCount}/${totalCount} lateFlag=${lateFlag}`,
    );

    return { score, passed, correctCount, totalCount };
  }

  private resolveCertId(session: TestSession): string {
    // certId is stored on the session row since migration 1749000000000.
    // Fall back to examId only for rows pre-dating that migration (should not
    // occur in practice once the migration is applied).
    return session.certId ?? session.examId;
  }

  /** Load a session, verify ownership, and require a specific set of statuses. */
  private async getOwnedSession(
    sessionId: string,
    userId: string,
    allowedStatuses: TestSessionStatus[] = [
      TestSessionStatus.ACTIVE,
      TestSessionStatus.SUBMITTED,
      TestSessionStatus.EXPIRED,
      TestSessionStatus.AUTO_SUBMITTED,
    ],
  ): Promise<TestSession> {
    const session = await this.testSessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Session does not belong to this user');
    if (!allowedStatuses.includes(session.status)) {
      throw new UnprocessableEntityException(
        `Session is in status '${session.status}' which is not allowed for this operation`,
      );
    }
    return session;
  }

  /** Convenience wrapper — requires ACTIVE status. */
  private getOwnedActiveSession(
    sessionId: string,
    userId: string,
  ): Promise<TestSession> {
    return this.getOwnedSession(sessionId, userId, [TestSessionStatus.ACTIVE]);
  }

  /** Find + bcrypt-verify an unused, non-expired access code. */
  private async findAndVerifyCode(
    userId: string,
    code: string,
    examId: string,
  ): Promise<{ code: ExamAccessCode; exam: Exam }> {
    const exam = await this.examRepo.findOne({ where: { id: examId } });
    if (!exam) throw new NotFoundException('Exam not found');

    // M9 (audit 2026-06-11): a draft (or unpublished-again) exam is not
    // sittable even with a previously-issued code. Same generic error as an
    // invalid code — no state enumeration.
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ForbiddenException('Invalid or expired access code');
    }

    const candidates = await this.accessCodeRepo.find({
      where: { userId, examId, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    for (const candidate of candidates) {
      if (new Date() > candidate.expiresAt) continue;
      const match = await bcrypt.compare(code, candidate.tokenHash);
      if (match) return { code: candidate, exam };
    }

    throw new ForbiddenException('Invalid or expired access code');
  }
}
