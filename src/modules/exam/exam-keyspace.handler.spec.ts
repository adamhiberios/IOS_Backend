import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExamKeyspaceHandler } from './exam-keyspace.handler';
import { ExamService } from './exam.service';
import { ExamGateway } from './exam.gateway';
import { TestSessionService } from './test-session.service';
import { TestSession, TestSessionStatus } from '../../database/entities/test-session.entity';

const mockTestSessionRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockExamService = {
  autoSubmitFromSnapshot: jest.fn(),
};

const mockGateway = {
  emitSessionExpired: jest.fn(),
};

const mockTestSessionSvc = {
  startGrace: jest.fn(),
};

describe('ExamKeyspaceHandler', () => {
  let handler: ExamKeyspaceHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamKeyspaceHandler,
        { provide: getRepositoryToken(TestSession), useValue: mockTestSessionRepo },
        { provide: ExamService, useValue: mockExamService },
        { provide: ExamGateway, useValue: mockGateway },
        { provide: TestSessionService, useValue: mockTestSessionSvc },
      ],
    }).compile();
    handler = module.get(ExamKeyspaceHandler);
  });

  // ── Session expiry ─────────────────────────────────────────────────────────

  it('session expiry — marks session EXPIRED, opens grace, emits WS', async () => {
    mockTestSessionRepo.findOne.mockResolvedValue({
      id: 'sess-1',
      status: TestSessionStatus.ACTIVE,
      snapshot: { 'q-1': 'opt-a' },
    });
    mockTestSessionRepo.update.mockResolvedValue({ affected: 1 });
    mockTestSessionSvc.startGrace.mockResolvedValue(undefined);
    mockGateway.emitSessionExpired.mockReturnValue(undefined);

    await handler.handleExpiry({ type: 'session', sessionId: 'sess-1' });

    expect(mockTestSessionRepo.update).toHaveBeenCalledWith('sess-1', {
      status: TestSessionStatus.EXPIRED,
    });
    expect(mockTestSessionSvc.startGrace).toHaveBeenCalledWith('sess-1', {
      'q-1': 'opt-a',
    });
    expect(mockGateway.emitSessionExpired).toHaveBeenCalledWith('sess-1');
  });

  it('session expiry — skips already-submitted session', async () => {
    mockTestSessionRepo.findOne.mockResolvedValue({
      id: 'sess-1',
      status: TestSessionStatus.SUBMITTED,
      snapshot: {},
    });
    await handler.handleExpiry({ type: 'session', sessionId: 'sess-1' });
    expect(mockTestSessionRepo.update).not.toHaveBeenCalled();
    expect(mockGateway.emitSessionExpired).not.toHaveBeenCalled();
  });

  it('session expiry — handles missing session gracefully (no throw)', async () => {
    mockTestSessionRepo.findOne.mockResolvedValue(null);
    await expect(
      handler.handleExpiry({ type: 'session', sessionId: 'ghost' }),
    ).resolves.not.toThrow();
    expect(mockTestSessionRepo.update).not.toHaveBeenCalled();
  });

  it('session expiry — uses empty object when snapshot is null', async () => {
    mockTestSessionRepo.findOne.mockResolvedValue({
      id: 'sess-2',
      status: TestSessionStatus.ACTIVE,
      snapshot: null,
    });
    mockTestSessionRepo.update.mockResolvedValue({ affected: 1 });
    mockTestSessionSvc.startGrace.mockResolvedValue(undefined);
    mockGateway.emitSessionExpired.mockReturnValue(undefined);

    await handler.handleExpiry({ type: 'session', sessionId: 'sess-2' });

    expect(mockTestSessionSvc.startGrace).toHaveBeenCalledWith('sess-2', {});
  });

  // ── Grace expiry ───────────────────────────────────────────────────────────

  it('grace expiry — delegates to examService.autoSubmitFromSnapshot', async () => {
    mockExamService.autoSubmitFromSnapshot.mockResolvedValue(undefined);
    await handler.handleExpiry({ type: 'grace', sessionId: 'sess-3' });
    expect(mockExamService.autoSubmitFromSnapshot).toHaveBeenCalledWith('sess-3');
  });
});
