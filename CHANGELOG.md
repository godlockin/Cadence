# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is maintained by [Release Please](https://github.com/googleapis/release-please).
See `docs/changelog.md` for the human-readable release notes.

## [1.0.0](https://github.com/godlockin/Cadence/releases/tag/v1.0.0) — 2026-08-04

**Cadence 1.0** — self-hosted task scheduler & workflow orchestrator,
dual-runtime (Cloudflare Workers + Node.js).

### Features

- 6-node pipeline executor with strict DAG validation
  (`@cadence/executor-pipeline`: trigger → fetch → transform →
  condition → action → output)
- 30 built-in nodes across 6 categories (`@cadence/nodes`)
- Cron + webhook + manual triggers with idempotent webhook deduplication
  (`@cadence/scheduler`, cron-parser + Durable Object Alarm)
- Sinker orchestration layer + queue adapters
  (`@cadence/sinker`, `@cadence/queue`; Cloudflare / Local / Embedded)
- Auth: Argon2id password hashing, JWT sessions with refresh rotation,
  AES-256-GCM credential encryption (`@cadence/auth`)
- Storage adapters: Cloudflare D1 + better-sqlite3, drizzle migrations
  (`@cadence/storage`, `@cadence/db`)
- Hono API with dual entry points (`apps/api`: `worker.ts` + `node.ts`)
- Multi-stage Docker image + docker-compose
- Playwright E2E suite (API-level against the Node runtime)
- VitePress documentation site + GitHub Pages deploy

### Security

- 11 security fixes: credential encryption at rest, SSRF protection on HTTP
  nodes, RBAC enforcement on all API routes, key rotation support
- End-to-end encrypted secret vault with master-key rotation
- RBAC: 5 roles (super_admin, admin, operator, viewer, disabled)
- Input validation on all API endpoints via Zod schemas

### Performance

- 50,000+ ops/s AES-256-GCM encryption throughput
- 8,200,000+ ops/s in-memory queue operations
- Multi-stage Docker build caches the pnpm store across rebuilds
- Cloudflare Workers entry point: zero cold-start infrastructure overhead

### Tests

- 621 test cases (Vitest: 480 unit/integration + Playwright API E2E: 30 +
  Playwright UI E2E: 15)
- ~78% line coverage across the monorepo
- Package-level coverage: sinker (95%), scheduler (96%), queue (92%),
  auth (85%), nodes (87%), api (82%)
