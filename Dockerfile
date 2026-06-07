# syntax=docker/dockerfile:1.6
# =============================================================================
# IOS LMS API — Multi-stage Dockerfile
#
# Strategy:
#   1. deps     → install prod dependencies into a minimal layer (cached often)
#   2. builder  → install all deps + compile TypeScript with nest build
#   3. runner   → slim final image: only dist + prod node_modules + non-root user
#
# The runner image is what ships to staging and production. Same image, same
# behaviour everywhere — environment is injected via env vars at runtime.
# =============================================================================

ARG NODE_VERSION=20.18-alpine

# ─── Stage 1: production dependencies only ──────────────────────────────────
FROM node:${NODE_VERSION} AS deps

WORKDIR /app

# Alpine needs build tools for native modules (bcrypt, etc.)
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && ln -sf python3 /usr/bin/python

COPY package.json package-lock.json ./

# Install only production dependencies. Use npm ci for reproducible builds.
RUN npm ci --omit=dev --no-audit --no-fund \
  && apk del .build-deps

# ─── Stage 2: builder (all deps + compile) ──────────────────────────────────
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && ln -sf python3 /usr/bin/python

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source last so dependency layers cache properly
COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build \
  && apk del .build-deps

# ─── Stage 3: production runtime ────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner

# Install runtime utilities only. wget for healthcheck, tini for proper signal
# handling (PID 1 SIGTERM forwarding to Node).
RUN apk add --no-cache wget tini

WORKDIR /app

# Non-root user. The `node` user already exists in the official image (uid 1000).
ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_LOGLEVEL=warn

COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
COPY                --chown=node:node package.json      ./
COPY                --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# tini is PID 1 and forwards signals to the entrypoint, which runs migrations
# then execs node (so node becomes PID of the actual app under tini).
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
