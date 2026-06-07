import { Test, TestingModule } from '@nestjs/testing';
import { TestSessionService, ExamSessionData } from './test-session.service';
import { RedisService } from '../redis/redis.service';
import {
  EXAM_SESSION_PREFIX,
  EXAM_GRACE_PREFIX,
  GRACE_WINDOW_SECONDS,
} from '../redis/redis.constants';

const mockRedis = {
  setJson: jest.fn(),
  setJsonKeepTtl: jest.fn(),
  getJson: jest.fn(),
  pttl: jest.fn(),
  del: jest.fn(),
};

const baseData: Omit<ExamSessionData, 'answers'> = {
  sessionId: 'sess-1',
  userId: 'user-1',
  examId: 'exam-1',
  certId: 'cert-1',
  startedAt: new Date().toISOString(),
};

describe('TestSessionService', () => {
  let service: TestSessionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestSessionService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    service = module.get(TestSessionService);
  });

  // ── start ─────────────────────────────────────────────────────────────────

  it('start — creates key with correct prefix, empty answers, and TTL', async () => {
    mockRedis.setJson.mockResolvedValue(undefined);
    await service.start(baseData, 3600);
    expect(mockRedis.setJson).toHaveBeenCalledWith(
      `${EXAM_SESSION_PREFIX}${baseData.sessionId}`,
      { ...baseData, answers: {} },
      3600,
    );
  });

  // ── autosave ──────────────────────────────────────────────────────────────

  it('autosave — merges answers and calls setJsonKeepTtl', async () => {
    mockRedis.getJson.mockResolvedValue({ ...baseData, answers: {} });
    mockRedis.setJsonKeepTtl.mockResolvedValue(true);
    const answers = { 'q-1': 'opt-a' };
    const result = await service.autosave(baseData.sessionId, answers);
    expect(result).toBe(true);
    expect(mockRedis.setJsonKeepTtl).toHaveBeenCalledWith(
      `${EXAM_SESSION_PREFIX}${baseData.sessionId}`,
      expect.objectContaining({ answers }),
    );
  });

  it('autosave — returns false when session is already expired (getJson returns null)', async () => {
    mockRedis.getJson.mockResolvedValue(null);
    const result = await service.autosave(baseData.sessionId, {});
    expect(result).toBe(false);
    expect(mockRedis.setJsonKeepTtl).not.toHaveBeenCalled();
  });

  // ── getSession ────────────────────────────────────────────────────────────

  it('getSession — returns data and pttlMs together', async () => {
    const sessionData: ExamSessionData = { ...baseData, answers: {} };
    mockRedis.getJson.mockResolvedValue(sessionData);
    mockRedis.pttl.mockResolvedValue(120_000);
    const { data, pttlMs } = await service.getSession(baseData.sessionId);
    expect(data).toEqual(sessionData);
    expect(pttlMs).toBe(120_000);
  });

  it('getSession — returns null data when key is absent', async () => {
    mockRedis.getJson.mockResolvedValue(null);
    mockRedis.pttl.mockResolvedValue(-2);
    const { data, pttlMs } = await service.getSession('missing');
    expect(data).toBeNull();
    expect(pttlMs).toBe(-2);
  });

  // ── deleteSession ─────────────────────────────────────────────────────────

  it('deleteSession — calls del with correct key', async () => {
    mockRedis.del.mockResolvedValue(1);
    await service.deleteSession(baseData.sessionId);
    expect(mockRedis.del).toHaveBeenCalledWith(
      `${EXAM_SESSION_PREFIX}${baseData.sessionId}`,
    );
  });

  // ── grace window ──────────────────────────────────────────────────────────

  it('startGrace — stores snapshot at grace prefix with correct TTL', async () => {
    mockRedis.setJson.mockResolvedValue(undefined);
    const answers = { 'q-1': 'opt-b' };
    await service.startGrace(baseData.sessionId, answers);
    expect(mockRedis.setJson).toHaveBeenCalledWith(
      `${EXAM_GRACE_PREFIX}${baseData.sessionId}`,
      { snapshot: answers },
      GRACE_WINDOW_SECONDS,
    );
  });

  it('consumeGrace — returns snapshot and deletes key', async () => {
    const answers = { 'q-2': 'opt-c' };
    mockRedis.getJson.mockResolvedValue({ snapshot: answers });
    mockRedis.del.mockResolvedValue(1);
    const result = await service.consumeGrace(baseData.sessionId);
    expect(result).toEqual(answers);
    expect(mockRedis.del).toHaveBeenCalledWith(
      `${EXAM_GRACE_PREFIX}${baseData.sessionId}`,
    );
  });

  it('consumeGrace — returns null when grace window has expired', async () => {
    mockRedis.getJson.mockResolvedValue(null);
    const result = await service.consumeGrace(baseData.sessionId);
    expect(result).toBeNull();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('hasGrace — returns true when pttl > 0', async () => {
    mockRedis.pttl.mockResolvedValue(60_000);
    expect(await service.hasGrace(baseData.sessionId)).toBe(true);
  });

  it('hasGrace — returns false when pttl <= 0', async () => {
    mockRedis.pttl.mockResolvedValue(-2);
    expect(await service.hasGrace(baseData.sessionId)).toBe(false);
  });
});
