/**
 * @cadence/storage — D1StorageAdapter unit tests.
 *
 * Uses a hand-rolled in-memory D1 binding backed by better-sqlite3.  This
 * gives us a faithful async D1 surface (prepare/bind/run/all/raw/first
 * + batch + exec) without pulling in @miniflare/d1.
 *
 * Drizzle's D1 driver calls `.raw()` on the bound statement, so the mock
 * must return 2D arrays in the same column order drizzle expects.  We
 * parse the SELECT list out of the SQL with a regex to know the order.
 *
 * Mirror of the in-memory and sqlite suites — same fixtures, same
 * expectations, so a behavior drift between adapters becomes obvious.
 */

import {
  AuditLogSchema,
  ExecutionSchema,
  GroupSchema,
  RoleSchema,
  TagSchema,
  TaskSchema,
  UserSchema,
} from '@cadence/domain'
import type {
  AuditLog,
  Credential,
  Execution,
  ExecutionId,
  Group,
  Tag,
  Task,
  TaskId,
  User,
} from '@cadence/domain'
import { ulid } from './ulid.js'
import {
  ConflictError,
  D1StorageAdapter,
  NotFoundError,
  StaleVersionError,
  type D1Binding,
} from '../src/index.js'
import type { ExecutionPatch, TaskPatch } from '@cadence/domain'
import Database from 'better-sqlite3'

/* -------------------------------------------------------------------------
 * D1 mock — backs onto better-sqlite3, exposes D1 surface only
 *
 * The non-trivial bit is `.raw()`: drizzle's D1 session calls this on the
 * bound statement and expects `unknown[][]` in the same column order as
 * the SELECT list.  We parse the column list out of the SQL with a regex.
 * ------------------------------------------------------------------------- */

type D1Row = Record<string, unknown>

interface D1MockStatement {
  bind(...params: unknown[]): D1MockStatement
  run<T = D1Row>(): Promise<{ success: boolean; meta: { changes: number } }>
  all<T = D1Row>(): Promise<{ results: T[]; success: boolean }>
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]>
  first<T = D1Row>(colName?: string): Promise<T | null>
}

function parseSelectColumns(sql: string): string[] {
  // extract `select <cols> from <table>` columns; tolerates newlines + AS
  const m = /^\s*select\s+([\s\S]+?)\s+from\b/i.exec(sql)
  if (m === null) return []
  const colsRaw = m[1] ?? ''
  return colsRaw
    .split(',')
    .map((c) => {
      // take the last identifier (`table.col AS alias` → alias; `col` → col)
      const trimmed = c.trim()
      // strip table qualifiers
      const parts = trimmed.split(/\s+/)
      const last = parts[parts.length - 1] ?? ''
      // strip alias quotes/backticks
      return last.replace(/[`"[\]]/g, '').replace(/^.*\./, '')
    })
    .filter((c) => c.length > 0 && c !== '*')
}

export function makeD1Mock(): D1Binding {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')

  const statement = (sql: string): D1MockStatement => {
    let bound: unknown[] = []
    const stmt: D1MockStatement = {
      bind(...params: unknown[]) {
        bound = params
        return this
      },
      async run() {
        const res = execSql(db, sql, bound)
        return { success: true, meta: { changes: res.changes } }
      },
      async all() {
        const res = execSql(db, sql, bound)
        return { results: (res.rows ?? []) as never, success: true }
      },
      async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
        const res = execSql(db, sql, bound)
        const rows = (res.rows ?? []) as Record<string, unknown>[]
        const cols = parseSelectColumns(sql)
        const values = rows.map((r) => cols.map((c) => r[c] ?? null))
        if (options?.columnNames === true) {
          return [cols, ...values] as [string[], ...T[]]
        }
        return values as T[]
      },
      async first<T = D1Row>(colName?: string) {
        const res = execSql(db, sql, bound)
        const rows = res.rows ?? []
        if (rows.length === 0) return null
        const row = rows[0] as Record<string, unknown>
        if (colName !== undefined) return (row[colName] as T) ?? null
        return row as T
      },
    }
    return stmt
  }

  return {
    prepare: (sql: string) => statement(sql),
    batch: async <T>(_statements: readonly unknown[]) => [] as T,
    exec: async (sql: string) => {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
  }
}

function execSql(
  db: Database.Database,
  sql: string,
  bound: unknown[],
): { rows?: Record<string, unknown>[]; changes: number } {
  const trimmed = sql.trim()
  const isSelect = /^select/i.test(trimmed)
  try {
    if (isSelect) {
      const stmtObj = db.prepare(trimmed)
      const rows = stmtObj.all(...(bound as never[])) as Record<string, unknown>[]
      return { rows, changes: 0 }
    }
    const stmtObj = db.prepare(trimmed)
    const info = stmtObj.run(...(bound as never[]))
    return { changes: info.changes }
  } catch (e) {
    if (!isSelect) {
      try {
        db.exec(trimmed)
        return { changes: 0 }
      } catch {
        throw e
      }
    }
    throw e
  }
}

/* -------------------------------------------------------------------------
 * fixtures (same as in-memory + sqlite)
 * ------------------------------------------------------------------------- */

const BASE_TS = 1_700_000_000_000

function makeUser(overrides: Partial<User> = {}): User {
  return UserSchema.parse({
    id: crypto.randomUUID(),
    email: `u${Math.random().toString(36).slice(2, 8)}@example.com`,
    displayName: 'Alice',
    role: 'editor',
    passwordHash: 'hash',
    createdAt: new Date(BASE_TS).toISOString(),
    updatedAt: new Date(BASE_TS).toISOString(),
    ...overrides,
  })
}

function makeGroup(ownerId: string): Group {
  return GroupSchema.parse({
    id: crypto.randomUUID(),
    name: 'team-a',
    description: '',
    ownerId,
    createdAt: new Date(BASE_TS).toISOString(),
    updatedAt: new Date(BASE_TS).toISOString(),
  })
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const created = BASE_TS
  return TaskSchema.parse({
    id: ulid(),
    name: 'hello world',
    description: 'sample',
    owner_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' as TaskId,
    group_id: null,
    payload_kind: 'command',
    payload_json: '{}',
    trigger_kind: 'manual',
    trigger_config_json: '{}',
    status: 'pending',
    cron: null,
    timezone: 'UTC',
    start_at: null,
    end_at: null,
    max_retries: 0,
    retry_backoff: 'exponential',
    concurrency_policy: 'skip',
    jitter_ms: 0,
    timeout_ms: 30000,
    tags: [],
    notifications_json: null,
    metadata_json: '{}',
    version: 1,
    created_at: created,
    updated_at: created,
    deleted_at: null,
    ...overrides,
  })
}

function makeExecution(taskId: TaskId, overrides: Partial<Execution> = {}): Execution {
  const ts = BASE_TS
  return ExecutionSchema.parse({
    id: ulid() as ExecutionId,
    taskId,
    status: 'queued',
    triggerSource: 'manual',
    triggeredBy: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    errorJson: null,
    resultJson: null,
    idempotencyKey: null,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  })
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return TagSchema.parse({
    id: crypto.randomUUID(),
    name: 'urgent',
    color: '#ff0000',
    createdAt: new Date(BASE_TS).toISOString(),
    ...overrides,
  })
}

function makeCredential(ownerId: string): Credential {
  return {
    id: crypto.randomUUID(),
    ownerId,
    name: 'my-key',
    kind: 'api-key',
    ciphertext: 'ct',
    iv: 'iv',
    authTag: 'tag',
    createdAt: new Date(BASE_TS).toISOString(),
  }
}

function makeAudit(overrides: Partial<AuditLog> = {}): AuditLog {
  return AuditLogSchema.parse({
    id: crypto.randomUUID(),
    action: 'task.create',
    actorId: null,
    resourceKind: 'task',
    resourceId: 'r-1',
    diffJson: '{}',
    metadataJson: '{}',
    createdAt: BASE_TS,
    ...overrides,
  })
}

async function makeStorage(): Promise<D1StorageAdapter> {
  const binding = makeD1Mock()
  const s = new D1StorageAdapter(binding)
  await s.migrate()
  return s
}

/* -------------------------------------------------------------------------
 * tests
 * ------------------------------------------------------------------------- */

describe('D1StorageAdapter — lifecycle', () => {
  it('migrate runs without throwing; close is a no-op', async () => {
    const s = await makeStorage()
    await expect(s.migrate()).resolves.toBeUndefined()
    await expect(s.close()).resolves.toBeUndefined()
    await expect(s.close()).resolves.toBeUndefined()
  })
})

describe('D1StorageAdapter — tasks', () => {
  it('saveTask + getTask round-trip', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    const fetched = await s.getTask(t.id)
    expect(fetched).toEqual(t)
  })

  it('getTask returns null when missing', async () => {
    const s = await makeStorage()
    expect(await s.getTask(ulid() as TaskId)).toBeNull()
  })

  it('saveTask throws on duplicate id', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    await expect(s.saveTask(t)).rejects.toBeInstanceOf(ConflictError)
  })

  it('updateTask throws StaleVersionError on mismatch', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    const patch: TaskPatch = { expectedVersion: 99, name: 'renamed' }
    await expect(s.updateTask(t.id, patch)).rejects.toBeInstanceOf(StaleVersionError)
  })

  it('updateTask throws NotFoundError on missing id', async () => {
    const s = await makeStorage()
    const patch: TaskPatch = { expectedVersion: 1, name: 'x' }
    await expect(s.updateTask(ulid() as TaskId, patch)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('updateTask bumps version + updated_at, merges fields', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    const patch: TaskPatch = { expectedVersion: 1, name: 'renamed', max_retries: 5 }
    const next = await s.updateTask(t.id, patch)
    expect(next.name).toBe('renamed')
    expect(next.max_retries).toBe(5)
    expect(next.version).toBe(2)
    expect(next.updated_at).toBeGreaterThanOrEqual(t.updated_at)
  })

  it('deleteTask soft-deletes (sets deleted_at, bumps version)', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    await s.deleteTask(t.id, 1)
    const fetched = await s.getTask(t.id)
    expect(fetched?.deleted_at).not.toBeNull()
    expect(fetched?.version).toBe(2)
  })

  it('deleteTask is idempotent', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    await s.deleteTask(t.id, 1)
    await s.deleteTask(t.id, 2)
    const fetched = await s.getTask(t.id)
    expect(fetched?.deleted_at).not.toBeNull()
  })

  it('deleteTask throws StaleVersionError on mismatch', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    await expect(s.deleteTask(t.id, 99)).rejects.toBeInstanceOf(StaleVersionError)
  })

  it('listTasks filters by ownerId + status', async () => {
    const s = await makeStorage()
    const owner = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as TaskId
    const a = makeTask({ owner_id: owner, status: 'pending' })
    const b = makeTask({ owner_id: owner, status: 'running' })
    const c = makeTask({ owner_id: ulid() as TaskId, status: 'pending' })
    await s.saveTask(a)
    await s.saveTask(b)
    await s.saveTask(c)
    const out = await s.listTasks({ ownerId: owner, status: 'pending' })
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe(a.id)
  })

  it('listTasks excludes soft-deleted by default; includeDeleted=true returns them', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    await s.deleteTask(t.id, 1)
    expect(await s.listTasks()).toHaveLength(0)
    expect(await s.listTasks({ includeDeleted: true })).toHaveLength(1)
  })

  it('listTasks fuzzy q match is case-insensitive', async () => {
    const s = await makeStorage()
    const t = makeTask({ name: 'Deploy Production' })
    await s.saveTask(t)
    expect(await s.listTasks({ q: 'deploy' })).toHaveLength(1)
    expect(await s.listTasks({ q: 'PROD' })).toHaveLength(1)
    expect(await s.listTasks({ q: 'absent' })).toHaveLength(0)
  })

  it('listTasks filters by payloadKind / triggerKind', async () => {
    const s = await makeStorage()
    const a = makeTask({ payload_kind: 'http', trigger_kind: 'cron' })
    const b = makeTask({ payload_kind: 'command', trigger_kind: 'manual' })
    await s.saveTask(a)
    await s.saveTask(b)
    expect(await s.listTasks({ payloadKind: 'http' })).toHaveLength(1)
    expect(await s.listTasks({ triggerKind: 'manual' })).toHaveLength(1)
  })

  it('listTasks respects limit + offset', async () => {
    const s = await makeStorage()
    const ids: TaskId[] = []
    for (let i = 0; i < 5; i++) {
      const t = makeTask({ created_at: BASE_TS + i })
      ids.push(t.id)
      await s.saveTask(t)
    }
    const all = await s.listTasks()
    expect(all).toHaveLength(5)
    const page1 = await s.listTasks({}, [{ field: 'created_at', direction: 'asc' }])
    expect(page1.map((t) => t.id)).toEqual(ids)
    const limited = await s.listTasks({ limit: 2 })
    expect(limited).toHaveLength(2)
    expect(limited[0]?.id).toBe(ids[ids.length - 1])
    const offset = await s.listTasks({ limit: 2, offset: 2 })
    expect(offset).toHaveLength(2)
    expect(offset[0]?.id).not.toBe(limited[0]?.id)
  })

  it('listTasks with empty filter returns everything', async () => {
    const s = await makeStorage()
    await s.saveTask(makeTask())
    await s.saveTask(makeTask())
    expect(await s.listTasks()).toHaveLength(2)
  })
})

describe('D1StorageAdapter — executions', () => {
  it('createExecution + getExecution round-trip', async () => {
    const s = await makeStorage()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    expect(await s.getExecution(e.id)).toEqual(e)
  })

  it('createExecution throws on duplicate id', async () => {
    const s = await makeStorage()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    await expect(s.createExecution(e)).rejects.toBeInstanceOf(ConflictError)
  })

  it('updateExecution bumps version + merges fields', async () => {
    const s = await makeStorage()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    const patch: ExecutionPatch = { expectedVersion: 1, status: 'running', startedAt: BASE_TS + 1 }
    const next = await s.updateExecution(e.id, patch)
    expect(next.status).toBe('running')
    expect(next.startedAt).toBe(BASE_TS + 1)
    expect(next.version).toBe(2)
  })

  it('updateExecution throws StaleVersionError', async () => {
    const s = await makeStorage()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    await expect(
      s.updateExecution(e.id, { expectedVersion: 99, status: 'success' }),
    ).rejects.toBeInstanceOf(StaleVersionError)
  })

  it('updateExecution throws NotFoundError', async () => {
    const s = await makeStorage()
    await expect(
      s.updateExecution(ulid() as ExecutionId, { expectedVersion: 1, status: 'success' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('listExecutions filters by taskId, status, triggerSource', async () => {
    const s = await makeStorage()
    const tA = ulid() as TaskId
    const tB = ulid() as TaskId
    await s.createExecution(makeExecution(tA, { status: 'running' }))
    await s.createExecution(makeExecution(tA, { status: 'success' }))
    await s.createExecution(makeExecution(tB, { status: 'running' }))
    expect(await s.listExecutions({ taskId: tA })).toHaveLength(2)
    expect(await s.listExecutions({ status: 'running' })).toHaveLength(2)
    expect(await s.listExecutions({ triggerSource: 'manual' })).toHaveLength(3)
  })

  it('listExecutions filters by from/to timestamp', async () => {
    const s = await makeStorage()
    const tid = ulid() as TaskId
    await s.createExecution(makeExecution(tid, { startedAt: BASE_TS + 100 }))
    await s.createExecution(makeExecution(tid, { startedAt: BASE_TS + 200 }))
    await s.createExecution(makeExecution(tid, { startedAt: null }))
    const from = await s.listExecutions({ from: BASE_TS + 150 })
    expect(from).toHaveLength(1)
    const to = await s.listExecutions({ to: BASE_TS + 150 })
    expect(to).toHaveLength(1)
  })
})

describe('D1StorageAdapter — users', () => {
  it('saveUser + getUser + getUserByEmail round-trip', async () => {
    const s = await makeStorage()
    const u = makeUser()
    await s.saveUser(u)
    expect(await s.getUser(u.id)).toEqual(u)
    expect(await s.getUserByEmail(u.email)).toEqual(u)
    expect(await s.getUserByEmail('nobody@x.com')).toBeNull()
  })

  it('saveUser throws on duplicate email (different id)', async () => {
    const s = await makeStorage()
    const u1 = makeUser({ email: 'dup@example.com' })
    const u2 = makeUser({ email: 'dup@example.com' })
    await s.saveUser(u1)
    await expect(s.saveUser(u2)).rejects.toBeInstanceOf(ConflictError)
  })

  it('saveUser allows same id re-save (in-place update)', async () => {
    const s = await makeStorage()
    const u = makeUser({ email: 'foo@bar.com', displayName: 'A' })
    await s.saveUser(u)
    const updated = { ...u, displayName: 'B' }
    await s.saveUser(updated)
    expect((await s.getUser(u.id))?.displayName).toBe('B')
  })

  it('listUsers filters by role + email', async () => {
    const s = await makeStorage()
    await s.saveUser(makeUser({ role: 'admin' }))
    await s.saveUser(makeUser({ role: 'viewer' }))
    expect(await s.listUsers({ role: 'admin' })).toHaveLength(1)
    expect(await s.listUsers({ email: 'x' })).toHaveLength(0)
  })
})

describe('D1StorageAdapter — groups', () => {
  it('CRUD round-trip', async () => {
    const s = await makeStorage()
    const ownerId = crypto.randomUUID()
    const g = makeGroup(ownerId)
    await s.saveGroup(g)
    expect(await s.getGroup(g.id)).toEqual(g)
    expect(await s.listGroups({ ownerId })).toHaveLength(1)
    await s.deleteGroup(g.id)
    expect(await s.getGroup(g.id)).toBeNull()
  })
})

describe('D1StorageAdapter — credentials', () => {
  it('CRUD round-trip + filters', async () => {
    const s = await makeStorage()
    const owner = crypto.randomUUID()
    const c1 = makeCredential(owner)
    const c2 = makeCredential(owner)
    await s.saveCredential(c1)
    await s.saveCredential(c2)
    expect(await s.listCredentials({ ownerId: owner })).toHaveLength(2)
    expect(await s.listCredentials({ kind: 'api-key' })).toHaveLength(2)
    await s.deleteCredential(c1.id)
    expect(await s.getCredential(c1.id)).toBeNull()
  })
})

describe('D1StorageAdapter — tags', () => {
  it('CRUD round-trip + filter', async () => {
    const s = await makeStorage()
    const t1 = makeTag({ name: 'alpha' })
    const t2 = makeTag({ name: 'beta' })
    await s.saveTag(t1)
    await s.saveTag(t2)
    expect(await s.listTags({ name: 'alpha' })).toHaveLength(1)
    expect(await s.listTags()).toHaveLength(2)
  })

  it('attachTag + listTagsByTask returns sorted tags', async () => {
    const s = await makeStorage()
    const task = makeTask()
    await s.saveTask(task)
    const tA = makeTag({ name: 'zzz' })
    const tB = makeTag({ name: 'aaa' })
    await s.saveTag(tA)
    await s.saveTag(tB)
    await s.attachTag(task.id, tA.id)
    await s.attachTag(task.id, tB.id)
    const tags = await s.listTagsByTask(task.id)
    expect(tags.map((t) => t.name)).toEqual(['aaa', 'zzz'])
  })

  it('attachTag is idempotent', async () => {
    const s = await makeStorage()
    const task = makeTask()
    await s.saveTask(task)
    const tag = makeTag()
    await s.saveTag(tag)
    await s.attachTag(task.id, tag.id)
    await s.attachTag(task.id, tag.id)
    expect(await s.listTagsByTask(task.id)).toHaveLength(1)
  })

  it('detachTag is idempotent', async () => {
    const s = await makeStorage()
    const task = makeTask()
    await s.saveTask(task)
    const tag = makeTag()
    await s.saveTag(tag)
    await s.attachTag(task.id, tag.id)
    await s.detachTag(task.id, tag.id)
    await s.detachTag(task.id, tag.id)
    expect(await s.listTagsByTask(task.id)).toHaveLength(0)
  })

  it('listTasksByTag filters out soft-deleted tasks', async () => {
    const s = await makeStorage()
    const t1 = makeTask()
    const t2 = makeTask()
    await s.saveTask(t1)
    await s.saveTask(t2)
    const tag = makeTag()
    await s.saveTag(tag)
    await s.attachTag(t1.id, tag.id)
    await s.attachTag(t2.id, tag.id)
    await s.deleteTask(t1.id, 1)
    const tasks = await s.listTasksByTag(tag.id)
    expect(tasks.map((t) => t.id)).toEqual([t2.id])
  })

  it('listTasksByTask filter: tags=[id] requires match', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    const tag = makeTag()
    await s.saveTag(tag)
    await s.attachTag(t.id, tag.id)
    const out = await s.listTasks({ tags: [tag.id] })
    expect(out).toHaveLength(1)
    const out2 = await s.listTasks({ tags: [crypto.randomUUID() as never] })
    expect(out2).toHaveLength(0)
  })

  it('deleteTag cascades through junctions', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    const tag = makeTag()
    await s.saveTag(tag)
    await s.attachTag(t.id, tag.id)
    await s.deleteTag(tag.id)
    expect(await s.listTagsByTask(t.id)).toHaveLength(0)
  })
})

describe('D1StorageAdapter — audit', () => {
  it('appendAudit + listAuditLogs round-trip', async () => {
    const s = await makeStorage()
    await s.appendAudit(makeAudit({ action: 'task.create' }))
    await s.appendAudit(makeAudit({ action: 'task.update' }))
    expect(await s.listAuditLogs()).toHaveLength(2)
    expect(await s.listAuditLogs({ action: 'task.update' })).toHaveLength(1)
  })

  it('appendAudit rejects duplicate id (append-only)', async () => {
    const s = await makeStorage()
    const e = makeAudit()
    await s.appendAudit(e)
    await expect(s.appendAudit(e)).rejects.toBeInstanceOf(ConflictError)
  })

  it('listAuditLogs filters by resourceKind / actorId / from / to', async () => {
    const s = await makeStorage()
    const u = crypto.randomUUID()
    await s.appendAudit(makeAudit({ resourceKind: 'task', actorId: u, createdAt: 100 }))
    await s.appendAudit(makeAudit({ resourceKind: 'user', actorId: null, createdAt: 200 }))
    expect((await s.listAuditLogs({ resourceKind: 'task' })).length).toBe(1)
    expect((await s.listAuditLogs({ actorId: u })).length).toBe(1)
    expect((await s.listAuditLogs({ actorId: null })).length).toBe(1)
    expect((await s.listAuditLogs({ from: 150 })).length).toBe(1)
    expect((await s.listAuditLogs({ to: 150 })).length).toBe(1)
  })
})

describe('D1StorageAdapter — optimistic lock under concurrency', () => {
  it('concurrent saveTask → exactly one succeeds, others see updated version', async () => {
    const s = await makeStorage()
    const t = makeTask()
    await s.saveTask(t)
    const next1 = await s.updateTask(t.id, { expectedVersion: 1, name: 'one' })
    expect(next1.version).toBe(2)
    await expect(
      s.updateTask(t.id, { expectedVersion: 1, name: 'two' }),
    ).rejects.toBeInstanceOf(StaleVersionError)
    const next2 = await s.updateTask(t.id, { expectedVersion: 2, name: 'two' })
    expect(next2.version).toBe(3)
    expect(next2.name).toBe('two')
  })
})

describe('RoleSchema smoke (verify domain export parity)', () => {
  it('contains the four roles', () => {
    const roles = RoleSchema.options
    expect(roles).toContain('owner')
    expect(roles).toContain('admin')
    expect(roles).toContain('editor')
    expect(roles).toContain('viewer')
  })
})
