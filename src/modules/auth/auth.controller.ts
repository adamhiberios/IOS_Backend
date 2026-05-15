import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { Public } from './decorators';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

import { RegisterDto } from './dto/register.dto';
import {
  LoginDto,
  VerifyEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dtos';
import {
  LoginResponseDto,
  RegisterResponseDto,
  MessageResponseDto,
} from './dto/responses';
import { RefreshContext } from './strategies/jwt-refresh.strategy';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// In production the auth-routes-limit is 5 req/60s. In tests we set this
// very high so unrelated test runs don't trip the limiter as a side effect.
// The throttler-specific integration test mounts its own AppModule with the
// real 5/60s limit to verify production behaviour.
const AUTH_THROTTLE = {
  auth: {
    limit:
      process.env.NODE_ENV === 'test'
        ? Number(process.env.TEST_THROTTLE_AUTH_LIMIT ?? 100_000)
        : 5,
    ttl: 60_000,
  },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── Register ─────────────────────────────────────────────────────────────

  @Public()
  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new student account',
    description:
      'Creates a new student account and sends a verification email. ' +
      'The account is created in `email_verified=false` state. The user must ' +
      'click the verification link before they can log in.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'Email is unavailable' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.auth.register(dto);
  }

  // ── Verify email ─────────────────────────────────────────────────────────

  @Public()
  @Post('verify-email')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a registered email address',
    description:
      'Consumes the verification token sent in the registration email. ' +
      'The token is single-use and expires 24 hours after registration.',
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'Token invalid or expired' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    return this.auth.verifyEmail(dto.token);
  }

  // ── Login ────────────────────────────────────────────────────────────────

  @Public()
  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in as a student',
    description:
      'Returns the access token in the response body and the refresh token ' +
      'in an HttpOnly + Secure cookie scoped to `/api/v1/auth`. The access ' +
      'token expires in 15 minutes; the refresh token in 7 days.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials, account inactive, or email not verified',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { login, refreshToken } = await this.auth.loginStudent(
      dto.email,
      dto.password,
    );
    this.setRefreshCookie(res, refreshToken);
    return login;
  }

  // ── Refresh ──────────────────────────────────────────────────────────────

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and obtain a new access token',
    description:
      'Reads the refresh token from the HttpOnly cookie, validates it, ' +
      'revokes the old token, and issues a new access token + a new refresh ' +
      'token. Token reuse (presenting a revoked token) triggers full session ' +
      'invalidation for the account.',
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalid, expired, or revoked',
  })
  async refresh(
    @Req() req: Request & { user: RefreshContext },
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { login, refreshToken } = await this.auth.refresh(
      req.user.payload,
      req.user.rawToken,
    );
    this.setRefreshCookie(res, refreshToken);
    return login;
  }

  // ── Logout ───────────────────────────────────────────────────────────────

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log out — revoke the current refresh token',
    description:
      'Revokes the presented refresh token and clears the cookie. The ' +
      'access token remains valid until expiry (≤15 min).',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async logout(
    @Req() req: Request & { user: RefreshContext },
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const result = await this.auth.logout(req.user.payload);
    this.clearRefreshCookie(res);
    return result;
  }

  // ── Forgot password ──────────────────────────────────────────────────────

  @Public()
  @Post('forgot-password')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always returns success regardless of whether the email is registered, ' +
      'to prevent account enumeration. If the email is valid, a reset link ' +
      'with a 1-hour TTL is sent.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.auth.forgotPassword(dto.email);
  }

  // ── Reset password ───────────────────────────────────────────────────────

  @Public()
  @Post('reset-password')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a new password using a reset token',
    description:
      'Validates the reset token, updates the password, and revokes all ' +
      'existing refresh tokens for the account (forces re-login everywhere).',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'Token invalid or expired' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  // ── Cookie helpers ───────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === 'production' ||
        process.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }
}
