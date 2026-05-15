import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { createMockConfigService } from '../../test-utils/mocks';

// Mock @sendgrid/mail so tests don't hit the network
jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn().mockResolvedValue([{ statusCode: 202 }]),
  },
}));

import sgMail from '@sendgrid/mail';

describe('MailService', () => {
  const baseUrl = 'http://localhost:4000';

  const build = async (
    env: string,
    apiKey = 'SG.mock',
  ): Promise<MailService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            NODE_ENV: env,
            SENDGRID_API_KEY: apiKey,
            APP_BASE_URL: baseUrl,
          }),
        },
      ],
    }).compile();
    return module.get<MailService>(MailService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── send() ────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('skips SendGrid in development', async () => {
      const mail = await build('development');
      await mail.send({
        to: 'a@example.com',
        subject: 'Test',
        text: 'body',
        html: '<p>body</p>',
      });
      expect(sgMail.send).not.toHaveBeenCalled();
    });

    it('skips SendGrid in test environment', async () => {
      const mail = await build('test');
      await mail.send({
        to: 'a@example.com',
        subject: 'Test',
        text: 'body',
        html: '<p>body</p>',
      });
      expect(sgMail.send).not.toHaveBeenCalled();
    });

    it('sends via SendGrid in production', async () => {
      const mail = await build('production', 'SG.real_key');
      await mail.send({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Plain text',
        html: '<p>HTML</p>',
      });
      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Hello',
          text: 'Plain text',
          html: '<p>HTML</p>',
        }),
      );
    });

    it('does not throw when SendGrid fails (mail must never break auth)', async () => {
      const mail = await build('production', 'SG.real_key');
      jest.spyOn(mail['logger'], 'error').mockImplementation(() => undefined);
      (sgMail.send as jest.Mock).mockRejectedValueOnce(
        new Error('SendGrid down'),
      );

      await expect(
        mail.send({ to: 'x@y.com', subject: 's', text: 't', html: 'h' }),
      ).resolves.toBeUndefined();
    });
  });

  // ── builders ──────────────────────────────────────────────────────────────

  describe('buildVerificationEmail', () => {
    it('embeds the token as a query parameter, not in the body text', async () => {
      const mail = await build('development');
      const params = mail.buildVerificationEmail(
        'user@example.com',
        'Jane Doe',
        'abc123token',
        baseUrl,
      );
      expect(params.to).toBe('user@example.com');
      expect(params.html).toContain(
        `${baseUrl}/verify-email?token=abc123token`,
      );
      expect(params.text).toContain(
        `${baseUrl}/verify-email?token=abc123token`,
      );
    });

    it('escapes HTML in the full name to prevent injection', async () => {
      const mail = await build('development');
      const params = mail.buildVerificationEmail(
        'user@example.com',
        '<script>alert(1)</script>',
        'tok',
        baseUrl,
      );
      expect(params.html).not.toContain('<script>');
      expect(params.html).toContain('&lt;script&gt;');
    });
  });

  describe('buildPasswordResetEmail', () => {
    it('builds a /reset-password link with the token', async () => {
      const mail = await build('development');
      const params = mail.buildPasswordResetEmail(
        'user@example.com',
        'Jane',
        'resettok',
        baseUrl,
      );
      expect(params.html).toContain(`${baseUrl}/reset-password?token=resettok`);
      expect(params.text).toContain('1 hour');
    });
  });
});
