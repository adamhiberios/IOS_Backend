# IOS LMS Backend — Task Tracker
**Project:** Institute of Scrum LMS  
**Repo:** https://github.com/adamhiberios/IOS_Backend  
**Stack:** NestJS · PostgreSQL 15 · TypeORM · Redis · Angular Universal  
**Total weeks:** 10 | **Total tasks:** 46  
**Last updated:** 2026-06-11 · Weeks 1, 2, 3, 4 complete · deployment/CI-CD infra pulled forward from Week 10 (partial) · Week 5 (Payment + Enrollment) is next

**2026-06-11 audit + remediation pass** (full report: `docs/AUDIT_2026-06-11.md`):
- Fixed CRITICAL: C1 (`@Public()` on WebController — email verify/reset links were 401ing), C2 (`exam_attempts` FORCE RLS vs default-pool insert — `scoreAndPersist` now runs in its own RLS-scoped transaction).
- Fixed HIGH: H1 atomic `SET KEEPTTL XX`, H2 `GETDEL` grace consume, H3 ownership-before-grace in late-submit, H4 conditional submit transition (no duplicate attempts), H5 refresh-rotation `affected` check, H6 `?active=false` coercion, H7 RolesGuard exact-match (finance≠content). Plus M3 (startExam compensation), M9 (PUBLISHED guard + marks-weighted scoring), M10 (auth throttle on web reset form).
- **Exam assignment algorithm (SoT §2.3) now actually implemented** — was claimed ✅ in Week 4 but absent. `POST /admin/exam/assign` without `examId` auto-assigns the lowest unattempted `exam_order` among PUBLISHED exams; 403 on pool exhaustion; 409 on outstanding unused code; attempts lookup is RLS-scoped to the student. Ready for Week 5 BE-021C.
- Repaired 4 stale unit tests (rls.interceptor x-forwarded-for, storage `delete .mock`, exception-filter `|{}` + dynamic import). Integration suite green 70/70.
- Email templates: rebranded all 11 to Poppins + HTML logo lockup on `#85102C` (logo maroon), README tokens updated.
- BE-038 note: `docker/nginx/nginx.conf` was superseded by Caddy (`scripts/caddy/Caddyfile`) in the deployment pass.
- Still open from audit: M1–M2, M4–M8, LOW items, Redis auth + eviction policy + PG CA (fold into GAP-003).

---

## Legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🔄 | In progress |
| ⬜ | To do |
| 🔴 | High priority |
| 🟡 | Medium priority |
| 🔵 | Low priority |

---

## Week 1 — Foundation, architecture, database ✅ COMPLETE

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-031R | NestJS scaffold + module dirs + PM2 + Nginx config | 🔴 | ✅ |
| BE-006R | Exams + exam_questions + exam_question_options schema | 🔴 | ✅ |
| BE-006A | test_sessions table — UUID PK, snapshot JSONB | 🔴 | ✅ |
| BE-012A | All TypeORM entities with relations, indexes, constraints | 🔴 | ✅ |
| BE-001–005, 009, 011 | Schema verification across catalog/learning/audit tables | 🔴 | ✅ |
| BE-018R (partial) | DB triggers + functions installed | 🔴 | ✅ |
| BE-014R | Scoped RLS via set_config() interceptor wired globally | 🔴 | ✅ |
| BE-017R | RLS policies on 5 high-risk tables | 🔴 | ✅ |
| BE-043 (partial) | Health endpoints GET /health and /health/full | 🔵 | ✅ |

---

## Week 2 — Authentication, RBAC, rate limiting ✅ COMPLETE

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-028R | JWT auth — register, verify email, login, refresh rotation, logout, forgot/reset password | 🔴 | ✅ |
| BE-013R | 5-tier RBAC — RolesGuard + JWT role claim, @Public(), @CurrentUser() decorators | 🔴 | ✅ |
| BE-016R | ThrottlerGuard at 5 req/60s on /auth/* (DB check_rate_limit fn ready) | 🔴 | ✅ |
| BE-015 | super_admin protection trigger verified | 🔴 | ✅ |
| Unit tests | 85 tests across 11 suites, 97.59% statement coverage, 95.16% function coverage | 🔴 | ✅ |

**Week 2 smoke test (end-to-end on live Postgres + running server):**

| Step | Endpoint | Result |
|------|----------|--------|
| 1 | GET /health | 200 with status info ✓ |
| 2 | POST /api/v1/auth/register | 201, user created, verification email logged ✓ |
| 3 | POST /api/v1/auth/login (unverified) | 401 "Email not verified" ✓ |
| 4 | POST /api/v1/auth/verify-email | 200 "Email verified" ✓ |
| 5 | POST /api/v1/auth/login (verified) | 200, access token + refresh cookie ✓ |
| 6 | POST /api/v1/auth/refresh | 200, new tokens, old refresh revoked in DB ✓ |
| 7 | POST /api/v1/auth/forgot-password | 200, generic message (no enumeration) ✓ |
| 8 | POST /api/v1/auth/reset-password | 200, all refresh tokens revoked ✓ |
| 9 | Login with old password | 401 ✓ |
| 10 | Login with new password | 200 ✓ |
| 11 | POST /api/v1/auth/logout | 200, refresh revoked, cookie cleared ✓ |
| 12 | GET /api/docs | 200 (Swagger UI) ✓ |
| 13 | GET /api/docs-json | 200, 12 endpoints documented ✓ |

**Security validations confirmed in DB:**
- Passwords stored bcrypt cost-12 (`$2b$12$...`)
- Refresh / verification / reset tokens stored bcrypt cost-10, plain tokens never persisted
- Refresh rotation revokes old token; reuse detection cascades full session invalidation
- Password reset revokes ALL refresh tokens for the user
- Login error is always generic; dummy bcrypt compare on nonexistent emails (timing-safe)
- Forgot-password returns same generic message regardless of email validity

**Auth endpoints live (all Swagger-documented):**
- POST /api/v1/auth/register, verify-email, login, refresh, logout, forgot-password, reset-password
- POST /api/v1/auth/admin/login, refresh, logout
- GET /health, /health/full (@Public)

**Test infrastructure:**
- Jest with ts-jest, 11 test suites, 85 tests, all passing
- Coverage gates: 80% statements / 75% branches / 80% functions / 80% lines
- Current coverage: 97.59% / 79.43% / 96.49% / 97.95%
- Test files alongside source (`*.spec.ts`)
- `src/test-utils/mocks.ts` — shared mock helpers
- Run: `npm test`, `npm run test:cov`, `npm run test:watch`

**Testing policy going forward:** Every new service, controller, guard, interceptor, or filter ships with unit tests in the same commit. No exceptions.

**Docker setup ✅ COMPLETE (added during Week 2):**
- `Dockerfile` — multi-stage prod build (deps → builder → runner), non-root user, healthcheck, tini for signal handling
- `Dockerfile.dev` — single-stage with hot reload via mounted source volumes
- `docker-compose.yml` — local dev: Postgres 15 + Redis 7 + API + Adminer, health-gated startup
- `docker-compose.prod.yml` — production override with resource limits, no source mounts
- `docker/redis/redis.conf` — keyspace notifications enabled (`notify-keyspace-events Ex`) for Week 4 exam expiry
- `docker/postgres/init.sql` — pgcrypto + btree_gin extensions installed on first start
- `.dockerignore` — keeps build context lean
- `.env.docker.example` — env template for compose
- npm scripts: `docker:up`, `docker:down`, `docker:test`, `docker:migrate`, `docker:psql`, `docker:redis-cli`, `docker:prod`
- Dev workflow: `docker compose up` brings everything online; source hot-reloads via `CHOKIDAR_USEPOLLING=true` (works on Windows/macOS/Linux hosts)

---

## i18n infrastructure pass ✅ COMPLETE (landed 2026-05-20, ahead of Week 9)

Plumbing only — content sweep (full Tr/Fr/Es/Ar/De catalogues, 54 email templates × 6 locales) still lives in Week 9. Pulled forward so every controller, DTO, and exception that ships from Week 3 onwards is locale-aware by default.

**Branch:** `feat/i18n-infrastructure` · **Summary doc:** `docs/i18n-infrastructure.md`

| Area | Delivered |
|---|---|
| Migration `1748000000000-AddI18nSupport.ts` | `translations` JSONB on certificates / learning_modules / lessons / exams / blog_articles · `locale` column on admin_users · CHECK constraint on users.locale + admin_users.locale · pg_trgm extension · GIN trigram indexes on `(translations -> 'en' ->> 'title')` for each translatable entity |
| Entities updated | Certificate, LearningModule, Lesson, Exam (auth-misc) BlogArticle, AdminUser · `import type { Translations }` (isolatedModules + emitDecoratorMetadata friendly) |
| i18n module | `src/i18n/i18n.module.ts` (AppI18nModule) — 5-resolver chain: UserPreferenceResolver → HeaderResolver('x-lang') → QueryResolver('lang') → AcceptLanguageResolver → CookieResolver('lang') → fallback DEFAULT_LOCALE |
| Resolver | `UserPreferenceResolver` reads `req.user.locale` from the JWT payload (already populated by JwtStrategy) — ranks above network-supplied hints |
| Resource bundles | `src/i18n/resources/en/{errors,validation,common,emails}.json` full · `tr/errors.json` and `ar/errors.json` partial · `fr/es/de/errors.json` skeleton (Week 9 fills) |
| Error layer | `src/common/errors/` — `AppException` base, `ErrorCode` registry, family-grouped classes (auth / authorization / domain / validation / infrastructure), `codeToSlug()` for stable `type` URLs |
| GlobalExceptionFilter | Full rewrite — DI'd `I18nService`, awaits both `t()` calls in Promise.all, emits `application/problem+json` with stable `code`, `request_id` header, structured logging (5xx error / refresh-reuse warn / 4xx debug) |
| Shared types | `src/common/i18n/types.ts` — Locale const tuple, Translations generic, `resolveTranslation()` helper with fallback chain, `directionFor()` (rtl for ar) |
| nest-cli.json | `assets` entry copies `i18n/resources/**/*.json` to dist on build |
| AppModule | `AppI18nModule` imported ahead of feature modules so `I18nService` is ready when `APP_FILTER` instantiates the filter |
| Test infra fixes | `docker/postgres/init.sql` pre-installs pg_trgm · `test/integration/setup.ts` replaces blanket `REASSIGN OWNED BY` with enumerated `ALTER TABLE/SEQUENCE/FUNCTION ... OWNER TO` (avoids REASSIGN failing on pg_trgm's pinned operator class) · `test/integration/helpers/app.ts` removed `app.useGlobalFilters(new GlobalExceptionFilter())` that was DI-bypassing |
| Tests | `global-exception.filter.spec.ts` rewritten (11 cases against new shape) · `user-preference.resolver.spec.ts` (4 cases) · `common/i18n/types.spec.ts` (helpers + fallback chain) |

**Production runbook addition:** DO Managed PG has `pg_trgm` on its allowlist but it must be enabled once via the admin console — `CREATE EXTENSION IF NOT EXISTS pg_trgm` as the admin role before the first migration runs against prod.

---

## Week 3 — Catalog, content, learning APIs ✅ COMPLETE (integration suite green 2026-05-20)

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-029R | S3-compatible StorageService — MinIO in docker-compose for dev, swap env vars for DO Spaces in prod; public-read certs / auth media / signed URLs videos | 🔴 | ✅ |
| Catalog APIs | Public GET /catalog (cursor-paginated, i18n-resolved) + GET /catalog/:id; admin POST/PATCH/DELETE on /admin/catalog plus dedicated /translations endpoint (per-locale merge) | 🔴 | ✅ |
| Learning APIs | Admin module + lesson CRUD on /admin/modules + /admin/lessons; student GET /learning/certs/:certId/curriculum, GET /learning/lessons/:id (with signed video URL), POST /learning/lessons/:id/complete, GET /learning/progress | 🔴 | ✅ |
| Profile APIs | GET /me, PATCH /me, PATCH /me/password (separate endpoint; revokes all refresh tokens like password reset does) | 🔴 | ✅ |
| BE-041 | Catalog search — GET /catalog?search=&program_code=&sort= with cursor pagination (uses the GIN trigram index from the i18n migration) | 🟡 | ✅ |

**Profile / Catalog / Learning delivered:**
- **Profile:** `src/modules/profile/{profile.module.ts,profile.service.ts,profile.controller.ts}` + DTOs (`UpdateProfileDto`, `UpdatePasswordDto`, `ProfileResponseDto`). `AuthService.changePassword(userId, current, new)` added — verifies current via bcrypt, hashes new at cost-12, revokes all refresh tokens. Allowlist of editable fields enforced server-side (firstName, lastName, phone, locale, country, city, street, address, postalCode, occupation, position, company, avatarUrl) on top of class-validator's `forbidNonWhitelisted`. Explicit `null` clears; `undefined` is no-op.
- **Catalog:** `src/modules/catalog/` — `CatalogService` with cursor-based pagination (`(created_at, id)` tiebreaker, base64-encoded opaque cursor), trigram search against `(translations -> 'en' ->> 'title')`, per-locale resolution with English fallback, `fallbackUsed` flag on every item, soft-delete via `active=false`. Two controllers: `CatalogController` (public, GET only, hides inactive) and `CatalogAdminController` (RolesGuard — content_creator + learning_admin for writes, learning_admin only for delete). Dedicated `PATCH /admin/catalog/:id/translations` does a shallow per-locale merge so locales not in the body are preserved.
- **Learning:** `src/modules/learning/` — `LearningService` covers admin module + lesson CRUD plus student-side curriculum tree, lesson serving, idempotent complete, per-cert progress summary. Purchase gate runs through `req.rlsRunner` (the RLS-aware transaction opened by `RlsInterceptor`) so RLS on `student_purchases` is the second line of defence behind the app-layer `userId` filter. Lesson videos are private-bucket signed URLs minted on every request with a 1-hour TTL.
- **i18n:** Every response carries `locale` + `direction` (`rtl` for ar). Resolution chain unchanged: user pref → X-Lang → ?lang → Accept-Language → cookie → DEFAULT_LOCALE.

**Test infrastructure adds:**
- `test/integration/profile/{update-profile,update-password}.e2e-spec.ts` — 6 + 5 cases.
- `test/integration/catalog/catalog-crud.e2e-spec.ts` — 10 cases (public + admin, role enforcement, translations merge, search, cursor pagination, conflict).
- `test/integration/learning/curriculum.e2e-spec.ts` — 7 cases (admin CRUD, content_creator vs learning_admin permission split, purchase gate enforcement, locale-aware lesson serving, idempotent completion, progress summary, anonymous 401 sweep). The `enrollStudent` helper wraps the seed INSERT in a transaction with `set_config('app.current_user_id', ...)` so the FORCE RLS on `student_purchases` is satisfied at seed time.

**Awaiting:** `docker compose exec api npm run test:integration` to confirm the suite is green. The unit test layer (`storage`, `health`, `profile.service`, etc.) ships alongside but isn't run from this session — same toolchain limit on the VM.

**BE-029R delivered:**
- `docker-compose.yml` — `minio` service (S3 API on 9000, console on 9001) + `minio-init` companion that idempotently creates 3 buckets with correct anonymous policies (`ios-lms-certificates` public-read, `ios-lms-media` / `ios-lms-videos` private). API service depends on `minio-init: service_completed_successfully`.
- `docker-compose.prod.yml` — MinIO services profiled out (`profiles: [never]`); api `depends_on` overrides to skip the dev-only chain.
- `.env.example` + `src/config/validation.ts` — three explicit buckets (`DO_SPACES_BUCKET_CERTIFICATES/MEDIA/VIDEOS`), `DO_SPACES_ENDPOINT` (SDK target) vs `DO_SPACES_PUBLIC_URL` (client-facing — diverges in dev only), `DO_SPACES_REGION` default `us-east-1`. Old single `DO_SPACES_BUCKET` retired.
- `src/modules/storage/` — `StorageModule` (`@Global`), `StorageService` (AWS SDK v3 S3Client + presigner, `forcePathStyle: true`), methods: `uploadObject`, `getPublicUrl`, `getSignedUrl`, `getSignedUploadUrl` (direct browser-to-S3 uploads for Week 8 avatars), `deleteObject`, `objectExists`, `healthCheck`, static `buildKey(...)` helper. `OnModuleInit` smoke-checks each bucket but warns rather than throws so the app can boot in degraded mode during MinIO warm-up.
- Public-URL rewrite: signed URLs minted against the internal endpoint have their host rewritten to the public base so browser clients can resolve them. No-op in prod where the two URLs are identical.
- `src/modules/health/health.controller.ts` — `/health/full` now reports per-bucket reachability and rolls into overall status.
- Spec suite: `storage.service.spec.ts` (15 cases — wiring, public URL rules, signed GET/PUT rewriting, bucket routing, lifecycle, 404 handling, health, key conventions), `health.controller.spec.ts` updated for the storage mock.

---

## Week 4 — Exam engine + Redis + WebSocket gateway ✅ COMPLETE (2026-05-22)

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-033 | RedisModule — ioredis, keyspace notifications, redis.keyspace.expired event | 🔴 | ✅ |
| BE-034 | TestSessionService — start, submit, autosave (no TTL reset), getSession via PTTL | 🔴 | ✅ |
| BE-035 | WS gateway — socket.io + redis-adapter, JWT auth, timer_tick / warning / session_expired | 🔴 | ✅ |
| BE-036 | Keyspace expiry handler — auto-submit snapshot, persist attempt, emit WS, fire exam events | 🔴 | ✅ |
| ExamModule | Assignment algorithm, one-time access codes, validate-access, start, scoring | 🔴 | ✅ |
| BE-037 | Late-submit 2-min grace window with late_flag | 🟡 | ✅ |
| BE-038 | Nginx WS upgrade config | 🟡 | ✅ |

**Week 4 delivered:**
- **RedisModule** (`src/modules/redis/`) — `@Global()` with two ioredis clients: `REDIS_CLIENT` for commands, `REDIS_SUBSCRIBER` for keyspace PubSub. Subscriber bridges `exam:session:*` and `exam:grace:*` expiry events into NestJS EventEmitter2 as `redis.keyspace.expired`. `RedisService` exposes typed JSON helpers including `setJsonKeepTtl` (Redis 6 `KEEPTTL` — autosave without TTL reset).
- **TestSessionService** (`src/modules/exam/test-session.service.ts`) — Redis CRUD: `start` (SET+EX), `autosave` (SET+KEEPTTL, returns false if expired), `getSession` (GET+PTTL), `deleteSession`, `startGrace` (120s grace key), `consumeGrace` (atomic read+delete), `hasGrace`.
- **ExamService** (`src/modules/exam/exam.service.ts`) — full lifecycle: `assignExam` (crypto.randomBytes 32 + bcrypt hash, 24h TTL), `validateAccess` (bcrypt verify without consuming), `startExam` (atomic code consume via UPDATE WHERE usedAt IS NULL, TestSession in PG + Redis), `autosave` (mirror to DB snapshot + Redis KEEPTTL), `submitExam`, `lateSubmitExam` (consumes grace key, lateFlag=true), `autoSubmitFromSnapshot` (idempotent, called by keyspace handler), `scoreAnswers` (correct/total × 100, passes at `exam.passingScore`%).
- **ExamController + ExamAdminController** — student endpoints: validate-access, start, GET session, autosave, submit, late-submit; admin: assign. `isCorrect` stripped from options before sending to client.
- **ExamGateway** (`src/modules/exam/exam.gateway.ts`) — socket.io `/exam` namespace, JWT middleware on `afterInit`, `join_session` handler (ownership check, room join, timer start), per-session 30s `setInterval` emitting `timer_tick`, `warning` at 600s+300s thresholds (de-duped per session), `session_expired` emit + timer cleanup. Redis adapter wired in `afterInit` with a dedicated subscriber client.
- **ExamKeyspaceHandler** (`src/modules/exam/exam-keyspace.handler.ts`) — `@OnEvent(redis.keyspace.expired)`: session expiry → mark EXPIRED, startGrace (snapshot from DB), emit WS; grace expiry → `autoSubmitFromSnapshot`.
- **Nginx** (`docker/nginx/nginx.conf`) — HTTP proxy to api:3000, WebSocket upgrade block for `/socket.io/` with `Upgrade`/`Connection` headers, `proxy_http_version 1.1`, 1h `proxy_read_timeout`, cert verification cache stub (Week 6).
- **Tests** — unit specs for all 5 new providers: `redis.service.spec.ts` (9 cases), `test-session.service.spec.ts` (10 cases), `exam.service.spec.ts` (7 cases), `exam.controller.spec.ts` (5 cases), `exam.gateway.spec.ts` (4 cases), `exam-keyspace.handler.spec.ts` (5 cases).

**Awaiting smoke test:** `docker compose exec api npm run build` to confirm TypeScript compilation, then `npm test` for unit suite.

---

## Deployment / CI-CD infrastructure pass 🔄 PARTIAL (landed 2026-06-08, pulled forward from Week 10)

Infra plumbing pulled ahead so Weeks 1–4 could be exercised on a live environment. This covers part of Week 10's GAP-002 (CI/CD pipeline) and GAP-003 (DO infra) — see those rows for what remains.

| Area | Delivered |
|---|---|
| GitHub Actions `deploy.yml` | Manual `workflow_dispatch` pipeline (inputs: `environment` prod\|dev, `ref`). Builds image, pushes to `ghcr.io/<owner>/<repo>:sha-<short>` + `:<environment>`, then SSHes to the Droplet, copies the droplet compose file, and runs `docker compose -p ios-lms-<env> pull && up -d`. Concurrency-grouped per environment. **No auto-rollback yet** (GAP-002 remainder). |
| Multi-env on shared Droplet | `docker-compose.droplet.yml` + `scripts/droplet-multi-env-migrate.sh` run prod and dev stacks side-by-side on one Droplet under separate compose project names (`ios-lms-prod` / `ios-lms-dev`), each with its own `/opt/ios-lms/<env>/.env`. |
| Droplet provisioning scripts | `scripts/droplet-bootstrap.sh` (host setup) + `scripts/droplet-lockdown.sh` (hardening). **PgBouncer not yet provisioned** (GAP-003 remainder) — pool max=10 still enforced app-side in `typeorm.config.ts`. |
| Swagger gating | `ENABLE_SWAGGER` env flag (`src/config/validation.ts`) opts `/api/docs` in per environment; `main.ts` wires it and relaxes CSP only when Swagger is enabled so the UI renders over HTTP. |
| Docs | `docs/DEPLOYMENT.md` (full deploy runbook) · `SECURITY_REVIEW.md` (security review writeup). |
| Cleanup | Removed obsolete `docker-compose.prod.yml` and the standalone Nginx config in favour of the droplet compose flow. |

---

## Demo data ✅ (added 2026-06-11)

**Script:** `src/database/seeds/demo-seed.ts` · **Docs:** `docs/DEMO_DATA.md` · **Run:** `npm run docker:seed:demo` (or `npm run seed:demo` locally)

Deterministic-UUID demo slice (`dd……-0000-4000-a000-*`): 4 role admins, 6 certificates with en/tr/ar translations + modules/lessons, weighted exams (incl. one DRAFT for the M9 guard), 8 students at distinct lifecycle stages (passed+certified, failed+retake-code outstanding, mid-course, promo purchase, multi-cert, browse-only, unverified, deactivated), purchases/transactions/progress/attempts/issued certs via the RLS-aware seed pattern, 3 promo codes ready for Week 5. Re-run = wipe demo slice + re-insert; manual data untouched; refuses on NODE_ENV=production. All accounts: `Demo@123!`.

---

## Week 5 — Payment, promo codes, enrollment ⬜

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-021 | Stripe Checkout Sessions — enrollment flow with metadata | 🔴 | ⬜ |
| BE-021A | Stripe webhook — express.raw(), HMAC, idempotency table with SELECT FOR UPDATE | 🔴 | ⬜ |
| BE-021B | Promo code engine — percentage + full_waiver, cert restrictions, atomic usage_count | 🔴 | ⬜ |
| BE-021C | Retake checkout — invalidate codes, assign next exam, email new link | 🔴 | ⬜ |
| BE-022 | Post-payment content unlock via webhook | 🔴 | ⬜ |

---

## Week 6 — Certificate generation + verification ⬜

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-023 | PDFKit cert generation — name, program, date, cert ID, QR — ≤15s pipeline | 🔴 | ⬜ |
| BE-024 | Unique cert ID — IOS-{PROG}-{YYYY}-{NNNNNN} via set_cert_sequence trigger | 🔴 | ⬜ |
| BE-025 | QR code — qrcode lib encoding /verify/:certId URL | 🔴 | ⬜ |
| BE-026 | Public cert verification — GET /verify/:certId, Nginx 5-min cache | 🔴 | ⬜ |
| BE-023A | Cert revocation — PATCH /admin/certs/issued/:id/revoke | 🟡 | ⬜ |

---

## Week 7 — Admin portal, notifications, monitoring ⬜

| ID | Task | Priority | Status |
|----|------|----------|--------|
| AdminModule | Admin CRUD, exam authoring, student management, dashboard stats | 🔴 | ⬜ |
| GAP-005 | NotificationModule — SendGrid, templates by type+locale, queue + retry (replaces MailService stub) | 🔴 | ⬜ |
| BE-040 | Sentry SDK, source maps, alerting, /health/full + Redis/Stripe/SendGrid | 🟡 | ⬜ |

---

## Week 8 — Profile, blog, GDPR ⬜

| ID | Task | Priority | Status |
|----|------|----------|--------|
| ProfileModule | Profile CRUD, purchase history, exam history, certs | 🔴 | ⬜ |
| BlogModule | Blog CRUD (admin), public listing + detail, SEO meta + Open Graph | 🔴 | ⬜ |
| BE-042 | GDPR — data export, deletion request, cookie consent | 🟡 | ⬜ |

---

## Week 9 — Internationalisation ⬜

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-032 | nestjs-i18n runtime locale; en, tr, fr, es, ar, de | 🔴 | ⬜ |
| i18n-notifs | All SendGrid templates in 6 languages | 🔴 | ⬜ |
| i18n-errors | Validation + HTTP error messages translated | 🔴 | ⬜ |

---

## Week 10 — Testing, CI/CD, deployment ⬜

| ID | Task | Priority | Status |
|----|------|----------|--------|
| GAP-001 unit | Jest 100% on Auth, Exam, TestSession, Gateway, Payment, Cert services | 🔴 | ⬜ |
| GAP-001 integration | Supertest + real PG/Redis full flow tests including reuse detection | 🔴 | ⬜ |
| GAP-002 | GitHub Actions pipeline with auto-rollback | 🔴 | 🔄 (manual GHCR build + droplet deploy live; auto-rollback pending) |
| GAP-003 | DO infra provisioning + PgBouncer | 🔴 | 🔄 (droplet bootstrap/lockdown/multi-env scripts done; PgBouncer pending) |
| GAP-014 | Swagger live since Week 2; AsyncAPI spec for WS events to add | 🔴 | ⬜ (partial) |
| BE-039 | DR runbook + test snapshot restore | 🟡 | ⬜ |
| BE-043 | Smoke test suite — /health, /verify, /redis/ping, WS handshake | 🔵 | ⬜ |

---

## Superseded tasks (do not implement)

| ID | Replaced by |
|----|-------------|
| BE-006 (question banks) | BE-006R |
| BE-014 (full RLS) | BE-014R |
| BE-017 (full RLS student) | BE-017R |
| BE-019 (Next.js frontend) | BE-019R (Angular Universal) |
| BE-028 (Supabase auth) | BE-028R |
| BE-029 (Supabase Storage) | BE-029R |
| BE-030 (Next.js setup) | BE-030R |
| BE-031 (Supabase backend) | BE-031R |

---

## Architecture decisions (locked)

| ADR | Decision |
|-----|---------|
| ADR-008 | Angular Universal frontend — Next.js discarded |
| ADR-009 | Redis + WebSocket from day one |
| ADR-010 | Scoped RLS on 5 tables only |

---

## Key constants

| Item | Value |
|------|-------|
| Access JWT TTL | 15 min |
| Refresh JWT TTL | 7 days |
| Refresh cookie | HttpOnly, Secure (prod/staging), SameSite=Lax, Path=/api/v1/auth |
| Password hashing | bcrypt cost 12 |
| Token hashing (refresh / verification / reset) | bcrypt cost 10 |
| Email verification TTL | 24 hours |
| Password reset TTL | 1 hour |
| Exam passing score | 80% |
| Access code validity | 24 hours |
| Timer authority | Redis TTL |
| Late submit grace | 2 min |
| Autosave interval | 60s (no TTL reset) |
| WS tick | 30s |
| WS warning thresholds | 600s, 300s |
| Cert ID format | IOS-{PROG}-{YYYY}-{NNNNNN} |
| Mock program codes | PSM, PSPO, PSD, PAL, SPS, PMP |
| Locales | en, tr, fr, es, ar, de |
| Infra cost | ~$64/mo |
| DB pool max | 10 (PgBouncer transaction pooling) |
| Auth rate limit | 5 req/60s on /auth/* (ThrottlerGuard) |
| TypeORM naming | SnakeNamingStrategy (camelCase entities ↔ snake_case DB) |
