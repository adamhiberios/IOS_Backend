import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators';
import type { AuthenticatedUser } from '../../common/interceptors/rls.interceptor';
import { AuthService } from '../auth/auth.service';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { MessageResponseDto } from '../auth/dto/responses';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('profile')
@ApiBearerAuth()
@Controller('me')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly auth: AuthService,
  ) {}

  // ── GET /me ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Get the authenticated student profile',
    description:
      'Returns the full profile for the bearer-token user. Admins do not use ' +
      'this endpoint — admin profiles are managed via /admin/users in Week 7.',
  })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Caller is not a student' })
  async getMe(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProfileResponseDto> {
    this.requireStudent(user);
    return this.profile.getProfile(user.id!);
  }

  // ── PATCH /me ──────────────────────────────────────────────────────────

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update the authenticated student profile',
    description:
      'Partial update — only supplied fields are changed. Explicit `null` ' +
      'clears the field. `email`, `emailVerified`, `active`, and `password` ' +
      'are not editable here. Password has its own endpoint at `PATCH ' +
      '/me/password`. Email changes will land in Week 8 with a re-verify flow.',
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Caller is not a student' })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    this.requireStudent(user);
    return this.profile.updateProfile(user.id!, dto);
  }

  // ── PATCH /me/password ────────────────────────────────────────────────

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the authenticated student password',
    description:
      'Verifies `currentPassword` against the stored bcrypt hash, then hashes ' +
      'and stores `newPassword` (cost 12). Revokes ALL refresh tokens for ' +
      'this user — every active session, including this one, is signed out. ' +
      'Clears the refresh cookie on this response. The frontend should treat ' +
      'this as a successful logout and redirect to login.',
  })
  @ApiBody({ type: UpdatePasswordDto })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 400, description: 'New password matches current' })
  @ApiResponse({ status: 401, description: 'Current password incorrect' })
  @ApiResponse({ status: 403, description: 'Caller is not a student' })
  async updatePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    this.requireStudent(user);
    const result = await this.auth.changePassword(
      user.id!,
      dto.currentPassword,
      dto.newPassword,
    );
    // Clear the refresh cookie — all sessions including this one are revoked
    // server-side, but we should also wipe the client state so the next
    // /auth/refresh hits an empty cookie path quickly.
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private requireStudent(user: AuthenticatedUser): void {
    if (user?.type !== 'student' || !user?.id) {
      // Admin users have their own /admin/me endpoint (Week 7). Trying to use
      // /me as an admin returns 403 rather than 401 — they're authenticated,
      // just not authorized for this surface.
      throw new ForbiddenException(
        'This endpoint is for student accounts only',
      );
    }
  }
}
