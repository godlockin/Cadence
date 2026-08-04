# syntax=docker/dockerfile:1
# PulseDeck — multi-stage Docker image.
#
#   build:  docker build -t pulsedeck .
#   run:    docker run -p 3000:3000 -e JWT_SECRET=... -e ENCRYPTION_KEY=... pulsedeck
#   compose: docker compose up
#
# The image runs the Node.js runtime (Hono + better-sqlite3). Cloudflare
# Workers deployment is handled separately via `wrangler deploy`.

# ---------- stage 1: dependencies (cache-friendly) ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable

# Build tools for native modules (better-sqlite3 prebuilds cover musl,
# but keep the toolchain available as a fallback).
RUN apk add --no-cache python3 make g++

# Layer 1: manifests only — maximizes layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/executor-pipeline/package.json packages/executor-pipeline/
COPY packages/nodes/package.json packages/nodes/
COPY packages/queue/package.json packages/queue/
COPY packages/scheduler/package.json packages/scheduler/
COPY packages/sinker/package.json packages/sinker/
COPY packages/storage/package.json packages/storage/
COPY packages/ui/package.json packages/ui/

RUN pnpm i --frozen-lockfile

# ---------- stage 2: builder ----------
FROM deps AS builder
COPY . .
# `pnpm build` = turbo run build (api + web + all packages).
RUN pnpm build

# ---------- stage 3: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV PULSEDECK_DB_PATH=/data/pulsedeck.db

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/apps/api/dist apps/api/dist
# Built React frontend → served by node.ts at <api>/dist/static (SPA).
COPY --from=builder /app/apps/web/dist apps/api/dist/static
COPY --from=builder /app/packages ./packages
# pnpm node_modules carries the .pnpm virtual store; workspace links point
# back at /app/packages which we copied above.
COPY --from=builder /app/node_modules ./node_modules

RUN mkdir -p /data
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "apps/api/dist/node.js"]
