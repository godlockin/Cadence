# PulseDeck

> Self-hosted scheduled-task orchestration platform. TypeScript everywhere.  
> Dual-runtime: Cloudflare Workers (Hono + D1) **or** Node.js (better-sqlite3).

## Why

Combine the ergonomics of n8n / Zapier-style visual pipelines with the
determinism of cron / queue systems, deployable to either a serverless edge
or a long-lived Node process — without rewriting the app.

## Requirement → Solution

| #   | Requirement                                                                 | Solution                                                       |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | 6-node pipeline (trigger → fetch → transform → condition → action → output) | `@pulsedeck/pipeline` enforces DAG topology                    |
| 2   | 30+ built-in nodes covering common integrations                             | `@pulsedeck/nodes` ships 30 nodes grouped by the 6 kinds       |
| 3   | Cron + webhook + manual triggers                                            | `@pulsedeck/scheduler` (cron-parser) + Worker DO Alarm adapter |
| 4   | JWT + RBAC + encrypted secrets                                              | `@pulsedeck/auth` (Argon2id, jose JWT, AES-256-GCM)            |
| 5   | Dual deployment (Cloudflare + Node)                                         | `apps/api` exposes both `worker.ts` and `node.ts` entries      |

## Architecture

```
+---------------------+        +-------------------------+
| apps/web (React 19) | <----> | apps/api (Hono)         |
|                     |        |   ├── src/worker.ts     |  <-- Cloudflare Workers + D1
|                     |        |   └── src/node.ts       |  <-- Node.js + better-sqlite3
+---------------------+        +-----------+-------------+
                                            |
                       +--------------------+--------------------+
                       |                                         |
                       v                                         v
              +-------------------+                   +------------------------+
              | @pulsedeck/scheduler|                | @pulsedeck/pipeline    |
              |  cron + DO alarm    |                |  6-node DAG executor   |
              +---------+----------+                   +----------+-------------+
                        |                                         |
                        v                                         v
              +--------------------+                +-------------------------+
              | @pulsedeck/storage | <------------- | @pulsedeck/nodes (30)   |
              |  D1 / SQLite adapter|               +-------------------------+
              +---------+----------+
                        |
                        v
              +--------------------+
              | @pulsedeck/db      |  drizzle schemas
              +--------------------+
```

## Repo Layout

```
apps/
  web/        React 19 + Vite 6
  api/        Hono (worker + node entry)
packages/
  domain/     Zod schemas (single source of truth)
  storage/    StorageAdapter interface (D1 + SQLite implementations)
  pipeline/   6-node DAG executor
  nodes/      30 built-in nodes
  scheduler/  cron-parser + Durable Object alarm
  auth/       Argon2id + JWT + AES-256-GCM
  db/         drizzle schema + migrations
  ui/         shared React components
```

## Develop

Requires Node.js >= 20 and pnpm >= 10.

```bash
nvm use            # picks .nvmrc (20)
pnpm i             # install workspace deps
pnpm dev           # api + web + scheduler (concurrent)
pnpm build         # turbo run build
pnpm lint          # ESLint flat config
pnpm type-check    # tsc --noEmit
pnpm test          # Vitest
pnpm format        # Prettier
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
