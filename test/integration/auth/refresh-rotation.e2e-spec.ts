import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll, countRows } from '../helpers/db';
import { http, loginAsStudent, extractCookie } from '../helpers/http';
import { createUser, resetCounters } from '../helpers/fixtures';

describe('[integration] auth/refresh-rotation', () => {
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

  it('rotation: old refresh token is marked revoked in DB after refresh', async () => {
    const user = await createUser(app);
    const { refreshCookie } = await loginAsStudent(
      app,
      user.email,
      user.password,
    );

    expect(await countRows(ds, 'refresh_tokens')).toBe(1);

    // Use the refresh token
    const refreshRes = await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);

    // After rotation: old token revoked, new token issued — 2 rows, 1 revoked
    expect(await countRows(ds, 'refresh_tokens')).toBe(2);
    const revoked = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM refresh_tokens WHERE revoked_at IS NOT NULL`,
    );
    expect(Number(revoked[0].count)).toBe(1);

    const newRefreshCookie = extractCookie(refreshRes, 'refreshToken');
    expect(newRefreshCookie).toBeTruthy();
    expect(newRefreshCookie).not.toBe(refreshCookie);
  });

  it('reuse detection: replaying an already-rotated token revokes all sessions', async () => {
    const user = await createUser(app);
    const { refreshCookie: cookie1 } = await loginAsStudent(
      app,
      user.email,
      user.password,
    );

    // First rotation — cookie1 is now revoked, cookie2 is live
    const r1 = await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .expect(200);
    const cookie2 = extractCookie(r1, 'refreshToken')!;

    // Replay cookie1 (the already-revoked one). This is the attack scenario.
    await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .expect(401);

    // All refresh tokens for this user should now be revoked
    const liveTokens = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    expect(Number(liveTokens[0].count)).toBe(0);

    // And cookie2 — the previously-live token — should also be revoked now
    await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie2)
      .expect(401);
  });

  it('logout revokes only the presented refresh token, not others', async () => {
    const user = await createUser(app);

    // Two parallel sessions — like two browsers
    const { refreshCookie: session1 } = await loginAsStudent(
      app,
      user.email,
      user.password,
    );
    const { refreshCookie: session2 } = await loginAsStudent(
      app,
      user.email,
      user.password,
    );

    expect(await countRows(ds, 'refresh_tokens')).toBe(2);

    // Log out from session 1
    await http(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', session1)
      .expect(200);

    // Session 2 should still work — logout must not have touched it
    await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session2)
      .expect(200);

    // And we can verify directly in the DB that session1 was revoked but
    // session2 was just rotated (one row revoked from logout, one row from
    // the refresh-rotation we just did = 2 rows revoked, 1 new active).
    const revoked = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [user.id],
    );
    const active = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    expect(Number(revoked[0].count)).toBe(2);
    expect(Number(active[0].count)).toBe(1);
  });

  it('refresh after logout on the SAME token triggers reuse detection (kills all sessions)', async () => {
    // Documents the deliberate "presenting a revoked token = treated as theft"
    // security posture. This is intentional.
    const user = await createUser(app);
    const { refreshCookie: session1 } = await loginAsStudent(
      app,
      user.email,
      user.password,
    );
    const { refreshCookie: session2 } = await loginAsStudent(
      app,
      user.email,
      user.password,
    );

    await http(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', session1)
      .expect(200);

    // Attacker presents the (now-revoked) session1 cookie. Reuse detection fires.
    await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session1)
      .expect(401);

    // All of this user's sessions are now revoked, including the innocent session2
    await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session2)
      .expect(401);
  });

  it('refresh with no cookie returns 401', async () => {
    await http(app).post('/api/v1/auth/refresh').expect(401);
  });

  it('refresh with a structurally valid but unsigned JWT cookie returns 401', async () => {
    await http(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refreshToken=this.is.not-a-real-jwt')
      .expect(401);
  });
});
