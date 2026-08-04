# Cadence Implementation Plan

Cadence is built in **9 sequential PHASES**. Each phase ships behind a
verification gate (lint / type-check / build / test).

| #   | Phase                                   | Deliverable                                          | Gate                                    |
| --- | --------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| 0   | **Monorepo skeleton + toolchain**       | pnpm workspace, turbo, eslint, prettier, husky, ci   | clone + `pnpm i` + `pnpm build` succeed |
| 1   | Domain models + Zod contracts           | `@Cadence/domain` complete entities + schemas        | `pnpm type-check`                       |
| 2   | Storage adapters (D1 + better-sqlite3)  | `@Cadence/storage` impl, migrations                  | vitest tests pass                       |
| 3   | Auth (Argon2id + JWT + AES)             | `@Cadence/auth` impl + tests                         | vitest tests pass                       |
| 4   | Pipeline executor (sub-package)         | `@Cadence/executor-pipeline` impl + DAG validator    | vitest tests pass                       |
| 5   | Sinker abstraction layer (orchestrator) | `@Cadence/sinker` engine + `@Cadence/queue` adapters | vitest tests pass                       |
| 6   | 30 built-in nodes                       | `@Cadence/nodes` impl, grouped by 6 kinds            | vitest tests pass                       |
| 7   | Scheduler (cron + DO alarm)             | `@Cadence/scheduler` impl                            | vitest tests pass                       |
| 8   | API (Hono, dual entry)                  | `apps/api` routes + auth middleware                  | build + manual smoke                    |
| 9   | Web (React 19 + Vite)                   | `apps/web` editor + dashboard                        | playwright e2e                          |
| 10  | Release hardening                       | docs, deploy guides, security audit                  | all gates green                         |

## Architecture (after PHASE 0 adjustment)

```
apps/
  api/          Hono backend, dual runtime (worker + node)
  web/          React 19 + Vite frontend
packages/
  domain/       Zod schemas + entity types (single source of truth)
  sinker/       Top-level orchestrator (task lifecycle + queue dispatch)
  queue/        QueueAdapter port (Cloudflare / Local / Embedded)
  executor-pipeline/  PipelineRunner implementation (sub-package of sinker)
  storage/      D1 + better-sqlite3 adapters
  auth/         Argon2id + JWT + AES
  scheduler/    Cron + DO alarm
  nodes/        30 built-in nodes, 6 kinds
  db/           Drizzle schemas + migrations
  ui/           shared React primitives
```

Dependency chain:

```
apps/api -> { sinker, queue, scheduler, storage, auth, db, executor-pipeline, domain, nodes }
            sinker -> { domain, executor-pipeline }
            queue  -> { sinker }
            executor-pipeline -> { domain }
            nodes  -> { domain, executor-pipeline }
            scheduler -> { domain, storage }
            storage -> { domain }
            auth   -> { domain }
            db     -> { domain }
```

## Current Status

**PHASE 0–7** — ✅ all code complete:

- PHASE 0 skeleton + toolchain (pnpm workspace, turbo, eslint, prettier, husky, CI)
- PHASE 1 domain + Zod contracts
- PHASE 2 storage adapters (D1 + better-sqlite3) + migrations
- PHASE 3 auth (Argon2id + JWT + AES)
- PHASE 4 executor-pipeline (6-node DAG)
- PHASE 5 sinker orchestrator + queue adapters
- PHASE 6 30 built-in nodes
- PHASE 7 scheduler (cron + DO alarm)

**PHASE 8** — API (Hono, dual entry) ✅ + **PHASE 9** — Web (React 19 + Vite) ✅.
**PHASE 10** — Release hardening: docs, deploy guides, security audit — in progress (this file).

## Deployment Checklist

- [ ] wrangler.toml 配 D1/KV/Queue/Secrets
- [ ] pnpm dev 本地 4 进程启动 OK
- [ ] pnpm start 生产模式启动 OK
- [ ] Docker-compose 跑通
- [ ] wrangler deploy 成功
- [ ] /health 返回 ok
- [ ] README + LICENSE + VitePress docs 可访问
