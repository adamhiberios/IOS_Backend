import { Test, TestingModule } from '@nestjs/testing';
import { WsException } from '@nestjs/websockets';
import { ExamGateway } from './exam.gateway';
import { TestSessionService } from './test-session.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from '../redis/redis.constants';

const mockServer = {
  to: jest.fn().mockReturnThis(),
  emit: jest.fn(),
  adapter: jest.fn(),
  use: jest.fn(),
};

const mockTestSessionSvc = {
  getSession: jest.fn(),
};

const mockJwtService = {
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'JWT_SECRET') return 'secret';
    if (key === 'REDIS_URL') return 'redis://localhost:6379';
    return undefined;
  }),
};

const mockRedisClient = {};

describe('ExamGateway', () => {
  let gateway: ExamGateway;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamGateway,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TestSessionService, useValue: mockTestSessionSvc },
        { provide: REDIS_CLIENT, useValue: mockRedisClient },
      ],
    }).compile();
    gateway = module.get(ExamGateway);
    // Inject mock server directly (AfterInit is not called in unit tests).
    (gateway as any).server = mockServer;
  });

  // ── handleJoinSession ──────────────────────────────────────────────────────

  it('handleJoinSession — throws WsException when session does not belong to user', async () => {
    mockTestSessionSvc.getSession.mockResolvedValue({
      data: { sessionId: 'sess-1', userId: 'other-user' },
      pttlMs: 60_000,
    });
    const socket = { id: 's1', data: { userId: 'user-1' }, join: jest.fn() } as any;
    await expect(
      gateway.handleJoinSession(socket, { sessionId: 'sess-1' }),
    ).rejects.toThrow(WsException);
  });

  it('handleJoinSession — throws WsException when session not found', async () => {
    mockTestSessionSvc.getSession.mockResolvedValue({
      data: null,
      pttlMs: -2,
    });
    const socket = { id: 's1', data: { userId: 'user-1' }, join: jest.fn() } as any;
    await expect(
      gateway.handleJoinSession(socket, { sessionId: 'sess-1' }),
    ).rejects.toThrow(WsException);
  });

  it('handleJoinSession — joins room and returns remainingSeconds', async () => {
    mockTestSessionSvc.getSession.mockResolvedValue({
      data: { sessionId: 'sess-1', userId: 'user-1' },
      pttlMs: 120_000,
    });
    const socket = { id: 's1', data: { userId: 'user-1' }, join: jest.fn() } as any;

    // Clear timers to prevent setInterval from running in tests
    jest.useFakeTimers();
    const result = await gateway.handleJoinSession(socket, { sessionId: 'sess-1' });
    jest.useRealTimers();

    expect(result.joined).toBe(true);
    expect(result.remainingSeconds).toBe(120);
    expect(socket.join).toHaveBeenCalledWith('session:sess-1');
  });

  // ── emitSessionExpired ────────────────────────────────────────────────────

  it('emitSessionExpired — emits to correct room and clears timer', () => {
    jest.useFakeTimers();
    // Pre-plant a fake timer entry to verify clearTimer is called.
    (gateway as any).timers.set('sess-1', {
      intervalId: setInterval(() => {}, 100_000),
      warnedThresholds: new Set(),
    });

    mockServer.to.mockReturnValue(mockServer);
    gateway.emitSessionExpired('sess-1');

    expect(mockServer.to).toHaveBeenCalledWith('session:sess-1');
    expect(mockServer.emit).toHaveBeenCalledWith('session_expired', { sessionId: 'sess-1' });
    expect((gateway as any).timers.has('sess-1')).toBe(false);

    jest.useRealTimers();
  });
});
