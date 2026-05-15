# IOS LMS — Backend

Backend for the Institute of Scrum Learning Management System.

**Stack:** NestJS · PostgreSQL 15 · TypeORM · Redis 7 · Angular Universal (frontend, separate)

**Auth:** JWT access (15 min) + refresh rotation in HttpOnly cookie (7d). 5-tier RBAC.

**Exam engine:** Redis TTL as canonical clock, WebSocket gateway for real-time updates, auto-submit on expiry (Week 4).

---

## Quick start — Docker (recommended)

```bash
# 1. Copy the env template
cp .env.docker.example .env

# 2. Start everything (Postgres + Redis + API + Adminer)
docker compose up

# 3. In another terminal, run migrations the first time
docker compose exec api npm run migration:run
```

URLs:
- API — http://localhost:3000
- Swagger — http://localhost:3000/api/docs
- Adminer (DB GUI) — http://localhost:8080
- Postgres — `localhost:5432` (user: `ios`, pass: `iospass`, db: `ios_lms`)
- Redis — `localhost:6379`

Common commands (also available as `npm run docker:*` shortcuts):

```bash
docker compose up -d                      # detached
docker compose down                        # stop containers (data preserved)
docker compose down -v                     # nuke volumes (wipes DB)
docker compose logs -f api                 # tail API logs
docker compose exec api npm test           # run tests inside the container
docker compose exec api npm run migration:run
docker compose exec postgres psql -U ios -d ios_lms
docker compose exec redis redis-cli
```

---

## Quick start — bare metal (no Docker)

Requires Node 20.x, Postgres 15, Redis 7 running locally.

```bash
npm install
cp .env.example .env
# Edit .env with your local DB / Redis URLs
npm run migration:run
npm run start:dev
```

---

## Project structure

```
src/
├── app.module.ts            # Root module — wires global guards + filters
├── main.ts                  # Bootstrap — Helmet, cookies, Swagger, CORS
├── common/                  # Cross-cutting concerns
│   ├── decorators/          # @Roles()
│   ├── filters/             # RFC 7807 global exception filter
│   ├── guards/              # RolesGuard (5-tier RBAC)
│   └── interceptors/        # RlsInterceptor (sets app.current_user_id)
├── config/                  # Joi env validation
├── database/
│   ├── config/              # TypeORM config + SnakeNamingStrategy
│   ├── entities/            # 25 entities + barrel index
│   └── migrations/          # Numbered TypeORM migrations
├── modules/
│   ├── auth/                # JWT auth + RBAC (Week 2 ✓)
│   ├── health/              # /health endpoints
│   └── mail/                # Stub MailService (replaced by NotificationModule in Week 7)
└── test-utils/              # Shared test helpers
```

Tests live next to their source (`*.spec.ts`).

---

## Testing

```bash
npm test              # all unit tests
npm run test:cov      # with coverage report (gates: 80/75/80/80)
npm run test:watch    # watch mode
npm run lint          # eslint with autofix
```

Current status: **85 tests, 97.59% statement coverage.** New code must ship with tests in the same commit.

---

## Production deployment

For self-hosted (single DigitalOcean Droplet):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

For managed services (DO Managed Postgres + Managed Caching/Valkey), drop the `postgres` and `redis` services and point `DATABASE_URL` / `REDIS_URL` at the managed instances.

See `IOS_LMS_Backend_TaskTracker.md` for the full project plan.
