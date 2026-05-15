import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { createMockConfigService } from '../../../test-utils/mocks';
import { RefreshTokenPayload } from '../types';

describe('JwtRefreshStrategy', () => {
  let strategy: JwtRefreshStrategy;

  beforeEach(() => {
    strategy = new JwtRefreshStrategy(createMockConfigService());
  });

  it('throws when JWT_REFRESH_SECRET is not configured', () => {
    expect(
      () =>
        new JwtRefreshStrategy(
          createMockConfigService({ JWT_REFRESH_SECRET: undefined }),
        ),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('returns { payload, rawToken } when both are present', () => {
    const payload: RefreshTokenPayload = {
      sub: '550e8400-e29b-41d4-a716-446655440000',
      type: 'student',
      jti: 42,
    };
    const req = {
      cookies: { refreshToken: 'raw.jwt.string' },
    } as unknown as Request;

    const result = strategy.validate(req, payload);

    expect(result.payload).toEqual(payload);
    expect(result.rawToken).toBe('raw.jwt.string');
  });

  it('rejects when payload is missing sub', () => {
    const req = { cookies: { refreshToken: 'raw' } } as unknown as Request;
    expect(() =>
      strategy.validate(req, {
        type: 'student',
        jti: 1,
      } as unknown as RefreshTokenPayload),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when payload jti is not a number', () => {
    const req = { cookies: { refreshToken: 'raw' } } as unknown as Request;
    expect(() =>
      strategy.validate(req, {
        sub: 1,
        type: 'student',
        jti: 'abc',
      } as unknown as RefreshTokenPayload),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when cookies are missing entirely', () => {
    const payload: RefreshTokenPayload = {
      sub: '550e8400-e29b-41d4-a716-446655440000',
      type: 'student',
      jti: 42,
    };
    const req = {} as Request;
    expect(() => strategy.validate(req, payload)).toThrow(
      UnauthorizedException,
    );
  });
});
