/**
 * @cadence/storage — SqliteStorageAdapter.
 *
 * better-sqlite3 (sync) + drizzle-orm query builder.  Same SQL dialect as
 * Cloudflare D1, but the in-process binding is synchronous so we wrap each
 * call in `Promise.resolve()` to keep the async `StorageAdapter` contract.
 *
 * The adapter enforces:
 *  - optimistic locking on tasks + executions via `version` column
 *  - soft delete on tasks via `deleted_at`
 *  - append-only audit (UNIQUE id + insert-then-check)
 *  - tag cascade via `pipeline_tags` junction
 *
 * 100% schema parity with `D1StorageAdapter` — both consume the same
 * drizzle schema from `@cadence/db`.
 */

import {
  auditLogs,
  credentialRefreshJobs,
  credentials,
  executions,
  groups,
  pipelineTags,
  refreshTokens,
  tags,
  taskCredentials,
  tasks,
  users,
} from '@cadence/db'
import { migrate } from '@cadence/db'
import { BUILTIN_ROLE_GRANTS, type BuiltinRole, type User, type UserId } from '@cadence/domain'
import type {
  AuditLog,
  Credential,
  CredentialId,
  Execution,
  ExecutionId,
  ExecutionPatch,
  Group,
  GroupId,
  Tag,
  TagId,
  Task,
  TaskId,
  TaskPatch,
} from '@cadence/domain'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  type SQL,
} from 'drizzle-orm'
import type { AnyColumn } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type Database from 'better-sqlite3'
import {
  ConflictError,
  NotFoundError,
  StaleVersionError,
  type AuditFilter,
  type CredentialFilter,
  type ExecutionFilter,
  type GroupFilter,
  type RefreshJob,
  type RefreshToken,
  type ResolvedUserRole,
  type SortClause,
  type StorageAdapter,
  type TagFilter,
  type TaskFilter,
  type UserFilter,
} from './interface.js'
import {
  auditLogDomainToRow,
  auditLogRowToDomain,
  credentialDomainToRow,
  credentialRowToDomain,
  executionDomainToRow,
  executionRowToDomain,
  groupDomainToRow,
  groupRowToDomain,
  tagDomainToRow,
  tagRowToDomain,
  taskDomainToRow,
  taskRowToDomain,
  userDomainToRow,
  userRowToDomain,
} from './mappers.js'

/**
 * Loose type accepted by the factory — the real `better-sqlite3` Database
 * satisfies this shape.  Keeping the loose surface avoids pulling the
 * native module when the storage package is type-checked in a Workers
 * context.
 */
export type SqliteDatabase = {
  prepare: (sql: string) => unknown
  exec: (sql: string) => unknown
  close: () => void
}

/* -------------------------------------------------------------------------
 * helpers
 * ------------------------------------------------------------------------- */

function nowMs(): number {
  return Date.now()
}

function matchQ(value: string, q: string | undefined): boolean {
  if (q === undefined || q === '') return true
  return value.toLowerCase().includes(q.toLowerCase())
}

function buildOrderBy(
  table:
    | typeof tasks
    | typeof executions
    | typeof users
    | typeof groups
    | typeof credentials
    | typeof tags
    | typeof auditLogs,
  clauses: readonly SortClause<string>[] | undefined,
  defaultSort: readonly SortClause<string>[],
) {
  const list = clauses && clauses.length > 0 ? clauses : defaultSort
  const cols = table as unknown as Record<string, AnyColumn>
  return list.map((c) => {
    // Sort fields may be snake_case (per the in-memory test fixture, which
    // matches the Task domain Zod schema). Map to the camelCase column name
    // on the drizzle table.
    const camel = c.field.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
    const col = cols[camel] ?? cols[c.field]
    if (col === undefined) {
      throw new Error(`Unknown sort field: ${String(c.field)}`)
    }
    return c.direction === 'asc' ? asc(col) : desc(col)
  })
}

function whereAnd(conds: SQL[]) {
  return conds.length > 0 ? and(...conds) : undefined
}

/* -------------------------------------------------------------------------
 * Adapter
 * ------------------------------------------------------------------------- */

export class SqliteStorageAdapter implements StorageAdapter {
  private readonly db: Database.Database
  private readonly drizzleDb: BetterSQLite3Database
  private closed = false

  constructor(db: Database.Database | SqliteDatabase) {
    // The factory passes the loose SqliteDatabase type, but the real
    // better-sqlite3 Database is a strict superset.
    this.db = db as Database.Database
    this.drizzleDb = drizzle(this.db)
  }

  /* ===== Lifecycle ===== */

  async migrate(): Promise<void> {
    await migrate(this.db as unknown as Parameters<typeof migrate>[0])
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /* ===== Tasks ===== */

  async getTask(id: TaskId): Promise<Task | null> {
    const row = this.drizzleDb.select().from(tasks).where(eq(tasks.id, id)).get()
    return row ? taskRowToDomain(row) : null
  }

  async listTasks(
    filter?: TaskFilter,
    sort?: readonly SortClause<keyof Task & string>[],
  ): Promise<Task[]> {
    const f = filter ?? {}
    const conds: SQL[] = []
    if (!f.includeDeleted) {
      conds.push(isNull(tasks.deletedAt))
    }
    if (f.ownerId !== undefined) conds.push(eq(tasks.ownerId, f.ownerId))
    if (f.groupId !== undefined) conds.push(eq(tasks.groupId, f.groupId))
    if (f.status !== undefined) conds.push(eq(tasks.status, f.status))
    if (f.payloadKind !== undefined) conds.push(eq(tasks.payloadKind, f.payloadKind))
    if (f.triggerKind !== undefined) conds.push(eq(tasks.triggerKind, f.triggerKind))
    if (f.q !== undefined && f.q !== '') {
      // SQLite LIKE is case-insensitive for ASCII by default
      conds.push(like(tasks.name, `%${f.q}%`))
    }

    const whereClause = whereAnd(conds)
    const orderBy = buildOrderBy(tasks, sort as readonly SortClause<string>[] | undefined, [
      { field: 'createdAt', direction: 'desc' },
    ])

    // Tag filter requires a subquery (or two-step: load candidates, filter, paginate)
    // For correctness we pre-fetch candidate ids when tag filter is set, then
    // re-apply WHERE for the remaining filters via the IN clause.
    let candidateIds: Set<string> | undefined
    if (f.tags !== undefined && f.tags.length > 0) {
      const rows = this.drizzleDb
        .select({ taskId: pipelineTags.taskId })
        .from(pipelineTags)
        .where(inArray(pipelineTags.tagId, f.tags as string[]))
        .all()
      candidateIds = new Set(rows.map((r) => r.taskId))
    }

    const finalWhere =
      candidateIds !== undefined
        ? whereClause
          ? and(whereClause, inArray(tasks.id, Array.from(candidateIds)))
          : inArray(tasks.id, Array.from(candidateIds))
        : whereClause

    const rows = this.drizzleDb
      .select()
      .from(tasks)
      .where(finalWhere)
      .orderBy(...orderBy)
      .limit(f.limit ?? -1)
      .offset(f.offset ?? 0)
      .all()

    // q filter via in-memory fallback (covers the case where LIKE didn't fire
    // because of unicode casing). The LIKE filter is an optimisation.
    const out = rows.map((r) => taskRowToDomain(r))
    if (f.q !== undefined && f.q !== '') {
      return out.filter((r) => matchQ(r.name, f.q))
    }
    return out
  }

  async saveTask(task: Task): Promise<void> {
    const existing = this.drizzleDb
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .get()
    if (existing !== undefined) {
      throw new ConflictError(`Task ${task.id} already exists`)
    }
    this.drizzleDb.insert(tasks).values(taskDomainToRow(task)).run()
  }

  async updateTask(id: TaskId, patch: TaskPatch): Promise<Task> {
    const existing = this.drizzleDb.select().from(tasks).where(eq(tasks.id, id)).get()
    if (existing === undefined) {
      throw new NotFoundError('Task', id)
    }
    if (existing.version !== patch.expectedVersion) {
      throw new StaleVersionError('Task', patch.expectedVersion, existing.version)
    }
    const ts = nowMs()
    const nextVersion = existing.version + 1

    const update: Partial<typeof tasks.$inferInsert> = {
      version: nextVersion,
      updatedAt: ts,
    }
    if (patch.name !== undefined) update.name = patch.name
    if (patch.description !== undefined) update.description = patch.description
    if (patch.group_id !== undefined) update.groupId = patch.group_id
    if (patch.payload_kind !== undefined) update.payloadKind = patch.payload_kind
    if (patch.payload_json !== undefined) update.payloadJson = patch.payload_json
    if (patch.trigger_kind !== undefined) update.triggerKind = patch.trigger_kind
    if (patch.trigger_config_json !== undefined)
      update.triggerConfigJson = patch.trigger_config_json
    if (patch.status !== undefined) update.status = patch.status
    if (patch.cron !== undefined) update.cron = patch.cron
    if (patch.timezone !== undefined) update.timezone = patch.timezone
    if (patch.start_at !== undefined) update.startAt = patch.start_at
    if (patch.end_at !== undefined) update.endAt = patch.end_at
    if (patch.max_retries !== undefined) update.maxRetries = patch.max_retries
    if (patch.retry_backoff !== undefined) update.retryBackoff = patch.retry_backoff
    if (patch.concurrency_policy !== undefined) update.concurrencyPolicy = patch.concurrency_policy
    if (patch.jitter_ms !== undefined) update.jitterMs = patch.jitter_ms
    if (patch.timeout_ms !== undefined) update.timeoutMs = patch.timeout_ms
    if (patch.tags !== undefined) update.tagsJson = JSON.stringify(patch.tags)
    if (patch.notifications_json !== undefined) update.notificationsJson = patch.notifications_json
    if (patch.metadata_json !== undefined) update.metadataJson = patch.metadata_json

    // Optimistic-lock UPDATE: only fire if version still matches
    const result = this.drizzleDb
      .update(tasks)
      .set(update)
      .where(and(eq(tasks.id, id), eq(tasks.version, patch.expectedVersion)))
      .run()

    if (result.changes === 0) {
      // race: someone updated between our SELECT and UPDATE
      const current = this.drizzleDb
        .select({ version: tasks.version })
        .from(tasks)
        .where(eq(tasks.id, id))
        .get()
      throw new StaleVersionError('Task', patch.expectedVersion, current?.version ?? -1)
    }

    const updated = this.drizzleDb.select().from(tasks).where(eq(tasks.id, id)).get()
    if (updated === undefined) {
      throw new NotFoundError('Task', id)
    }
    return taskRowToDomain(updated)
  }

  async deleteTask(id: TaskId, expectedVersion: number): Promise<void> {
    const existing = this.drizzleDb.select().from(tasks).where(eq(tasks.id, id)).get()
    if (existing === undefined) return // idempotent
    if (existing.deletedAt !== null) return // already deleted
    if (existing.version !== expectedVersion) {
      throw new StaleVersionError('Task', expectedVersion, existing.version)
    }
    const ts = nowMs()
    const result = this.drizzleDb
      .update(tasks)
      .set({ deletedAt: ts, updatedAt: ts, version: existing.version + 1 })
      .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
      .run()
    void result // if 0 rows: another writer beat us; treat as idempotent
  }

  /* ===== Executions ===== */

  async getExecution(id: ExecutionId): Promise<Execution | null> {
    const row = this.drizzleDb.select().from(executions).where(eq(executions.id, id)).get()
    return row ? executionRowToDomain(row) : null
  }

  async listExecutions(
    filter?: ExecutionFilter,
    sort?: readonly SortClause<keyof Execution & string>[],
  ): Promise<Execution[]> {
    const f = filter ?? {}
    const conds: SQL[] = []
    if (f.taskId !== undefined) conds.push(eq(executions.taskId, f.taskId))
    if (f.status !== undefined) conds.push(eq(executions.status, f.status))
    if (f.triggerSource !== undefined) conds.push(eq(executions.triggerSource, f.triggerSource))
    if (f.from !== undefined) conds.push(gte(executions.startedAt, f.from))
    if (f.to !== undefined) conds.push(lte(executions.startedAt, f.to))

    const whereClause = conds.length > 0 ? and(...conds) : undefined
    const orderBy = buildOrderBy(executions, sort as readonly SortClause<string>[] | undefined, [
      { field: 'createdAt', direction: 'desc' },
    ])

    const rows = this.drizzleDb
      .select()
      .from(executions)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(f.limit ?? -1)
      .offset(f.offset ?? 0)
      .all()
    return rows.map((r) => executionRowToDomain(r))
  }

  async createExecution(exec: Execution): Promise<void> {
    const existing = this.drizzleDb
      .select({ id: executions.id })
      .from(executions)
      .where(eq(executions.id, exec.id))
      .get()
    if (existing !== undefined) {
      throw new ConflictError(`Execution ${exec.id} already exists`)
    }
    this.drizzleDb.insert(executions).values(executionDomainToRow(exec)).run()
  }

  async updateExecution(id: ExecutionId, patch: ExecutionPatch): Promise<Execution> {
    const existing = this.drizzleDb.select().from(executions).where(eq(executions.id, id)).get()
    if (existing === undefined) {
      throw new NotFoundError('Execution', id)
    }
    if (existing.version !== patch.expectedVersion) {
      throw new StaleVersionError('Execution', patch.expectedVersion, existing.version)
    }
    const ts = nowMs()
    const nextVersion = existing.version + 1
    const update: Partial<typeof executions.$inferInsert> = {
      version: nextVersion,
      updatedAt: ts,
    }
    if (patch.status !== undefined) update.status = patch.status
    if (patch.startedAt !== undefined) update.startedAt = patch.startedAt
    if (patch.finishedAt !== undefined) update.finishedAt = patch.finishedAt
    if (patch.durationMs !== undefined) update.durationMs = patch.durationMs
    if (patch.retryCount !== undefined) update.retryCount = patch.retryCount
    if (patch.errorJson !== undefined) update.errorJson = patch.errorJson
    if (patch.resultJson !== undefined) update.resultJson = patch.resultJson

    const result = this.drizzleDb
      .update(executions)
      .set(update)
      .where(and(eq(executions.id, id), eq(executions.version, patch.expectedVersion)))
      .run()

    if (result.changes === 0) {
      const current = this.drizzleDb
        .select({ version: executions.version })
        .from(executions)
        .where(eq(executions.id, id))
        .get()
      throw new StaleVersionError('Execution', patch.expectedVersion, current?.version ?? -1)
    }

    const updated = this.drizzleDb.select().from(executions).where(eq(executions.id, id)).get()
    if (updated === undefined) {
      throw new NotFoundError('Execution', id)
    }
    return executionRowToDomain(updated)
  }

  /* ===== Users ===== */

  async getUser(id: UserId): Promise<User | null> {
    const row = this.drizzleDb.select().from(users).where(eq(users.id, id)).get()
    return row ? userRowToDomain(row) : null
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const row = this.drizzleDb.select().from(users).where(eq(users.email, email)).get()
    return row ? userRowToDomain(row) : null
  }

  async listUsers(filter?: UserFilter): Promise<User[]> {
    const f = filter ?? {}
    const conds: SQL[] = []
    if (f.role !== undefined) conds.push(eq(users.role, f.role))
    if (f.email !== undefined) conds.push(eq(users.email, f.email))
    const whereClause = conds.length > 0 ? and(...conds) : undefined
    const rows = this.drizzleDb
      .select()
      .from(users)
      .where(whereClause)
      .orderBy(asc(users.createdAt))
      .limit(f.limit ?? -1)
      .offset(f.offset ?? 0)
      .all()
    return rows.map((r) => userRowToDomain(r))
  }

  async saveUser(user: User): Promise<void> {
    const conflict = this.drizzleDb
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, user.email), ne(users.id, user.id)))
      .get()
    if (conflict !== undefined) {
      throw new ConflictError(`User email ${user.email} already in use`)
    }
    // upsert: insert or replace
    this.drizzleDb
      .insert(users)
      .values(userDomainToRow(user))
      .onConflictDoUpdate({
        target: users.id,
        set: userDomainToRow(user),
      })
      .run()
  }

  /* ===== Groups ===== */

  async getGroup(id: GroupId): Promise<Group | null> {
    const row = this.drizzleDb.select().from(groups).where(eq(groups.id, id)).get()
    return row ? groupRowToDomain(row) : null
  }

  async listGroups(filter?: GroupFilter): Promise<Group[]> {
    const f = filter ?? {}
    const conds: SQL[] = []
    if (f.ownerId !== undefined) conds.push(eq(groups.ownerId, f.ownerId))
    const whereClause = conds.length > 0 ? and(...conds) : undefined
    const rows = this.drizzleDb
      .select()
      .from(groups)
      .where(whereClause)
      .orderBy(asc(groups.createdAt))
      .limit(f.limit ?? -1)
      .offset(f.offset ?? 0)
      .all()
    return rows.map((r) => groupRowToDomain(r))
  }

  async saveGroup(group: Group): Promise<void> {
    this.drizzleDb
      .insert(groups)
      .values(groupDomainToRow(group))
      .onConflictDoUpdate({
        target: groups.id,
        set: groupDomainToRow(group),
      })
      .run()
  }

  async deleteGroup(id: GroupId): Promise<void> {
    this.drizzleDb.delete(groups).where(eq(groups.id, id)).run()
  }

  async isGroupMember(groupId: GroupId, userId: UserId): Promise<boolean> {
    /* No dedicated membership table yet: the group owner is implicitly
     * a member. The full RBAC matrix lands in PHASE 3 — for now this is
     * a fail-closed default for the IDOR guard. */
    const g = this.drizzleDb
      .select({ ownerId: groups.ownerId })
      .from(groups)
      .where(eq(groups.id, groupId))
      .get()
    if (!g) return false
    return g.ownerId === userId
  }

  /* ===== Credentials ===== */

  async getCredential(id: CredentialId): Promise<Credential | null> {
    const row = this.drizzleDb.select().from(credentials).where(eq(credentials.id, id)).get()
    return row ? credentialRowToDomain(row) : null
  }

  async listCredentials(filter?: CredentialFilter): Promise<Credential[]> {
    const f = filter ?? {}
    const conds: SQL[] = []
    if (f.ownerId !== undefined) conds.push(eq(credentials.ownerId, f.ownerId))
    if (f.kind !== undefined) conds.push(eq(credentials.kind, f.kind))
    if (f.type !== undefined) conds.push(eq(credentials.type, f.type))
    if (f.expiresBefore !== undefined) conds.push(lt(credentials.expiresAt, f.expiresBefore))
    if (f.disabled !== undefined) {
      conds.push(f.disabled ? isNotNull(credentials.disabledAt) : isNull(credentials.disabledAt))
    }
    const whereClause = conds.length > 0 ? and(...conds) : undefined
    const rows = this.drizzleDb
      .select()
      .from(credentials)
      .where(whereClause)
      .orderBy(asc(credentials.createdAt))
      .limit(f.limit ?? -1)
      .offset(f.offset ?? 0)
      .all()
    return rows.map((r) => credentialRowToDomain(r))
  }

  async saveCredential(cred: Credential): Promise<void> {
    this.drizzleDb
      .insert(credentials)
      .values(credentialDomainToRow(cred))
      .onConflictDoUpdate({
        target: credentials.id,
        set: credentialDomainToRow(cred),
      })
      .run()
  }

  async deleteCredential(id: CredentialId): Promise<void> {
    this.drizzleDb.delete(credentials).where(eq(credentials.id, id)).run()
  }

  /* ===== Credential refresh (distributed lock + circuit breaker) ===== */

  async listRunningRefreshJobs(credId: CredentialId): Promise<RefreshJob[]> {
    const rows = this.drizzleDb
      .select()
      .from(credentialRefreshJobs)
      .where(
        and(eq(credentialRefreshJobs.credId, credId), eq(credentialRefreshJobs.status, 'running')),
      )
      .all()
    return rows.map((r) => ({
      id: r.id,
      credId: r.credId as CredentialId,
      status: r.status as RefreshJob['status'],
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    }))
  }

  async createRefreshJob(job: RefreshJob): Promise<void> {
    const running = await this.listRunningRefreshJobs(job.credId)
    if (running.length > 0) {
      throw new ConflictError(`Refresh job already running for credential ${job.credId}`)
    }
    this.drizzleDb.insert(credentialRefreshJobs).values(job).run()
  }

  async completeRefreshJob(credId: CredentialId, status: 'ok' | 'failed'): Promise<void> {
    this.drizzleDb
      .update(credentialRefreshJobs)
      .set({ status, finishedAt: nowMs() })
      .where(
        and(eq(credentialRefreshJobs.credId, credId), eq(credentialRefreshJobs.status, 'running')),
      )
      .run()
  }

  async recordRefreshFailure(credId: CredentialId): Promise<number> {
    const row = this.drizzleDb
      .select({
        consecutiveFailures: credentials.consecutiveFailures,
        version: credentials.version,
      })
      .from(credentials)
      .where(eq(credentials.id, credId))
      .get()
    if (row === undefined) throw new NotFoundError('Credential', credId)
    const next = (row.consecutiveFailures ?? 0) + 1
    this.drizzleDb
      .update(credentials)
      .set({ consecutiveFailures: next, updatedAt: nowMs(), version: (row.version ?? 1) + 1 })
      .where(eq(credentials.id, credId))
      .run()
    return next
  }

  async countConsecutiveRefreshFailures(credId: CredentialId): Promise<number> {
    const row = this.drizzleDb
      .select({ consecutiveFailures: credentials.consecutiveFailures })
      .from(credentials)
      .where(eq(credentials.id, credId))
      .get()
    return row?.consecutiveFailures ?? 0
  }

  async disableCredential(credId: CredentialId): Promise<void> {
    const row = this.drizzleDb
      .select({ version: credentials.version, disabledAt: credentials.disabledAt })
      .from(credentials)
      .where(eq(credentials.id, credId))
      .get()
    if (row === undefined) return // idempotent
    if (row.disabledAt !== null) return // already disabled
    this.drizzleDb
      .update(credentials)
      .set({ disabledAt: nowMs(), updatedAt: nowMs(), version: (row.version ?? 1) + 1 })
      .where(eq(credentials.id, credId))
      .run()
  }

  async listTasksByCredential(credId: CredentialId): Promise<Task[]> {
    const rows = this.drizzleDb
      .select({ task: tasks })
      .from(taskCredentials)
      .innerJoin(tasks, eq(taskCredentials.taskId, tasks.id))
      .where(eq(taskCredentials.credentialId, credId))
      .all()
    return rows.map((r) => taskRowToDomain(r.task))
  }

  async attachCredentialToTask(taskId: TaskId, credId: CredentialId): Promise<void> {
    this.drizzleDb
      .insert(taskCredentials)
      .values({ taskId, credentialId: credId })
      .onConflictDoNothing()
      .run()
  }

  /* ===== Tags ===== */

  async getTag(id: TagId): Promise<Tag | null> {
    const row = this.drizzleDb.select().from(tags).where(eq(tags.id, id)).get()
    return row ? tagRowToDomain(row) : null
  }

  async listTags(filter?: TagFilter): Promise<Tag[]> {
    const f = filter ?? {}
    const conds: SQL[] = []
    if (f.name !== undefined) conds.push(eq(tags.name, f.name))
    const whereClause = conds.length > 0 ? and(...conds) : undefined
    const rows = this.drizzleDb
      .select()
      .from(tags)
      .where(whereClause)
      .orderBy(asc(tags.name))
      .limit(f.limit ?? -1)
      .offset(f.offset ?? 0)
      .all()
    return rows.map((r) => tagRowToDomain(r))
  }

  async saveTag(tag: Tag): Promise<void> {
    this.drizzleDb
      .insert(tags)
      .values(tagDomainToRow(tag))
      .onConflictDoUpdate({
        target: tags.id,
        set: tagDomainToRow(tag),
      })
      .run()
  }

  async deleteTag(id: TagId): Promise<void> {
    // FK ON DELETE CASCADE handles pipeline_tags; in better-sqlite3 we need
    // PRAGMA foreign_keys = ON; we set this in migrate() via the SQL DDL.
    this.drizzleDb.delete(tags).where(eq(tags.id, id)).run()
  }

  async attachTag(taskId: TaskId, tagId: TagId): Promise<void> {
    // Use INSERT OR IGNORE for idempotency
    this.drizzleDb
      .insert(pipelineTags)
      .values({ taskId, tagId, attachedAt: nowMs() })
      .onConflictDoNothing()
      .run()
  }

  async detachTag(taskId: TaskId, tagId: TagId): Promise<void> {
    this.drizzleDb
      .delete(pipelineTags)
      .where(and(eq(pipelineTags.taskId, taskId), eq(pipelineTags.tagId, tagId)))
      .run()
  }

  async listTagsByTask(taskId: TaskId): Promise<Tag[]> {
    const rows = this.drizzleDb
      .select({ tag: tags })
      .from(pipelineTags)
      .innerJoin(tags, eq(pipelineTags.tagId, tags.id))
      .where(eq(pipelineTags.taskId, taskId))
      .orderBy(asc(tags.name))
      .all()
    return rows.map((r) => tagRowToDomain(r.tag))
  }

  async listTasksByTag(tagId: TagId): Promise<Task[]> {
    const rows = this.drizzleDb
      .select({ task: tasks })
      .from(pipelineTags)
      .innerJoin(tasks, eq(pipelineTags.taskId, tasks.id))
      .where(and(eq(pipelineTags.tagId, tagId), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.createdAt))
      .all()
    return rows.map((r) => taskRowToDomain(r.task))
  }

  /* ===== RBAC + Refresh Tokens ===== */

  async listUserRoles(userId: UserId): Promise<readonly ResolvedUserRole[]> {
    const row = this.drizzleDb
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    if (row === undefined) return []
    const grants = BUILTIN_ROLE_GRANTS[row.role as BuiltinRole]
    if (grants === undefined) return []
    return [
      {
        id: `role:${row.role}`,
        name: row.role as BuiltinRole,
        scope: 'global',
        groupId: null,
        permissions: grants,
      },
    ]
  }

  async createRefreshToken(token: RefreshToken): Promise<void> {
    const existing = this.drizzleDb
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, token.tokenHash))
      .get()
    if (existing !== undefined) {
      throw new ConflictError(`RefreshToken ${token.id} already exists`)
    }
    this.drizzleDb
      .insert(refreshTokens)
      .values({
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        userAgent: token.userAgent ?? null,
        ip: token.ip ?? null,
        createdAt: token.createdAt,
        expiresAt: token.expiresAt,
      })
      .run()
  }

  async getRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    const row = this.drizzleDb
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .get()
    if (row === undefined) return null
    return {
      id: row.id,
      userId: row.userId as UserId,
      tokenHash: row.tokenHash,
      userAgent: row.userAgent ?? undefined,
      ip: row.ip ?? undefined,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    this.drizzleDb.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).run()
  }

  async listUserRefreshTokens(userId: UserId): Promise<readonly RefreshToken[]> {
    const rows = this.drizzleDb
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .orderBy(desc(refreshTokens.createdAt))
      .all()
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId as UserId,
      tokenHash: row.tokenHash,
      userAgent: row.userAgent ?? undefined,
      ip: row.ip ?? undefined,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }))
  }

  async revokeAllUserTokens(userId: UserId): Promise<number> {
    const result = this.drizzleDb
      .delete(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .run()
    return result.changes
  }

  /* ===== Audit ===== */

  async appendAudit(entry: AuditLog): Promise<void> {
    const existing = this.drizzleDb
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.id, entry.id))
      .get()
    if (existing !== undefined) {
      throw new ConflictError(`AuditLog ${entry.id} already exists`)
    }
    this.drizzleDb.insert(auditLogs).values(auditLogDomainToRow(entry)).run()
  }

  async listAuditLogs(filter?: AuditFilter): Promise<AuditLog[]> {
    const f = filter ?? {}
    const conds: SQL[] = []
    if (f.resourceKind !== undefined) conds.push(eq(auditLogs.resourceKind, f.resourceKind))
    if (f.resourceId !== undefined) conds.push(eq(auditLogs.resourceId, f.resourceId))
    if (f.actorId !== undefined) {
      conds.push(f.actorId === null ? isNull(auditLogs.actorId) : eq(auditLogs.actorId, f.actorId))
    }
    if (f.action !== undefined) conds.push(eq(auditLogs.action, f.action))
    if (f.from !== undefined) conds.push(gte(auditLogs.createdAt, f.from))
    if (f.to !== undefined) conds.push(lte(auditLogs.createdAt, f.to))
    const whereClause = conds.length > 0 ? and(...conds) : undefined
    const rows = this.drizzleDb
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(f.limit ?? -1)
      .offset(f.offset ?? 0)
      .all()
    return rows.map((r) => auditLogRowToDomain(r))
  }
}
