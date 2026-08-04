# @cadence/sinker

> Top-level orchestrator for PulseDeck tasks.
> The single point of decision for "when should this task run, who runs it, and how do we record what happened".

---

## Overview

A **Task** is the unified object (cron / manual / webhook / event triggers, pipeline / command / http / script / webhook payloads, success / failure / cancel outcomes — all attached to the same row).
The **sinker** is the engine that drives Tasks through their lifecycle.

Two pieces:

1. **`SinkerEngine`** — public API. Persists executions, drives the state machine, hands work to a queue.
2. **`PayloadDispatcher` + 5 built-in `PayloadHandler`s** — the payload half. Picks the right handler for a task's `payload_kind` and runs it.

The split is deliberate: the engine never knows about HTTP or shell; the dispatcher never knows about queues or cron. Both pieces are pure TS, no runtime dependencies beyond `zod` and `ulid`.

---

## Installation

Workspace-managed. Already linked at `apps/api` and `apps/web`. No additional steps.

---

## State machine

```
                  register
                    │
                    ▼
                 ┌────────┐  enable   ┌──────────┐
                 │pending │ ────────▶ │scheduled │
                 └────────┘           └──────────┘
                    │  ▲                │  ▲  │
                    │  │ disable        │  │  │ suspend
              suspend│  └────────────────┘  │  │
                    ▼                       ▼  │
                 ┌──────────┐              ┌──────────┐
                 │suspended │ ──resume───▶ │scheduled │
                 └──────────┘              └──────────┘
                                               │
                                          enqueue
                                               ▼
                                         ┌────────┐
                                         │ queued │
                                         └────────┘
                                               │ dispatch
                                               ▼
                                       ┌────────────┐
                                       │ dispatched │
                                       └────────────┘
                                               │ start
                                               ▼
                                         ┌────────┐
                                         │running │ ─succeed─▶ success (terminal)
                                         └────────┘
                                               │ fail
                                               ▼
                                          failed (retry)
                                               │ retry
                                               ▼
                                          queued
```

Any non-listed transition throws `StateTransitionError`. Terminal states (`success`, `cancelled`) accept no further events; `failed` is terminal-ish and only the `retry` event is legal.

---

## Public surface

```ts
import {
  SinkerEngine,
  PayloadDispatcher,
  HttpHandler,
  CommandHandler,
  ScriptHandler,
  PipelineHandler,
  WebhookHandler,
  JsonLogger,
} from '@cadence/sinker'
```

| Symbol              | Kind        | What it does                                                  |
| ------------------- | ----------- | ------------------------------------------------------------- |
| `SinkerEngine`      | class       | Trigger / suspend / resume / cancel / status / `workerLoop`.  |
| `PayloadDispatcher` | class       | Register handlers, dispatch by `payload_kind`.                |
| `HttpHandler`       | class       | Runs `fetch()` with timeout, honours AbortSignal.             |
| `CommandHandler`    | class       | `spawn(cmd, args)` in a child process. CF throws 422.         |
| `ScriptHandler`     | class       | Runs JS in a `worker_thread`. CF throws 422.                  |
| `PipelineHandler`   | class       | Topological execution of node specs; pluggable runner.        |
| `WebhookHandler`    | class       | Builds + tracks the public URL. Inbound triggers call engine. |
| `JsonLogger`        | class       | Structured single-line JSON logger.                           |
| `BufferedLogger`    | class       | Capture-in-memory logger for tests.                           |
| `detectRuntime`     | function    | `'local'` or `'cloudflare'` based on globals.                 |
| `TASK_EVENTS`       | const array | 13 events accepted by the state machine.                      |
| `TRANSITIONS`       | const table | Adjacency map used by `nextState()`.                          |

---

## Minimal usage

```ts
import {
  SinkerEngine,
  PayloadDispatcher,
  HttpHandler,
  CommandHandler,
  PipelineHandler,
  WebhookHandler,
  ScriptHandler,
  JsonLogger,
} from '@cadence/sinker'

const logger = new JsonLogger({ scope: 'sinker-demo' })
const dispatcher = new PayloadDispatcher({ logger })
  .register(new HttpHandler())
  .register(new CommandHandler())
  .register(new ScriptHandler())
  .register(new PipelineHandler())
  .register(new WebhookHandler())

const engine = new SinkerEngine({
  storage, // implements getTask / createExecution / patchExecution / ...
  queue, // implements enqueue / dequeue / size
  executor, // usually just `dispatcher.dispatch.bind(dispatcher)` wrapped
  scheduler, // cron / DO alarm adapter
  notifier, // webhook / email / etc.
  logger,
  dispatcher,
  runtime: 'local',
})

/* 1. fire-and-forget trigger */
const executionId = await engine.trigger(taskId, { source: 'manual' })

/* 2. lifecycle */
await engine.suspend(taskId, 'maintenance window')
await engine.resume(taskId)

/* 3. kill in-flight work */
await engine.cancel(executionId, 'cancelled by user')

/* 4. start a worker (one per CPU / per CF isolate) */
const ac = new AbortController()
process.once('SIGINT', () => ac.abort())
await engine.workerLoop('worker-1', ac.signal)
```

The engine does **not** re-implement the DAG. `PipelineHandler` accepts a pluggable `runner`; the host app should call `setRunner(realPipelineRunner)` to wire the real `@cadence/executor-pipeline` package.

---

## Boundaries

| This package does                                               | This package does **not** do                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| Persist executions, drive state machine, hand off to the queue. | Implement cron evaluation (that's `@cadence/scheduler`).        |
| Validate + run a payload (one of 5 kinds).                      | Implement the actual DAG (that's `@cadence/executor-pipeline`). |
| Cancel in-flight work via `AbortController`.                    | Own the HTTP server (the host app does that).                   |
| Surface structured events through the logger.                   | Send notifications (the host wires `notifier`).                 |

The split is enforced by imports: `@cadence/sinker` depends on `@cadence/domain` and `zod` only. No circular deps.

---

## Error model

| Error                    | When                                            |
| ------------------------ | ----------------------------------------------- |
| `TaskNotFoundError`      | Trigger / suspend / resume on a missing task.   |
| `StateTransitionError`   | Illegal state transition.                       |
| `HandlerNotFoundError`   | Dispatcher has no handler for a `payload_kind`. |
| `PayloadValidationError` | `payload_json` is invalid (parse or schema).    |
| `ForbiddenError`         | IDOR guard — non-owner triggered a task.        |
| `NodeOnlyError`          | `CommandHandler` / `ScriptHandler` on CF.       |
| `CommandInjectionError`  | `CommandHandler` sandbox rejected config.       |
| `SSRFError`              | `HttpHandler` blocked a host (private IP etc.). |
| `ScriptSandboxError`     | `ScriptHandler` static scan rejected source.    |

All errors extend `Error` and have a stable `name`. Workers can match on `name` to decide whether to retry or surface a 4xx to the caller.

---

## Integration testing

End-to-end tests under `test/integration/` wire the real SinkerEngine
against the PHASE 2 `StorageAdapter` contract and the real
`EmbeddedQueueAdapter`. Each scenario spins up a fresh harness with:

- `SinkerStorageAdapter` (bridge) → `@cadence/storage` `InMemoryStorageAdapter`
- `EmbeddedQueueAdapter` (engine controls `dequeue()`)
- `FakeExecutor` (scriptable, no external IO)
- `FakeScheduler` / `FakeNotifier` / `BufferedLogger`
- `PayloadDispatcher` with all 5 built-in handlers registered

The worker loop runs in the background; `runUntilDrained()` blocks
until the queue is empty, then assertions fire. Per-case timeout is
10s. Scenarios cover HTTP / command / pipeline / webhook happy paths,
fail + retry, suspend + resume, cancel, concurrent triggers, audit,
and optimistic locking.

```bash
pnpm test:integration   # integration scenarios only
pnpm test               # unit + integration
```

## Wiring a real storage adapter

`@cadence/sinker` was designed against a lean port (6 methods on
`StorageAdapter`). The PHASE 2 storage package ships a richer
contract; the bridge in `test/fixtures/sinker-storage-bridge.ts`
shows how to translate. For production wiring, copy the bridge and
point it at your adapter of choice:

```ts
import { SinkerEngine, PayloadDispatcher, BufferedLogger } from '@cadence/sinker'
import { SinkerStorageAdapter } from './sinker-storage-bridge.js' // your copy
import { EmbeddedQueueAdapter } from '@cadence/queue'
import { InMemoryStorageAdapter } from '@cadence/storage'

const storage = new SinkerStorageAdapter(new InMemoryStorageAdapter())
const queue = new EmbeddedQueueAdapter()
const logger = new BufferedLogger()
const dispatcher = new PayloadDispatcher({ logger })
  .register(new HttpHandler())
  .register(new CommandHandler())
  .register(new PipelineHandler())
  .register(new ScriptHandler())
  .register(new WebhookHandler())

const engine = new SinkerEngine({
  storage,
  queue,
  executor: dispatcher.dispatch.bind(dispatcher),
  scheduler: yourScheduler,
  notifier: yourNotifier,
  logger,
  dispatcher,
  runtime: 'local',
})
```

To use the real `SqliteStorageAdapter` (PHASE 2A+), swap the inner
adapter:

```ts
import Database from 'better-sqlite3'
import { SqliteStorageAdapter } from '@cadence/storage'

const db = new Database(process.env.DB_PATH ?? ':memory:')
const storage = new SinkerStorageAdapter(new SqliteStorageAdapter(db))
await storage.migrate() // applies migrations from @cadence/db
```

The bridge only depends on the `StorageAdapter` port, so any
PHASE 2-compliant adapter (InMemory, Sqlite, D1) drops in without
changes to the engine or the test code.

---

## Versioning

- `SINKER_VERSION` — string. Bumped on every API change.
- PHASE 1 ships `0.1.0`.
