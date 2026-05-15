import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Creates a Jest-mocked TypeORM Repository.
 * Every method returns a jest.fn() — set `.mockResolvedValue(...)` per test.
 */
export const createMockRepository = <T extends object = object>(): jest.Mocked<
  Repository<T>
> => {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    insert: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: {} as Repository<T>['manager'],
  } as unknown as jest.Mocked<Repository<T>>;
};

export const createMockJwtService = (): jest.Mocked<JwtService> => {
  return {
    sign: jest.fn().mockReturnValue('signed.jwt.token'),
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    verify: jest.fn(),
    verifyAsync: jest.fn(),
    decode: jest.fn(),
  } as unknown as jest.Mocked<JwtService>;
};

export const createMockConfigService = (
  overrides: Record<string, unknown> = {},
): jest.Mocked<ConfigService> => {
  const defaults: Record<string, unknown> = {
    JWT_SECRET: 'test-jwt-access-secret-min-32-chars-long',
    JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-min-32-chars-long',
    JWT_ACCESS_TTL: 900,
    JWT_REFRESH_TTL: 604_800,
    APP_BASE_URL: 'http://localhost:4000',
    NODE_ENV: 'test',
    SENDGRID_API_KEY: 'SG.mock',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => defaults[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in defaults)) throw new Error(`Missing config: ${key}`);
      return defaults[key];
    }),
  } as unknown as jest.Mocked<ConfigService>;
};
