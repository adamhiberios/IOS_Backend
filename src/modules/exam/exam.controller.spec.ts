import { Test, TestingModule } from '@nestjs/testing';
import { ExamController } from './exam.controller';
import { ExamService } from './exam.service';
import { TestSessionStatus } from '../../database/entities/test-session.entity';

const mockExamService = {
  validateAccess: jest.fn(),
  startExam: jest.fn(),
  getSessionStatus: jest.fn(),
  autosave: jest.fn(),
  submitExam: jest.fn(),
  lateSubmitExam: jest.fn(),
};

const userId = 'user-1';

describe('ExamController', () => {
  let controller: ExamController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExamController],
      providers: [{ provide: ExamService, useValue: mockExamService }],
    }).compile();
    controller = module.get(ExamController);
  });

  it('validateAccess — returns valid:true with exam info', async () => {
    mockExamService.validateAccess.mockResolvedValue({
      exam: {
        id: 'exam-1',
        title: 'PSM I',
        durationMinutes: 60,
        passingScore: 80,
      },
      accessCodeId: 'code-1',
    });
    const result = await controller.validateAccess(userId, {
      code: 'abc',
      examId: 'exam-1',
    });
    expect(result.valid).toBe(true);
    expect(result.accessCodeId).toBe('code-1');
  });

  it('startExam — strips isCorrect from options', async () => {
    mockExamService.startExam.mockResolvedValue({
      sessionId: 'sess-1',
      durationSeconds: 3600,
      expiresAt: new Date(),
      questions: [
        {
          id: 'q-1',
          questionText: 'Q?',
          questionType: 'mcq',
          position: 1,
          options: [
            { id: 'opt-a', optionText: 'A', isCorrect: true },
            { id: 'opt-b', optionText: 'B', isCorrect: false },
          ],
        },
      ],
    });
    const result = await controller.startExam(userId, {
      code: 'abc',
      examId: 'exam-1',
    });
    expect(result.questions[0].options[0]).not.toHaveProperty('isCorrect');
    expect(result.questions[0].options[0]).toHaveProperty('optionText', 'A');
  });

  it('autosave — returns { saved: true }', async () => {
    mockExamService.autosave.mockResolvedValue(undefined);
    const result = await controller.autosave(userId, 'sess-1', {
      answers: { 'q-1': 'opt-a' },
    });
    expect(result).toEqual({ saved: true });
  });

  it('getSessionStatus — delegates to service', async () => {
    const expected = {
      sessionId: 'sess-1',
      remainingSeconds: 3500,
      answers: {},
      status: TestSessionStatus.ACTIVE,
    };
    mockExamService.getSessionStatus.mockResolvedValue(expected);
    const result = await controller.getSessionStatus(userId, 'sess-1');
    expect(result).toEqual(expected);
  });

  it('submit — returns score result from service', async () => {
    const scoreResult = { score: 85, passed: true, correctCount: 17, totalCount: 20 };
    mockExamService.submitExam.mockResolvedValue(scoreResult);
    const result = await controller.submit(userId, 'sess-1', {
      answers: {},
    });
    expect(result).toEqual(scoreResult);
  });
});
