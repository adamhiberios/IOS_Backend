import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { DataSource } from 'typeorm';
import { RlsInterceptor, RlsRequest } from './rls.interceptor';

const USER_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ADMIN_UUID = '66e8400e-e29b-41d4-a716-446655440001';

const buildContext = (req: Partial<RlsRequest>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

const buildHandler = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

const buildFailingHandler = (err: Error): CallHandler => ({
  handle: () => throwError(() => err),
});

describe('RlsInterceptor', () => {
  let dataSource: jest.Mocked<DataSource>;
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    query: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    isTransactionActive: boolean;
    isReleased: boolean;
  };
  let interceptor: RlsInterceptor;

  beforeEach(() => {
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
      isReleased: false,
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as jest.Mocked<DataSource>;
    interceptor = new RlsInterceptor(dataSource);
  });

  it('bypasses unauthenticated requests entirely (no transaction)', async () => {
    const req: Partial<RlsRequest> = { headers: {} };
    const result = await lastValueFrom(
      interceptor.intercept(buildContext(req), buildHandler('result')),
    );
    expect(result).toBe('result');
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('sets app.current_user_id for student requests', async () => {
    const req: Partial<RlsRequest> = {
      headers: {},
      user: { id: USER_UUID, type: 'student' },
      socket: { remoteAddress: '10.0.0.1' } as RlsRequest['socket'],
    };

    await lastValueFrom(
      interceptor.intercept(buildContext(req), buildHandler('ok')),
    );

    const calls = queryRunner.query.mock.calls;
    const userIdCall = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('current_user_id'),
    );
    expect(userIdCall).toBeDefined();
    expect(userIdCall![1]).toEqual([USER_UUID]);
  });

  it('sets app.current_admin_id for admin requests', async () => {
    const req: Partial<RlsRequest> = {
      headers: {},
      user: { adminId: ADMIN_UUID, type: 'admin' },
      socket: { remoteAddress: '127.0.0.1' } as RlsRequest['socket'],
    };

    await lastValueFrom(
      interceptor.intercept(buildContext(req), buildHandler('ok')),
    );

    const calls = queryRunner.query.mock.calls;
    const adminCall = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('current_admin_id'),
    );
    expect(adminCall).toBeDefined();
    expect(adminCall![1]).toEqual([ADMIN_UUID]);
  });

  it('uses req.ip (trust-proxy validated) and ignores the raw x-forwarded-for header', async () => {
    // Since the trust-proxy fix, the interceptor reads Express's `req.ip`
    // (hop-count validated) — never the spoofable raw header. The header here
    // is a decoy: it must NOT win over req.ip.
    const req: Partial<RlsRequest> = {
      ip: '203.0.113.5',
      headers: { 'x-forwarded-for': '198.51.100.99' },
      user: { id: USER_UUID, type: 'student' },
      socket: { remoteAddress: '127.0.0.1' } as RlsRequest['socket'],
    };

    await lastValueFrom(
      interceptor.intercept(buildContext(req), buildHandler('ok')),
    );

    const calls = queryRunner.query.mock.calls;
    const ipCall = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('current_ip'),
    );
    expect(ipCall![1]).toEqual(['203.0.113.5']);
  });

  it('falls back to socket.remoteAddress when req.ip is unset', async () => {
    const req: Partial<RlsRequest> = {
      headers: {},
      user: { id: USER_UUID, type: 'student' },
      socket: { remoteAddress: '10.0.0.7' } as RlsRequest['socket'],
    };

    await lastValueFrom(
      interceptor.intercept(buildContext(req), buildHandler('ok')),
    );

    const ipCall = queryRunner.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('current_ip'),
    );
    expect(ipCall![1]).toEqual(['10.0.0.7']);
  });

  it('commits the transaction on successful handler', async () => {
    const req: Partial<RlsRequest> = {
      headers: {},
      user: { id: USER_UUID, type: 'student' },
      socket: { remoteAddress: '127.0.0.1' } as RlsRequest['socket'],
    };

    await lastValueFrom(
      interceptor.intercept(buildContext(req), buildHandler('ok')),
    );

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('rolls back the transaction when handler throws', async () => {
    const req: Partial<RlsRequest> = {
      headers: {},
      user: { id: USER_UUID, type: 'student' },
      socket: { remoteAddress: '127.0.0.1' } as RlsRequest['socket'],
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(
          buildContext(req),
          buildFailingHandler(new Error('boom')),
        ),
      ),
    ).rejects.toThrow('boom');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('attaches queryRunner to request for service consumption', async () => {
    const req: Partial<RlsRequest> = {
      headers: {},
      user: { id: USER_UUID, type: 'student' },
      socket: { remoteAddress: '127.0.0.1' } as RlsRequest['socket'],
    };

    await lastValueFrom(
      interceptor.intercept(buildContext(req), buildHandler('ok')),
    );

    expect(req.rlsRunner).toBe(queryRunner);
  });
});
