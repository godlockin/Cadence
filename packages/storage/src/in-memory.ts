/**
 * @cadence/storage — InMemoryStorageAdapter.
 *
 * Pure Map-based implementation. Used by:
 *  - sinker unit tests (PHASE 1A)
 *  - local dev without a DB
 *  - CI test runners
 *
 * NOT thread-safe. NOT durable. NOT for production.
 *
 * Supports:
 *  - full CRUD via the StorageAdapter contract
 *  - optimistic locking via Task.version / Execution.version / User.version
 *  - soft delete via Task.deleted_at
 *  - tag many-to-many via junction Map
 *  - filter combinations: ownerId/groupId/status/payloadKind/triggerKind/tags/q
 *  - pagination via limit/offset
 *
 * Sort:
 *  - default: createdAt desc (newest first)
 *  - caller-provided SortClause array applies in order
 *
 * All side effects are synchronous against in-process Maps but wrapped in
 * `Promise.resolve()` to match the StorageAdapter async contract.
 */

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
  User,
  UserId,
} from '@cadence/domain'
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

/* -------------------------------------------------------------------------
 * helpers
 * ------------------------------------------------------------------------- */

function matchQ<T extends string>(value: T, q: string | undefined): boolean {
  if (q === undefined || q === '') return true
  return value.toLowerCase().includes(q.toLowerCase())
}

function compareByClause<T extends Record<string, unknown>>(
  a: T,
  b: T,
  clauses: readonly SortClause<string>[] | undefined,
): number {
  if (!clauses || clauses.length === 0) return 0
  for (const c of clauses) {
    const av = a[c.field]
    const bv = b[c.field]
    if (av === bv) continue
    if (av === undefined || av === null) return 1
    if (bv === undefined || bv === null) return -1
    if (av < bv) return c.direction === 'asc' ? -1 : 1
    if (av > bv) return c.direction === 'asc' ? 1 : -1
  }
  return 0
}

function paginate<T>(items: readonly T[], limit?: number, offset?: number): T[] {
  const off = offset ?? 0
  if (limit === undefined) return items.slice(off)
  return items.slice(off, off + limit)
}

function nowMs(): number {
  return Date.now()
}

/* -------------------------------------------------------------------------
 * InMemoryStorageAdapter
 * ------------------------------------------------------------------------- */

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly tasks = new Map<TaskId, Task>()
  private readonly executions = new Map<ExecutionId, Execution>()
  private readonly users = new Map<UserId, User>()
  private readonly groups = new Map<GroupId, Group>()
  private readonly credentials = new Map<CredentialId, Credential>()
  private readonly tags = new Map<TagId, Tag>()
  /** taskId -> Set<tagId> */
  private readonly taskTags = new Map<TaskId, Set<TagId>>()
  private readonly audit: AuditLog[] = []
  /** userId -> RoleId -> assignment (for RBAC). InMemory starts empty. */
  private readonly userRoles = new Map<UserId, Map<string, ResolvedUserRole>>()
  /** tokenHash -> RefreshToken (id is also stored for ergonomics). */
  private readonly refreshTokens = new Map<string, RefreshToken>()
  /** refresh-job ledger — running jobs are the distributed lock. */
  private readonly refreshJobs = new Map<string, RefreshJob>()
  /** taskId -> Set<credentialId> (dependency for pause-on-disable). */
  private readonly taskCredentials = new Map<TaskId, Set<CredentialId>>()

  /* ===== Lifecycle ===== */

  async migrate(): Promise<void> {
    // no-op — schema is implicit in the Maps
  }

  async close(): Promise<void> {
    // no-op — nothing to release
  }

  /* ===== Tasks ===== */

  async getTask(id: TaskId): Promise<Task | null> {
    const row = this.tasks.get(id)
    return row ?? null
  }

  async listTasks(
    filter?: TaskFilter,
    sort?: readonly SortClause<keyof Task & string>[],
  ): Promise<Task[]> {
    const f = filter ?? {}
    let rows = Array.from(this.tasks.values())

    if (!f.includeDeleted) {
      rows = rows.filter((r) => r.deleted_at === null)
    }
    if (f.ownerId !== undefined) {
      const owner = f.ownerId
      rows = rows.filter((r) => r.owner_id === owner)
    }
    if (f.groupId !== undefined) {
      const group = f.groupId
      rows = rows.filter((r) => r.group_id === group)
    }
    if (f.status !== undefined) {
      const status = f.status
      rows = rows.filter((r) => r.status === status)
    }
    if (f.payloadKind !== undefined) {
      const pk = f.payloadKind
      rows = rows.filter((r) => r.payload_kind === pk)
    }
    if (f.triggerKind !== undefined) {
      const tk = f.triggerKind
      rows = rows.filter((r) => r.trigger_kind === tk)
    }
    if (f.tags !== undefined && f.tags.length > 0) {
      const want = new Set(f.tags)
      rows = rows.filter((r) => {
        const attached = this.taskTags.get(r.id)
        if (!attached) return false
        for (const t of want) {
          if (attached.has(t)) return true
        }
        return false
      })
    }
    if (f.q !== undefined && f.q !== '') {
      const q = f.q
      rows = rows.filter((r) => matchQ(r.name, q))
    }

    const clauses: readonly SortClause<string>[] | undefined = sort
      ? (sort as readonly SortClause<string>[])
      : ([{ field: 'created_at', direction: 'desc' }] as const)
    rows.sort((a, b) =>
      compareByClause(
        a as unknown as Record<string, unknown>,
        b as unknown as Record<string, unknown>,
        clauses,
      ),
    )

    return paginate(rows, f.limit, f.offset)
  }

  async saveTask(task: Task): Promise<void> {
    if (this.tasks.has(task.id)) {
      throw new ConflictError(`Task ${task.id} already exists`)
    }
    this.tasks.set(task.id, { ...task })
  }

  async updateTask(id: TaskId, patch: TaskPatch): Promise<Task> {
    const existing = this.tasks.get(id)
    if (existing === undefined) {
      throw new NotFoundError('Task', id)
    }
    if (existing.version !== patch.expectedVersion) {
      throw new StaleVersionError('Task', patch.expectedVersion, existing.version)
    }
    const merged = this.applyTaskPatch(existing, patch)
    this.tasks.set(id, merged)
    return merged
  }

  async deleteTask(id: TaskId, expectedVersion: number): Promise<void> {
    const existing = this.tasks.get(id)
    if (existing === undefined) return // idempotent
    if (existing.version !== expectedVersion) {
      throw new StaleVersionError('Task', expectedVersion, existing.version)
    }
    if (existing.deleted_at !== null) return // already deleted
    const ts = nowMs()
    const merged: Task = {
      ...existing,
      deleted_at: ts,
      updated_at: ts,
      version: existing.version + 1,
    }
    this.tasks.set(id, merged)
  }

  private applyTaskPatch(existing: Task, patch: TaskPatch): Task {
    const ts = nowMs()
    const next: Task = { ...existing }
    if (patch.name !== undefined) next.name = patch.name
    if (patch.description !== undefined) next.description = patch.description
    if (patch.group_id !== undefined) next.group_id = patch.group_id
    if (patch.payload_kind !== undefined) next.payload_kind = patch.payload_kind
    if (patch.payload_json !== undefined) next.payload_json = patch.payload_json
    if (patch.trigger_kind !== undefined) next.trigger_kind = patch.trigger_kind
    if (patch.trigger_config_json !== undefined)
      next.trigger_config_json = patch.trigger_config_json
    if (patch.status !== undefined) next.status = patch.status
    if (patch.cron !== undefined) next.cron = patch.cron
    if (patch.timezone !== undefined) next.timezone = patch.timezone
    if (patch.start_at !== undefined) next.start_at = patch.start_at
    if (patch.end_at !== undefined) next.end_at = patch.end_at
    if (patch.max_retries !== undefined) next.max_retries = patch.max_retries
    if (patch.retry_backoff !== undefined) next.retry_backoff = patch.retry_backoff
    if (patch.concurrency_policy !== undefined) next.concurrency_policy = patch.concurrency_policy
    if (patch.jitter_ms !== undefined) next.jitter_ms = patch.jitter_ms
    if (patch.timeout_ms !== undefined) next.timeout_ms = patch.timeout_ms
    if (patch.tags !== undefined) next.tags = patch.tags
    if (patch.notifications_json !== undefined) next.notifications_json = patch.notifications_json
    if (patch.metadata_json !== undefined) next.metadata_json = patch.metadata_json

    next.updated_at = ts
    next.version = existing.version + 1
    return next
  }

  /* ===== Executions ===== */

  async getExecution(id: ExecutionId): Promise<Execution | null> {
    const row = this.executions.get(id)
    return row ?? null
  }

  async listExecutions(
    filter?: ExecutionFilter,
    sort?: readonly SortClause<keyof Execution & string>[],
  ): Promise<Execution[]> {
    const f = filter ?? {}
    let rows = Array.from(this.executions.values())

    if (f.taskId !== undefined) {
      const tid = f.taskId
      rows = rows.filter((r) => r.taskId === tid)
    }
    if (f.status !== undefined) {
      const s = f.status
      rows = rows.filter((r) => r.status === s)
    }
    if (f.triggerSource !== undefined) {
      const ts = f.triggerSource
      rows = rows.filter((r) => r.triggerSource === ts)
    }
    if (f.from !== undefined) {
      const from = f.from
      rows = rows.filter((r) => r.startedAt !== null && r.startedAt >= from)
    }
    if (f.to !== undefined) {
      const to = f.to
      rows = rows.filter((r) => r.startedAt !== null && r.startedAt <= to)
    }

    const clauses: readonly SortClause<string>[] | undefined = sort
      ? (sort as readonly SortClause<string>[])
      : ([{ field: 'createdAt', direction: 'desc' }] as const)
    rows.sort((a, b) =>
      compareByClause(
        a as unknown as Record<string, unknown>,
        b as unknown as Record<string, unknown>,
        clauses,
      ),
    )

    return paginate(rows, f.limit, f.offset)
  }

  async createExecution(exec: Execution): Promise<void> {
    if (this.executions.has(exec.id)) {
      throw new ConflictError(`Execution ${exec.id} already exists`)
    }
    this.executions.set(exec.id, { ...exec })
  }

  async updateExecution(id: ExecutionId, patch: ExecutionPatch): Promise<Execution> {
    const existing = this.executions.get(id)
    if (existing === undefined) {
      throw new NotFoundError('Execution', id)
    }
    if (existing.version !== patch.expectedVersion) {
      throw new StaleVersionError('Execution', patch.expectedVersion, existing.version)
    }
    const ts = nowMs()
    const next: Execution = { ...existing }
    if (patch.status !== undefined) next.status = patch.status
    if (patch.startedAt !== undefined) next.startedAt = patch.startedAt
    if (patch.finishedAt !== undefined) next.finishedAt = patch.finishedAt
    if (patch.durationMs !== undefined) next.durationMs = patch.durationMs
    if (patch.retryCount !== undefined) next.retryCount = patch.retryCount
    if (patch.errorJson !== undefined) next.errorJson = patch.errorJson
    if (patch.resultJson !== undefined) next.resultJson = patch.resultJson
    next.updatedAt = ts
    next.version = existing.version + 1
    this.executions.set(id, next)
    return next
  }

  /* ===== Users ===== */

  async getUser(id: UserId): Promise<User | null> {
    const row = this.users.get(id)
    return row ?? null
  }

  async getUserByEmail(email: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return u
    }
    return null
  }

  async listUsers(filter?: UserFilter): Promise<User[]> {
    const f = filter ?? {}
    let rows = Array.from(this.users.values())
    if (f.role !== undefined) {
      const role = f.role
      rows = rows.filter((r) => r.role === role)
    }
    if (f.email !== undefined) {
      const email = f.email
      rows = rows.filter((r) => r.email === email)
    }
    rows.sort((a, b) =>
      compareByClause(
        a as unknown as Record<string, unknown>,
        b as unknown as Record<string, unknown>,
        [{ field: 'createdAt', direction: 'desc' }],
      ),
    )
    return paginate(rows, f.limit, f.offset)
  }

  async saveUser(user: User): Promise<void> {
    for (const u of this.users.values()) {
      if (u.email === user.email && u.id !== user.id) {
        throw new ConflictError(`User email ${user.email} already in use`)
      }
    }
    this.users.set(user.id, { ...user })
  }

  /* ===== Groups ===== */

  async getGroup(id: GroupId): Promise<Group | null> {
    return this.groups.get(id) ?? null
  }

  async listGroups(filter?: GroupFilter): Promise<Group[]> {
    const f = filter ?? {}
    let rows = Array.from(this.groups.values())
    if (f.ownerId !== undefined) {
      const owner = f.ownerId
      rows = rows.filter((r) => r.ownerId === owner)
    }
    rows.sort((a, b) =>
      compareByClause(
        a as unknown as Record<string, unknown>,
        b as unknown as Record<string, unknown>,
        [{ field: 'createdAt', direction: 'desc' }],
      ),
    )
    return paginate(rows, f.limit, f.offset)
  }

  async saveGroup(group: Group): Promise<void> {
    this.groups.set(group.id, { ...group })
  }

  async deleteGroup(id: GroupId): Promise<void> {
    this.groups.delete(id)
  }

  async isGroupMember(groupId: GroupId, userId: UserId): Promise<boolean> {
    /* The current model has no separate group-membership table; the
     * group owner is implicitly a member. This is a conservative
     * fail-closed default that lets the IDOR guard reject strangers
     * while still letting owners trigger their own group's tasks.
     *
     * If a user has been assigned a group-scoped role, they also count
     * as a member (covers seeded roles via the RBAC bridge). */
    const g = this.groups.get(groupId)
    if (!g) return false
    if (g.ownerId === userId) return true
    const roleMap = this.userRoles.get(userId)
    if (roleMap !== undefined) {
      for (const r of roleMap.values()) {
        if (r.scope === 'group' && r.groupId === groupId) return true
      }
    }
    return false
  }

  /* ===== RBAC roles ===== */

  async listUserRoles(userId: UserId): Promise<readonly ResolvedUserRole[]> {
    const map = this.userRoles.get(userId)
    if (map === undefined) return []
    return Array.from(map.values()).map((r) => ({
      id: r.id,
      name: r.name,
      scope: r.scope,
      groupId: r.groupId,
      permissions: r.permissions.map((p) => ({ action: p.action, scope: p.scope })),
    }))
  }

  /* Test/admin helper — assign a role to a user. Not part of the
   * StorageAdapter contract; lets InMemoryStorageAdapter drive RBAC
   * tests without a roles table. */
  setUserRole(userId: UserId, role: ResolvedUserRole): void {
    let map = this.userRoles.get(userId)
    if (map === undefined) {
      map = new Map()
      this.userRoles.set(userId, map)
    }
    map.set(role.id, role)
  }

  /* ===== Refresh tokens ===== */

  async createRefreshToken(token: RefreshToken): Promise<void> {
    if (this.refreshTokens.has(token.tokenHash)) {
      throw new ConflictError(`RefreshToken ${token.id} already exists`)
    }
    this.refreshTokens.set(token.tokenHash, { ...token })
  }

  async getRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    return this.refreshTokens.get(tokenHash) ?? null
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    this.refreshTokens.delete(tokenHash)
  }

  async listUserRefreshTokens(userId: UserId): Promise<readonly RefreshToken[]> {
    const out: RefreshToken[] = []
    for (const t of this.refreshTokens.values()) {
      if (t.userId === userId) out.push({ ...t })
    }
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }

  async revokeAllUserTokens(userId: UserId): Promise<number> {
    let count = 0
    for (const [hash, t] of this.refreshTokens.entries()) {
      if (t.userId === userId) {
        this.refreshTokens.delete(hash)
        count++
      }
    }
    return count
  }

  /* ===== Credentials ===== */

  async getCredential(id: CredentialId): Promise<Credential | null> {
    return this.credentials.get(id) ?? null
  }

  async listCredentials(filter?: CredentialFilter): Promise<Credential[]> {
    const f = filter ?? {}
    let rows = Array.from(this.credentials.values())
    if (f.ownerId !== undefined) {
      const owner = f.ownerId
      rows = rows.filter((r) => r.ownerId === owner)
    }
    if (f.kind !== undefined) {
      const k = f.kind
      rows = rows.filter((r) => r.kind === k)
    }
    if (f.type !== undefined) {
      const t = f.type
      rows = rows.filter((r) => (r.type ?? 'static_token') === t)
    }
    if (f.expiresBefore !== undefined) {
      const before = f.expiresBefore
      rows = rows.filter(
        (r) => r.expiresAt !== null && r.expiresAt !== undefined && r.expiresAt <= before,
      )
    }
    if (f.disabled !== undefined) {
      const want = f.disabled
      rows = rows.filter((r) => (r.disabledAt !== null && r.disabledAt !== undefined) === want)
    }
    rows.sort((a, b) =>
      compareByClause(
        a as unknown as Record<string, unknown>,
        b as unknown as Record<string, unknown>,
        [{ field: 'createdAt', direction: 'desc' }],
      ),
    )
    return paginate(rows, f.limit, f.offset)
  }

  async saveCredential(cred: Credential): Promise<void> {
    this.credentials.set(cred.id, { ...cred })
  }

  async deleteCredential(id: CredentialId): Promise<void> {
    this.credentials.delete(id)
  }

  /* ===== Credential refresh (distributed lock + circuit breaker) ===== */

  async listRunningRefreshJobs(credId: CredentialId): Promise<RefreshJob[]> {
    const out: RefreshJob[] = []
    for (const job of this.refreshJobs.values()) {
      if (job.credId === credId && job.status === 'running') out.push({ ...job })
    }
    return out
  }

  async createRefreshJob(job: RefreshJob): Promise<void> {
    const running = await this.listRunningRefreshJobs(job.credId)
    if (running.length > 0) {
      throw new ConflictError(`Refresh job already running for credential ${job.credId}`)
    }
    this.refreshJobs.set(job.id, { ...job })
  }

  async completeRefreshJob(credId: CredentialId, status: 'ok' | 'failed'): Promise<void> {
    for (const [id, job] of this.refreshJobs.entries()) {
      if (job.credId === credId && job.status === 'running') {
        this.refreshJobs.set(id, { ...job, status, finishedAt: Date.now() })
      }
    }
  }

  async recordRefreshFailure(credId: CredentialId): Promise<number> {
    const current = this.credentials.get(credId)
    if (current === undefined) throw new NotFoundError('Credential', credId)
    const next = current.consecutiveFailures ?? 0
    const updated: Credential = {
      ...current,
      consecutiveFailures: next + 1,
      updatedAt: Date.now(),
      version: (current.version ?? 1) + 1,
    }
    this.credentials.set(credId, updated)
    return next + 1
  }

  async countConsecutiveRefreshFailures(credId: CredentialId): Promise<number> {
    const current = this.credentials.get(credId)
    return current?.consecutiveFailures ?? 0
  }

  async disableCredential(credId: CredentialId): Promise<void> {
    const current = this.credentials.get(credId)
    if (current === undefined) return // idempotent
    if (current.disabledAt !== null && current.disabledAt !== undefined) return
    this.credentials.set(credId, {
      ...current,
      disabledAt: Date.now(),
      updatedAt: Date.now(),
      version: (current.version ?? 1) + 1,
    })
  }

  async listTasksByCredential(credId: CredentialId): Promise<Task[]> {
    const out: Task[] = []
    for (const [taskId, set] of this.taskCredentials.entries()) {
      if (!set.has(credId)) continue
      const row = this.tasks.get(taskId)
      if (row !== undefined && row.deleted_at === null) out.push(row)
    }
    out.sort((a, b) => b.created_at - a.created_at)
    return out
  }

  async attachCredentialToTask(taskId: TaskId, credId: CredentialId): Promise<void> {
    let set = this.taskCredentials.get(taskId)
    if (set === undefined) {
      set = new Set()
      this.taskCredentials.set(taskId, set)
    }
    set.add(credId)
  }

  /* ===== Tags ===== */

  async getTag(id: TagId): Promise<Tag | null> {
    return this.tags.get(id) ?? null
  }

  async listTags(filter?: TagFilter): Promise<Tag[]> {
    const f = filter ?? {}
    let rows = Array.from(this.tags.values())
    if (f.name !== undefined) {
      const name = f.name
      rows = rows.filter((r) => r.name === name)
    }
    rows.sort((a, b) => a.name.localeCompare(b.name))
    return paginate(rows, f.limit, f.offset)
  }

  async saveTag(tag: Tag): Promise<void> {
    this.tags.set(tag.id, { ...tag })
  }

  async deleteTag(id: TagId): Promise<void> {
    this.tags.delete(id)
    // cascade: remove from all task junctions
    for (const set of this.taskTags.values()) {
      set.delete(id)
    }
  }

  async attachTag(taskId: TaskId, tagId: TagId): Promise<void> {
    let set = this.taskTags.get(taskId)
    if (set === undefined) {
      set = new Set()
      this.taskTags.set(taskId, set)
    }
    set.add(tagId)
  }

  async detachTag(taskId: TaskId, tagId: TagId): Promise<void> {
    const set = this.taskTags.get(taskId)
    if (set === undefined) return
    set.delete(tagId)
    if (set.size === 0) this.taskTags.delete(taskId)
  }

  async listTagsByTask(taskId: TaskId): Promise<Tag[]> {
    const set = this.taskTags.get(taskId)
    if (set === undefined) return []
    const out: Tag[] = []
    for (const tagId of set) {
      const t = this.tags.get(tagId)
      if (t !== undefined) out.push(t)
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  async listTasksByTag(tagId: TagId): Promise<Task[]> {
    const out: Task[] = []
    for (const [tid, set] of this.taskTags.entries()) {
      if (!set.has(tagId)) continue
      const row = this.tasks.get(tid)
      if (row !== undefined && row.deleted_at === null) out.push(row)
    }
    out.sort((a, b) => b.created_at - a.created_at)
    return out
  }

  /* ===== Audit ===== */

  async appendAudit(entry: AuditLog): Promise<void> {
    // append-only: scan for duplicate id (cheap because in-memory).
    for (const e of this.audit) {
      if (e.id === entry.id) {
        throw new ConflictError(`AuditLog ${entry.id} already exists`)
      }
    }
    this.audit.push({ ...entry })
  }

  async listAuditLogs(filter?: AuditFilter): Promise<AuditLog[]> {
    const f = filter ?? {}
    let rows = this.audit.slice()
    if (f.resourceKind !== undefined) {
      const rk = f.resourceKind
      rows = rows.filter((r) => r.resourceKind === rk)
    }
    if (f.resourceId !== undefined) {
      const rid = f.resourceId
      rows = rows.filter((r) => r.resourceId === rid)
    }
    if (f.actorId !== undefined) {
      const aid = f.actorId
      rows = rows.filter((r) => r.actorId === aid)
    }
    if (f.action !== undefined) {
      const a = f.action
      rows = rows.filter((r) => r.action === a)
    }
    if (f.from !== undefined) {
      const from = f.from
      rows = rows.filter((r) => r.createdAt >= from)
    }
    if (f.to !== undefined) {
      const to = f.to
      rows = rows.filter((r) => r.createdAt <= to)
    }
    rows.sort((a, b) => b.createdAt - a.createdAt)
    return paginate(rows, f.limit, f.offset)
  }
}
