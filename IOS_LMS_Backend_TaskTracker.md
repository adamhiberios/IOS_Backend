# IOS LMS Backend — Task Tracker
**Project:** Institute of Scrum LMS  
**Repo:** https://github.com/adamhiberios/IOS_Backend  
**Stack:** NestJS · PostgreSQL 15 · TypeORM · Redis · Angular Universal  
**Total weeks:** 10 | **Total tasks:** 46  
**Last updated:** Week 2 complete · smoke-tested end-to-end

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

## Week 3 — Catalog, content, learning APIs ⬜ UP NEXT

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-029R | DO Spaces StorageService — public-read certs, auth media, signed URLs videos | 🔴 | ⬜ |
| Catalog APIs | GET /catalog, GET /catalog/:id, content gating per enrollment | 🔴 | ⬜ |
| Learning APIs | Modules + lessons CRUD, lesson serving with purchase gate, progress tracking | 🔴 | ⬜ |
| BE-041 | Catalog search — GET /catalog?search=&program_code=&sort= with cursor pagination | 🟡 | ⬜ |

---

## Week 4 — Exam engine + Redis + WebSocket gateway ⬜

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BE-033 | RedisModule — ioredis, keyspace notifications, redis.keyspace.expired event | 🔴 | ⬜ |
| BE-034 | TestSessionService — start, submit, autosave (no TTL reset), getSession via PTTL | 🔴 | ⬜ |
| BE-035 | WS gateway — socket.io + redis-adapter, JWT auth, timer_tick / warning / session_expired | 🔴 | ⬜ |
| BE-036 | Keyspace expiry handler — auto-submit snapshot, persist attempt, emit WS, fire exam events | 🔴 | ⬜ |
| ExamModule | Assignment algorithm, one-time access codes, validate-access, start, scoring | 🔴 | ⬜ |
| BE-037 | Late-submit 2-min grace window with late_flag | 🟡 | ⬜ |
| BE-038 | Nginx WS upgrade config | 🟡 | ⬜ |

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
| GAP-002 | GitHub Actions pipeline with auto-rollback | 🔴 | ⬜ |
| GAP-003 | DO infra provisioning + PgBouncer | 🔴 | ⬜ |
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
