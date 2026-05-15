import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, InsertResult } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { AdminUser, AdminRole } from '../../database/entities';
import { SeederService } from './seeder.service';

/**
 * Pure unit tests — repository and ConfigService are mocked. The integration
 * test in test/integration/seeder/ exercises this against real Postgres.
 */
describe('SeederService', () => {
  let service: SeederService;
  let admins: jest.Mocked<Repository<AdminUser>>;
  let config: jest.Mocked<ConfigService>;
  let insertResult: InsertResult;

  // Helper to build a service with a specific env configuration
  const buildService = async (
    envOverrides: Record<string, string | undefined>,
  ) => {
    const get = jest.fn((key: string, defaultValue?: string) => {
      const v = envOverrides[key];
      return v !== undefined ? v : defaultValue;
    });

    const queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(insertResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeederService,
        {
          provide: getRepositoryToken(AdminUser),
          useValue: {
            count: jest.fn().mockResolvedValue(0),
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
          },
        },
        {
          provide: ConfigService,
          useValue: { get },
        },
      ],
    }).compile();

    service = module.get(SeederService);
    admins = module.get(getRepositoryToken(AdminUser));
    config = module.get(ConfigService);
    return { service, admins, config, queryBuilder };
  };

  beforeEach(() => {
    insertResult = {
      identifiers: [{ id: 'new-uuid-1' }],
      generatedMaps: [],
      raw: [],
    };
  });

  describe('idempotency', () => {
    it('skips bootstrap when a super_admin already exists', async () => {
      const { service, admins } = await buildService({
        NODE_ENV: 'development',
      });
      admins.count.mockResolvedValueOnce(1);

      await service.onApplicationBootstrap();

      expect(admins.count).toHaveBeenCalledWith({
        where: { role: AdminRole.SUPER_ADMIN },
      });
      expect(admins.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('still skips when multiple super_admins somehow exist', async () => {
      const { service, admins } = await buildService({
        NODE_ENV: 'development',
      });
      admins.count.mockResolvedValueOnce(2);

      await service.onApplicationBootstrap();

      expect(admins.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('development env', () => {
    it('creates super_admin with dev defaults when env vars are absent', async () => {
      const { service, queryBuilder } = await buildService({
        NODE_ENV: 'development',
      });

      await service.onApplicationBootstrap();

      expect(queryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@ios.local',
          firstName: 'IOS',
          lastName: 'Admin',
          role: AdminRole.SUPER_ADMIN,
          active: true,
        }),
      );

      // Password hash present and is a valid bcrypt hash of the dev default
      const calledWith = queryBuilder.values.mock.calls[0][0] as {
        passwordHash: string;
      };
      expect(calledWith.passwordHash).toMatch(/^\$2[aby]\$/);
      const matches = await bcrypt.compare(
        'DevAdmin@123!',
        calledWith.passwordHash,
      );
      expect(matches).toBe(true);
    });

    it('uses env-provided credentials when set in dev', async () => {
      const { service, queryBuilder } = await buildService({
        NODE_ENV: 'development',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'custom@example.com',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'CustomDev@Password1',
        BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: 'Custom',
        BOOTSTRAP_SUPER_ADMIN_LAST_NAME: 'Owner',
      });

      await service.onApplicationBootstrap();

      const inserted = queryBuilder.values.mock.calls[0][0] as {
        email: string;
        firstName: string;
        lastName: string;
        passwordHash: string;
      };
      expect(inserted.email).toBe('custom@example.com');
      expect(inserted.firstName).toBe('Custom');
      expect(inserted.lastName).toBe('Owner');
      const matches = await bcrypt.compare(
        'CustomDev@Password1',
        inserted.passwordHash,
      );
      expect(matches).toBe(true);
    });
  });

  describe('test env', () => {
    it('behaves like development (falls back to defaults)', async () => {
      const { service, queryBuilder } = await buildService({
        NODE_ENV: 'test',
      });

      await service.onApplicationBootstrap();

      const inserted = queryBuilder.values.mock.calls[0][0] as {
        email: string;
      };
      expect(inserted.email).toBe('admin@ios.local');
    });
  });

  describe('staging env', () => {
    it('refuses to start without BOOTSTRAP_SUPER_ADMIN_EMAIL', async () => {
      const { service } = await buildService({
        NODE_ENV: 'staging',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'StagingP@ssword12!',
        BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: 'Staging',
        BOOTSTRAP_SUPER_ADMIN_LAST_NAME: 'Admin',
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /staging.*EMAIL.*PASSWORD/i,
      );
    });

    it('refuses to start without BOOTSTRAP_SUPER_ADMIN_PASSWORD', async () => {
      const { service } = await buildService({
        NODE_ENV: 'staging',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'ops@example.com',
        BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: 'Staging',
        BOOTSTRAP_SUPER_ADMIN_LAST_NAME: 'Admin',
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /staging.*EMAIL.*PASSWORD/i,
      );
    });

    it('refuses to start without name env vars', async () => {
      const { service } = await buildService({
        NODE_ENV: 'staging',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'ops@example.com',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'StagingP@ssword12!',
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /staging.*FIRST_NAME.*LAST_NAME/i,
      );
    });

    it('creates super_admin when all env vars are present', async () => {
      const { service, queryBuilder } = await buildService({
        NODE_ENV: 'staging',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'ops@example.com',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'StagingP@ssword12!',
        BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: 'Staging',
        BOOTSTRAP_SUPER_ADMIN_LAST_NAME: 'Ops',
      });

      await service.onApplicationBootstrap();

      const inserted = queryBuilder.values.mock.calls[0][0] as {
        email: string;
      };
      expect(inserted.email).toBe('ops@example.com');
    });
  });

  describe('production env', () => {
    it('skips bootstrap entirely when BOOTSTRAP_SUPER_ADMIN is not set', async () => {
      const { service, admins } = await buildService({
        NODE_ENV: 'production',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'ops@example.com',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'ProdP@ssword12345!',
      });

      await service.onApplicationBootstrap();

      // Should not even check the DB if opt-in flag is missing
      expect(admins.count).not.toHaveBeenCalled();
      expect(admins.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('skips bootstrap when BOOTSTRAP_SUPER_ADMIN=false', async () => {
      const { service, admins } = await buildService({
        NODE_ENV: 'production',
        BOOTSTRAP_SUPER_ADMIN: 'false',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'ops@example.com',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'ProdP@ssword12345!',
      });

      await service.onApplicationBootstrap();

      expect(admins.count).not.toHaveBeenCalled();
    });

    it('refuses to start with opt-in but missing email/password', async () => {
      const { service } = await buildService({
        NODE_ENV: 'production',
        BOOTSTRAP_SUPER_ADMIN: 'true',
        BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: 'Prod',
        BOOTSTRAP_SUPER_ADMIN_LAST_NAME: 'Admin',
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /production.*EMAIL.*PASSWORD/i,
      );
    });

    it('creates super_admin when opt-in + all env vars set', async () => {
      const { service, queryBuilder } = await buildService({
        NODE_ENV: 'production',
        BOOTSTRAP_SUPER_ADMIN: 'true',
        BOOTSTRAP_SUPER_ADMIN_EMAIL: 'ops@institute-of-scrum.com',
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'RealStrongProdPass1!',
        BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: 'IOS',
        BOOTSTRAP_SUPER_ADMIN_LAST_NAME: 'Ops',
      });

      await service.onApplicationBootstrap();

      const inserted = queryBuilder.values.mock.calls[0][0] as {
        email: string;
        role: AdminRole;
      };
      expect(inserted.email).toBe('ops@institute-of-scrum.com');
      expect(inserted.role).toBe(AdminRole.SUPER_ADMIN);
    });
  });

  describe('race safety', () => {
    it('handles the case where sibling worker won the race (zero identifiers)', async () => {
      insertResult = {
        identifiers: [],
        generatedMaps: [],
        raw: [],
      };

      const { service } = await buildService({
        NODE_ENV: 'development',
      });

      // Should not throw — just logs and exits
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('uses ON CONFLICT DO NOTHING via orIgnore', async () => {
      const { service, queryBuilder } = await buildService({
        NODE_ENV: 'development',
      });

      await service.onApplicationBootstrap();

      expect(queryBuilder.orIgnore).toHaveBeenCalled();
    });
  });

  describe('password hashing', () => {
    it('hashes with bcrypt cost 12 (production strength)', async () => {
      const { service, queryBuilder } = await buildService({
        NODE_ENV: 'development',
      });

      await service.onApplicationBootstrap();

      const inserted = queryBuilder.values.mock.calls[0][0] as {
        passwordHash: string;
      };
      // bcrypt cost is encoded in the second segment of the hash: $2b$<cost>$...
      const costMatch = /^\$2[aby]\$(\d{2})\$/.exec(inserted.passwordHash);
      expect(costMatch).not.toBeNull();
      expect(Number(costMatch![1])).toBe(12);
    });
  });
});
