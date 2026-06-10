# IOS LMS — Production & Development Deployment

This is the operational reference for the IOS LMS backend on DigitalOcean. It documents what was built, why it was built that way, and how to operate it. Anyone who joins the project should be able to deploy, debug, and recover from this document alone.

---

## 1. Overview

The backend is a NestJS API serving the Institute of Scrum LMS. It runs on a single DigitalOcean Droplet in TOR1 (Toronto), with managed Postgres and Valkey on the same private VPC and S3-compatible object storage in DigitalOcean Spaces. Cloudflare fronts the API as a CDN/WAF/TLS terminator with end-to-end TLS validation against the origin. Two parallel environments — `prod` and `dev` — share the same Droplet, the same managed clusters (with isolated databases), and the same Spaces buckets (with isolated key prefixes), but run as independent docker stacks behind different subdomains.

Deploys are manual: there is no auto-deploy on push. Every release is consciously triggered through GitHub Actions, with the deployer picking the target environment and the git ref to ship.

---

## 2. Architecture

```
                          ┌──────────────────────┐
                          │      Internet        │
                          └──────────┬───────────┘
                                     │ HTTPS
                                     ▼
                          ┌──────────────────────┐
                          │  Cloudflare edge     │  TLS termination, WAF,
                          │  (instituteofscrum   │  DDoS mitigation, CDN
                          │   .org zone)         │  Hides origin IP
                          └──────────┬───────────┘
                                     │ HTTPS (Full Strict)
                                     │ Origin CA cert validated
                                     ▼
            ┌──────────────────────────────────────────────────┐
            │  DigitalOcean Droplet — TOR1 — 159.203.7.46      │
            │                                                  │
            │  UFW: only 22, 80, 443 allowed inbound           │
            │  3000/3001 NOT reachable from internet           │
            │                                                  │
            │  ┌────────────────────────────────────────────┐  │
            │  │ Caddy 2 (container, host networking)      │  │
            │  │ Listens :80 (redirect→HTTPS) and :443      │  │
            │  │ Serves Cloudflare Origin CA cert           │  │
            │  │ Routes by Host header:                     │  │
            │  │   api.instituteofscrum.org → :3000         │  │
            │  │   api-dev.instituteofscrum.org → :3001     │  │
            │  └──────────────┬─────────────────────────────┘  │
            │                 │ HTTP over loopback             │
            │                 ▼                                │
            │  ┌──────────────────────┐  ┌──────────────────┐  │
            │  │ ios-lms-api  (prod)  │  │ ios-lms-api-dev  │  │
            │  │ bound 127.0.0.1:3000 │  │ bound 127.0.0.1: │  │
            │  │ NestJS, prod env     │  │       3001       │  │
            │  └──────┬───────────────┘  └──────┬───────────┘  │
            └─────────│─────────────────────────│──────────────┘
                      │  TLS over VPC private network
                      ▼                         ▼
            ┌────────────────────────────────────────┐
            │ DO Managed Postgres (TOR1)             │
            │   ios_lms        (prod app DB)         │
            │   ios_lms_dev    (dev app DB)          │
            │   defaultdb      (DO default — unused) │
            └────────────────────────────────────────┘
            ┌────────────────────────────────────────┐
            │ DO Managed Valkey (TOR1)               │
            │   DB index 0  (prod)                   │
            │   DB index 1  (dev)                    │
            └────────────────────────────────────────┘
            ┌────────────────────────────────────────┐
            │ DO Spaces (TOR1, public S3 endpoint)   │
            │   ios-lms-certificates                 │
            │     prod uploads: certs/...            │
            │     dev uploads:  dev/certs/...        │
            │   ios-storage (media + video)          │
            │     prod uploads: media/...            │
            │     dev uploads:  dev/media/...        │
            └────────────────────────────────────────┘
```

**Key design decisions.**

- **Shared Droplet, isolated stacks.** Both envs run on one Droplet to keep cost low and ops simple. Each env is its own docker compose project (`ios-lms-prod`, `ios-lms-dev`) so they cannot collide on networks, container names, or volumes.
- **Shared managed services, logical isolation.** Same Postgres cluster, different database. Same Valkey, different logical DB index. Same Spaces buckets, different key prefix. Each env is functionally isolated without paying for duplicate infrastructure.
- **Caddy as Host-based router.** Two subdomains resolve to the same Droplet IP. Caddy reads the HTTP `Host` header and proxies to the right loopback port. Containers do not face the public internet.
- **No auto-deploy.** All deploys are explicit `workflow_dispatch` runs. Pushing to `main` does not ship anything by itself.
- **Production stays plain `NODE_ENV=production`.** Dev also runs `NODE_ENV=production` so all production safety validations (Joi schema, JWT-secret allowlists, mock-key bans) stay active on dev. Dev-only behavior (Swagger UI) is opt-in via a dedicated `ENABLE_SWAGGER` env flag.

---

## 3. Components & tools

| Layer | Tool | Why |
|-------|------|-----|
| Compute | DigitalOcean Droplet, Ubuntu 24.04 LTS | Single host that hosts both environments + reverse proxy. Cheaper and simpler than App Platform for v1 traffic. |
| Container runtime | Docker Engine + Compose plugin | Industry standard; lets us version everything as images. |
| Reverse proxy | Caddy 2 | Single config file, simple Host-based routing, supports TLS natively. |
| Edge / TLS | Cloudflare (free tier) | DDoS, WAF, TLS termination, origin IP hiding, free Universal SSL covering wildcard subdomains. |
| Database | DO Managed Postgres 15 | Backups, point-in-time recovery, automatic minor version upgrades, sits in the same VPC as the Droplet for private networking. |
| Cache / pub-sub | DO Managed Valkey 7+ | Redis-compatible. Used for throttler, refresh tokens, socket.io adapter. |
| Object storage | DO Spaces | S3-compatible, same region as the rest. |
| Image registry | GitHub Container Registry (`ghcr.io`) | Free for public packages, automatic auth from GH Actions, lives near the CI compute. |
| CI/CD | GitHub Actions | One workflow with `workflow_dispatch` to build + push + deploy. |
| Domain | GoDaddy (registrar) | Domain registration only. |
| DNS | Cloudflare | Authoritative DNS; GoDaddy nameservers point at Cloudflare. |

**Why these specific choices and not alternatives:**

- *DO App Platform instead of Droplet.* App Platform would handle TLS, deploys, and auto-scaling — but it costs more, gives you less control over the host, and the multi-env pattern requires two separate apps. The shared-Droplet pattern documented here lets one Basic Droplet host both envs for a fraction of the price.
- *Nginx instead of Caddy.* Nginx works fine. Caddy was picked because (a) one config file, (b) sensible defaults, (c) hot config reload built in. If you ever need fine-grained features like upstream health checks with custom retry logic, Nginx may make sense.
- *AWS instead of DO.* DigitalOcean's pricing for small workloads (one Droplet, one Postgres, one Valkey) is materially lower than AWS RDS + EC2 + ElastiCache. The trade-off is fewer services and a smaller ecosystem.
- *Direct GHCR push from CI.* Simpler than DO Container Registry: no extra credentials, free tier is sufficient. We can switch to DOCR later if pull latency becomes a problem (currently fine).

---

## 4. Infrastructure: the Droplet

### 4.1 Provisioning

| Setting | Value |
|---------|-------|
| Region | TOR1 (Toronto) — matches Postgres + Valkey + Spaces |
| OS image | Ubuntu 24.04 LTS |
| Plan | DO Basic (size depends on workload — minimum 2 GB RAM recommended once both stacks run) |
| Public IPv4 | 159.203.7.46 |
| Private VPC IP | 10.20.0.5 — used by Caddy when reaching the API containers (via loopback, but VPC is what reaches managed services) |
| VPC | TOR1 default VPC — same as Postgres + Valkey |

### 4.2 SSH access

The Droplet was created without an attached SSH key. Initial access was bootstrapped by:

1. Resetting the root password from the DO Console (DO emails a temporary password).
2. Logging in to the HTML5 console as root.
3. Generating a local SSH key on the workstation:
   ```powershell
   ssh-keygen -t ed25519 -C "ios-lms-deploy" -f $env:USERPROFILE\.ssh\ios_lms_droplet
   ```
4. Adding the public key to `/root/.ssh/authorized_keys` on the Droplet.

After bootstrap, root SSH is disabled (see §4.4). All operations use the non-root `deploy` user.

### 4.3 Bootstrap (one-time setup)

Script: `scripts/droplet-bootstrap.sh`

It performs, in order:

1. `apt update && apt upgrade -y` plus install `ca-certificates curl gnupg ufw fail2ban`.
2. Create a 2 GB swapfile at `/swapfile` (helps small Droplets weather memory spikes during builds and migrations).
3. Install Docker CE + Compose plugin from Docker's official apt repo (not Ubuntu's older `docker.io` package).
4. Create the `deploy` user, add it to the `docker` group, copy `/root/.ssh/authorized_keys` to `/home/deploy/.ssh/authorized_keys`.
5. Create `/opt/ios-lms/` owned by `deploy`.
6. Configure UFW: deny by default, allow 22/tcp (initially also 3000/tcp for the first deploy; later removed when Caddy fronted everything).

### 4.4 SSH hardening

Script: `scripts/droplet-lockdown.sh`

Run after verifying that SSH key access works for the `deploy` user. It modifies `/etc/ssh/sshd_config` (and any drop-ins under `/etc/ssh/sshd_config.d/`) to:

- `PermitRootLogin no`
- `PasswordAuthentication no`

After this, the only way in is as `deploy` with the SSH key. The DO HTML5 console still works locally but is no longer useful for remote shells.

### 4.5 Privilege model

The `deploy` user is in the `docker` group. That implicitly grants root-equivalent access via Docker (any container can mount the host filesystem as root). To make narrow operational tasks ergonomic, the user has a targeted sudoers rule:

```
deploy ALL=(root) NOPASSWD: /usr/sbin/ufw
```

Installed via a one-time Docker-escalation step:

```bash
docker run --rm -v /etc/sudoers.d:/sudoers alpine sh -c \
  "echo 'deploy ALL=(root) NOPASSWD: /usr/sbin/ufw' > /sudoers/90-deploy-ufw && chmod 440 /sudoers/90-deploy-ufw"
```

This lets `deploy` run `ufw` without password without granting general sudo. The privilege is what was already implied by Docker group membership — just made explicit and bounded.

### 4.6 Final firewall posture

```
[ 1] 22/tcp        ALLOW IN  Anywhere   SSH
[ 2] 80/tcp        ALLOW IN  Anywhere   Caddy HTTP redirect
[ 3] 443/tcp       ALLOW IN  Anywhere   Caddy HTTPS (from Cloudflare)
+ IPv6 equivalents
```

The 3000 and 3001 rules from the initial deployment were removed once Caddy was fronting both. Containers bind to `127.0.0.1` (see §7.2), so even without UFW, direct external connections to 3000/3001 would fail at the docker layer.

---

## 5. Infrastructure: managed services

### 5.1 Postgres

| Setting | Value |
|---------|-------|
| Cluster | `db-pgsql-tor1-62678` (DO-assigned) |
| Region | TOR1 |
| VPC | Default TOR1 VPC (same as Droplet) |
| Trusted sources | The Droplet (added via DO Console → Network Access) |
| Connection hostname | `private-db-pgsql-tor1-62678-do-user-38165705-0.j.db.ondigitalocean.com` (private VPC) |
| Port | 25060 |
| SSL mode in connection URL | `sslmode=no-verify` (see "Postgres TLS quirk" in §12) |
| Databases | `defaultdb` (unused), `ios_lms` (prod), `ios_lms_dev` (dev) |
| User | `doadmin` (DO-managed; we don't create per-app users) |

The dev database (`ios_lms_dev`) was created from the DO Console → cluster → Users & Databases tab. Sharing the cluster keeps cost flat; sharing the user is acceptable because both envs are operated by the same team.

### 5.2 Valkey

| Setting | Value |
|---------|-------|
| Cluster | `db-vk-tor1-52645` (DO-assigned) |
| Region | TOR1 |
| Trusted sources | The Droplet |
| Connection hostname | `private-db-vk-tor1-52645-do-user-38165705-0.j.db.ondigitalocean.com` |
| Port | 25061 |
| Protocol | `rediss://` (TLS required) |
| Eviction policy | `allkeys-lru` (set during initial provisioning) |
| Logical DB | `0` for prod, `1` for dev — selected via the path component of the `REDIS_URL` |

`ioredis` (the client used by NestJS) parses the `/1` path automatically; no code change was needed to route dev to a separate logical database.

### 5.3 Spaces

| Setting | Value |
|---------|-------|
| Region | TOR1 |
| Endpoint | `https://tor1.digitaloceanspaces.com` |
| Region (for AWS SDK) | `us-east-1` (DO Spaces compatibility convention) |
| Buckets | `ios-lms-certificates` (public-listable), `ios-storage` (private; media + video) |
| Access key | One per environment? No — single key shared across prod + dev, with **Limited Access** scope restricted to those two buckets. |

Environments share buckets but isolate uploads via `STORAGE_KEY_PREFIX`:

- Prod sets `STORAGE_KEY_PREFIX=""` (no prefix) → objects land at `<bucket>/<key>`.
- Dev sets `STORAGE_KEY_PREFIX="dev"` → objects land at `<bucket>/dev/<key>`.

The prefix is applied transparently in `StorageService` (`src/modules/storage/storage.service.ts`) — callers always pass the unprefixed key, and the service prepends the prefix when talking to S3. DB records store the unprefixed key, which means the same code path works identically in both environments.

The current upload code does NOT set `ACL: 'public-read'` on certificate objects. For public certificate links to work without auth, either set the bucket policy to public-read or change `storage.service.ts` to set ACL per-upload. This is a known follow-up.

---

## 6. Infrastructure: domain, DNS, edge

### 6.1 Domain and DNS

- **Registrar:** GoDaddy
- **Authoritative DNS:** Cloudflare
- **Zone:** `instituteofscrum.org`
- **Records:**

  ```
  api.instituteofscrum.org      A   159.203.7.46   Proxied (orange cloud)
  api-dev.instituteofscrum.org  A   159.203.7.46   Proxied (orange cloud)
  ```

Both records resolve through Cloudflare's edge IPs (`104.21.x.x`, `172.67.x.x`), so the Droplet's real IP is not visible in public DNS.

### 6.2 SSL/TLS mode

Cloudflare is set to **Full (Strict)**. That means:

- **Browser ↔ Cloudflare:** HTTPS using Cloudflare's Universal SSL cert covering `instituteofscrum.org` and one level of subdomains.
- **Cloudflare ↔ Origin:** HTTPS to port 443 on the Droplet, with the origin's cert **validated** against Cloudflare's Origin CA.

A Cloudflare Origin CA certificate was generated for `*.instituteofscrum.org` + `instituteofscrum.org` (15-year validity, RSA 2048) and uploaded to `/opt/ios-lms/caddy/origin.crt` + `origin.key`. Caddy presents this cert on every request.

If the Origin CA cert ever rotates or expires, Caddy must be restarted to pick up the new files:

```bash
cd /opt/ios-lms/caddy
docker compose -p ios-lms-caddy restart
```

### 6.3 Caddy reverse proxy

- **Config:** `scripts/caddy/Caddyfile` (in repo) → `/opt/ios-lms/caddy/Caddyfile` (on Droplet)
- **Compose:** `scripts/caddy/docker-compose.yml` → `/opt/ios-lms/caddy/docker-compose.yml`
- **Image:** `caddy:2-alpine`
- **Network mode:** `host` — Caddy binds to the Droplet's 80 and 443 directly, and reaches API containers via `localhost:3000` / `localhost:3001`.
- **TLS:** manual cert from `/etc/caddy/origin.crt` + `/etc/caddy/origin.key` (mounted read-only). `auto_https off` because Cloudflare is the cert authority for browsers; the cert Caddy serves is only for the Cloudflare ↔ Origin hop.
- **Trusted proxies:** Cloudflare's published IP ranges. Caddy reads `CF-Connecting-IP` as the real client IP and forwards it to the upstream as `X-Real-IP`, so the NestJS throttler and audit logs see the actual visitor IP, not Cloudflare's.

Reload config without restarting:

```bash
docker exec ios-lms-caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 7. Application: multi-environment layout

### 7.1 Filesystem on the Droplet

```
/opt/ios-lms/
├── caddy/
│   ├── docker-compose.yml         # Caddy stack
│   ├── Caddyfile                  # Caddy site config
│   ├── origin.crt                 # Cloudflare Origin CA cert (perms 0644)
│   └── origin.key                 # Cloudflare Origin CA key  (perms 0600)
├── prod/
│   ├── docker-compose.yml         # Replaced on every prod deploy by CI
│   └── .env                       # Prod secrets — perms 0600, never committed
└── dev/
    ├── docker-compose.yml         # Replaced on every dev deploy by CI
    ├── .env                       # Dev secrets — perms 0600, never committed
    └── .env.example               # Template (left behind by migration script)
```

`/opt/ios-lms/` and everything under it is owned by `deploy:deploy`.

### 7.2 docker-compose.droplet.yml (the template)

Lives in the repo at `docker-compose.droplet.yml`. The deploy workflow `scp`s it into `/opt/ios-lms/<env>/docker-compose.yml` on every run, so the in-repo version is the canonical config.

Parameterized via env vars (read from each env's `.env`):

| Var | Purpose | Example (prod) | Example (dev) |
|-----|---------|----------------|----------------|
| `API_IMAGE` | GHCR image reference to pull | `ghcr.io/.../ios_backend:sha-abc123` | same image, often same tag |
| `APP_ENV` | Names the container | `prod` → `ios-lms-api-prod` | `dev` → `ios-lms-api-dev` |
| `HOST_PORT` | Loopback port the container binds to | `3000` | `3001` |

Container internals always listen on port 3000 — `HOST_PORT` is the host-side binding. Ports bind to `127.0.0.1` only so the containers are not directly exposed to the public internet.

The compose project name (`-p ios-lms-prod` / `-p ios-lms-dev`) namespaces the docker network and volumes per env so they cannot collide.

### 7.3 Environment files (.env)

Every env var the app reads is loaded from `/opt/ios-lms/<env>/.env` via `env_file:` in the compose. The files are:

- **Never committed** — gitignored by `.env`
- **`chmod 600`** — only `deploy` can read them
- **Updated in two ways:**
  1. `API_IMAGE` is updated automatically by the deploy workflow on every run (via `sed`).
  2. Everything else is edited by hand on the Droplet (e.g. `nano /opt/ios-lms/prod/.env`).

Differences between prod and dev:

| Variable | Prod | Dev |
|----------|------|-----|
| `APP_ENV` | `prod` | `dev` |
| `HOST_PORT` | `3000` | `3001` |
| `APP_BASE_URL` | `https://api.instituteofscrum.org` | `https://api-dev.instituteofscrum.org` |
| `DATABASE_URL` | ends with `/ios_lms?sslmode=no-verify` | ends with `/ios_lms_dev?sslmode=no-verify` |
| `REDIS_URL` | no path (DB 0) | ends with `/1` (DB 1) |
| `STORAGE_KEY_PREFIX` | empty or absent | `dev` |
| `ENABLE_SWAGGER` | absent (or `false`) | `true` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | unique 96-hex-char values | **different** unique values — dev tokens can't be replayed against prod |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` / `PASSWORD` | prod admin | dev admin |

Both envs run `NODE_ENV=production` so every safety validation in `src/config/validation.ts` applies to both — including the mock-key bans and the JWT-secret allowlist of well-known dev defaults.

### 7.4 Migrations

Run on container start via `docker/entrypoint.sh`:

```sh
#!/bin/sh
set -eu
echo "[entrypoint] running database migrations..."
node ./node_modules/typeorm/cli.js migration:run \
  -d ./dist/database/config/typeorm.config.js
echo "[entrypoint] migrations complete, starting api..."
exec node dist/main
```

Single-instance safe (we only run one container per env). The compiled `dist/database/config/typeorm.config.js` exports `AppDataSource` which the typeorm CLI picks up. `tini` (PID 1) → entrypoint → `exec node` keeps signal handling clean.

---

## 8. CI/CD: GitHub Actions

Workflow: `.github/workflows/deploy.yml`

### 8.1 Trigger

`workflow_dispatch` only. There is no `push:` trigger. You must explicitly trigger every deploy from the **Actions** tab.

Inputs:

- `environment` — `dev` or `prod`
- `ref` — branch / tag / SHA to build (optional; defaults to the branch you launched the workflow from)

### 8.2 Required secrets

| Secret | What it is |
|--------|-----------|
| `DROPLET_HOST` | `159.203.7.46` |
| `DROPLET_USER` | `deploy` |
| `DROPLET_SSH_KEY` | full PEM of the private SSH key authorized on `deploy@159.203.7.46` |

GHCR push uses the built-in `GITHUB_TOKEN` with `packages: write`. No PAT is required.

### 8.3 Pipeline

```
[workflow_dispatch]
  │
  ▼
[build-push]   Checks out the chosen ref. Builds the multi-stage Dockerfile.
  │            Pushes two tags to GHCR:
  │              ghcr.io/.../ios_backend:sha-<short>   (immutable, per-build)
  │              ghcr.io/.../ios_backend:<env>         (rolling, last-deployed)
  ▼
[deploy]       SSHes into the Droplet.
               Copies docker-compose.droplet.yml → /opt/ios-lms/<env>/docker-compose.yml.
               Sets API_IMAGE=<sha-tagged> in /opt/ios-lms/<env>/.env via sed.
               Logs in to GHCR with GITHUB_TOKEN.
               docker compose -p ios-lms-<env> pull
               docker compose -p ios-lms-<env> up -d
               docker image prune -f
               Health-checks https://api[-dev].instituteofscrum.org/health
               (10 retries, 5s apart).
               On failure: tails the last 200 lines of container logs and exits 1.
```

### 8.4 Rollback

Trigger the workflow again with `ref` set to a previous commit SHA. Docker pulls the image already built for that SHA (or rebuilds if it's missing from cache), and the same redeploy logic runs. Health-check confirms before the workflow exits clean.

If a deploy is actively bad, you can also do a faster manual rollback on the Droplet:

```bash
cd /opt/ios-lms/<env>
sed -i 's|^API_IMAGE=.*|API_IMAGE=ghcr.io/adamhiberios/ios_backend:sha-<good-sha>|' .env
docker compose -p ios-lms-<env> pull
docker compose -p ios-lms-<env> up -d
```

---

## 9. Operations runbook

### 9.1 Daily operations

| Action | Command |
|--------|---------|
| Tail prod logs | `ssh deploy@<host>` → `docker logs -f ios-lms-api` (or `ios-lms-api-prod` after the next prod deploy renames it) |
| Tail dev logs | `docker logs -f ios-lms-api-dev` |
| Tail Caddy access | `docker logs -f ios-lms-caddy` |
| Restart prod | `cd /opt/ios-lms/prod && docker compose -p ios-lms-prod restart` |
| Restart dev | `cd /opt/ios-lms/dev && docker compose -p ios-lms-dev restart` |
| Reload Caddy config | `docker exec ios-lms-caddy caddy reload --config /etc/caddy/Caddyfile` |
| Show running containers | `docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'` |
| Show UFW state | `sudo ufw status numbered` |
| Inspect env without leaking secrets | `docker exec ios-lms-api-dev env \| grep -E '^(NODE_ENV\|APP_ENV\|ENABLE_SWAGGER)='` |

### 9.2 Editing an `.env`

1. `nano /opt/ios-lms/<env>/.env`
2. Save (`Ctrl+O`, Enter, `Ctrl+X`)
3. Ensure perms are still 0600: `chmod 600 /opt/ios-lms/<env>/.env`
4. Apply by recreating the container: `cd /opt/ios-lms/<env> && docker compose -p ios-lms-<env> up -d`

`docker compose up -d` re-reads the env file. `docker restart` does NOT — only `up -d` (or `down` + `up`) recreates the container with the new env.

### 9.3 Rotating secrets

**Postgres / Valkey passwords:**

1. DO Console → cluster → **Users & Databases** → reset the relevant user's password.
2. Update `DATABASE_URL` / `REDIS_URL` in both `/opt/ios-lms/prod/.env` and `/opt/ios-lms/dev/.env`.
3. `docker compose -p ios-lms-prod up -d` and `docker compose -p ios-lms-dev up -d`.

**JWT secrets:**

1. Generate new ones: `openssl rand -hex 48` (run twice for access + refresh).
2. Update `JWT_SECRET` and `JWT_REFRESH_SECRET` in the target env's `.env`.
3. Restart the stack. All active sessions are invalidated — every user has to log in again.

**Spaces access key:**

1. DO Console → **API** → **Spaces Keys** → generate new key (Limited Access scoped to the two buckets).
2. Update `DO_SPACES_KEY` and `DO_SPACES_SECRET` in both `.env` files.
3. Restart both stacks.
4. After verifying everything still works, delete the old key from the DO Console.

### 9.4 Backups

- **Postgres:** DO automatic daily backups + 7-day point-in-time recovery. Enable in DO Console → cluster → **Backups** if not already on.
- **Spaces:** no automatic versioning. Consider enabling object versioning per bucket if accidental deletion is a risk.
- **Droplet:** weekly Droplet snapshots can be enabled per Droplet. The Droplet itself is mostly disposable (it's just Docker + configs + secrets in `/opt/ios-lms`), so backups matter mainly for `.env` files.

---

## 10. Security posture

### 10.1 Layered defenses

| Layer | Mitigates |
|-------|-----------|
| Cloudflare WAF + DDoS | L3/L4 floods, OWASP-style attacks, bot abuse, geo-restricted access (when configured) |
| Cloudflare hides origin IP | Attackers can't bypass Cloudflare by hitting the Droplet directly via DNS |
| UFW | Only 22/80/443 inbound; direct connection to API ports times out |
| Container loopback bind | Containers won't accept external connections even if UFW were broken |
| Caddy + Origin CA (Full Strict) | TLS-encrypted Cloudflare↔Origin link, with cert validation — no MITM gap |
| Caddy trusted-proxies | Real client IP comes from `CF-Connecting-IP`; spoofed forwarded headers from non-Cloudflare sources are ignored |
| Helmet | Security headers (CSP, X-Frame-Options, HSTS, etc.) |
| App-level rate limiting | NestJS throttler keyed on real IP |
| JWT + refresh rotation | Short-lived access tokens (15 min), HttpOnly refresh cookie, rotation on refresh, revoke-on-reuse |
| Joi env validation | App refuses to start if a well-known dev JWT secret or mock external-service key reaches `NODE_ENV=production` |

### 10.2 What is and isn't encrypted in transit

| Hop | Encrypted? | How |
|-----|-----------|-----|
| Browser ↔ Cloudflare | Yes | Cloudflare Universal SSL, TLS 1.2+ |
| Cloudflare ↔ Caddy | Yes | Full (Strict) using Cloudflare Origin CA cert |
| Caddy ↔ API container | No (loopback) | Same-host loopback traffic; never leaves the Droplet |
| API container ↔ Postgres | Yes | `sslmode` over private VPC |
| API container ↔ Valkey | Yes | `rediss://` (TLS) over private VPC |
| API container ↔ Spaces | Yes | HTTPS to `tor1.digitaloceanspaces.com` |

### 10.3 Secret management

All secrets live in:

- `/opt/ios-lms/prod/.env` and `/opt/ios-lms/dev/.env` on the Droplet (mode 0600, owner `deploy`).
- GitHub repository secrets for CI: `DROPLET_HOST`, `DROPLET_USER`, `DROPLET_SSH_KEY`.

No secret is committed to the repo. The `.env.example` files in the repo contain only placeholder structure.

### 10.4 Audit posture (what's logged)

- **Caddy:** request log on stdout (`docker logs ios-lms-caddy`). Includes real client IP via `CF-Connecting-IP`.
- **API:** NestJS logger writes to stdout; `docker logs ios-lms-api[-dev]`.
- **Cloudflare:** all requests logged at the Cloudflare dashboard (Analytics, Security Events).
- **Postgres:** DO Managed Postgres ships logs to the DO dashboard.

---

## 11. Known follow-ups

These are deliberately not done yet but are tracked for later.

1. **Restrict UFW 443 to Cloudflare IP ranges only.** Currently `allow 443/tcp from anywhere` — anyone who learns the origin IP can hit Caddy directly (which still validates Host header but bypasses Cloudflare's WAF). Locking 443 to Cloudflare's published IP list closes that.
2. **Enable Cloudflare WAF managed rulesets** (Security → WAF → Managed rules) — OWASP + Cloudflare Managed. Free, big wins for protection.
3. **`Always Use HTTPS` and `Min TLS Version 1.2`** at Cloudflare (SSL/TLS → Edge Certificates).
4. **Rotate Postgres + Valkey passwords** — the original ones leaked into earlier chat output.
5. **Real Stripe + SendGrid keys** — the live `.env`s have placeholder values that pass Joi validation but fail at first API call.
6. **`BOOTSTRAP_SUPER_ADMIN=false`** in both envs once each super_admin has logged in (the seeder is idempotent regardless, but cleaner).
7. **Certificate ACL fix** — `StorageService.uploadObject` for the certificates bucket should set `ACL: 'public-read'` for the public-URL pattern to actually work without auth. Currently certs are private despite `getPublicUrl()` generating an unsigned URL.
8. **Object versioning on Spaces** for the certificates and storage buckets.
9. **Droplet snapshot schedule** — at least weekly, to recover `/opt/ios-lms/` contents quickly if needed.
10. **Move from `sslmode=no-verify` to `sslmode=verify-full`** with the DO managed Postgres CA bundle mounted into the container.

---

## 12. Lessons learned (debugged during this deployment)

These are problems that surfaced and how they were fixed. Useful when something similar comes up.

**Postgres TLS quirk.** With `DATABASE_URL=...?sslmode=require`, newer `pg-connection-string` parses it as `verify-full` semantics (the warning printed in the logs explicitly says so). Node's default CA store doesn't trust DO's intermediate CA, so connections fail with `SELF_SIGNED_CERT_IN_CHAIN`. The `ssl: { rejectUnauthorized: false }` option in `typeorm.config.ts` is supposed to override this, but the URL-derived `ssl` config wins. Fix: change the URL to `?sslmode=no-verify` (libpq-compatible: skip cert verification). Long-term fix: install the DO Postgres CA bundle and switch to `sslmode=verify-full`.

**Joi rejects mock external-service keys in production.** `validation.ts` explicitly invalidates `sk_test_mock`, `whsec_mock`, and `SG.mock` when `NODE_ENV=production`. This is a deliberate safety net. To boot without real Stripe/SendGrid keys, use any *other* placeholder string — they don't have to be real, just not in the blocklist.

**Swagger blocked by CSP `script-src 'self'`.** Helmet's default CSP forbids inline scripts. Swagger UI's HTML loader uses inline `<script>` to bootstrap. Fix: when `ENABLE_SWAGGER=true`, relax CSP to include `'unsafe-inline'` for `script-src` and `script-src-attr`.

**Swagger blocked by `upgrade-insecure-requests` over plain HTTP.** Once Swagger was past CSP, asset loads still failed with `ERR_SSL_PROTOCOL_ERROR`. Helmet's default CSP includes `upgrade-insecure-requests`, which tells the browser to fetch every sub-resource over HTTPS. The dev API was on plain HTTP at the time, so this broke every asset. Temporary fix: drop the directive while serving over HTTP. Permanent fix: keep it enabled now that Cloudflare provides HTTPS in front.

**DO HTML5 console fails after SSH lockdown.** The browser console uses the SSH backend; once `PermitRootLogin=no` is in `sshd_config`, the console can no longer log in as root. Workaround for one-off root tasks: use the `deploy` user with a Docker-escalated sudo rule (see §4.5).

**Container restart vs recreate.** `docker compose restart` does NOT re-read `env_file`. `docker compose up -d` DOES (it recreates the container if any config changed). Always use `up -d` after editing an `.env`.

**Compose project name namespacing.** Without `-p <name>`, docker compose derives a project name from the directory. Moving config files between directories changes that, leading to orphaned networks and containers. We pin the project name explicitly: `-p ios-lms-prod`, `-p ios-lms-dev`, `-p ios-lms-caddy`.

---

## 13. Files in the repo relevant to deployment

```
Dockerfile                                # Multi-stage production build (deps → builder → runner)
docker-compose.droplet.yml                # Template for both env stacks (parameterized via .env)
docker-compose.yml                        # Local development stack (Postgres + Redis + MinIO + API)
docker-compose.test.yml                   # Test stack
docker/entrypoint.sh                      # Container entrypoint: migrations + exec node

.github/workflows/deploy.yml              # Manual GHCR build + Droplet deploy workflow

scripts/droplet-bootstrap.sh              # One-time: install Docker, deploy user, UFW
scripts/droplet-lockdown.sh               # One-time: disable root SSH + password auth
scripts/droplet-multi-env-migrate.sh      # One-time: split /opt/ios-lms/ into prod/ + dev/
scripts/caddy/Caddyfile                   # Caddy reverse-proxy config
scripts/caddy/docker-compose.yml          # Caddy stack

src/main.ts                               # Helmet/CSP, Swagger gating
src/config/validation.ts                  # Joi env-validation schema (incl. ENABLE_SWAGGER, STORAGE_KEY_PREFIX)
src/database/config/typeorm.config.ts     # DataSource used by both runtime and migrations
src/modules/storage/storage.service.ts    # S3 adapter, applies STORAGE_KEY_PREFIX

docs/DEPLOYMENT.md                        # This document
```

---

## 14. Quick reference: deploying

1. Push code (any branch).
2. https://github.com/adamhiberios/IOS_Backend/actions → **Deploy** → **Run workflow**.
3. Pick branch + `environment` (`prod` or `dev`) + optional `ref` (commit SHA or tag).
4. Click **Run workflow**.
5. Wait for both jobs (`build-push` then `deploy`) to go green. Health check passes the workflow.
6. Verify in browser: https://api.instituteofscrum.org/health or https://api-dev.instituteofscrum.org/health.
