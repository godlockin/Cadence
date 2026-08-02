# Architecture

PulseDeck ships as a TypeScript monorepo with two deployment targets that share
the **same domain code**.

## Borrowed vs. Built-from-Scratch

| Concept               | Borrowed                 | Built-from-scratch              |
| --------------------- | ------------------------ | ------------------------------- |
| HTTP framework        | Hono (Cloudflare + Node) | —                               |
| ORM                   | drizzle                  | —                               |
| Validation            | Zod                      | —                               |
| JWT                   | jose                     | —                               |
| Password hash         | argon2                   | —                               |
| Cron parsing          | cron-parser              | —                               |
| Pipeline DAG executor | —                        | `@pulsedeck/pipeline` (PHASE 4) |
| 30 built-in nodes     | —                        | `@pulsedeck/nodes` (PHASE 5)    |
| Storage abstraction   | —                        | `@pulsedeck/storage` (PHASE 2)  |

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
                 | @pulsedeck/storage |   StorageAdapter interface
                 |  -> D1Adapter      |
                 |  -> SQLiteAdapter  |
                 +---------+-----------+
                           |
                           v
                 +---------------------+
                 | @pulsedeck/domain   |   Zod schemas (single source)
                 +---------------------+
```

## Scheduling

- **Node runtime**: cron-parser drives a polling loop, reads due rows from storage.
- **Cloudflare runtime**: a Durable Object holds the alarm; one DO per active
  schedule. Alarm fires → enqueue → pipeline executor → write results to D1.

Both code paths call into the same `@pulsedeck/pipeline` executor.
