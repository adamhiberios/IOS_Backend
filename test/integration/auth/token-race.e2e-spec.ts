import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { http } from '../helpers/http';
import { resetCounters } from '../helpers/fixtures';
import { MailSpy, useMailSpy } from '../helpers/mail-spy';

/**
 * Verify-email and reset-password both use the
 * "UPDATE ... WHERE used_at IS NULL" atomic pattern. This test fires two
 * concurrent verify requests with the same token and asserts that exactly
 * one wins.
 */
describe('[integration] auth/token-race', () => {
  let app: INestApplication;
  let ds: DataSource;
  const mail = MailSpy.get();

  beforeAll(async () => {
    app = await buildTestApp({ customize: useMailSpy });
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(ds);
    resetCounters();
    mail.clear();
  });

  it('two concurrent verify-email requests with the same token: exactly one succeeds, the other gets 400', async () => {
    await http(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'race@example.com',
        password: 'StrongP@ss1',
        firstName: 'Race',
        lastName: 'Cond',
      })
      .expect(201);

    const token = mail.extractToken('verify-email');
    expect(token).toBeTruthy();

    const [r1, r2] = await Promise.allSettled([
      http(app).post('/api/v1/auth/verify-email').send({ token }),
      http(app).post('/api/v1/auth/verify-email').send({ token }),
    ]);

    const statuses = [r1, r2].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 500,
    );

    const successes = statuses.filter((s) => s === 200).length;
    const failures = statuses.filter((s) => s === 400).length;
    expect(successes).toBe(1);
    expect(failures).toBe(1);

    const userRow = await ds.query<{ email_verified: boolean }[]>(
      `SELECT email_verified FROM users WHERE email = 'race@example.com'`,
    );
    expect(userRow[0].email_verified).toBe(true);

    const tokenRow = await ds.query<{ used_at: Date | null }[]>(
      `SELECT used_at FROM auth_tokens WHERE purpose = 'email_verification' ORDER BY id DESC LIMIT 1`,
    );
    expect(tokenRow[0].used_at).not.toBeNull();
  });
});
