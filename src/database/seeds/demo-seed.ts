/* eslint-disable no-console */
/**
 * Demo data seeder — `npm run seed:demo` (or `npm run docker:seed:demo`).
 *
 * Inserts a rich, internally-consistent demo dataset:
 *   - 4 admin users (one per non-super role)
 *   - 6 certificates (PSM, PSPO, PSD, PAL, SPS, PMP) with en/tr/ar translations
 *   - modules + lessons per certificate
 *   - published exams with weighted questions/options (+ one DRAFT exam)
 *   - 8 students at different lifecycle stages
 *   - purchases, transactions, lesson progress, exam attempts,
 *     one issued certificate, one outstanding access code, 3 promo codes
 *
 * Design rules:
 *   - Every demo row uses a DETERMINISTIC UUID in the `dd......-0000-4000-a000-*`
 *     namespace. Re-running the script deletes ONLY those rows (children go
 *     via ON DELETE CASCADE) and re-inserts them clean. Manually-created data
 *     is never touched.
 *   - Inserts into FORCE-RLS tables (student_purchases, exam_attempts,
 *     transactions, issued_certificates) run inside a transaction with
 *     `set_config('app.current_user_id', <owner>, true)` — the project's
 *     RLS-aware seed pattern — so the script also works under a
 *     non-BYPASSRLS role.
 *   - Refuses to run when NODE_ENV=production.
 *
 * See docs/DEMO_DATA.md for the account list and demo storylines.
 */
import { AppDataSource } from '../config/typeorm.config';
import { DataSource, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

import {
  AdminUser,
  AdminRole,
  User,
  Certificate,
  LearningModule,
  Lesson,
  PaymentType,
} from '../entities';
import { CertLevel } from '../entities/certificate.entity';
import {
  Exam,
  ExamQuestion,
  ExamQuestionOption,
  ExamStatus,
  QuestionType,
} from '../entities/exam.entity';
import { AttemptStatus } from '../entities/exam-attempt.entity';
import { TransactionStatus } from '../entities/progress-cert-transaction.entity';
import { DiscountType } from '../entities/misc.entity';
import { ExamAccessCode } from '../entities/exam-access-code.entity';

// ── Deterministic IDs ────────────────────────────────────────────────────────
// Block per entity type; index per row. All demo rows live in this namespace.

const BLOCK = {
  admin: 1,
  user: 2,
  cert: 3,
  module: 4,
  lesson: 5,
  exam: 6,
  question: 7,
  option: 8,
  promo: 9,
  attempt: 10,
  transaction: 11,
  accessCode: 12,
  issued: 13,
  purchase: 14,
} as const;

function demoId(block: number, n: number): string {
  return `dd${block.toString(16).padStart(6, '0')}-0000-4000-a000-${n
    .toString(16)
    .padStart(12, '0')}`;
}

const DEMO_PASSWORD = 'Demo@123!';
/** Plain one-time access code for the retake student (Omar). 64 hex chars. */
const DEMO_ACCESS_CODE = 'ab'.repeat(32);

// ── Catalog spec ─────────────────────────────────────────────────────────────

interface CertSpec {
  n: number;
  code: string;
  title: string;
  track: string;
  level: CertLevel;
  price: number;
  hours: number;
  description: string;
  tr: string;
  ar: string;
  publishedExams: number;
  draftExams?: number;
  modules: Array<{ title: string; lessons: string[] }>;
}

const CERTS: CertSpec[] = [
  {
    n: 1,
    code: 'PSM',
    title: 'Professional Scrum Master I',
    track: 'Scrum Master',
    level: CertLevel.FOUNDATION,
    price: 149,
    hours: 20,
    description:
      'Demonstrate a fundamental understanding of Scrum and the role of the Scrum Master.',
    tr: 'Profesyonel Scrum Master I',
    ar: 'ماستر سكرام المحترف الأول',
    publishedExams: 3,
    modules: [
      {
        title: 'Scrum Foundations',
        lessons: [
          'What is empirical process control?',
          'The Scrum pillars: transparency, inspection, adaptation',
          'Scrum values in practice',
          'Reading the Scrum Guide critically',
        ],
      },
      {
        title: 'The Scrum Team',
        lessons: [
          'Accountabilities: Scrum Master, Product Owner, Developers',
          'Self-management and cross-functionality',
          'Common anti-patterns and how to name them',
          'Scaling considerations for a single team',
        ],
      },
      {
        title: 'Events and Artifacts',
        lessons: [
          'Sprint mechanics and the Sprint Goal',
          'Backlog refinement that actually works',
          'Definition of Done vs acceptance criteria',
          'Mock exam walkthrough',
        ],
      },
    ],
  },
  {
    n: 2,
    code: 'PSPO',
    title: 'Professional Scrum Product Owner I',
    track: 'Product Owner',
    level: CertLevel.FOUNDATION,
    price: 149,
    hours: 18,
    description:
      'Validate your knowledge of value-driven product ownership in Scrum.',
    tr: 'Profesyonel Scrum Ürün Sahibi I',
    ar: 'مالك المنتج المحترف في سكرام الأول',
    publishedExams: 2,
    modules: [
      {
        title: 'Product Value',
        lessons: [
          'Outcomes over outputs',
          'Evidence-based management basics',
          'Stakeholders vs customers',
        ],
      },
      {
        title: 'Backlog Mastery',
        lessons: [
          'Ordering, not prioritising',
          'Writing items the team can act on',
          'Forecasting and release planning',
        ],
      },
      {
        title: 'Working with the Team',
        lessons: [
          'The PO at the Sprint Review',
          'Saying no without losing trust',
          'Mock exam walkthrough',
        ],
      },
    ],
  },
  {
    n: 3,
    code: 'PSD',
    title: 'Professional Scrum Developer I',
    track: 'Developer',
    level: CertLevel.FOUNDATION,
    price: 129,
    hours: 16,
    description:
      'Prove your ability to build complex software within a Scrum team.',
    tr: 'Profesyonel Scrum Geliştiricisi I',
    ar: 'مطور سكرام المحترف الأول',
    publishedExams: 2,
    modules: [
      {
        title: 'Module 1 — Engineering in Sprints',
        lessons: [
          '1.1 Slicing work vertically',
          '1.2 Test-first development',
          '1.3 Continuous integration discipline',
        ],
      },
      {
        title: 'Module 2 — Quality and Done',
        lessons: [
          '2.1 Technical debt economics',
          '2.2 Definition of Done as an engineering contract',
          '2.3 Mock exam walkthrough',
        ],
      },
    ],
  },
  {
    n: 4,
    code: 'PAL',
    title: 'Professional Agile Leadership',
    track: 'Leadership',
    level: CertLevel.PRACTITIONER,
    price: 199,
    hours: 14,
    description:
      'For leaders who support and enable agile teams across an organisation.',
    tr: 'Profesyonel Çevik Liderlik',
    ar: 'القيادة الرشيقة المحترفة',
    publishedExams: 1,
    modules: [
      {
        title: 'Module 1 — Leading Agility',
        lessons: [
          '1.1 The leader’s role in an empirical organisation',
          '1.2 Goals, measures, and anti-metrics',
          '1.3 Growing teams without controlling them',
        ],
      },
      {
        title: 'Module 2 — Organisational Design',
        lessons: [
          '2.1 Structures that help value flow',
          '2.2 Funding models and governance',
          '2.3 Mock exam walkthrough',
        ],
      },
    ],
  },
  {
    n: 5,
    code: 'SPS',
    title: 'Scaled Professional Scrum',
    track: 'Scaling',
    level: CertLevel.PRACTITIONER,
    price: 249,
    hours: 22,
    description:
      'Validate your knowledge of scaling Scrum with the Nexus framework.',
    tr: 'Ölçeklenmiş Profesyonel Scrum',
    ar: 'سكرام المحترف الموسع',
    publishedExams: 1,
    modules: [
      {
        title: 'Module 1 — Nexus Essentials',
        lessons: ['1.1 The Nexus framework', '1.2 Cross-team dependencies'],
      },
      {
        title: 'Module 2 — Integration',
        lessons: ['2.1 The integrated increment', '2.2 Mock exam walkthrough'],
      },
    ],
  },
  {
    n: 6,
    code: 'PMP',
    title: 'Project Management Professional Bridge',
    track: 'Project Management',
    level: CertLevel.AUTHORITY,
    price: 299,
    hours: 30,
    description:
      'Bridge course for PMP holders transitioning to empirical product delivery.',
    tr: 'Proje Yönetimi Profesyoneli Köprü Programı',
    ar: 'جسر محترف إدارة المشاريع',
    publishedExams: 1,
    draftExams: 1, // demos the M9 PUBLISHED guard in admin tooling
    modules: [
      {
        title: 'Module 1 — From Plans to Empiricism',
        lessons: ['1.1 Predictive vs adaptive', '1.2 Risk as a backlog concern'],
      },
      {
        title: 'Module 2 — Delivery',
        lessons: ['2.1 Milestones vs Sprint Goals', '2.2 Mock exam walkthrough'],
      },
    ],
  },
];

/** Question marks per exam: total 10, so scores land on clean percentages. */
const QUESTION_MARKS = [3, 2, 2, 2, 1];

// ── RLS-aware insert helper ──────────────────────────────────────────────────

async function asUser<T>(
  ds: DataSource,
  userId: string,
  fn: (runner: QueryRunner) => Promise<T>,
): Promise<T> {
  const runner = ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_user_id', $1, true)`, [
      userId,
    ]);
    const result = await fn(runner);
    await runner.commitTransaction();
    return result;
  } catch (err) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw err;
  } finally {
    if (!runner.isReleased) await runner.release();
  }
}

// ── Cleanup (refresh-on-rerun) ───────────────────────────────────────────────

async function cleanup(ds: DataSource): Promise<void> {
  // Children (purchases, progress, attempts, transactions, issued certs,
  // access codes, sessions, modules, lessons, exams, questions, options)
  // cascade from these parents. Postgres referential actions are exempt from
  // RLS, so the cascade is clean even under a non-BYPASSRLS role.
  const userIds = Array.from({ length: 16 }, (_, i) =>
    demoId(BLOCK.user, i + 1),
  );
  const certIds = CERTS.map((c) => demoId(BLOCK.cert, c.n));
  const adminIds = Array.from({ length: 8 }, (_, i) =>
    demoId(BLOCK.admin, i + 1),
  );
  const promoIds = Array.from({ length: 8 }, (_, i) =>
    demoId(BLOCK.promo, i + 1),
  );

  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  await ds.query(`DELETE FROM certificates WHERE id = ANY($1::uuid[])`, [
    certIds,
  ]);
  await ds.query(`DELETE FROM admin_users WHERE id = ANY($1::uuid[])`, [
    adminIds,
  ]);
  await ds.query(`DELETE FROM promo_codes WHERE id = ANY($1::uuid[])`, [
    promoIds,
  ]);
  console.log('✓ previous demo slice removed (manual data untouched)');
}

// ── Seed sections ────────────────────────────────────────────────────────────

async function seedAdmins(ds: DataSource, passwordHash: string) {
  const repo = ds.getRepository(AdminUser);
  const admins: Array<[number, string, AdminRole, string, string]> = [
    [1, 'demo-learning@ios.local', AdminRole.LEARNING_ADMIN, 'Leila', 'Hassan'],
    [2, 'demo-content@ios.local', AdminRole.CONTENT_CREATOR, 'Carl', 'Wright'],
    [3, 'demo-finance@ios.local', AdminRole.FINANCE_ADMIN, 'Fatima', 'Aziz'],
    [4, 'demo-support@ios.local', AdminRole.SUPPORT_ADMIN, 'Sam', 'Porter'],
  ];
  for (const [n, email, role, firstName, lastName] of admins) {
    await repo.save(
      repo.create({
        id: demoId(BLOCK.admin, n),
        email,
        passwordHash,
        firstName,
        lastName,
        role,
        active: true,
      }),
    );
  }
  console.log(`✓ ${admins.length} admin users`);
}

async function seedCatalog(ds: DataSource) {
  const certRepo = ds.getRepository(Certificate);
  const moduleRepo = ds.getRepository(LearningModule);
  const lessonRepo = ds.getRepository(Lesson);

  let moduleSeq = 0;
  let lessonSeq = 0;

  for (const spec of CERTS) {
    await certRepo.save(
      certRepo.create({
        id: demoId(BLOCK.cert, spec.n),
        title: spec.title,
        programCode: spec.code,
        description: spec.description,
        translations: {
          en: { title: spec.title, description: spec.description },
          tr: { title: spec.tr },
          ar: { title: spec.ar },
        },
        price: spec.price,
        currency: 'USD',
        active: true,
        track: spec.track,
        level: spec.level,
        durationHours: spec.hours,
      }),
    );

    for (const [mi, mod] of spec.modules.entries()) {
      moduleSeq += 1;
      const moduleId = demoId(BLOCK.module, moduleSeq);
      await moduleRepo.save(
        moduleRepo.create({
          id: moduleId,
          certId: demoId(BLOCK.cert, spec.n),
          title: mod.title,
          description: null,
          translations: { en: { title: mod.title } },
          position: mi + 1,
          active: true,
        }),
      );

      for (const [li, lessonTitle] of mod.lessons.entries()) {
        lessonSeq += 1;
        await lessonRepo.save(
          lessonRepo.create({
            id: demoId(BLOCK.lesson, lessonSeq),
            moduleId,
            title: lessonTitle,
            videoUrl: null,
            contentText: `Demo lesson content for "${lessonTitle}". Replace with real curriculum copy.`,
            translations: { en: { title: lessonTitle } },
            position: li + 1,
            durationSeconds: 420 + li * 120,
            active: true,
          }),
        );
      }
    }
  }
  console.log(
    `✓ ${CERTS.length} certificates, ${moduleSeq} modules, ${lessonSeq} lessons`,
  );
}

interface SeededExam {
  certN: number;
  examId: string;
  order: number;
  /** questionId → { correctOptionId, wrongOptionId, marks } */
  questions: Array<{
    id: string;
    correct: string;
    wrong: string;
    marks: number;
  }>;
}

async function seedExams(ds: DataSource): Promise<SeededExam[]> {
  const examRepo = ds.getRepository(Exam);
  const questionRepo = ds.getRepository(ExamQuestion);
  const optionRepo = ds.getRepository(ExamQuestionOption);

  const seeded: SeededExam[] = [];
  let examSeq = 0;
  let questionSeq = 0;
  let optionSeq = 0;

  for (const spec of CERTS) {
    const total = spec.publishedExams + (spec.draftExams ?? 0);
    for (let order = 1; order <= total; order++) {
      examSeq += 1;
      const examId = demoId(BLOCK.exam, examSeq);
      const isDraft = order > spec.publishedExams;
      await examRepo.save(
        examRepo.create({
          id: examId,
          certId: demoId(BLOCK.cert, spec.n),
          title: `${spec.code} Assessment ${order}${isDraft ? ' (draft)' : ''}`,
          examOrder: order,
          status: isDraft ? ExamStatus.DRAFT : ExamStatus.PUBLISHED,
          passingScore: 80,
          durationMinutes: 60,
          translations: {
            en: { title: `${spec.code} Assessment ${order}` },
          },
        }),
      );

      const entry: SeededExam = { certN: spec.n, examId, order, questions: [] };
      for (const [qi, marks] of QUESTION_MARKS.entries()) {
        questionSeq += 1;
        const questionId = demoId(BLOCK.question, questionSeq);
        const isTrueFalse = qi >= 3;
        await questionRepo.save(
          questionRepo.create({
            id: questionId,
            examId,
            questionText: isTrueFalse
              ? `Demo T/F question ${qi + 1} for ${spec.code} assessment ${order}: the Sprint may be cancelled only by the Product Owner.`
              : `Demo question ${qi + 1} for ${spec.code} assessment ${order}: which statement best reflects empirical process control?`,
            questionType: isTrueFalse ? QuestionType.TRUE_FALSE : QuestionType.MCQ,
            position: qi + 1,
            marks,
          }),
        );

        const optionCount = isTrueFalse ? 2 : 4;
        const correctIndex = qi % optionCount;
        let correctId = '';
        let wrongId = '';
        for (let oi = 0; oi < optionCount; oi++) {
          optionSeq += 1;
          const optionId = demoId(BLOCK.option, optionSeq);
          const isCorrect = oi === correctIndex;
          if (isCorrect) correctId = optionId;
          else if (!wrongId) wrongId = optionId;
          await optionRepo.save(
            optionRepo.create({
              id: optionId,
              questionId,
              optionText: isTrueFalse
                ? oi === 0
                  ? 'True'
                  : 'False'
                : `Option ${String.fromCharCode(65 + oi)}`,
              isCorrect,
            }),
          );
        }
        entry.questions.push({ id: questionId, correct: correctId, wrong: wrongId, marks });
      }
      seeded.push(entry);
    }
  }
  console.log(
    `✓ ${examSeq} exams (incl. 1 draft), ${questionSeq} questions, ${optionSeq} options`,
  );
  return seeded;
}

async function seedStudents(ds: DataSource, passwordHash: string) {
  const repo = ds.getRepository(User);
  const students: Array<{
    n: number;
    email: string;
    firstName: string;
    lastName: string;
    verified: boolean;
    active: boolean;
    locale?: string;
    company?: string;
  }> = [
    { n: 1, email: 'demo+sara@ios.local', firstName: 'Sara', lastName: 'Demir', verified: true, active: true, company: 'Acme Corp' },
    { n: 2, email: 'demo+omar@ios.local', firstName: 'Omar', lastName: 'Khalil', verified: true, active: true, locale: 'ar' },
    { n: 3, email: 'demo+lina@ios.local', firstName: 'Lina', lastName: 'Aydin', verified: true, active: true, locale: 'tr' },
    { n: 4, email: 'demo+yusuf@ios.local', firstName: 'Yusuf', lastName: 'Mansour', verified: true, active: true },
    { n: 5, email: 'demo+mona@ios.local', firstName: 'Mona', lastName: 'Said', verified: true, active: true, company: 'Globex' },
    { n: 6, email: 'demo+karim@ios.local', firstName: 'Karim', lastName: 'Naser', verified: true, active: true },
    { n: 7, email: 'demo+aisha@ios.local', firstName: 'Aisha', lastName: 'Rahman', verified: false, active: true },
    { n: 8, email: 'demo+tom@ios.local', firstName: 'Tom', lastName: 'Becker', verified: true, active: false },
  ];
  for (const s of students) {
    await repo.save(
      repo.create({
        id: demoId(BLOCK.user, s.n),
        email: s.email,
        passwordHash,
        firstName: s.firstName,
        lastName: s.lastName,
        phone: null,
        avatarUrl: null,
        country: null,
        city: null,
        street: null,
        address: null,
        postalCode: null,
        occupation: null,
        position: null,
        company: s.company ?? null,
        locale: s.locale ?? 'en',
        emailVerified: s.verified,
        emailVerifiedAt: s.verified ? new Date() : null,
        active: s.active,
      }),
    );
  }
  console.log(`✓ ${students.length} students`);
}

/** Build an answers map hitting an exact weighted score. */
function buildAnswers(
  exam: SeededExam,
  correctMarks: number[],
): { answers: Record<string, string>; score: number } {
  const answers: Record<string, string> = {};
  let earned = 0;
  let total = 0;
  for (const q of exam.questions) {
    total += q.marks;
    if (correctMarks.includes(q.marks) ) {
      // consume one entry per match
      correctMarks.splice(correctMarks.indexOf(q.marks), 1);
      answers[q.id] = q.correct;
      earned += q.marks;
    } else {
      answers[q.id] = q.wrong;
    }
  }
  return { answers, score: parseFloat(((earned / total) * 100).toFixed(2)) };
}

async function seedStories(ds: DataSource, exams: SeededExam[]) {
  const certId = (n: number) => demoId(BLOCK.cert, n);
  const userId = (n: number) => demoId(BLOCK.user, n);
  const examsFor = (certN: number) =>
    exams
      .filter((e) => e.certN === certN)
      .sort((a, b) => a.order - b.order);

  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

  // Helper: purchase + completed transaction inside the owner's RLS context.
  let purchaseSeq = 0;
  let txSeq = 0;
  const purchase = async (
    uN: number,
    cN: number,
    opts: { examCompleted?: boolean; promoId?: string; amount: number; when: number },
  ) => {
    purchaseSeq += 1;
    txSeq += 1;
    const pId = demoId(BLOCK.purchase, purchaseSeq);
    const tId = demoId(BLOCK.transaction, txSeq);
    await asUser(ds, userId(uN), async (r) => {
      await r.query(
        `INSERT INTO student_purchases
           (id, user_id, cert_id, payment_intent_id, payment_type, pre_exam_confirmed, exam_completed, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          pId,
          userId(uN),
          certId(cN),
          `pi_demo_${purchaseSeq}`,
          PaymentType.ENROLLMENT,
          opts.examCompleted ?? false,
          opts.examCompleted ?? false,
          daysAgo(opts.when),
        ],
      );
      await r.query(
        `INSERT INTO transactions
           (id, user_id, cert_id, stripe_session_id, amount, currency, status, promo_code_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $8)`,
        [
          tId,
          userId(uN),
          certId(cN),
          `cs_demo_${txSeq}`,
          opts.amount,
          TransactionStatus.COMPLETED,
          opts.promoId ?? null,
          daysAgo(opts.when),
        ],
      );
    });
  };

  // Lesson progress helper (student_progress is NOT RLS'd — plain queries).
  const completeLessons = async (uN: number, certN: number, count: number) => {
    const rows: Array<{ id: string }> = await ds.query(
      `SELECT l.id FROM lessons l
         JOIN learning_modules m ON m.id = l.module_id
        WHERE m.cert_id = $1
        ORDER BY m.position, l.position
        LIMIT $2`,
      [certId(certN), count],
    );
    for (const [i, row] of rows.entries()) {
      await ds.query(
        `INSERT INTO student_progress (id, user_id, lesson_id, completed_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $3, $3)`,
        [userId(uN), row.id, daysAgo(20 - i)],
      );
    }
  };

  // Exam attempt helper (FORCE RLS — runs as the student).
  let attemptSeq = 0;
  const attempt = async (
    uN: number,
    exam: SeededExam,
    correctMarks: number[],
    when: number,
  ): Promise<{ id: string; passed: boolean }> => {
    attemptSeq += 1;
    const aId = demoId(BLOCK.attempt, attemptSeq);
    const { answers, score } = buildAnswers(exam, [...correctMarks]);
    const passed = score >= 80;
    await asUser(ds, userId(uN), async (r) => {
      await r.query(
        `INSERT INTO exam_attempts
           (id, user_id, exam_id, cert_id, score, passed, answers, duration_seconds, started_at, submitted_at, status, late_flag, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $10, $10)`,
        [
          aId,
          userId(uN),
          exam.examId,
          certId(exam.certN),
          score,
          passed,
          JSON.stringify(answers),
          2400,
          daysAgo(when),
          new Date(daysAgo(when).getTime() + 2_400_000),
          AttemptStatus.SUBMITTED,
        ],
      );
    });
    return { id: aId, passed };
  };

  // ── Story 1 — Sara: bought PSM, finished the course, passed, certified ─────
  await purchase(1, 1, { examCompleted: true, amount: 149, when: 30 });
  await completeLessons(1, 1, 12); // all PSM lessons
  const saraAttempt = await attempt(1, examsFor(1)[0], [3, 2, 2, 2], 21); // 90%
  await asUser(ds, userId(1), async (r) => {
    await r.query(
      `INSERT INTO issued_certificates
         (id, user_id, certificate_id, exam_attempt_id, s3_url, qr_url, is_active, issued_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, NULL, true, $5, $5, $5)`,
      [demoId(BLOCK.issued, 1), userId(1), certId(1), saraAttempt.id, daysAgo(21)],
    );
  });

  // ── Story 2 — Omar: bought PSM, failed assessment 1, retake pending ────────
  await purchase(2, 1, { amount: 149, when: 25 });
  await completeLessons(2, 1, 8);
  await attempt(2, examsFor(1)[0], [3, 2, 1], 14); // 60% — failed
  // Outstanding one-time access code for the NEXT exam (what assignNextExam
  // would issue): PSM assessment 2.
  const accessRepo = ds.getRepository(ExamAccessCode);
  await accessRepo.save(
    accessRepo.create({
      id: demoId(BLOCK.accessCode, 1),
      userId: userId(2),
      examId: examsFor(1)[1].examId,
      certId: certId(1),
      tokenHash: await bcrypt.hash(DEMO_ACCESS_CODE, 10),
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
      usedAt: null,
    }),
  );

  // ── Story 3 — Lina: bought PSPO, mid-course, no exam yet ───────────────────
  await purchase(3, 2, { amount: 149, when: 12 });
  await completeLessons(3, 2, 5);

  // ── Story 4 — Yusuf: bought PSD with the 20% promo, just started ──────────
  await purchase(4, 3, {
    amount: 103.2,
    promoId: demoId(BLOCK.promo, 1),
    when: 3,
  });
  await completeLessons(4, 3, 1);

  // ── Story 5 — Mona: PAL passed + certified; PSM bought but untouched ──────
  await purchase(5, 4, { examCompleted: true, amount: 199, when: 45 });
  await completeLessons(5, 4, 6);
  const monaAttempt = await attempt(5, examsFor(4)[0], [3, 2, 2, 2, 1], 40); // 100%
  await asUser(ds, userId(5), async (r) => {
    await r.query(
      `INSERT INTO issued_certificates
         (id, user_id, certificate_id, exam_attempt_id, s3_url, qr_url, is_active, issued_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, NULL, true, $5, $5, $5)`,
      [demoId(BLOCK.issued, 2), userId(5), certId(4), monaAttempt.id, daysAgo(40)],
    );
  });
  await purchase(5, 1, { amount: 149, when: 2 });

  // Stories 6–8 (Karim: browsing only · Aisha: unverified · Tom: deactivated)
  // need no purchase rows — their value is the account state itself.

  console.log(
    `✓ ${purchaseSeq} purchases, ${txSeq} transactions, ${attemptSeq} exam attempts, 2 issued certificates, 1 outstanding access code`,
  );
}

async function seedPromoCodes(ds: DataSource) {
  await ds.query(
    `INSERT INTO promo_codes
       (id, code, discount_type, discount_value, applicable_cert_ids, max_uses, usage_count, expires_at, created_by_id, created_at, updated_at)
     VALUES
       ($1, 'SCRUM20',   $2, 20.00, NULL,            NULL, 0, NOW() + interval '90 days', $7, NOW(), NOW()),
       ($3, 'LAUNCH100', $4, NULL,  ARRAY[$8]::uuid[],  5, 0, NOW() + interval '30 days', $7, NOW(), NOW()),
       ($5, 'EXPIRED10', $6, 10.00, NULL,            NULL, 0, NOW() - interval '1 day',   $7, NOW(), NOW())`,
    [
      demoId(BLOCK.promo, 1),
      DiscountType.PERCENTAGE,
      demoId(BLOCK.promo, 2),
      DiscountType.FULL_WAIVER,
      demoId(BLOCK.promo, 3),
      DiscountType.PERCENTAGE,
      demoId(BLOCK.admin, 3), // created by demo finance admin
      demoId(BLOCK.cert, 3), // LAUNCH100 applies to PSD only
    ],
  );
  // Note: Yusuf's transaction (seeded AFTER this, in seedStories) references
  // SCRUM20 — the update_promo_usage_count DB trigger increments usage_count
  // automatically on that insert. Do not set it manually here.
  console.log('✓ 3 promo codes (SCRUM20, LAUNCH100, EXPIRED10)');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('✗ Refusing to seed demo data with NODE_ENV=production.');
    process.exit(1);
  }

  const ds = await AppDataSource.initialize();
  console.log(`Connected to ${ds.options.database as string}. Seeding demo data…\n`);

  try {
    await cleanup(ds);

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    await seedAdmins(ds, passwordHash);
    await seedCatalog(ds);
    const exams = await seedExams(ds);
    await seedStudents(ds, passwordHash);
    await seedPromoCodes(ds);
    await seedStories(ds, exams);

    console.log(`
──────────────────────────────────────────────────────────
Demo data ready. All demo accounts share the password:

    ${DEMO_PASSWORD}

Admins:   demo-learning@ios.local (learning_admin)
          demo-content@ios.local  (content_creator)
          demo-finance@ios.local  (finance_admin)
          demo-support@ios.local  (support_admin)

Students: demo+sara@ios.local   PSM done, passed 90%, certified
          demo+omar@ios.local   PSM failed 60%, retake code pending
          demo+lina@ios.local   PSPO mid-course (locale tr)
          demo+yusuf@ios.local  PSD via SCRUM20 promo, just started
          demo+mona@ios.local   PAL certified (100%), PSM untouched
          demo+karim@ios.local  verified, no purchases
          demo+aisha@ios.local  NOT email-verified
          demo+tom@ios.local    deactivated account

Omar's one-time access code (PSM Assessment 2):
    ${DEMO_ACCESS_CODE}

Promo codes: SCRUM20 (20% all) · LAUNCH100 (free, PSD only) · EXPIRED10
Re-run anytime: the demo slice is wiped and re-inserted; your own
rows are never touched. Details: docs/DEMO_DATA.md
──────────────────────────────────────────────────────────`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('✗ Demo seed failed:', err);
  process.exit(1);
});
