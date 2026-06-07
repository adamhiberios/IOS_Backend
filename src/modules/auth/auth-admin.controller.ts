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
import { LoginDto } from './dto/auth.dtos';
import { LoginResponseDto, MessageResponseDto } from './dto/responses';
import { RefreshContext } from './strategies/jwt-refresh.strategy';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Same env-aware override pattern as AuthController — keep tests from tripping
// the 5/60s production limit when one suite logs many admins in (catalog,
// learning, etc. each do an admin login per test).
const AUTH_THROTTLE = {
  auth: {
    limit:
      process.env.NODE_ENV === 'test'
        ? Number(process.env.TEST_THROTTLE_AUTH_LIMIT ?? 100_000)
        : 5,
    ttl: 60_000,
  },
};

@ApiTags('auth-admin')
@Controller('auth/admin')
export class AuthAdminController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in as admin staff',
    description:
      'Admin accounts are created internally by super_admin — no public ' +
      'registration. JWT carries the admin role and is used by RolesGuard.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials or account inactive',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const { login, refreshToken } = await this.auth.loginAdmin(
      dto.email,
      dto.password,
    );
    this.setRefreshCookie(res, refreshToken);
    return login;
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate admin refresh token' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token invalid' })
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

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out an admin session' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async logout(
    @Req() req: Request & { user: RefreshContext },
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const result = await this.auth.logout(req.user.payload);
    this.clearRefreshCookie(res);
    return result;
  }

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
