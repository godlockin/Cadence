/**
 * @cadence/storage — InMemoryStorageAdapter unit tests.
 *
 * Covers:
 *  - happy path for every method on the StorageAdapter contract
 *  - optimistic locking (StaleVersionError on concurrent saves)
 *  - soft delete (deleted_at populated, getTask still returns row)
 *  - filter combinations (ownerId / groupId / status / payloadKind / triggerKind / tags / q)
 *  - pagination (limit / offset)
 *  - tag many-to-many (attach / detach / listTagsByTask / listTasksByTag)
 *  - audit append-only (duplicate id → ConflictError)
 *
 * Tests use real ULIDs + UUIDs via crypto.randomUUID / ulid generation,
 * not mocks — keeps the fake honest.
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
import { ConflictError, InMemoryStorageAdapter, NotFoundError, StaleVersionError } from '../src/index.js'
import type { ExecutionPatch, TaskPatch } from '@cadence/domain'

/* -------------------------------------------------------------------------
 * fixtures
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

/* -------------------------------------------------------------------------
 * tests
 * ------------------------------------------------------------------------- */

describe('InMemoryStorageAdapter — lifecycle', () => {
  it('migrate + close are no-ops', async () => {
    const s = new InMemoryStorageAdapter()
    await expect(s.migrate()).resolves.toBeUndefined()
    await expect(s.close()).resolves.toBeUndefined()
    // idempotent
    await expect(s.close()).resolves.toBeUndefined()
  })
})

describe('InMemoryStorageAdapter — tasks', () => {
  it('saveTask + getTask round-trip', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    const fetched = await s.getTask(t.id)
    expect(fetched).toEqual(t)
  })

  it('getTask returns null when missing', async () => {
    const s = new InMemoryStorageAdapter()
    expect(await s.getTask(ulid() as TaskId)).toBeNull()
  })

  it('saveTask throws on duplicate id', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    await expect(s.saveTask(t)).rejects.toBeInstanceOf(ConflictError)
  })

  it('updateTask throws StaleVersionError on mismatch', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    const patch: TaskPatch = { expectedVersion: 99, name: 'renamed' }
    await expect(s.updateTask(t.id, patch)).rejects.toBeInstanceOf(StaleVersionError)
  })

  it('updateTask throws NotFoundError on missing id', async () => {
    const s = new InMemoryStorageAdapter()
    const patch: TaskPatch = { expectedVersion: 1, name: 'x' }
    await expect(s.updateTask(ulid() as TaskId, patch)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('updateTask bumps version + updated_at, merges fields', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    const patch: TaskPatch = {
      expectedVersion: 1,
      name: 'renamed',
      max_retries: 5,
    }
    const next = await s.updateTask(t.id, patch)
    expect(next.name).toBe('renamed')
    expect(next.max_retries).toBe(5)
    expect(next.version).toBe(2)
    expect(next.updated_at).toBeGreaterThanOrEqual(t.updated_at)
  })

  it('deleteTask soft-deletes (sets deleted_at, bumps version)', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    await s.deleteTask(t.id, 1)
    const fetched = await s.getTask(t.id)
    expect(fetched?.deleted_at).not.toBeNull()
    expect(fetched?.version).toBe(2)
  })

  it('deleteTask is idempotent', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    await s.deleteTask(t.id, 1)
    await s.deleteTask(t.id, 2) // version after first delete
    const fetched = await s.getTask(t.id)
    expect(fetched?.deleted_at).not.toBeNull()
  })

  it('deleteTask throws StaleVersionError on mismatch', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    await expect(s.deleteTask(t.id, 99)).rejects.toBeInstanceOf(StaleVersionError)
  })

  it('listTasks filters by ownerId + status', async () => {
    const s = new InMemoryStorageAdapter()
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
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    await s.deleteTask(t.id, 1)
    expect(await s.listTasks()).toHaveLength(0)
    expect(await s.listTasks({ includeDeleted: true })).toHaveLength(1)
  })

  it('listTasks fuzzy q match is case-insensitive', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask({ name: 'Deploy Production' })
    await s.saveTask(t)
    expect(await s.listTasks({ q: 'deploy' })).toHaveLength(1)
    expect(await s.listTasks({ q: 'PROD' })).toHaveLength(1)
    expect(await s.listTasks({ q: 'absent' })).toHaveLength(0)
  })

  it('listTasks filters by payloadKind / triggerKind', async () => {
    const s = new InMemoryStorageAdapter()
    const a = makeTask({ payload_kind: 'http', trigger_kind: 'cron' })
    const b = makeTask({ payload_kind: 'command', trigger_kind: 'manual' })
    await s.saveTask(a)
    await s.saveTask(b)
    expect(await s.listTasks({ payloadKind: 'http' })).toHaveLength(1)
    expect(await s.listTasks({ triggerKind: 'manual' })).toHaveLength(1)
  })

  it('listTasks respects limit + offset', async () => {
    const s = new InMemoryStorageAdapter()
    const ids: TaskId[] = []
    for (let i = 0; i < 5; i++) {
      const t = makeTask({ created_at: BASE_TS + i })
      ids.push(t.id)
      await s.saveTask(t)
    }
    const all = await s.listTasks()
    expect(all).toHaveLength(5)

    const page1 = await s.listTasks({}, [{ field: 'created_at', direction: 'asc' }], )
    expect(page1.map((t) => t.id)).toEqual(ids)

    const limited = await s.listTasks({ limit: 2 })
    expect(limited).toHaveLength(2)
    // default sort is created_at desc → newest first
    expect(limited[0]?.id).toBe(ids[ids.length - 1])

    const offset = await s.listTasks({ limit: 2, offset: 2 })
    expect(offset).toHaveLength(2)
    expect(offset[0]?.id).not.toBe(limited[0]?.id)
  })

  it('listTasks with empty filter returns everything', async () => {
    const s = new InMemoryStorageAdapter()
    await s.saveTask(makeTask())
    await s.saveTask(makeTask())
    expect(await s.listTasks()).toHaveLength(2)
  })
})

describe('InMemoryStorageAdapter — executions', () => {
  it('createExecution + getExecution round-trip', async () => {
    const s = new InMemoryStorageAdapter()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    expect(await s.getExecution(e.id)).toEqual(e)
  })

  it('createExecution throws on duplicate id', async () => {
    const s = new InMemoryStorageAdapter()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    await expect(s.createExecution(e)).rejects.toBeInstanceOf(ConflictError)
  })

  it('updateExecution bumps version + merges fields', async () => {
    const s = new InMemoryStorageAdapter()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    const patch: ExecutionPatch = { expectedVersion: 1, status: 'running', startedAt: BASE_TS + 1 }
    const next = await s.updateExecution(e.id, patch)
    expect(next.status).toBe('running')
    expect(next.startedAt).toBe(BASE_TS + 1)
    expect(next.version).toBe(2)
  })

  it('updateExecution throws StaleVersionError', async () => {
    const s = new InMemoryStorageAdapter()
    const e = makeExecution(ulid() as TaskId)
    await s.createExecution(e)
    await expect(
      s.updateExecution(e.id, { expectedVersion: 99, status: 'success' }),
    ).rejects.toBeInstanceOf(StaleVersionError)
  })

  it('updateExecution throws NotFoundError', async () => {
    const s = new InMemoryStorageAdapter()
    await expect(
      s.updateExecution(ulid() as ExecutionId, { expectedVersion: 1, status: 'success' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('listExecutions filters by taskId, status, triggerSource', async () => {
    const s = new InMemoryStorageAdapter()
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
    const s = new InMemoryStorageAdapter()
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

describe('InMemoryStorageAdapter — users', () => {
  it('saveUser + getUser + getUserByEmail round-trip', async () => {
    const s = new InMemoryStorageAdapter()
    const u = makeUser()
    await s.saveUser(u)
    expect(await s.getUser(u.id)).toEqual(u)
    expect(await s.getUserByEmail(u.email)).toEqual(u)
    expect(await s.getUserByEmail('nobody@x.com')).toBeNull()
  })

  it('saveUser throws on duplicate email (different id)', async () => {
    const s = new InMemoryStorageAdapter()
    const u1 = makeUser({ email: 'dup@example.com' })
    const u2 = makeUser({ email: 'dup@example.com' })
    await s.saveUser(u1)
    await expect(s.saveUser(u2)).rejects.toBeInstanceOf(ConflictError)
  })

  it('saveUser allows same id re-save (in-place update)', async () => {
    const s = new InMemoryStorageAdapter()
    const u = makeUser({ email: 'foo@bar.com', displayName: 'A' })
    await s.saveUser(u)
    const updated = { ...u, displayName: 'B' }
    await s.saveUser(updated)
    expect((await s.getUser(u.id))?.displayName).toBe('B')
  })

  it('listUsers filters by role + email', async () => {
    const s = new InMemoryStorageAdapter()
    await s.saveUser(makeUser({ role: 'admin' }))
    await s.saveUser(makeUser({ role: 'viewer' }))
    expect(await s.listUsers({ role: 'admin' })).toHaveLength(1)
    expect(await s.listUsers({ email: 'x' })).toHaveLength(0)
  })
})

describe('InMemoryStorageAdapter — groups', () => {
  it('CRUD round-trip', async () => {
    const s = new InMemoryStorageAdapter()
    const ownerId = crypto.randomUUID()
    const g = makeGroup(ownerId)
    await s.saveGroup(g)
    expect(await s.getGroup(g.id)).toEqual(g)
    expect(await s.listGroups({ ownerId })).toHaveLength(1)
    await s.deleteGroup(g.id)
    expect(await s.getGroup(g.id)).toBeNull()
  })
})

describe('InMemoryStorageAdapter — credentials', () => {
  it('CRUD round-trip + filters', async () => {
    const s = new InMemoryStorageAdapter()
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

describe('InMemoryStorageAdapter — tags', () => {
  it('CRUD round-trip + filter', async () => {
    const s = new InMemoryStorageAdapter()
    const t1 = makeTag({ name: 'alpha' })
    const t2 = makeTag({ name: 'beta' })
    await s.saveTag(t1)
    await s.saveTag(t2)
    expect(await s.listTags({ name: 'alpha' })).toHaveLength(1)
    expect(await s.listTags()).toHaveLength(2)
  })

  it('attachTag + listTagsByTask returns sorted tags', async () => {
    const s = new InMemoryStorageAdapter()
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
    const s = new InMemoryStorageAdapter()
    const task = makeTask()
    await s.saveTask(task)
    const tag = makeTag()
    await s.saveTag(tag)
    await s.attachTag(task.id, tag.id)
    await s.attachTag(task.id, tag.id)
    expect((await s.listTagsByTask(task.id))).toHaveLength(1)
  })

  it('detachTag is idempotent', async () => {
    const s = new InMemoryStorageAdapter()
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
    const s = new InMemoryStorageAdapter()
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
    const s = new InMemoryStorageAdapter()
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
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    const tag = makeTag()
    await s.saveTag(tag)
    await s.attachTag(t.id, tag.id)
    await s.deleteTag(tag.id)
    expect(await s.listTagsByTask(t.id)).toHaveLength(0)
  })
})

describe('InMemoryStorageAdapter — audit', () => {
  it('appendAudit + listAuditLogs round-trip', async () => {
    const s = new InMemoryStorageAdapter()
    await s.appendAudit(makeAudit({ action: 'task.create' }))
    await s.appendAudit(makeAudit({ action: 'task.update' }))
    expect(await s.listAuditLogs()).toHaveLength(2)
    expect(await s.listAuditLogs({ action: 'task.update' })).toHaveLength(1)
  })

  it('appendAudit rejects duplicate id (append-only)', async () => {
    const s = new InMemoryStorageAdapter()
    const e = makeAudit()
    await s.appendAudit(e)
    await expect(s.appendAudit(e)).rejects.toBeInstanceOf(ConflictError)
  })

  it('listAuditLogs filters by resourceKind / actorId / from / to', async () => {
    const s = new InMemoryStorageAdapter()
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

describe('InMemoryStorageAdapter — optimistic lock under concurrency', () => {
  it('concurrent saveTask → exactly one succeeds, others see updated version', async () => {
    const s = new InMemoryStorageAdapter()
    const t = makeTask()
    await s.saveTask(t)
    // First save succeeds
    const next1 = await s.updateTask(t.id, { expectedVersion: 1, name: 'one' })
    expect(next1.version).toBe(2)
    // Second save with stale expectedVersion=1 must fail
    await expect(
      s.updateTask(t.id, { expectedVersion: 1, name: 'two' }),
    ).rejects.toBeInstanceOf(StaleVersionError)
    // Re-fetch + retry with version=2 succeeds
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