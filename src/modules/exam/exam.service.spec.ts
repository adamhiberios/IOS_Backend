import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import { TestSessionService } from './test-session.service';
import { Exam, ExamStatus } from '../../database/entities/exam.entity';
import { ExamAccessCode } from '../../database/entities/exam-access-code.entity';
import { TestSession as TestSessionEntity } from '../../database/entities/test-session.entity';
import { ExamAccessCode } from '../../database/entities/exam-access-code.entity';
import { ExamAttempt, AttemptStatus } from '../../database/entities/exam-attempt.entity';
import { TestSession, TestSessionStatus } from '../../database/entities/test-session.entity';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');
const bcryptMock = bcrypt as jest.Mocked<typeof bcrypt>;

const mockExamRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};
const mockAccessCodeRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockTestSessionRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockAttemptRepo = {
  create: jest.fn(),
  save: jest.fn(),
};
// C2 — scoreAndPersist runs in its own RLS-scoped QueryRunner transaction.
const mockRunnerManager = {
  save: jest.fn(),
  update: jest.fn(),
};
const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  query: jest.fn(),
  manager: mockRunnerManager,
  isTransactionActive: true,
  isReleased: false,
};
// M3/G1 — entity manager used by dataSource.transaction(cb).
const mockEntityManager = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockDataSource = {
  createQueryRunner: jest.fn(() => mockQueryRunner),
  transaction: jest.fn(
    async (cb: (em: typeof mockEntityManager) => unknown) =>
      cb(mockEntityManager),
  ),
};
const mockTestSessionSvc = {
  start: jest.fn(),
  autosave: jest.fn(),
  getSession: jest.fn(),
  deleteSession: jest.fn(),
  startGrace: jest.fn(),
  consumeGrace: jest.fn(),
  hasGrace: jest.fn(),
};

const mockExam: Partial<Exam> = {
  id: 'exam-1',
  certId: 'cert-1',
  title: 'PSM I Exam',
  status: ExamStatus.PUBLISHED,
  examOrder: 1,
  durationMinutes: 60,
  passingScore: 80,
  questions: [
    {
      id: 'q-1',
      examId: 'exam-1',
      questionText: 'What is Scrum?',
      position: 1,
      marks: 1,
    } as any,
  ],
};

const mockSession: Partial<TestSession> = {
  id: 'sess-1',
  userId: 'user-1',
  examId: 'exam-1',
  startedAt: new Date(),
  durationSeconds: 3600,
  expiresAt: new Date(Date.now() + 3_600_000),
  status: TestSessionStatus.ACTIVE,
  snapshot: null,
};

describe('ExamService', () => {
  let service: ExamService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamService,
        { provide: getRepositoryToken(Exam), useValue: mockExamRepo },
        { provide: getRepositoryToken(ExamAccessCode), useValue: mockAccessCodeRepo },
        { provide: getRepositoryToken(TestSession), useValue: mockTestSessionRepo },
        { provide: getRepositoryToken(ExamAttempt), useValue: mockAttemptRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: TestSessionService, useValue: mockTestSessionSvc },
      ],
    }).compile();
    service = module.get(ExamService);
  });

  // ── assignExam ─────────────────────────────────────────────────────────────

  it('assignExam — throws NotFoundException for unknown exam', async () => {
    mockExamRepo.findOne.mockResolvedValue(null);
    await expect(service.assignExam('u', 'bad-exam', 'c')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assignExam — creates access code and returns plain code', async () => {
    mockExamRepo.findOne.mockResolvedValue(mockExam);
    (bcryptMock.hash as jest.Mock).mockResolvedValue('hashed');
    mockAccessCodeRepo.create.mockImplementation((d) => d);
    mockAccessCodeRepo.save.mockResolvedValue({});
    const result = await service.assignExam('u', 'exam-1', 'cert-1');
    expect(result.plainCode).toHaveLength(64); // 32 bytes hex
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockAccessCodeRepo.save).toHaveBeenCalled();
  });

  it('assignExam — rejects a DRAFT exam with 422 (M9)', async () => {
    mockExamRepo.findOne.mockResolvedValue({
      ...mockExam,
      status: ExamStatus.DRAFT,
    });
    await expect(
      service.assignExam('u', 'exam-1', 'cert-1'),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(mockAccessCodeRepo.save).not.toHaveBeenCalled();
  });

  it('assignExam — rejects an exam that belongs to a different certificate with 400', async () => {
    mockExamRepo.findOne.mockResolvedValue({ ...mockExam, certId: 'cert-OTHER' });
    await expect(
      service.assignExam('u', 'exam-1', 'cert-1'),
    ).rejects.toThrow(BadRequestException);
  });

  // ── assignNextExam (G1 — SoT §2.3 algorithm) ───────────────────────────────

  describe('assignNextExam', () => {
    const pool = [
      { ...mockExam, id: 'exam-1', examOrder: 1, title: 'PSM I' },
      { ...mockExam, id: 'exam-2', examOrder: 2, title: 'PSM I — Retake A' },
      { ...mockExam, id: 'exam-3', examOrder: 3, title: 'PSM I — Retake B' },
    ];

    const mockAttempted = (examIds: string[]) => {
      mockQueryRunner.query.mockImplementation(async (sql: string) =>
        sql.includes('SELECT DISTINCT')
          ? examIds.map((id) => ({ exam_id: id }))
          : undefined,
      );
    };

    beforeEach(() => {
      mockExamRepo.find.mockResolvedValue(pool);
      mockAccessCodeRepo.findOne.mockResolvedValue(null);
      mockAccessCodeRepo.create.mockImplementation((d) => d);
      mockAccessCodeRepo.save.mockResolvedValue({});
      (bcryptMock.hash as jest.Mock).mockResolvedValue('hashed');
    });

    it('queries only PUBLISHED exams ordered by exam_order ASC', async () => {
      mockAttempted([]);
      await service.assignNextExam('user-1', 'cert-1');
      expect(mockExamRepo.find).toHaveBeenCalledWith({
        where: { certId: 'cert-1', status: ExamStatus.PUBLISHED },
        order: { examOrder: 'ASC' },
      });
    });

    it('assigns the lowest unattempted exam_order', async () => {
      mockAttempted(['exam-1']); // first already attempted
      const result = await service.assignNextExam('user-1', 'cert-1');
      expect(result.examId).toBe('exam-2');
      expect(result.examOrder).toBe(2);
      expect(result.plainCode).toHaveLength(64);
    });

    it('runs the attempts lookup inside an RLS-scoped transaction keyed on the STUDENT', async () => {
      mockAttempted([]);
      await service.assignNextExam('user-1', 'cert-1');
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining(`set_config('app.current_user_id', $1, true)`),
        ['user-1'],
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('throws 403 when the pool is exhausted', async () => {
      mockAttempted(['exam-1', 'exam-2', 'exam-3']);
      await expect(
        service.assignNextExam('user-1', 'cert-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAccessCodeRepo.save).not.toHaveBeenCalled();
    });

    it('throws 404 when the certificate has no published exams', async () => {
      mockExamRepo.find.mockResolvedValue([]);
      await expect(
        service.assignNextExam('user-1', 'cert-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 when an unused, unexpired code already exists for the next exam', async () => {
      mockAttempted([]);
      mockAccessCodeRepo.findOne.mockResolvedValue({
        id: 'code-old',
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await expect(
        service.assignNextExam('user-1', 'cert-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockAccessCodeRepo.save).not.toHaveBeenCalled();
    });

    it('ignores an EXPIRED outstanding code and issues a new one', async () => {
      mockAttempted([]);
      mockAccessCodeRepo.findOne.mockResolvedValue({
        id: 'code-old',
        expiresAt: new Date(Date.now() - 1000),
      });
      const result = await service.assignNextExam('user-1', 'cert-1');
      expect(result.examId).toBe('exam-1');
      expect(mockAccessCodeRepo.save).toHaveBeenCalled();
    });
  });

  // ── validateAccess ─────────────────────────────────────────────────────────

  it('validateAccess — rejects a DRAFT exam with the generic 403 (M9, no state enumeration)', async () => {
    mockExamRepo.findOne.mockResolvedValue({
      ...mockExam,
      status: ExamStatus.DRAFT,
    });
    await expect(
      service.validateAccess('u', 'any-code', 'exam-1'),
    ).rejects.toThrow('Invalid or expired access code');
    // Must not even consult the codes table.
    expect(mockAccessCodeRepo.find).not.toHaveBeenCalled();
  });


  it('validateAccess — throws ForbiddenException when no valid code exists', async () => {
    mockExamRepo.findOne.mockResolvedValue(mockExam);
    mockAccessCodeRepo.find.mockResolvedValue([]);
    await expect(service.validateAccess('u', 'bad-code', 'exam-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('validateAccess — returns exam on matching code', async () => {
    mockExamRepo.findOne.mockResolvedValue(mockExam);
    const candidate = {
      id: 'code-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    mockAccessCodeRepo.find.mockResolvedValue([candidate]);
    (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
    const result = await service.validateAccess('u', 'plain', 'exam-1');
    expect(result.exam).toEqual(mockExam);
    expect(result.accessCodeId).toBe('code-1');
  });

  // ── startExam ──────────────────────────────────────────────────────────────

  it('startExam — throws ConflictException if active session already exists', async () => {
    mockExamRepo.findOne.mockResolvedValue(mockExam);
    const candidate = {
      id: 'code-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 3_600_000),
      certId: 'cert-1',
    };
    mockAccessCodeRepo.find.mockResolvedValue([candidate]);
    (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
    mockTestSessionRepo.findOne.mockResolvedValue(mockSession);
    await expect(service.startExam('user-1', 'plain', 'exam-1')).rejects.toThrow(
      ConflictException,
    );
  });

  // ── scoreAnswers ───────────────────────────────────────────────────────────

  it('scoreAnswers — returns 0 score for empty exam', async () => {
    mockExamRepo.findOne.mockResolvedValue({ ...mockExam, questions: [] });
    const result = await service.scoreAnswers('exam-1', {});
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('scoreAnswers — counts correct answers accurately', async () => {
    const examWithOptions = {
      ...mockExam,
      questions: [
        {
          id: 'q-1',
          options: [
            { id: 'opt-a', isCorrect: true },
            { id: 'opt-b', isCorrect: false },
          ],
        },
        {
          id: 'q-2',
          options: [
            { id: 'opt-c', isCorrect: false },
            { id: 'opt-d', isCorrect: true },
          ],
        },
      ],
    };
    mockExamRepo.findOne.mockResolvedValue(examWithOptions);
    // Answer q-1 correctly, q-2 incorrectly
    const result = await service.scoreAnswers('exam-1', {
      'q-1': 'opt-a',
      'q-2': 'opt-c',
    });
    expect(result.correctCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.score).toBe(50);
    expect(result.passed).toBe(false);
  });

  it('scoreAnswers — 100% is passing', async () => {
    const examWithOptions = {
      ...mockExam,
      passingScore: 80,
      questions: [
        { id: 'q-1', options: [{ id: 'opt-a', isCorrect: true }] },
      ],
    };
    mockExamRepo.findOne.mockResolvedValue(examWithOptions);
    const result = await service.scoreAnswers('exam-1', { 'q-1': 'opt-a' });
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  // ── submitExam / scoreAndPersist (C2 — RLS-scoped persistence) ─────────────

  describe('submitExam — RLS-scoped persistence', () => {
    beforeEach(() => {
      mockTestSessionRepo.findOne.mockResolvedValue({ ...mockSession });
      mockExamRepo.findOne.mockResolvedValue({
        ...mockExam,
        questions: [
          { id: 'q-1', options: [{ id: 'opt-a', isCorrect: true }] },
        ],
      });
      mockAttemptRepo.create.mockImplementation((d) => d);
      mockRunnerManager.update.mockResolvedValue({ affected: 1 });
      mockTestSessionSvc.deleteSession.mockResolvedValue(undefined);
    });

    it('persists the attempt inside a transaction with app.current_user_id set', async () => {
      const result = await service.submitExam('sess-1', 'user-1', {
        'q-1': 'opt-a',
      });

      expect(mockDataSource.createQueryRunner).toHaveBeenCalled();
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      // set_config must run BEFORE the insert, with the session owner's id.
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining(`set_config('app.current_user_id', $1, true)`),
        ['user-1'],
      );
      expect(mockRunnerManager.save).toHaveBeenCalledWith(
        ExamAttempt,
        expect.objectContaining({
          userId: 'user-1',
          examId: 'exam-1',
          status: AttemptStatus.SUBMITTED,
          lateFlag: false,
        }),
      );
      // H4: conditional transition — criteria constrains current status.
      expect(mockRunnerManager.update).toHaveBeenCalledWith(
        TestSession,
        expect.objectContaining({ id: 'sess-1' }),
        expect.objectContaining({ status: TestSessionStatus.SUBMITTED }),
      );
      // Order: set_config → conditional update → attempt insert.
      const queryOrder = mockQueryRunner.query.mock.invocationCallOrder[0];
      const updateOrder = mockRunnerManager.update.mock.invocationCallOrder[0];
      const saveOrder = mockRunnerManager.save.mock.invocationCallOrder[0];
      expect(queryOrder).toBeLessThan(updateOrder);
      expect(updateOrder).toBeLessThan(saveOrder);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockTestSessionSvc.deleteSession).toHaveBeenCalledWith('sess-1');
      // Legacy direct-repo writes must NOT be used (they bypass the RLS GUC).
      expect(mockAttemptRepo.save).not.toHaveBeenCalled();
      expect(mockTestSessionRepo.update).not.toHaveBeenCalled();
      expect(result.score).toBe(100);
      expect(result.passed).toBe(true);
    });

    it('rolls back and releases the runner when the insert fails', async () => {
      mockRunnerManager.save.mockRejectedValueOnce(new Error('insert failed'));

      await expect(
        service.submitExam('sess-1', 'user-1', { 'q-1': 'opt-a' }),
      ).rejects.toThrow('insert failed');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockTestSessionSvc.deleteSession).not.toHaveBeenCalled();
    });

    it('H4 — throws Conflict and inserts no attempt when another submit won the race', async () => {
      mockRunnerManager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.submitExam('sess-1', 'user-1', { 'q-1': 'opt-a' }),
      ).rejects.toThrow(ConflictException);

      expect(mockRunnerManager.save).not.toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  // ── lateSubmitExam (H3 — ownership before grace consume) ───────────────────

  describe('lateSubmitExam', () => {
    const expiredSession = {
      ...mockSession,
      status: TestSessionStatus.EXPIRED,
    };

    beforeEach(() => {
      mockExamRepo.findOne.mockResolvedValue({
        ...mockExam,
        questions: [
          { id: 'q-1', options: [{ id: 'opt-a', isCorrect: true }] },
        ],
      });
      mockAttemptRepo.create.mockImplementation((d) => d);
      mockRunnerManager.update.mockResolvedValue({ affected: 1 });
      mockTestSessionSvc.deleteSession.mockResolvedValue(undefined);
    });

    it('H3 — rejects a non-owner BEFORE consuming the grace key', async () => {
      mockTestSessionRepo.findOne.mockResolvedValue(expiredSession); // owned by user-1

      await expect(
        service.lateSubmitExam('sess-1', 'attacker-9', { 'q-1': 'opt-a' }),
      ).rejects.toThrow(ForbiddenException);

      // The victim's grace window must remain intact.
      expect(mockTestSessionSvc.consumeGrace).not.toHaveBeenCalled();
    });

    it('consumes grace and persists a lateFlag attempt for the owner', async () => {
      mockTestSessionRepo.findOne.mockResolvedValue(expiredSession);
      mockTestSessionSvc.consumeGrace.mockResolvedValue({ 'q-1': 'opt-a' });

      const result = await service.lateSubmitExam('sess-1', 'user-1', {});

      expect(mockTestSessionSvc.consumeGrace).toHaveBeenCalledWith('sess-1');
      expect(mockRunnerManager.save).toHaveBeenCalledWith(
        ExamAttempt,
        expect.objectContaining({ lateFlag: true, userId: 'user-1' }),
      );
      expect(result.score).toBe(100);
    });

    it('rejects when the grace window has closed', async () => {
      mockTestSessionRepo.findOne.mockResolvedValue(expiredSession);
      mockTestSessionSvc.consumeGrace.mockResolvedValue(null);

      await expect(
        service.lateSubmitExam('sess-1', 'user-1', {}),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRunnerManager.save).not.toHaveBeenCalled();
    });
  });

  // ── Weighted scoring (M9) ───────────────────────────────────────────────────

  it('scoreAnswers — weights the score by question marks', async () => {
    mockExamRepo.findOne.mockResolvedValue({
      ...mockExam,
      passingScore: 80,
      questions: [
        { id: 'q-1', marks: 3, options: [{ id: 'opt-a', isCorrect: true }] },
        { id: 'q-2', marks: 1, options: [{ id: 'opt-b', isCorrect: true }] },
      ],
    });
    // q-1 (3 marks) correct, q-2 (1 mark) wrong → 3/4 = 75%
    const result = await service.scoreAnswers('exam-1', {
      'q-1': 'opt-a',
      'q-2': 'opt-WRONG',
    });
    expect(result.score).toBe(75);
    expect(result.passed).toBe(false);
    expect(result.correctCount).toBe(1); // counts stay plain question counts
    expect(result.totalCount).toBe(2);
  });

  // ── startExam compensation (M3) ────────────────────────────────────────────

  describe('startExam — compensation when Redis start fails', () => {
    beforeEach(() => {
      mockExamRepo.findOne.mockResolvedValue({ ...mockExam, questions: [] });
      const candidate = {
        id: 'code-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 3_600_000),
        certId: 'cert-1',
      };
      mockAccessCodeRepo.find.mockResolvedValue([candidate]);
      (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
      mockTestSessionRepo.findOne.mockResolvedValue(null); // no active session

      mockEntityManager.update.mockResolvedValue({ affected: 1 });
      mockEntityManager.create.mockImplementation((_cls, d) => d);
      mockEntityManager.save.mockImplementation(async (e) => ({
        ...e,
        id: 'sess-9',
      }));
    });

    it('frees the access code and deletes the dangling session row, then rethrows', async () => {
      mockTestSessionSvc.start.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.startExam('user-1', 'plain', 'exam-1'),
      ).rejects.toThrow('redis down');

      // Compensation: session row removed…
      expect(mockEntityManager.delete).toHaveBeenCalledWith(
        TestSessionEntity,
        { id: 'sess-9' },
      );
      // …and the one-time code restored to unused.
      expect(mockEntityManager.update).toHaveBeenCalledWith(
        ExamAccessCode,
        { id: 'code-1' },
        { usedAt: null },
      );
    });

    it('happy path: consumes the code and creates the session in one transaction', async () => {
      mockTestSessionSvc.start.mockResolvedValue(undefined);

      const result = await service.startExam('user-1', 'plain', 'exam-1');

      expect(result.sessionId).toBe('sess-9');
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockEntityManager.update).toHaveBeenCalledWith(
        ExamAccessCode,
        { id: 'code-1', usedAt: expect.anything() },
        { usedAt: expect.any(Date) },
      );
      expect(mockEntityManager.delete).not.toHaveBeenCalled();
    });

    it('first-write-wins: a consumed code aborts the transaction with 409', async () => {
      mockEntityManager.update.mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.startExam('user-1', 'plain', 'exam-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });
  });
});
