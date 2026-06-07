# Vibecoder Security Review — ios-lms-api

**Date:** 2026-05-24
**Reviewer:** Claude (vibecoder-review skill)
**Stack:** NestJS 11 (TypeScript), TypeORM + Postgres, Redis, Socket.IO, JWT (access + refresh), AWS S3 SDK (against MinIO/DO Spaces), bcrypt, Helmet, @nestjs/throttler
**Scope:** Triage-style review of `src/`, configuration, and Docker setup. ~120 TypeScript files, 100 non-test.

## Summary

Overall this codebase is meaningfully **better than the typical vibecoder app**. The fundamentals are in place: global `JwtAuthGuard` (default-deny), bcrypt cost-12 passwords, refresh-token rotation with reuse detection, hashed refresh tokens in DB, dummy-hash timing-attack mitigation on login, parameterised queries everywhere, generic `forgot-password` response (no user enumeration), `helmet`, locked-down HTTP CORS, rate limiting on `/auth/*`, and Joi-validated env config.

But there is **one exploitable privilege-escalation bug** and a handful of insecure-default and hygiene issues that should be fixed before this ships.

| # | Severity | Finding |
|---|---|---|
| 1 | **CRITICAL** | `POST /api/v1/admin/exam/assign` is reachable by any authenticated student — `@UseGuards(RolesGuard)` is missing |
| 2 | **HIGH** | docker-compose bakes in `JWT_SECRET` / `JWT_REFRESH_SECRET` / DB / S3 dev defaults that would silently be used in production if env vars are unset |
| 3 | **MEDIUM** | WebSocket `/exam` namespace accepts any Origin with `credentials: true` |
| 4 | **MEDIUM** | `X-Forwarded-For` trusted unconditionally; `app.set('trust proxy', …)` is not configured |
| 5 | **MEDIUM** | `npm audit` reports 4 moderate transitive vulnerabilities (ws, qs, engine.io, socket.io-adapter) |
| 6 | LOW | Production DB connection uses `rejectUnauthorized: false` (no TLS cert validation) |
| 7 | LOW | Refresh cookie uses `sameSite: 'lax'` rather than `'strict'` |

---

## Findings

### 1. [CRITICAL] Any authenticated user can assign exams to anyone

**Location:** `src/modules/exam/exam.controller.ts:154-176`

**Issue:** `ExamAdminController` declares `@Roles(AdminRole.LEARNING_ADMIN)` on `assignExam`, but the class lacks `@UseGuards(RolesGuard)`. `RolesGuard` is **not** registered as an `APP_GUARD` in `src/app.module.ts` — it must be applied per-controller (as every other admin controller in this repo correctly does: `CatalogAdminController`, `LearningAdminController`, `HealthController`). Without the guard, the `@Roles(...)` decorator is decorative metadata only, and the only check that runs is the global `JwtAuthGuard`, which accepts any valid JWT — student or admin.

The downstream `ExamService.assignExam` (`src/modules/exam/exam.service.ts:74-98`) performs no role check either; it directly creates an `ExamAccessCode` row.

```typescript
// src/modules/exam/exam.controller.ts:154-176
@ApiTags('Admin — Exam')
@ApiBearerAuth()
@Controller('admin/exam')          // ← no @UseGuards(RolesGuard)
export class ExamAdminController {
  @Post('assign')
  @Roles(AdminRole.LEARNING_ADMIN) // ← inert without RolesGuard
  async assignExam(@Body() dto: AssignExamDto) {
    const { plainCode, expiresAt } = await this.examService.assignExam(
      dto.userId, dto.examId, dto.certId,
    );
    return { plainCode, expiresAt, message: '...' };
  }
}
```

**Compare to the working pattern in `src/modules/catalog/catalog-admin.controller.ts:51-53`:**

```typescript
@Controller('admin/catalog')
@UseGuards(RolesGuard)   // ← present here
export class CatalogAdminController { ... }
```

**Impact:** A registered student (no admin role) calling
```
POST /api/v1/admin/exam/assign
Authorization: Bearer <student JWT>
{ "userId": "<victim uuid>", "examId": "<exam uuid>", "certId": "<cert uuid>" }
```
receives a freshly-minted one-time access code in the response. The attacker can:
- Issue access codes to themselves for any exam (then `start` / `submit` it).
- Issue access codes to other students (nuisance / cert fraud).
- Enumerate exam UUIDs by trying assignments and reading the success/failure (no real enumeration protection — it just 404s on bad exam IDs).

**Severity rationale:** No special skill required. Single curl command. Bypasses the entire admin/student boundary on this surface.

**Fix:**
```typescript
@ApiTags('Admin — Exam')
@ApiBearerAuth()
@Controller('admin/exam')
@UseGuards(RolesGuard)        // ← add this
export class ExamAdminController {
  // … rest unchanged
}
```
After adding the guard, also add an integration test that exercises this exact bypass — `student JWT → POST /api/v1/admin/exam/assign → expect 403`. A test for this would have caught it.

**Suggested follow-up:** Audit every other controller for the same pattern. `grep -L "@UseGuards(RolesGuard)" $(grep -l "@Roles(" src/**/*.controller.ts)` is the one-liner. (I checked all five — only `ExamAdminController` is missing it. The rest are correct.)

---

### 2. [HIGH] docker-compose ships production-grade defaults for JWT and DB secrets

**Location:** `docker-compose.yml:35-37, 163-166, 178-179` (inherited unchanged by `docker-compose.prod.yml`)

**Issue:** The compose file uses `${VAR:-fallback}` for every secret with a *real, working* fallback baked in:

```yaml
# docker-compose.yml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-iospass}
JWT_SECRET: ${JWT_SECRET:-development-only-jwt-access-secret-min-64-chars-replace-in-production}
JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET:-development-only-jwt-refresh-secret-different-from-access-secret-here}
DO_SPACES_KEY: ${DO_SPACES_KEY:-minioadmin}
DO_SPACES_SECRET: ${DO_SPACES_SECRET:-minioadmin}
STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:-sk_test_mock}
SENDGRID_API_KEY: ${SENDGRID_API_KEY:-SG.mock}
```

`docker-compose.prod.yml` overlays but does **not** override these — it only flips `NODE_ENV=production` and tunes resource limits. The Joi schema in `src/config/validation.ts` accepts the dev secret because it's >=32 chars.

**Impact:** Anyone running
```
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
without first exporting `JWT_SECRET` and `JWT_REFRESH_SECRET` in their shell or a `.env` file gets a production instance signing tokens with a *well-known, source-controlled* secret. Same thing for the DB password (`iospass`) and S3 keys (`minioadmin`). The fact that these strings now exist publicly in this repo means any attacker who knows the project name can forge admin JWTs for that deployment.

**Fix (pick one):**

(a) Drop the fallbacks for production-critical vars so compose refuses to start without them:
```yaml
JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set}
JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET:?JWT_REFRESH_SECRET must be set}
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
DO_SPACES_KEY: ${DO_SPACES_KEY:?...}
DO_SPACES_SECRET: ${DO_SPACES_SECRET:?...}
```

(b) Add a startup check in `validation.ts` that *rejects* the known dev secret string when `NODE_ENV === 'production'`:
```typescript
JWT_SECRET: Joi.string().min(32).required()
  .when('NODE_ENV', { is: 'production',
    then: Joi.string().disallow(
      'development-only-jwt-access-secret-min-64-chars-replace-in-production'
    )}),
```

(a) is the simpler and more durable fix.

---

### 3. [MEDIUM] WebSocket gateway accepts any Origin with credentials

**Location:** `src/modules/exam/exam.gateway.ts:70-78`

```typescript
@WebSocketGateway({
  namespace: '/exam',
  cors: {
    origin: (origin, cb) => { cb(null, true); },   // ← any origin
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
```

The HTTP layer correctly restricts CORS to `APP_BASE_URL`, but the WebSocket namespace is wide open. The inline comment claims the check is done "at the HTTP layer / infra level" — I didn't find any such check in this repo, and Socket.IO long-polling fallback runs over HTTP, so the gateway's own CORS config does matter.

**Impact:** The risk is moderated because Socket.IO auth here is JWT-in-handshake (not cookies), so a malicious cross-origin page can't simply ride a victim's session. But the gateway is exfiltratable in other ways (e.g. CSWSH against a leaked token, or a misconfigured client that exposes the token on the page). Setting `credentials: true` while also accepting `*` is the exact combination browsers refuse for fetch — Socket.IO doesn't enforce that constraint for you.

**Fix:** Match the HTTP CORS policy:
```typescript
cors: {
  origin: process.env.APP_BASE_URL ?? 'http://localhost:4000',
  credentials: true,
},
```

---

### 4. [MEDIUM] X-Forwarded-For is trusted without `trust proxy`

**Location:** `src/common/interceptors/rls.interceptor.ts:60-63`, also `src/main.ts` (missing `app.set('trust proxy', …)`)

```typescript
const ip =
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
  req.socket.remoteAddress ?? '127.0.0.1';
```

Express is never told it's behind a proxy, and `x-forwarded-for` is read directly from headers — meaning a client connecting directly to the API can put whatever they like in that header, and the value flows into the RLS session variable `app.current_ip`. That variable is presumably consumed by Postgres RLS policies and/or audit logs.

**Impact:** Audit logs and any IP-based RLS policy can be spoofed by the client. Also, throttler keys may be derived from this header through Express's `req.ip` — if so, an attacker can rotate the spoofed IP to bypass the 5/60s auth rate limit.

**Fix:** In `src/main.ts`, configure trust proxy to match the actual deployment (e.g. behind a single trusted load balancer):
```typescript
app.set('trust proxy', 1);   // or a specific subnet
```
Once set, `req.ip` is trustworthy and you can replace the manual header parse in `rls.interceptor.ts` with `req.ip`.

---

### 5. [MEDIUM] `npm audit` reports 4 moderate transitive vulnerabilities

**Location:** `package-lock.json`

```
ws ≤ 8.20.0      uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx)
qs 6.11.1-6.15.1 DoS via stringify (GHSA-q8mj-m7cp-5q26)
engine.io        (via ws)
socket.io-adapter (via ws)
```

All transitive under `socket.io` / `@nestjs/platform-express`. `npm audit fix` reports an available fix.

**Fix:** `npm audit fix` then re-run integration tests.

---

### 6. [LOW] Production Postgres connection skips TLS verification

**Location:** `src/database/config/typeorm.config.ts:79-82`

```typescript
ssl: process.env.NODE_ENV === 'production'
  ? { rejectUnauthorized: false }
  : false,
```

This is a common pattern when connecting to managed Postgres providers (DO Managed PG, RDS) that present non-public CAs, but it disables certificate validation entirely — a successful MITM on the database path would be undetectable. Not exploitable from outside the VPC, but worth a note: when you know the CA, switch to `ssl: { ca: fs.readFileSync('rds-ca.pem'), rejectUnauthorized: true }`.

---

### 7. [LOW] Refresh cookie uses sameSite=lax (not strict)

**Location:** `src/modules/auth/auth.controller.ts:230`, `src/modules/auth/auth-admin.controller.ts:112`

`sameSite: 'lax'` allows the refresh cookie to ride top-level cross-site GETs. Since `/auth/refresh` is POST-only and JSON-bodied, no real CSRF risk surfaces today — but `'strict'` would future-proof against any GET-shaped variant added later. Cookie is path-scoped to `/api/v1/auth` and `httpOnly`, which already covers most of the risk.

---

## Things that look good (worth noting)

These are patterns the codebase gets right and that should be preserved:

- **Default-deny auth**: `JwtAuthGuard` registered as global `APP_GUARD`; routes opt out via `@Public()`.
- **Validation pipe**: `whitelist: true, forbidNonWhitelisted: true` — DTOs strip and reject unknown fields, no mass-assignment.
- **Password reset and verification tokens** are 32 random bytes, bcrypt-hashed in DB, single-use (`usedAt` set with `affected` race-check at `auth.service.ts:451-459`).
- **Refresh token rotation** with reuse detection that revokes all sessions on a replay (`auth.service.ts:186-194`).
- **Timing-attack mitigation** on login: dummy bcrypt compare when the user/admin row doesn't exist (`auth.service.ts:131-138, 159-164`).
- **`forgot-password`** returns the same message whether the email exists or not (`auth.service.ts:255-258`).
- **Exam questions** strip `isCorrect` from options before returning to clients (`exam.controller.ts:79-88`).
- **`ExamGateway.handleJoinSession`** verifies session ownership against `socket.data.userId` (`exam.gateway.ts:155-160`).
- **Profile endpoints** read user ID from JWT via `@CurrentUser('id')`, never from URL params, and additionally enforce `user.type === 'student'`.
- **No raw SQL string concatenation** anywhere I could find. TypeORM repositories and parameterised `createQueryBuilder` calls throughout.
- **No `eval`, `exec`, `child_process`**; no `innerHTML` / `dangerouslySetInnerHTML` (this is a JSON API, so that's expected, but worth confirming).
- **Bootstrap super_admin** seeder properly gated by `NODE_ENV` with opt-in flag for production (`seeder/seeder.service.ts:64-74`).
- **Helmet** is enabled (`main.ts:14`).
- **Auth rate limiting**: 5 requests / 60s on `/auth/*` routes via `@Throttle` decorator.

---

## Quick wins (in order)

1. **Add `@UseGuards(RolesGuard)` to `ExamAdminController`.** One line. Test with a student JWT.
2. **Strip JWT/DB/S3 default fallbacks from `docker-compose.yml`**, or replace `:-` with `:?` so compose refuses to start without them.
3. **Run `npm audit fix`** and re-test.
4. **Constrain the WebSocket CORS origin** to `APP_BASE_URL`.
5. **Configure `app.set('trust proxy', ...)`** to match your deployment, then read IPs via `req.ip`.

## Suggested next-step tests

Three integration tests would close the loop on the issues above:

```typescript
// 1. Privilege boundary on admin/exam
it('rejects student JWT on POST /admin/exam/assign with 403', async () => { ... });

// 2. Insecure-default detection
it('refuses to boot in production with the well-known dev JWT secret', () => { ... });

// 3. Header spoofing
it('uses req.ip (not raw x-forwarded-for) for rate limiting', async () => { ... });
```

---

*This was a triage-level review (~2 hours). It is not a full audit. Areas that warrant deeper follow-up: the Postgres RLS policies themselves (I only read the interceptor that sets the session vars, not the policy DDL), Stripe webhook signature verification when it lands, and the storage signed-URL flow once it's exposed to clients.*
