import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildTestApp } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { http } from '../helpers/http';
import { resetCounters } from '../helpers/fixtures';

/**
 * Verifies the production rate-limit behaviour (5 req / 60s on /auth/*).
 *
 * Runs in a SEPARATE Jest invocation from the rest of the integration tests
 * because @Throttle metadata in AuthController is captured at class-decoration
 * time — meaning the auth throttle limit is baked in when the controller
 * module loads, and we cannot change it after. The `test:integration:throttler`
 * npm script sets TEST_THROTTLE_AUTH_LIMIT=5 in the process env so the
 * decorator reads the production value; the main `test:integration:main`
 * run gets the default high limit (100_000) so unrelated tests don't trip
 * the limiter.
 */
describe('[integration] auth/throttler', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ds = app.get(DataSource);
    await truncateAll(ds);
    resetCounters();
  });

  it('returns 429 after exceeding 5 login attempts within 60 seconds', async () => {
    const responses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await http(app)
        .post('/api/v1/auth/login')
        .send({
          email: `attempt${i}@example.com`,
          password: 'wrong-but-doesnt-matter',
        });
      responses.push(res.status);
    }

    expect(responses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(responses[5]).toBe(429);
  });
});
