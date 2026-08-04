# @cadence/storage

Storage adapter contract + three implementations (InMemory / Sqlite / D1)
for PulseDeck.

PHASE 2 ships:

- `StorageAdapter` contract (`interface.ts`)
- `InMemoryStorageAdapter` (PHASE 1A) — used by sinker unit tests
- `SqliteStorageAdapter` (PHASE 2) — better-sqlite3 + drizzle-orm
- `D1StorageAdapter` (PHASE 2) — Cloudflare D1 + drizzle-orm
- `mappers.ts` — row ↔ domain entity transforms
- `createStorageAdapter` factory

## Contract

The single export is `StorageAdapter` — the shape every implementation must
satisfy. The contract is shaped around `@cadence/domain` entities:

- Tasks (`Task`, `TaskId`) — top-level orchestrator units
- Executions (`Execution`, `ExecutionId`) — single task-run instances
- Users (`User`, `UserId`) — auth subjects with RBAC roles
- Groups (`Group`, `GroupId`) — RBAC scopes
- Credentials (`Credential`, `CredentialId`) — encrypted secrets
- Tags (`Tag`, `TagId`) — many-to-many labels on tasks
- AuditLog (`AuditLog`) — immutable append-only ledger

### Locking & soft delete

- **Optimistic locking** on Tasks + Executions via `expectedVersion` —
  adapter throws `StaleVersionError` on mismatch. Callers must re-fetch
  - retry.
- **Soft delete** on Tasks only: `deleteTask(id, expectedVersion)` sets
  `deleted_at = now`. `listTasks` excludes soft-deleted unless
  `includeDeleted: true`. All other entities use hard delete.
- **Append-only** on AuditLog: duplicate `id` → `ConflictError`.

### Filter shape

Every list method accepts a typed filter (see `interface.ts`):

| Filter             | Fields                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `TaskFilter`       | ownerId, groupId, status, payloadKind, triggerKind, tags[], q, limit, offset, includeDeleted |
| `ExecutionFilter`  | taskId, status, triggerSource, from, to, limit, offset                                       |
| `UserFilter`       | role, email, limit, offset                                                                   |
| `GroupFilter`      | ownerId, limit, offset                                                                       |
| `CredentialFilter` | ownerId, kind, limit, offset                                                                 |
| `TagFilter`        | name, limit, offset                                                                          |
| `AuditFilter`      | resourceKind, resourceId, actorId, action, from, to, limit, offset                           |

A `SortClause` array can be passed to `listTasks` / `listExecutions` to
override the default `createdAt desc` order.

## Implementations

| Adapter                  | Runtime | Status       | Use when                                                  |
| ------------------------ | ------- | ------------ | --------------------------------------------------------- |
| `InMemoryStorageAdapter` | any     | **PHASE 1A** | unit tests, local dev, CI                                 |
| `SqliteStorageAdapter`   | Node    | **PHASE 2**  | self-hosted single-node deploy (better-sqlite3 + drizzle) |
| `D1StorageAdapter`       | Workers | **PHASE 2**  | Cloudflare edge deploy (D1 + drizzle)                     |

Sqlite + D1 share a single SQL dialect + a single migration set (owned by
`@cadence/db`). The only difference is the underlying driver.

## Usage

```ts
import { createStorageAdapter } from '@cadence/storage'

// in tests / dev:
const storage = createStorageAdapter({ kind: 'memory' })

// on Node.js (PHASE 2):
const storage = createStorageAdapter({ kind: 'sqlite', db: openSqlite() })

// on Cloudflare Workers (PHASE 2):
const storage = createStorageAdapter({ kind: 'd1', binding: env.PULSEDECK_DB })
```

Every write goes through the adapter; the contract guarantees
`await storage.migrate()` has run before any read/write.

## Test usage

The in-memory adapter is the unit-test substrate for downstream packages:

```ts
// in sinker.test.ts
import { InMemoryStorageAdapter } from '@cadence/storage'

const storage = new InMemoryStorageAdapter()
await storage.migrate()

await storage.saveTask({
  id: ulid() as TaskId,
  name: 'demo',
  // ...rest of Task shape
})
```

## Optimistic-lock pattern (caller side)

```ts
const task = await storage.getTask(id)
if (!task) throw new Error('missing')

try {
  const updated = await storage.updateTask(id, {
    expectedVersion: task.version,
    status: 'running',
  })
} catch (e) {
  if (e instanceof StaleVersionError) {
    // re-fetch + retry, or surface conflict to UI
  } else {
    throw e
  }
}
```

## Audit pattern

```ts
import { AuditLogSchema } from '@cadence/domain'

await storage.appendAudit(
  AuditLogSchema.parse({
    id: crypto.randomUUID(),
    action: 'task.update',
    actorId: currentUser.id,
    resourceKind: 'task',
    resourceId: task.id,
    diffJson: JSON.stringify({ before: prev, after: next }),
    metadataJson: '{}',
    createdAt: Date.now(),
  }),
)
```

Audit rows are append-only — duplicate `id` → `ConflictError`.

## Migration strategy (PHASE 2)

Schema management for Sqlite + D1 adapters is owned by `@cadence/db`:

1. `packages/db/src/schema.ts` — drizzle schema (single source of truth)
2. `packages/db/migrations/sqlite/0000_init.sql` — initial SQL
3. `packages/db/src/migrate.ts` — `migrate(db)` (better-sqlite3) + `migrateD1(binding)` (D1)
4. `storage.migrate()` invokes the runner at startup; idempotent via a
   `schema_migrations` ledger with sha256 checksums

The InMemory adapter's `migrate()` is a no-op. Its tests share the same
fixtures as the SQL adapters so schema drift is impossible.

## Verification

```bash
pnpm --filter @cadence/storage build       # tsc → dist/
pnpm --filter @cadence/storage lint        # eslint, max-warnings 0
pnpm --filter @cadence/storage type-check  # tsc --noEmit
pnpm --filter @cadence/storage test        # vitest run
```

Tests live in `test/{in-memory,sqlite,d1}.test.ts` and cover every public
method on each adapter plus all filter combinations, pagination edges,
optimistic-locking, soft-delete semantics, and tag junction cascades.
All three suites share the same fixtures so behavior drift between
adapters becomes obvious in CI.

## VERSION

`0.2.0` — interface + InMemory (PHASE 1A) + Sqlite/D1 with migrations (PHASE 2).
