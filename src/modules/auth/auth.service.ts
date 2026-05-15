import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import {
  User,
  AdminUser,
  RefreshToken,
  TokenOwnerType,
  AuthToken,
  AuthTokenPurpose,
} from '../../database/entities';
import { MailService } from '../mail/mail.service';
import { AccessTokenPayload, RefreshTokenPayload } from './types';
import { RegisterDto } from './dto/register.dto';
import { AuthUserResponseDto, LoginResponseDto } from './dto/responses';

const BCRYPT_PASSWORD_COST = 12;
const BCRYPT_TOKEN_COST = 10;
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_HOURS = 1;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;
  private readonly appBaseUrl: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AdminUser) private readonly admins: Repository<AdminUser>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(AuthToken)
    private readonly authTokens: Repository<AuthToken>,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {
    this.accessTtlSec = Number(this.config.get('JWT_ACCESS_TTL') ?? 900);
    this.refreshTtlSec = Number(this.config.get('JWT_REFRESH_TTL') ?? 604_800);
    this.appBaseUrl =
      this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:4000';
  }

  // ── Registration ─────────────────────────────────────────────────────────

  async register(
    dto: RegisterDto,
  ): Promise<{ userId: string; message: string }> {
    const normalisedEmail = dto.email.trim().toLowerCase();

    const existing = await this.users.findOne({
      where: { email: normalisedEmail },
      select: ['id'],
    });
    if (existing) {
      throw new ConflictException('Email is unavailable');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_PASSWORD_COST);

    const user = await this.users.save(
      this.users.create({
        email: normalisedEmail,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone ?? null,
        company: dto.company ?? null,
        occupation: dto.occupation ?? null,
        position: dto.position ?? null,
        country: dto.country ?? null,
        city: dto.city ?? null,
        street: dto.street ?? null,
        address: dto.address ?? null,
        postalCode: dto.postalCode ?? null,
        locale: dto.locale ?? 'en',
        emailVerified: false,
        active: true,
      }),
    );

    await this.dispatchVerificationEmail(user);

    return {
      userId: user.id,
      message:
        'Registration successful. Check your email to verify your account.',
    };
  }

  // ── Email verification ───────────────────────────────────────────────────

  async verifyEmail(plainToken: string): Promise<{ message: string }> {
    const userId = await this.consumeAuthToken(
      plainToken,
      AuthTokenPurpose.EMAIL_VERIFICATION,
    );

    await this.users.update(
      { id: userId },
      { emailVerified: true, emailVerifiedAt: new Date() },
    );

    return { message: 'Email verified. You can now log in.' };
  }

  // ── Login ────────────────────────────────────────────────────────────────

  async loginStudent(
    email: string,
    password: string,
  ): Promise<{ login: LoginResponseDto; refreshToken: string }> {
    const user = await this.users.findOne({
      where: { email: email.trim().toLowerCase() },
    });

    const genericError = new UnauthorizedException('Invalid credentials');

    if (!user || !user.active) {
      await bcrypt.compare(
        password,
        '$2b$12$dummyhashtoslowdownbruteforceattempts',
      );
      throw genericError;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw genericError;

    if (!user.emailVerified) {
      throw new UnauthorizedException('Email not verified. Check your inbox.');
    }

    return this.issueStudentSession(user);
  }

  async loginAdmin(
    email: string,
    password: string,
  ): Promise<{ login: LoginResponseDto; refreshToken: string }> {
    const admin = await this.admins.findOne({
      where: { email: email.trim().toLowerCase() },
    });
    const genericError = new UnauthorizedException('Invalid credentials');

    if (!admin || !admin.active) {
      await bcrypt.compare(
        password,
        '$2b$12$dummyhashtoslowdownbruteforceattempts',
      );
      throw genericError;
    }
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) throw genericError;

    return this.issueAdminSession(admin);
  }

  // ── Refresh rotation ─────────────────────────────────────────────────────

  async refresh(
    payload: RefreshTokenPayload,
    rawToken: string,
  ): Promise<{ login: LoginResponseDto; refreshToken: string }> {
    const stored = await this.refreshTokens.findOne({
      where: { id: payload.jti },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    if (stored.revokedAt) {
      this.logger.warn(
        `Refresh-token reuse detected for ${payload.type} id=${payload.sub}. Revoking all sessions.`,
      );
      await this.revokeAllRefreshTokens(payload.sub, payload.type);
      throw new UnauthorizedException(
        'Session invalidated. Please log in again.',
      );
    }

    const matchesHash = await bcrypt.compare(rawToken, stored.tokenHash);
    if (!matchesHash) {
      throw new UnauthorizedException('Refresh token invalid');
    }

    await this.refreshTokens.update(
      { id: stored.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    if (payload.type === 'admin') {
      const admin = await this.admins.findOne({ where: { id: payload.sub } });
      if (!admin || !admin.active) {
        throw new UnauthorizedException('Account is inactive');
      }
      return this.issueAdminSession(admin);
    }

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Account is inactive');
    }
    return this.issueStudentSession(user);
  }

  // ── Logout ───────────────────────────────────────────────────────────────

  async logout(payload: RefreshTokenPayload): Promise<{ message: string }> {
    await this.refreshTokens.update(
      { id: payload.jti, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { message: 'Logged out' };
  }

  // ── Forgot password ──────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.users.findOne({
      where: { email: email.trim().toLowerCase() },
    });

    if (user && user.active) {
      const { plainToken } = await this.issueAuthToken(
        user.id,
        AuthTokenPurpose.PASSWORD_RESET,
        PASSWORD_RESET_TTL_HOURS,
      );

      await this.mail.send(
        this.mail.buildPasswordResetEmail(
          user.email,
          user.fullName,
          plainToken,
          this.appBaseUrl,
        ),
      );
    }

    return {
      message:
        'If an account exists for that email, a reset link has been sent.',
    };
  }

  // ── Reset password ───────────────────────────────────────────────────────

  async resetPassword(
    plainToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const userId = await this.consumeAuthToken(
      plainToken,
      AuthTokenPurpose.PASSWORD_RESET,
    );

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_PASSWORD_COST);
    await this.users.update({ id: userId }, { passwordHash });

    await this.revokeAllRefreshTokens(userId, 'student');

    return { message: 'Password reset successful. Please log in.' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async issueStudentSession(user: User): Promise<{
    login: LoginResponseDto;
    refreshToken: string;
  }> {
    const accessToken = this.signAccess({
      sub: user.id,
      type: 'student',
      email: user.email,
      locale: user.locale,
    });

    const refresh = await this.issueRefreshToken(user.id, 'student');

    const userDto: AuthUserResponseDto = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      locale: user.locale,
      emailVerified: user.emailVerified,
      type: 'student',
      role: null,
    };

    return {
      login: { accessToken, expiresIn: this.accessTtlSec, user: userDto },
      refreshToken: refresh.plainToken,
    };
  }

  private async issueAdminSession(admin: AdminUser): Promise<{
    login: LoginResponseDto;
    refreshToken: string;
  }> {
    const accessToken = this.signAccess({
      sub: admin.id,
      type: 'admin',
      email: admin.email,
      locale: 'en',
      role: admin.role,
    });

    const refresh = await this.issueRefreshToken(admin.id, 'admin');

    const userDto: AuthUserResponseDto = {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      fullName: admin.fullName,
      locale: 'en',
      emailVerified: true,
      type: 'admin',
      role: admin.role,
    };

    return {
      login: { accessToken, expiresIn: this.accessTtlSec, user: userDto },
      refreshToken: refresh.plainToken,
    };
  }

  private signAccess(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: this.accessTtlSec,
    });
  }

  /**
   * Issues a refresh token.
   * Note: refresh_tokens has a SERIAL primary key, so `jti` is a number even
   * though `sub` (the user/admin UUID) is a string. This is deliberate —
   * refresh_tokens is an internal-only table.
   */
  private async issueRefreshToken(
    subjectId: string,
    type: 'student' | 'admin',
  ): Promise<{ plainToken: string }> {
    const expiresAt = new Date(Date.now() + this.refreshTtlSec * 1000);

    const inserted = await this.refreshTokens.save(
      this.refreshTokens.create({
        ownerType:
          type === 'admin' ? TokenOwnerType.ADMIN : TokenOwnerType.USER,
        userId: type === 'student' ? subjectId : null,
        adminId: type === 'admin' ? subjectId : null,
        tokenHash: 'pending',
        expiresAt,
        revokedAt: null,
      }),
    );

    const refreshPayload: RefreshTokenPayload = {
      sub: subjectId,
      type,
      jti: inserted.id,
    };
    const jwtToken = this.jwt.sign(refreshPayload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.refreshTtlSec,
    });

    const tokenHash = await bcrypt.hash(jwtToken, BCRYPT_TOKEN_COST);
    await this.refreshTokens.update({ id: inserted.id }, { tokenHash });

    return { plainToken: jwtToken };
  }

  private async revokeAllRefreshTokens(
    subjectId: string,
    type: 'student' | 'admin',
  ): Promise<void> {
    const where =
      type === 'admin'
        ? { adminId: subjectId, revokedAt: IsNull() }
        : { userId: subjectId, revokedAt: IsNull() };
    await this.refreshTokens.update(where, { revokedAt: new Date() });
  }

  private async issueAuthToken(
    userId: string,
    purpose: AuthTokenPurpose,
    ttlHours: number,
  ): Promise<{ plainToken: string; record: AuthToken }> {
    await this.authTokens.update(
      { userId, purpose, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(plainToken, BCRYPT_TOKEN_COST);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const record = await this.authTokens.save(
      this.authTokens.create({
        userId,
        purpose,
        tokenHash,
        expiresAt,
        usedAt: null,
      }),
    );

    return { plainToken, record };
  }

  /**
   * Validates a plain token against unused, non-expired auth_tokens of the
   * given purpose, marks the row used, returns the UUID userId.
   *
   * Because tokens are bcrypt-hashed (so we can't index-search by hash),
   * we narrow by purpose + used_at IS NULL, then bcrypt-compare candidates.
   */
  private async consumeAuthToken(
    plainToken: string,
    purpose: AuthTokenPurpose,
  ): Promise<string> {
    const candidates = await this.authTokens.find({
      where: { purpose, usedAt: IsNull() },
      order: { id: 'DESC' },
      take: 50,
    });

    for (const row of candidates) {
      if (row.expiresAt < new Date()) continue;
      const matches = await bcrypt.compare(plainToken, row.tokenHash);
      if (matches) {
        const updateResult = await this.authTokens.update(
          { id: row.id, usedAt: IsNull() },
          { usedAt: new Date() },
        );
        if (!updateResult.affected) {
          throw new BadRequestException('Token invalid or already used');
        }
        return row.userId;
      }
    }

    throw new BadRequestException('Token invalid or expired');
  }

  private async dispatchVerificationEmail(user: User): Promise<void> {
    const { plainToken } = await this.issueAuthToken(
      user.id,
      AuthTokenPurpose.EMAIL_VERIFICATION,
      EMAIL_VERIFICATION_TTL_HOURS,
    );
    await this.mail.send(
      this.mail.buildVerificationEmail(
        user.email,
        user.fullName,
        plainToken,
        this.appBaseUrl,
      ),
    );
  }

  // ── Public helper for other modules (Week 7) ─────────────────────────────

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_PASSWORD_COST);
  }
}
