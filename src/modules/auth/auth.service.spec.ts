import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import {
  User,
  AdminUser,
  AdminRole,
  RefreshToken,
  TokenOwnerType,
  AuthToken,
  AuthTokenPurpose,
} from '../../database/entities';
import {
  createMockRepository,
  createMockJwtService,
  createMockConfigService,
} from '../../test-utils/mocks';
import { RefreshTokenPayload } from './types';

// Deterministic UUIDs for assertions
const USER_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ADMIN_UUID = '66e8400e-e29b-41d4-a716-446655440001';

// ── Fixtures ────────────────────────────────────────────────────────────────

const buildUser = (overrides: Partial<User> = {}): User =>
  ({
    id: USER_UUID,
    email: 'student@example.com',
    passwordHash: '$2b$12$placeholder',
    firstName: 'Test',
    lastName: 'Student',
    get fullName() {
      return `${this.firstName} ${this.lastName}`.trim();
    },
    phone: null,
    company: null,
    occupation: null,
    position: null,
    avatarUrl: null,
    country: null,
    city: null,
    street: null,
    address: null,
    postalCode: null,
    locale: 'en',
    emailVerified: true,
    emailVerifiedAt: new Date(),
    active: true,
    ...overrides,
  }) as unknown as User;

const buildAdmin = (overrides: Partial<AdminUser> = {}): AdminUser =>
  ({
    id: ADMIN_UUID,
    email: 'admin@example.com',
    passwordHash: '$2b$12$placeholder',
    firstName: 'Test',
    lastName: 'Admin',
    get fullName() {
      return `${this.firstName} ${this.lastName}`.trim();
    },
    role: AdminRole.SUPER_ADMIN,
    active: true,
    createdById: null,
    ...overrides,
  }) as unknown as AdminUser;

const buildRefreshToken = (
  overrides: Partial<RefreshToken> = {},
): RefreshToken =>
  ({
    id: 100,
    userId: USER_UUID,
    adminId: null,
    ownerType: TokenOwnerType.USER,
    tokenHash: '$2b$10$placeholder',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  }) as RefreshToken;

const buildAuthToken = (overrides: Partial<AuthToken> = {}): AuthToken =>
  ({
    id: 50,
    userId: USER_UUID,
    purpose: AuthTokenPurpose.PASSWORD_RESET,
    tokenHash: '$2b$10$placeholder',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    ...overrides,
  }) as AuthToken;

// ── Test suite ──────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let users: ReturnType<typeof createMockRepository<User>>;
  let admins: ReturnType<typeof createMockRepository<AdminUser>>;
  let refreshTokens: ReturnType<typeof createMockRepository<RefreshToken>>;
  let authTokens: ReturnType<typeof createMockRepository<AuthToken>>;
  let jwt: ReturnType<typeof createMockJwtService>;
  let mail: jest.Mocked<MailService>;

  beforeEach(async () => {
    users = createMockRepository<User>();
    admins = createMockRepository<AdminUser>();
    refreshTokens = createMockRepository<RefreshToken>();
    authTokens = createMockRepository<AuthToken>();
    jwt = createMockJwtService();
    mail = {
      send: jest.fn().mockResolvedValue(undefined),
      buildVerificationEmail: jest.fn().mockReturnValue({
        to: 'x',
        subject: 'x',
        text: 'x',
        html: 'x',
      }),
      buildPasswordResetEmail: jest.fn().mockReturnValue({
        to: 'x',
        subject: 'x',
        text: 'x',
        html: 'x',
      }),
    } as unknown as jest.Mocked<MailService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(AdminUser), useValue: admins },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: getRepositoryToken(AuthToken), useValue: authTokens },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: mail },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── register ──────────────────────────────────────────────────────────────

  describe('register', () => {
    const dto = {
      email: 'New@Example.com',
      password: 'StrongP@ss1',
      firstName: 'New',
      lastName: 'User',
    };

    it('normalises email to lowercase before persisting', async () => {
      users.findOne.mockResolvedValue(null);
      users.create.mockImplementation((data: Partial<User>) => data as User);
      users.save.mockResolvedValue(buildUser({ id: USER_UUID }));
      authTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });
      authTokens.create.mockImplementation((data) => data as AuthToken);
      authTokens.save.mockResolvedValue({ id: 1 } as AuthToken);

      await service.register(dto);

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
    });

    it('throws ConflictException when email already exists', async () => {
      users.findOne.mockResolvedValue(buildUser());
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('hashes password with bcrypt cost 12 before storing', async () => {
      users.findOne.mockResolvedValue(null);
      let capturedHash = '';
      users.create.mockImplementation((data: Partial<User>) => {
        capturedHash = data.passwordHash ?? '';
        return data as User;
      });
      users.save.mockResolvedValue(buildUser({ id: USER_UUID }));
      authTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });
      authTokens.create.mockImplementation((data) => data as AuthToken);
      authTokens.save.mockResolvedValue({ id: 1 } as AuthToken);

      await service.register(dto);

      expect(capturedHash).toMatch(/^\$2[aby]\$12\$/);
      expect(capturedHash).not.toContain(dto.password);
    });

    it('sends a verification email after successful registration', async () => {
      users.findOne.mockResolvedValue(null);
      users.create.mockImplementation((data: Partial<User>) => data as User);
      users.save.mockResolvedValue(
        buildUser({ id: USER_UUID, email: 'new@example.com' }),
      );
      authTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });
      authTokens.create.mockImplementation((data) => data as AuthToken);
      authTokens.save.mockResolvedValue({ id: 1 } as AuthToken);

      await service.register(dto);

      expect(mail.buildVerificationEmail).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalled();
    });

    it('persists all optional profile fields when provided', async () => {
      const fullDto = {
        ...dto,
        phone: '+1 555 0100',
        country: 'Canada',
        city: 'Victoria',
        street: 'Blanshard',
        address: '1234 Blanshard St',
        postalCode: 'V8W 3J6',
        occupation: 'Graphic designer',
        position: 'Team lead',
        company: 'Acme',
        locale: 'fr',
      };
      users.findOne.mockResolvedValue(null);
      let captured: Partial<User> = {};
      users.create.mockImplementation((data: Partial<User>) => {
        captured = data;
        return data as User;
      });
      users.save.mockResolvedValue(buildUser({ id: USER_UUID }));
      authTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });
      authTokens.create.mockImplementation((data) => data as AuthToken);
      authTokens.save.mockResolvedValue({ id: 1 } as AuthToken);

      await service.register(fullDto);

      expect(captured.firstName).toBe('New');
      expect(captured.lastName).toBe('User');
      expect(captured.phone).toBe('+1 555 0100');
      expect(captured.country).toBe('Canada');
      expect(captured.city).toBe('Victoria');
      expect(captured.street).toBe('Blanshard');
      expect(captured.address).toBe('1234 Blanshard St');
      expect(captured.postalCode).toBe('V8W 3J6');
      expect(captured.occupation).toBe('Graphic designer');
      expect(captured.position).toBe('Team lead');
      expect(captured.company).toBe('Acme');
      expect(captured.locale).toBe('fr');
    });
  });

  // ── login (student) ───────────────────────────────────────────────────────

  describe('loginStudent', () => {
    const password = 'StrongP@ss1';
    let user: User;

    beforeEach(async () => {
      user = buildUser({ passwordHash: await bcrypt.hash(password, 4) });
    });

    it('issues access token + refresh token for valid credentials', async () => {
      users.findOne.mockResolvedValue(user);
      refreshTokens.create.mockImplementation((data) => data as RefreshToken);
      refreshTokens.save.mockResolvedValue({ id: 200 } as RefreshToken);
      refreshTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.loginStudent(
        'student@example.com',
        password,
      );

      expect(result.login.accessToken).toBeDefined();
      expect(result.login.user.type).toBe('student');
      expect(result.login.user.email).toBe(user.email);
      expect(result.login.user.id).toBe(USER_UUID);
      expect(result.login.user.firstName).toBe('Test');
      expect(result.login.user.lastName).toBe('Student');
      expect(result.login.user.fullName).toBe('Test Student');
      expect(result.refreshToken).toBeDefined();
      expect(jwt.sign).toHaveBeenCalled();
    });

    it('rejects nonexistent emails with generic Unauthorized', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(
        service.loginStudent('nope@example.com', password),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects wrong passwords with the SAME generic error (no enumeration)', async () => {
      users.findOne.mockResolvedValue(user);
      await expect(
        service.loginStudent('student@example.com', 'WrongPassword'),
      ).rejects.toMatchObject({
        message: 'Invalid credentials',
      });
    });

    it('rejects inactive accounts', async () => {
      users.findOne.mockResolvedValue(buildUser({ active: false }));
      await expect(
        service.loginStudent('student@example.com', password),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unverified accounts with a distinct message', async () => {
      const unverified = buildUser({
        emailVerified: false,
        passwordHash: await bcrypt.hash(password, 4),
      });
      users.findOne.mockResolvedValue(unverified);

      await expect(
        service.loginStudent('student@example.com', password),
      ).rejects.toMatchObject({
        message: 'Email not verified. Check your inbox.',
      });
    });

    it('normalises email to lowercase before lookup', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(
        service.loginStudent('UPPER@EXAMPLE.COM', password),
      ).rejects.toThrow();
      expect(users.findOne).toHaveBeenCalledWith({
        where: { email: 'upper@example.com' },
      });
    });
  });

  // ── login (admin) ─────────────────────────────────────────────────────────

  describe('loginAdmin', () => {
    const password = 'AdminP@ss1';
    let admin: AdminUser;

    beforeEach(async () => {
      admin = buildAdmin({ passwordHash: await bcrypt.hash(password, 4) });
    });

    it('issues admin session with role in the JWT payload', async () => {
      admins.findOne.mockResolvedValue(admin);
      refreshTokens.create.mockImplementation((data) => data as RefreshToken);
      refreshTokens.save.mockResolvedValue({ id: 300 } as RefreshToken);
      refreshTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.loginAdmin('admin@example.com', password);

      expect(result.login.user.type).toBe('admin');
      expect(result.login.user.role).toBe(AdminRole.SUPER_ADMIN);
      expect(result.login.user.id).toBe(ADMIN_UUID);
      const accessPayload = jwt.sign.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(accessPayload.role).toBe(AdminRole.SUPER_ADMIN);
      expect(accessPayload.type).toBe('admin');
      expect(accessPayload.sub).toBe(ADMIN_UUID);
    });

    it('rejects inactive admin accounts', async () => {
      admins.findOne.mockResolvedValue(buildAdmin({ active: false }));
      await expect(
        service.loginAdmin('admin@example.com', password),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── refresh rotation ──────────────────────────────────────────────────────

  describe('refresh', () => {
    const rawToken = 'raw.jwt.string';
    const payload: RefreshTokenPayload = {
      sub: USER_UUID,
      type: 'student',
      jti: 100,
    };
    let storedHash: string;

    beforeEach(async () => {
      storedHash = await bcrypt.hash(rawToken, 4);
    });

    it('rotates: marks old token revoked and issues a new one', async () => {
      refreshTokens.findOne.mockResolvedValue(
        buildRefreshToken({ tokenHash: storedHash }),
      );
      refreshTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      users.findOne.mockResolvedValue(buildUser());
      refreshTokens.create.mockImplementation((data) => data as RefreshToken);
      refreshTokens.save.mockResolvedValue({ id: 101 } as RefreshToken);

      const result = await service.refresh(payload, rawToken);

      const firstUpdateCall = refreshTokens.update.mock.calls[0];
      expect(firstUpdateCall[0]).toMatchObject({ id: 100 });
      expect(firstUpdateCall[1]).toMatchObject({ revokedAt: expect.any(Date) });
      expect(result.login.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('rejects refresh when the stored token is missing', async () => {
      refreshTokens.findOne.mockResolvedValue(null);
      await expect(service.refresh(payload, rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects expired refresh tokens', async () => {
      refreshTokens.findOne.mockResolvedValue(
        buildRefreshToken({
          tokenHash: storedHash,
          expiresAt: new Date(Date.now() - 1000),
        }),
      );
      await expect(service.refresh(payload, rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('triggers reuse detection when presented a revoked token', async () => {
      refreshTokens.findOne.mockResolvedValue(
        buildRefreshToken({ tokenHash: storedHash, revokedAt: new Date() }),
      );
      refreshTokens.update.mockResolvedValue({
        affected: 5,
        raw: [],
        generatedMaps: [],
      });

      await expect(service.refresh(payload, rawToken)).rejects.toThrow(
        /Session invalidated/,
      );

      const calls = refreshTokens.update.mock.calls;
      const revokeAllCall = calls.find(
        ([w]) => typeof w === 'object' && w !== null && 'userId' in w,
      );
      expect(revokeAllCall).toBeDefined();
      expect((revokeAllCall![0] as { userId: string }).userId).toBe(USER_UUID);
    });

    it('rejects refresh when bcrypt hash does not match', async () => {
      refreshTokens.findOne.mockResolvedValue(
        buildRefreshToken({ tokenHash: '$2b$04$different.hash.entirely' }),
      );
      await expect(service.refresh(payload, rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects refresh for an inactive user', async () => {
      refreshTokens.findOne.mockResolvedValue(
        buildRefreshToken({ tokenHash: storedHash }),
      );
      refreshTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      users.findOne.mockResolvedValue(buildUser({ active: false }));

      await expect(service.refresh(payload, rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('marks the presented refresh token revoked', async () => {
      refreshTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      const payload: RefreshTokenPayload = {
        sub: USER_UUID,
        type: 'student',
        jti: 42,
      };

      const result = await service.logout(payload);

      expect(result).toEqual({ message: 'Logged out' });
      expect(refreshTokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42 }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  // ── forgot password ──────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('always returns generic message even when email does not exist (anti-enumeration)', async () => {
      users.findOne.mockResolvedValue(null);
      const result = await service.forgotPassword('nope@example.com');
      expect(result.message).toMatch(/if an account exists/i);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('returns the same message and sends email when account exists', async () => {
      users.findOne.mockResolvedValue(buildUser());
      authTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });
      authTokens.create.mockImplementation((data) => data as AuthToken);
      authTokens.save.mockResolvedValue({ id: 1 } as AuthToken);

      const result = await service.forgotPassword('student@example.com');

      expect(result.message).toMatch(/if an account exists/i);
      expect(mail.send).toHaveBeenCalled();
    });

    it('does not throw for non-existent emails', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(
        service.forgotPassword('nope@example.com'),
      ).resolves.toBeDefined();
    });
  });

  // ── reset password ──────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('rejects expired or invalid tokens', async () => {
      authTokens.find.mockResolvedValue([]);
      await expect(
        service.resetPassword('badtoken', 'NewP@ss1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('hashes the new password with bcrypt cost 12', async () => {
      const plainToken = 'real-reset-token';
      const tokenHash = await bcrypt.hash(plainToken, 4);
      authTokens.find.mockResolvedValue([buildAuthToken({ tokenHash })]);
      authTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      refreshTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });
      let capturedHash = '';
      users.update.mockImplementation((_, partial) => {
        capturedHash = (partial as Partial<User>).passwordHash ?? '';
        return Promise.resolve({ affected: 1, raw: [], generatedMaps: [] });
      });

      await service.resetPassword(plainToken, 'NewStrongP@ss1');

      expect(capturedHash).toMatch(/^\$2[aby]\$12\$/);
    });

    it('revokes all refresh tokens on successful reset', async () => {
      const plainToken = 'real-reset-token';
      const tokenHash = await bcrypt.hash(plainToken, 4);
      authTokens.find.mockResolvedValue([buildAuthToken({ tokenHash })]);
      authTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      users.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      refreshTokens.update.mockResolvedValue({
        affected: 3,
        raw: [],
        generatedMaps: [],
      });

      await service.resetPassword(plainToken, 'NewStrongP@ss1');

      const refreshCalls = refreshTokens.update.mock.calls;
      const lastCall = refreshCalls[refreshCalls.length - 1];
      expect(lastCall[0]).toMatchObject({ userId: USER_UUID });
      expect(lastCall[1]).toMatchObject({ revokedAt: expect.any(Date) });
    });

    it('marks the consumed auth token used (atomically — no race)', async () => {
      const plainToken = 'real-reset-token';
      const tokenHash = await bcrypt.hash(plainToken, 4);
      authTokens.find.mockResolvedValue([buildAuthToken({ tokenHash })]);
      authTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      users.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      refreshTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      await service.resetPassword(plainToken, 'NewStrongP@ss1');

      const consumeCall = authTokens.update.mock.calls.find(
        ([where]) =>
          typeof where === 'object' && where !== null && 'id' in where,
      );
      expect(consumeCall).toBeDefined();
      expect(consumeCall![0]).toMatchObject({ id: 50 });
    });
  });

  // ── verify email ──────────────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('marks user verified and consumes the token', async () => {
      const plainToken = 'verify-token-plain';
      const tokenHash = await bcrypt.hash(plainToken, 4);
      authTokens.find.mockResolvedValue([
        buildAuthToken({
          id: 10,
          purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
          tokenHash,
        }),
      ]);
      authTokens.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      users.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.verifyEmail(plainToken);

      expect(result.message).toMatch(/verified/i);
      expect(users.update).toHaveBeenCalledWith(
        { id: USER_UUID },
        expect.objectContaining({
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
        }),
      );
    });

    it('rejects when no matching unused token exists', async () => {
      authTokens.find.mockResolvedValue([]);
      await expect(service.verifyEmail('nonsense')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired token even if hash matches', async () => {
      const plainToken = 'expired-token';
      const tokenHash = await bcrypt.hash(plainToken, 4);
      authTokens.find.mockResolvedValue([
        buildAuthToken({
          purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
          tokenHash,
          expiresAt: new Date(Date.now() - 1000),
        }),
      ]);
      await expect(service.verifyEmail(plainToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the token was already consumed by a parallel request', async () => {
      const plainToken = 'race-token';
      const tokenHash = await bcrypt.hash(plainToken, 4);
      authTokens.find.mockResolvedValue([
        buildAuthToken({
          purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
          tokenHash,
        }),
      ]);
      authTokens.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      await expect(service.verifyEmail(plainToken)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── hashPassword (exposed helper) ────────────────────────────────────────

  describe('hashPassword', () => {
    it('returns a bcrypt cost-12 hash that verifies against the original', async () => {
      const hash = await service.hashPassword('Sample123!');
      expect(hash).toMatch(/^\$2[aby]\$12\$/);
      expect(await bcrypt.compare('Sample123!', hash)).toBe(true);
      expect(await bcrypt.compare('Sample123_wrong', hash)).toBe(false);
    });
  });
});
