import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { http, loginAsStudent } from '../helpers/http';
import { createUser, resetCounters } from '../helpers/fixtures';

describe('[integration] profile/update-profile', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    app = await buildTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(ds);
    resetCounters();
  });

  it('GET /me returns the authenticated student profile', async () => {
    const u = await createUser(app, { firstName: 'Jane', lastName: 'Doe', locale: 'en' });
    const { accessToken } = await loginAsStudent(app, u.email, u.password);

    const res = await http(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      fullName: string;
      locale: string;
      direction: string;
    };
    expect(body.id).toBe(u.id);
    expect(body.email).toBe(u.email);
    expect(body.fullName).toBe('Jane Doe');
    expect(body.locale).toBe('en');
    expect(body.direction).toBe('ltr');
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('PATCH /me updates allowlisted fields and ignores everything else', async () => {
    const u = await createUser(app);
    const { accessToken } = await loginAsStudent(app, u.email, u.password);

    const res = await http(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Janet',
        city: 'Toronto',
        locale: 'tr',
      })
      .expect(200);

    const body = res.body as {
      firstName: string;
      city: string;
      locale: string;
      direction: string;
    };
    expect(body.firstName).toBe('Janet');
    expect(body.city).toBe('Toronto');
    expect(body.locale).toBe('tr');
    expect(body.direction).toBe('ltr');
  });

  it('PATCH /me with an Arabic locale flips direction to rtl', async () => {
    const u = await createUser(app);
    const { accessToken } = await loginAsStudent(app, u.email, u.password);

    const res = await http(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ locale: 'ar' })
      .expect(200);

    expect((res.body as { direction: string }).direction).toBe('rtl');
  });

  it('PATCH /me rejects an unsupported locale via class-validator', async () => {
    const u = await createUser(app);
    const { accessToken } = await loginAsStudent(app, u.email, u.password);

    await http(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ locale: 'ja' })
      .expect(400);
  });

  it('PATCH /me rejects forbidden fields via forbidNonWhitelisted', async () => {
    const u = await createUser(app);
    const { accessToken } = await loginAsStudent(app, u.email, u.password);

    await http(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'attacker@evil.com' }) // not in the DTO allowlist
      .expect(400);

    await http(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ passwordHash: 'pwned' }) // direct DB column injection attempt
      .expect(400);
  });

  it('PATCH /me with explicit null clears optional fields', async () => {
    const u = await createUser(app);
    const { accessToken } = await loginAsStudent(app, u.email, u.password);

    // Set first
    await http(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ phone: '+1 415 555 0100' })
      .expect(200);

    // Then clear
    const res = await http(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ phone: null })
      .expect(200);

    expect((res.body as { phone: string | null }).phone).toBeNull();
  });

  it('returns 401 without a token', async () => {
    await http(app).get('/api/v1/me').expect(401);
    await http(app)
      .patch('/api/v1/me')
      .send({ firstName: 'Janet' })
      .expect(401);
  });
});
