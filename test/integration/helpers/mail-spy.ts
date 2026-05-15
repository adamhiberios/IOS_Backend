import type { TestingModuleBuilder } from '@nestjs/testing';
import {
  MailService,
  EmailParams,
} from '../../../src/modules/mail/mail.service';

/**
 * In-memory MailService replacement for integration tests.
 *
 * Stores every "sent" email so tests can extract verification tokens, reset
 * links, etc. without parsing logs or hitting SendGrid.
 *
 * A SINGLETON instance is shared across the suite; call `MailSpy.get().clear()`
 * in beforeEach to reset captured state between tests.
 */
export class MailSpy {
  private static _instance: MailSpy | null = null;

  static get(): MailSpy {
    if (!MailSpy._instance) MailSpy._instance = new MailSpy();
    return MailSpy._instance;
  }

  readonly sent: EmailParams[] = [];

  send(params: EmailParams): Promise<void> {
    this.sent.push(params);
    return Promise.resolve();
  }

  buildVerificationEmail(
    to: string,
    fullName: string,
    token: string,
    baseUrl: string,
  ): EmailParams {
    return {
      to,
      subject: 'Verify your IOS account',
      text: `Hi ${fullName}, verify: ${baseUrl}/verify-email?token=${token}`,
      html: `<a href="${baseUrl}/verify-email?token=${token}">Verify</a>`,
    };
  }

  buildPasswordResetEmail(
    to: string,
    fullName: string,
    token: string,
    baseUrl: string,
  ): EmailParams {
    return {
      to,
      subject: 'Reset your IOS password',
      text: `Hi ${fullName}, reset: ${baseUrl}/reset-password?token=${token}`,
      html: `<a href="${baseUrl}/reset-password?token=${token}">Reset</a>`,
    };
  }

  clear(): void {
    this.sent.length = 0;
  }

  /**
   * Pulls a `?token=<hex>` out of the text body of the most recent
   * verification or reset email. Returns null if not found.
   */
  extractToken(kind: 'verify-email' | 'reset-password'): string | null {
    const pattern =
      kind === 'verify-email'
        ? /\/verify-email\?token=([a-f0-9]+)/
        : /\/reset-password\?token=([a-f0-9]+)/;
    for (const email of [...this.sent].reverse()) {
      const m = pattern.exec(email.text);
      if (m) return m[1];
    }
    return null;
  }
}

/** Pass to buildTestApp to swap MailService out for MailSpy. */
export function useMailSpy(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder.overrideProvider(MailService).useValue(MailSpy.get());
}
