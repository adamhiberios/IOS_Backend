import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { ExamService } from './exam.service';
import { TestSessionService } from './test-session.service';
import { Exam } from '../../database/entities/exam.entity';
import { ExamAccessCode } from '../../database/entities/exam-access-code.entity';
import { ExamAttempt, AttemptStatus } from '../../database/entities/exam-attempt.entity';
import { TestSession, TestSessionStatus } from '../../database/entities/test-session.entity';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');
const bcryptMock = bcrypt as jest.Mocked<typeof bcrypt>;

const mockExamRepo = {
  findOne: jest.fn(),
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

  // ── validateAccess ─────────────────────────────────────────────────────────

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
});
