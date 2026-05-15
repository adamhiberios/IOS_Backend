import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll, findOne } from '../helpers/db';
import { http, extractCookie } from '../helpers/http';
import { resetCounters } from '../helpers/fixtures';
import { MailSpy, useMailSpy } from '../helpers/mail-spy';

describe('[integration] auth/register-verify-login', () => {
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

  it('rejects login for an unverified account', async () => {
    await http(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'unverified@example.com',
        password: 'StrongP@ss1',
        firstName: 'Un',
        lastName: 'Verified',
      })
      .expect(201);

    const userRow = await findOne<{ id: string; email_verified: boolean }>(
      ds,
      'users',
      { email: 'unverified@example.com' },
    );
    expect(userRow).not.toBeNull();
    expect(userRow!.email_verified).toBe(false);

    const loginRes = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: 'unverified@example.com', password: 'StrongP@ss1' })
      .expect(401);

    expect((loginRes.body as { detail: string }).detail).toMatch(
      /email not verified/i,
    );
  });

  it('completes the full register → verify → login flow end-to-end', async () => {
    // 1. Register
    const regRes = await http(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'jane@example.com',
        password: 'StrongP@ss1',
        firstName: 'Jane',
        lastName: 'Doe',
        country: 'Canada',
        city: 'Victoria',
      })
      .expect(201);

    const { userId } = regRes.body as { userId: string; message: string };
    expect(userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // 2. Verification email was sent
    const verifyEmail = mail.sent.find((e) => /verify/i.test(e.subject));
    expect(verifyEmail).toBeDefined();
    expect(verifyEmail!.to).toBe('jane@example.com');

    const token = mail.extractToken('verify-email');
    expect(token).not.toBeNull();
    expect(token!.length).toBeGreaterThan(32);

    // 3. Verify
    await http(app)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);

    const verifiedRow = await findOne<{ email_verified: boolean }>(
      ds,
      'users',
      { id: userId },
    );
    expect(verifiedRow!.email_verified).toBe(true);

    // 4. Login
    const loginRes = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jane@example.com', password: 'StrongP@ss1' })
      .expect(200);

    const body = loginRes.body as {
      accessToken: string;
      expiresIn: number;
      user: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        fullName: string;
        type: string;
      };
    };
    expect(body.accessToken).toBeTruthy();
    expect(body.user.id).toBe(userId);
    expect(body.user.firstName).toBe('Jane');
    expect(body.user.lastName).toBe('Doe');
    expect(body.user.fullName).toBe('Jane Doe');
    expect(body.user.type).toBe('student');

    // 5. Refresh cookie is HttpOnly + scoped + SameSite=Lax
    const setCookie = loginRes.headers['set-cookie'] as unknown as
      | string
      | string[];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const refreshHeader = cookies.find((c) => c.startsWith('refreshToken='));
    expect(refreshHeader).toBeTruthy();
    expect(refreshHeader).toMatch(/HttpOnly/);
    expect(refreshHeader).toMatch(/Path=\/api\/v1\/auth/);
    expect(refreshHeader).toMatch(/SameSite=Lax/i);

    // Refresh token must NOT appear in response body
    const refreshCookieValue = extractCookie(loginRes, 'refreshToken');
    expect(JSON.stringify(body)).not.toContain(
      refreshCookieValue!.split('=')[1],
    );
  });

  it('rejects malformed register payloads via the ValidationPipe', async () => {
    const bad = await http(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'not-an-email',
        password: 'short',
        firstName: '',
        lastName: 'Doe',
      })
      .expect(400);

    // ValidationPipe puts the list of errors into `message` as an array;
    // our GlobalExceptionFilter exposes it as `detail`.
    const body = bad.body as { detail: unknown; status: number };
    expect(body.status).toBe(400);
    expect(body.detail).toBeDefined();
    // Each validation message ends up in the detail body somehow — assert
    // that one of the specific messages from our DTOs is present.
    expect(JSON.stringify(body)).toMatch(/email|password/i);
  });

  it('rejects unknown fields (forbidNonWhitelisted)', async () => {
    await http(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'good@example.com',
        password: 'StrongP@ss1',
        firstName: 'Good',
        lastName: 'User',
        is_admin: true, // injection attempt
      })
      .expect(400);
  });

  it('returns the same generic error for non-existent email and wrong password (no enumeration)', async () => {
    // Seed a verified user
    await http(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'exists@example.com',
        password: 'StrongP@ss1',
        firstName: 'Ex',
        lastName: 'Ists',
      })
      .expect(201);
    await ds.query(
      `UPDATE users SET email_verified = TRUE, email_verified_at = NOW() WHERE email = 'exists@example.com'`,
    );

    const nonExistentRes = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nope@example.com', password: 'anything' })
      .expect(401);

    const wrongPasswordRes = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: 'exists@example.com', password: 'WrongP@ss1' })
      .expect(401);

    const nonExistentMsg = (nonExistentRes.body as { detail: string }).detail;
    const wrongPasswordMsg = (wrongPasswordRes.body as { detail: string })
      .detail;
    expect(nonExistentMsg).toBe(wrongPasswordMsg);
    expect(nonExistentMsg).toMatch(/invalid credentials/i);
  });
});
