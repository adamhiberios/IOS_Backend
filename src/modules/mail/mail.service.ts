import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';

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

  constructor(private readonly config: ConfigService) {
    const env = this.config.get<string>('NODE_ENV');
    this.isProd = env === 'production' || env === 'staging';
    this.fromAddress = 'no-reply@ios-lms.com';

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

  buildVerificationEmail(
    toEmail: string,
    fullName: string,
    token: string,
    appBaseUrl: string,
  ): EmailParams {
    const link = `${appBaseUrl}/verify-email?token=${token}`;
    return {
      to: toEmail,
      subject: 'Verify your IOS account',
      text: `Hi ${fullName},\n\nClick the link below to verify your email:\n${link}\n\nThis link expires in 24 hours.\n\n— IOS Team`,
      html: `<p>Hi ${escapeHtml(fullName)},</p>
<p>Click the link below to verify your email:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours.</p>
<p>— IOS Team</p>`,
    };
  }

  buildPasswordResetEmail(
    toEmail: string,
    fullName: string,
    token: string,
    appBaseUrl: string,
  ): EmailParams {
    const link = `${appBaseUrl}/reset-password?token=${token}`;
    return {
      to: toEmail,
      subject: 'Reset your IOS password',
      text: `Hi ${fullName},\n\nClick the link below to reset your password:\n${link}\n\nThis link expires in 1 hour. If you did not request a reset, ignore this email.\n\n— IOS Team`,
      html: `<p>Hi ${escapeHtml(fullName)},</p>
<p>Click the link below to reset your password:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
<p>— IOS Team</p>`,
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
