import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';

/**
 * Extracts a Set-Cookie header for the given cookie name and returns it
 * in a form suitable for sending back in a Cookie header.
 */
export function extractCookie(res: Response, name: string): string | null {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of cookies) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(raw);
    if (m) return `${name}=${m[1]}`;
  }
  return null;
}

/**
 * Returns the supertest agent for the app's HTTP server. Use this everywhere
 * instead of `request(app.getHttpServer())` so we get one consistent place
 * to extend later (logging, auth helpers, etc.).
 */
export function http(app: INestApplication): request.SuperTest<request.Test> {
  return request(
    app.getHttpServer(),
  ) as unknown as request.SuperTest<request.Test>;
}

/**
 * Convenience: full login flow that returns the access token + refresh cookie
 * string ready to be sent in subsequent Cookie headers.
 */
export async function loginAsStudent(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshCookie: string }> {
  const res = await http(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);

  const accessToken = (res.body as { accessToken: string }).accessToken;
  const refreshCookie = extractCookie(res, 'refreshToken');
  if (!refreshCookie) {
    throw new Error('Login did not return a refreshToken cookie');
  }
  return { accessToken, refreshCookie };
}

export async function loginAsAdmin(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshCookie: string }> {
  const res = await http(app)
    .post('/api/v1/auth/admin/login')
    .send({ email, password })
    .expect(200);

  const accessToken = (res.body as { accessToken: string }).accessToken;
  const refreshCookie = extractCookie(res, 'refreshToken');
  if (!refreshCookie) {
    throw new Error('Admin login did not return a refreshToken cookie');
  }
  return { accessToken, refreshCookie };
}
