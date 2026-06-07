import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll, countRows, findOne } from '../helpers/db';
import { http, loginAsStudent } from '../helpers/http';
import { createUser, resetCounters } from '../helpers/fixtures';

describe('[integration] profile/update-password', () => {
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

  it('changes the password, revokes all refresh tokens, lets new password log in', async () => {
    const u = await createUser(app, { password: 'OldP@ss123!' });
    const { accessToken } = await loginAsStudent(app, u.email, 'OldP@ss123!');

    // A second login (e.g. another device) creates a second refresh token.
    await loginAsStudent(app, u.email, 'OldP@ss123!');
    expect(await countRows(ds, 'refresh_tokens')).toBe(2);

    const res = await http(app)
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldP@ss123!', newPassword: 'NewSecure1!' })
      .expect(200);

    expect((res.body as { message: string }).message).toMatch(/signed out/i);

    // All refresh tokens revoked — none active.
    const activeRefresh = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM refresh_tokens WHERE revoked_at IS NULL`,
    );
    expect(Number(activeRefresh[0].count)).toBe(0);

    // Old password rejected.
    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'OldP@ss123!' })
      .expect(401);

    // New password accepted.
    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'NewSecure1!' })
      .expect(200);

    // Password hash actually changed.
    const updated = await findOne<{ password_hash: string }>(
      ds,
      'users',
      { id: u.id },
    );
    expect(updated).not.toBeNull();
    // We can't compare to the old hash without snapshotting it, but we can at
    // least confirm it's a bcrypt hash of the expected cost.
    expect(updated!.password_hash).toMatch(/^\$2[aby]\$1[02]\$/);
  });

  it('rejects an incorrect currentPassword with 401', async () => {
    const u = await createUser(app, { password: 'OldP@ss123!' });
    const { accessToken } = await loginAsStudent(app, u.email, 'OldP@ss123!');

    await http(app)
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongP@ss123!', newPassword: 'NewSecure1!' })
      .expect(401);

    // Old password still works — change was rejected.
    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'OldP@ss123!' })
      .expect(200);
  });

  it('rejects a newPassword identical to currentPassword with 400', async () => {
    const u = await createUser(app, { password: 'OldP@ss123!' });
    const { accessToken } = await loginAsStudent(app, u.email, 'OldP@ss123!');

    await http(app)
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldP@ss123!', newPassword: 'OldP@ss123!' })
      .expect(400);
  });

  it('rejects a weak newPassword via class-validator', async () => {
    const u = await createUser(app, { password: 'OldP@ss123!' });
    const { accessToken } = await loginAsStudent(app, u.email, 'OldP@ss123!');

    await http(app)
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldP@ss123!', newPassword: 'short' })
      .expect(400);

    await http(app)
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldP@ss123!', newPassword: 'nouppercaseornumber' })
      .expect(400);
  });

  it('returns 401 without a token', async () => {
    await http(app)
      .patch('/api/v1/me/password')
      .send({ currentPassword: 'x', newPassword: 'NewSecure1!' })
      .expect(401);
  });
});
