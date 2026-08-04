# Architecture

Cadence ships as a TypeScript monorepo with two deployment targets that share
the **same domain code**.

## Borrowed vs. Built-from-Scratch

| Concept               | Borrowed                 | Built-from-scratch            |
| --------------------- | ------------------------ | ----------------------------- |
| HTTP framework        | Hono (Cloudflare + Node) | —                             |
| ORM                   | drizzle                  | —                             |
| Validation            | Zod                      | —                             |
| JWT                   | jose                     | —                             |
| Password hash         | argon2                   | —                             |
| Cron parsing          | cron-parser              | —                             |
| Pipeline DAG executor | —                        | `@Cadence/executor-pipeline`  |
| Task orchestration    | —                        | `@Cadence/sinker` (top-level) |
| Queue port            | —                        | `@Cadence/queue`              |
| 30 built-in nodes     | —                        | `@Cadence/nodes`              |
| Storage abstraction   | —                        | `@Cadence/storage`            |

## Layering

`sinker` is the **top-level orchestrator**: it owns the task lifecycle (state
machine), the queue handoff, and execution dispatch. It composes the
`executor-pipeline` (6-node DAG runner), the `queue` adapter port, and the
`nodes` catalog. The API (`apps/api`) and scheduler (`@Cadence/scheduler`)
talk to `sinker`, never to the leaf packages directly.

```
apps/api (Hono, dual runtime)
   └─> @Cadence/sinker          ← top-level orchestrator (state machine + dispatch)
         ├─> @Cadence/executor-pipeline   (6-node DAG executor)
         ├─> @Cadence/queue               (QueueAdapter port: Cloudflare/Local/Embedded)
         └─> @Cadence/nodes               (30 built-in nodes, 6 kinds)
apps/web (React 19) ────────────────────┘
   every layer ──> @Cadence/domain       (Zod schemas, single source of truth)
   persistence ──> @Cadence/storage ──> @Cadence/db (drizzle + migrations)
```

## Dual Runtime

```
             +------------- main HTTP surface ------------+
             |                                            |
             v                                            v
   +-------------------+                       +-----------------------+
   |  Cloudflare       |                       |  Node.js              |
   |  Worker (Hono)    |                       |  process (Hono)       |
   |  + D1 binding     |                       |  + better-sqlite3     |
   +---------+---------+                       +----------+------------+
             |                                           |
             +-------------+-----------------------------+
                           |
                           v
                 +---------------------+
                 | @Cadence/storage |   StorageAdapter interface
                 |  -> D1Adapter      |
                 |  -> SQLiteAdapter  |
                 +---------+-----------+
                           |
                           v
                 +---------------------+
                 | @Cadence/domain   |   Zod schemas (single source)
                 +---------------------+
```

## Scheduling

- **Node runtime**: cron-parser drives a polling loop inside
  `@Cadence/scheduler` (`SchedulerHandle`), reads due rows from storage, and
  hands them to the `sinker` trigger path.
- **Cloudflare runtime**: a Durable Object holds the alarm; one DO per active
  schedule. Alarm fires → enqueue → `sinker` → `executor-pipeline` → write
  results to D1.

Both code paths call into the same `sinker` / `executor-pipeline` engine.
