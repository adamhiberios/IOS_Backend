import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { createMockConfigService } from '../../../test-utils/mocks';
import { AccessTokenPayload } from '../types';
import { AdminRole } from '../../../database/entities';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    strategy = new JwtStrategy(createMockConfigService());
  });

  it('throws when JWT_SECRET is not configured', () => {
    expect(
      () => new JwtStrategy(createMockConfigService({ JWT_SECRET: undefined })),
    ).toThrow(/JWT_SECRET/);
  });

  it('maps student payload to AuthenticatedUser with id', () => {
    const payload: AccessTokenPayload = {
      sub: '550e8400-e29b-41d4-a716-446655440000',
      type: 'student',
      email: 'student@example.com',
      locale: 'en',
    };
    const user = strategy.validate(payload);
    expect(user).toEqual({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'student',
      email: 'student@example.com',
      locale: 'en',
    });
  });

  it('maps admin payload to AuthenticatedUser with adminId and role', () => {
    const payload: AccessTokenPayload = {
      sub: '66e8400e-e29b-41d4-a716-446655440001',
      type: 'admin',
      email: 'admin@example.com',
      locale: 'en',
      role: AdminRole.LEARNING_ADMIN,
    };
    const user = strategy.validate(payload);
    expect(user).toEqual({
      adminId: '66e8400e-e29b-41d4-a716-446655440001',
      type: 'admin',
      email: 'admin@example.com',
      locale: 'en',
      role: AdminRole.LEARNING_ADMIN,
    });
  });

  it('rejects payloads missing sub', () => {
    expect(() =>
      strategy.validate({
        type: 'student',
        email: 'x',
        locale: 'en',
      } as AccessTokenPayload),
    ).toThrow(UnauthorizedException);
  });

  it('rejects payloads missing type', () => {
    expect(() =>
      strategy.validate({
        sub: '66e8400e-e29b-41d4-a716-446655440001',
        email: 'x',
        locale: 'en',
      } as unknown as AccessTokenPayload),
    ).toThrow(UnauthorizedException);
  });
});
