import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import { renderTemplate, TemplateVars } from './template.renderer';

export interface EmailParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * MailService — abstracts the underlying email provider.
 *
 * In development & test: logs email payload (for verifying flows without real sends).
 * In staging & production: sends via SendGrid.
 *
 * Week 7 replaces this with the full NotificationModule (templates, queue, retries).
 * For Week 2 we only need transactional sends for verification and password reset.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly isProd: boolean;
  private readonly fromAddress: string;
  private readonly frontendBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const env = this.config.get<string>('NODE_ENV');
    this.isProd = env === 'production' || env === 'staging';
    // From-address comes from env so prod and dev can use distinct sender
    // identities on the same SendGrid account (e.g. noreply@ vs noreply-dev@).
    this.fromAddress = this.config.get<string>(
      'MAIL_FROM_ADDRESS',
      'no-reply@invalid.local',
    );

    // Frontend URL — what email links point at. When a real web frontend
    // ships, set FRONTEND_BASE_URL to it and recipients land on the frontend
    // page instead of the API's built-in /verify-email + /reset-password.
    this.frontendBaseUrl = (
      this.config.get<string>('FRONTEND_BASE_URL') ||
      this.config.getOrThrow<string>('APP_BASE_URL')
    ).replace(/\/+$/, '');

    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (this.isProd && apiKey && apiKey !== 'SG.mock') {
      sgMail.setApiKey(apiKey);
    }
  }

  async send(params: EmailParams): Promise<void> {
    if (!this.isProd) {
      this.logger.log(
        `[DEV MAIL] To: ${params.to} | Subject: ${params.subject}`,
      );
      // Print the body at log level (not debug) so links are visible in dev
      // without enabling verbose logging. Useful for local end-to-end testing.
      for (const line of params.text.split('\n')) {
        if (line.trim()) this.logger.log(`[DEV MAIL] ${line}`);
      }
      return;
    }

    try {
      await sgMail.send({
        to: params.to,
        from: this.fromAddress,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
    } catch (err) {
      this.logger.error(
        `SendGrid send failed for ${params.to}`,
        err instanceof Error ? err.stack : String(err),
      );
      // Do NOT rethrow — auth flow should not fail because email is slow/down.
      // The reset/verify token is in the DB. User can request another email.
    }
  }

  // ── Convenience builders ─────────────────────────────────────────────────
  // Each builder loads the matching template pair from ./templates and renders
  // the tokens. Adding a new email type is: drop two files in /templates and
  // add a builder method here.

  /** Build an EmailParams from a template name + token bag. */
  private fromTemplate(
    template: string,
    toEmail: string,
    subject: string,
    vars: TemplateVars,
  ): EmailParams {
    const { html, text } = renderTemplate(template, {
      toEmail,
      ...vars,
    });
    return { to: toEmail, subject, text, html };
  }

  /**
   * Build the verification email. `_appBaseUrl` is accepted for backward
   * compatibility with callers but ignored — the email URL always uses
   * FRONTEND_BASE_URL (or APP_BASE_URL fallback) read at construction time.
   */
  buildVerificationEmail(
    toEmail: string,
    fullName: string,
    token: string,
    _appBaseUrl?: string,
  ): EmailParams {
    const firstName = fullName.split(' ')[0] || fullName;
    return this.fromTemplate(
      'email-verification',
      toEmail,
      'Verify your Institute of Scrum account',
      {
        firstName,
        verificationUrl: `${this.frontendBaseUrl}/verify-email?token=${token}`,
        expiresInHours: 24,
      },
    );
  }

  buildPasswordResetEmail(
    toEmail: string,
    fullName: string,
    token: string,
    _appBaseUrl?: string,
  ): EmailParams {
    const firstName = fullName.split(' ')[0] || fullName;
    return this.fromTemplate(
      'password-reset',
      toEmail,
      'Reset your Institute of Scrum password',
      {
        firstName,
        resetUrl: `${this.frontendBaseUrl}/reset-password?token=${token}`,
        expiresInHours: 1,
        supportEmail: this.fromAddress,
      },
    );
  }
}
