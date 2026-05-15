import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { http, loginAsStudent } from '../helpers/http';
import { createUser, resetCounters } from '../helpers/fixtures';
import { MailSpy, useMailSpy } from '../helpers/mail-spy';

describe('[integration] auth/password-reset', () => {
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

  it('forgot-password returns identical generic response for existing and non-existent emails', async () => {
    await createUser(app, { email: 'exists@example.com' });

    const realRes = await http(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'exists@example.com' })
      .expect(200);

    const fakeRes = await http(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nope@example.com' })
      .expect(200);

    expect((realRes.body as { message: string }).message).toBe(
      (fakeRes.body as { message: string }).message,
    );
    expect((realRes.body as { message: string }).message).toMatch(
      /if an account exists/i,
    );
  });

  it('reset-password revokes ALL existing refresh tokens for the user', async () => {
    const user = await createUser(app, { email: 'reset@example.com' });

    // Three concurrent sessions
    await loginAsStudent(app, user.email, user.password);
    await loginAsStudent(app, user.email, user.password);
    await loginAsStudent(app, user.email, user.password);

    const beforeReset = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    expect(Number(beforeReset[0].count)).toBe(3);

    // Trigger reset email
    await http(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    const token = mail.extractToken('reset-password');
    expect(token).toBeTruthy();

    await http(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'NewStrongP@ss2' })
      .expect(200);

    const afterReset = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    expect(Number(afterReset[0].count)).toBe(0);

    // Old password rejected, new password works
    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(401);

    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'NewStrongP@ss2' })
      .expect(200);
  });

  it('reset-password rejects an invalid token', async () => {
    await http(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(64), newPassword: 'NewStrongP@ss2' })
      .expect(400);
  });

  it('reset-password rejects an expired token', async () => {
    const user = await createUser(app, { email: 'expired@example.com' });

    await http(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);
    const token = mail.extractToken('reset-password');
    expect(token).toBeTruthy();

    // Age the token
    await ds.query(
      `UPDATE auth_tokens
       SET expires_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1 AND purpose = 'password_reset'`,
      [user.id],
    );

    await http(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'NewStrongP@ss2' })
      .expect(400);
  });
});
