import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

const mockClient = {
  set: jest.fn(),
  get: jest.fn(),
  getdel: jest.fn(),
  del: jest.fn(),
  pttl: jest.fn(),
  ping: jest.fn(),
};

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: REDIS_CLIENT, useValue: mockClient },
      ],
    }).compile();
    service = module.get(RedisService);
  });

  // ── setJson ─────────────────────────────────────────────────────────────

  it('setJson — calls SET with EX and serialized JSON', async () => {
    mockClient.set.mockResolvedValue('OK');
    await service.setJson('mykey', { foo: 'bar' }, 60);
    expect(mockClient.set).toHaveBeenCalledWith(
      'mykey',
      JSON.stringify({ foo: 'bar' }),
      'EX',
      60,
    );
  });

  // ── setJsonKeepTtl ───────────────────────────────────────────────────────

  it('setJsonKeepTtl — single atomic SET with KEEPTTL + XX, returns true on OK', async () => {
    mockClient.set.mockResolvedValue('OK');
    const result = await service.setJsonKeepTtl('k', { a: 1 });
    expect(result).toBe(true);
    expect(mockClient.set).toHaveBeenCalledWith(
      'k',
      JSON.stringify({ a: 1 }),
      'KEEPTTL',
      'XX',
    );
    // H1: must NOT pre-check PTTL — the check-then-set race could recreate
    // an expired key without a TTL.
    expect(mockClient.pttl).not.toHaveBeenCalled();
  });

  it('setJsonKeepTtl — returns false when key no longer exists (XX → null)', async () => {
    mockClient.set.mockResolvedValue(null);
    const result = await service.setJsonKeepTtl('k', { a: 1 });
    expect(result).toBe(false);
  });

  // ── getDelJson ───────────────────────────────────────────────────────────

  it('getDelJson — atomically GETDELs and deserializes', async () => {
    mockClient.getdel.mockResolvedValue(JSON.stringify({ snapshot: { q: 'a' } }));
    const val = await service.getDelJson<{ snapshot: Record<string, string> }>('k');
    expect(val).toEqual({ snapshot: { q: 'a' } });
    expect(mockClient.getdel).toHaveBeenCalledWith('k');
    expect(mockClient.del).not.toHaveBeenCalled();
  });

  it('getDelJson — returns null when key is absent', async () => {
    mockClient.getdel.mockResolvedValue(null);
    expect(await service.getDelJson('k')).toBeNull();
  });

  it('getDelJson — returns null on malformed JSON', async () => {
    mockClient.getdel.mockResolvedValue('not-json{{{');
    expect(await service.getDelJson('k')).toBeNull();
  });

  // ── getJson ──────────────────────────────────────────────────────────────

  it('getJson — deserializes JSON correctly', async () => {
    mockClient.get.mockResolvedValue(JSON.stringify({ x: 42 }));
    const val = await service.getJson<{ x: number }>('k');
    expect(val).toEqual({ x: 42 });
  });

  it('getJson — returns null when key is absent', async () => {
    mockClient.get.mockResolvedValue(null);
    expect(await service.getJson('k')).toBeNull();
  });

  it('getJson — returns null and logs on malformed JSON', async () => {
    mockClient.get.mockResolvedValue('not-json{{{');
    expect(await service.getJson('k')).toBeNull();
  });

  // ── pttl ─────────────────────────────────────────────────────────────────

  it('pttl — delegates to ioredis and returns value', async () => {
    mockClient.pttl.mockResolvedValue(12345);
    expect(await service.pttl('k')).toBe(12345);
  });

  // ── del ──────────────────────────────────────────────────────────────────

  it('del — calls DEL on the client', async () => {
    mockClient.del.mockResolvedValue(1);
    await service.del('k');
    expect(mockClient.del).toHaveBeenCalledWith('k');
  });

  // ── ping ─────────────────────────────────────────────────────────────────

  it('ping — returns PONG', async () => {
    mockClient.ping.mockResolvedValue('PONG');
    expect(await service.ping()).toBe('PONG');
  });
});
