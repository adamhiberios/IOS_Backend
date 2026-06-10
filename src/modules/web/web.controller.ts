import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { renderHtml } from '../mail/template.renderer';

/**
 * HTML pages served at the root path — reachable from email links.
 *
 * Routes:
 *   GET  /verify-email?token=...      → auto-verifies, renders result
 *   GET  /reset-password?token=...    → renders form
 *   POST /reset-password              → form-encoded body, processes reset
 *
 * No JSON, no /api/v1 prefix. These are excluded from the global API prefix
 * in main.ts. The controller is hidden from Swagger via @ApiExcludeController.
 */
@ApiExcludeController()
@Controller()
export class WebController {
  private readonly pagesDir = join(__dirname, 'pages');
  private readonly appBaseUrl: string;

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {
    this.appBaseUrl = this.config
      .getOrThrow<string>('APP_BASE_URL')
      .replace(/\/+$/, '');
  }

  // ── /verify-email ────────────────────────────────────────────────────────

  @Get('verify-email')
  async verifyEmail(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!token) {
      return this.sendHtml(
        res,
        400,
        'verify-error',
        {
          title: 'Missing token',
          message:
            'This verification link is incomplete. Use the link from the email exactly as it was sent.',
          loginUrl: `${this.appBaseUrl}/api/docs`,
        },
      );
    }

    try {
      await this.auth.verifyEmail(token);
      return this.sendHtml(res, 200, 'verify-success', {
        loginUrl: `${this.appBaseUrl}/api/docs`,
      });
    } catch {
      // Auth service throws on invalid/expired/already-used token. We don't
      // surface which specifically to avoid token-state enumeration.
      return this.sendHtml(res, 400, 'verify-error', {
        title: 'Link is no longer valid',
        message:
          'This verification link is invalid, expired, or has already been used. If your account is still unverified, request a new link.',
        loginUrl: `${this.appBaseUrl}/api/docs`,
      });
    }
  }

  // ── /reset-password ──────────────────────────────────────────────────────

  @Get('reset-password')
  resetPasswordForm(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): void {
    if (!token) {
      return this.sendHtml(res, 400, 'reset-error', {
        title: 'Missing token',
        message:
          'This reset link is incomplete. Use the link from the email exactly as it was sent.',
        loginUrl: `${this.appBaseUrl}/api/docs`,
      });
    }
    return this.sendHtml(res, 200, 'reset-form', { token });
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPasswordSubmit(
    @Body() body: { token?: string; newPassword?: string; confirmPassword?: string },
    @Res() res: Response,
  ): Promise<void> {
    const { token, newPassword, confirmPassword } = body;

    if (!token || !newPassword) {
      return this.sendHtml(res, 400, 'reset-error', {
        title: 'Missing fields',
        message: 'Both the token and a new password are required.',
        loginUrl: `${this.appBaseUrl}/api/docs`,
      });
    }

    if (confirmPassword !== undefined && confirmPassword !== newPassword) {
      return this.sendHtml(res, 400, 'reset-form', {
        token,
        error: 'Passwords do not match.',
      });
    }

    try {
      await this.auth.resetPassword(token, newPassword);
      return this.sendHtml(res, 200, 'reset-success', {
        loginUrl: `${this.appBaseUrl}/api/docs`,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'This reset link is invalid or expired.';
      return this.sendHtml(res, 400, 'reset-form', {
        token,
        error: message,
      });
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private sendHtml(
    res: Response,
    status: number,
    template: string,
    vars: Record<string, string | number | boolean | undefined>,
  ): void {
    const html = renderHtml(this.pagesDir, template, vars);
    res.status(status).type('text/html; charset=utf-8').send(html);
  }
}
