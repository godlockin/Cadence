/**
 * @cadence/storage — StorageAdapter contract.
 *
 * Single source of truth for the data layer. Three implementations:
 *  - InMemoryStorageAdapter  (PHASE 1A: unit tests + local dev)
 *  - SqliteStorageAdapter    (PHASE 2: better-sqlite3 + drizzle-orm)
 *  - D1StorageAdapter       (PHASE 2: Cloudflare D1 + drizzle-orm)
 *
 * PHASE 1A ships: interface + InMemory impl + Sqlite/D1 placeholders.
 *
 * Locking:
 *  - Tasks + Executions use **optimistic locking** via `expectedVersion`.
 *  - All other entities use plain upsert (save*) / hard-delete (delete*).
 *
 * Soft-delete:
 *  - Tasks are soft-deleted via `deleteTask` (sets `deleted_at`).
 *  - All other entities use hard-delete.
 *
 * Audit:
 *  - `appendAudit` is the ONLY place audit rows are created. Adapters
 *    enforce append-only semantics (duplicate id → ConflictError).
 *  - Callers wire mutation → appendAudit in the same transaction.
 */

import type {
  AuditAction,
  AuditLog,
  Credential,
  CredentialId,
  CredentialType,
  Execution,
  ExecutionId,
  ExecutionPatch,
  ExecutionTriggerSource,
  Group,
  GroupId,
  PermissionAction,
  PermissionScope,
  Tag,
  TagId,
  Task,
  TaskId,
  TaskPatch,
  TaskStatus,
  PayloadKind,
  TriggerKind,
  User,
  UserId,
} from '@cadence/domain'

/* -------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

export class StaleVersionError extends Error {
  public readonly resource: string
  public readonly expected: number
  public readonly actual: number
  constructor(resource: string, expected: number, actual: number) {
    super(`Stale version on ${resource}: expected ${String(expected)}, actual ${String(actual)}`)
    this.name = 'StaleVersionError'
    this.resource = resource
    this.expected = expected
    this.actual = actual
  }
}

export class NotFoundError extends Error {
  public readonly resource: string
  public readonly id: string
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`)
    this.name = 'NotFoundError'
    this.resource = resource
    this.id = id
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/* -------------------------------------------------------------------------
 * Filters & sorts
 * ------------------------------------------------------------------------- */

export interface TaskFilter {
  ownerId?: UserId
  groupId?: GroupId
  status?: TaskStatus
  payloadKind?: PayloadKind
  triggerKind?: TriggerKind
  /** match any of these tag IDs */
  tags?: readonly TagId[]
  /** fuzzy name match (case-insensitive substring) */
  q?: string
  /** when true, include rows with non-null deleted_at */
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface ExecutionFilter {
  taskId?: TaskId
  status?: TaskStatus
  triggerSource?: ExecutionTriggerSource
  /** startedAt >= from (ms epoch) */
  from?: number
  /** startedAt <= to (ms epoch) */
  to?: number
  limit?: number
  offset?: number
}

export interface UserFilter {
  role?: User['role']
  email?: string
  limit?: number
  offset?: number
}

export interface GroupFilter {
  ownerId?: UserId
  limit?: number
  offset?: number
}

export interface CredentialFilter {
  ownerId?: UserId
  kind?: Credential['kind']
  /** refresh type — e.g. 'oauth2_refresh_token' */
  type?: CredentialType
  /** only credentials whose expiresAt <= this value (ms epoch) */
  expiresBefore?: number
  /** true = only disabled; false = only non-disabled; undefined = all */
  disabled?: boolean
  limit?: number
  offset?: number
}

export interface TagFilter {
  name?: string
  limit?: number
  offset?: number
}

export interface AuditFilter {
  resourceKind?: AuditLog['resourceKind']
  resourceId?: string
  actorId?: UserId | null
  action?: AuditAction
  from?: number
  to?: number
  limit?: number
  offset?: number
}

export type SortDirection = 'asc' | 'desc'

export interface SortClause<TField extends string = string> {
  field: TField
  direction: SortDirection
}

/* -------------------------------------------------------------------------
 * RBAC + Auth types
 * ------------------------------------------------------------------------- */

export interface ResolvedPermission {
  readonly action: PermissionAction
  readonly scope: PermissionScope
}

export interface ResolvedUserRole {
  readonly id: string
  readonly name: string
  readonly scope: PermissionScope
  /** Non-null when `scope === 'group'`. */
  readonly groupId: GroupId | null
  readonly permissions: readonly ResolvedPermission[]
}

export interface RefreshToken {
  readonly id: string
  readonly userId: UserId
  readonly tokenHash: string
  readonly userAgent?: string
  readonly ip?: string
  readonly createdAt: number
  readonly expiresAt: number
}

/**
 * A row in the refresh-job ledger. Existence of a `running` row for a
 * credential is the distributed lock: the scheduler refuses to refresh a
 * credential that already has an unfinished (running) job.
 */
export interface RefreshJob {
  readonly id: string
  readonly credId: CredentialId
  readonly status: 'running' | 'ok' | 'failed'
  readonly startedAt: number
  readonly finishedAt: number | null
}

/* -------------------------------------------------------------------------
 * StorageAdapter — the contract
 * ------------------------------------------------------------------------- */

export interface StorageAdapter {
  /* ===== Tasks ===== */

  /** Get a task by ID. Returns the row even if soft-deleted; check `deleted_at`. */
  getTask(id: TaskId): Promise<Task | null>

  /** List tasks matching the filter. Returns newest-first by default. */
  listTasks(filter?: TaskFilter, sort?: readonly SortClause<keyof Task & string>[]): Promise<Task[]>

  /**
   * Insert a new task. Throws ConflictError if id already exists.
   */
  saveTask(task: Task): Promise<void>

  /**
   * Optimistic-locked update. Patch MUST contain `expectedVersion`.
   * Throws StaleVersionError on mismatch. Bumps version + updated_at on success.
   */
  updateTask(id: TaskId, patch: TaskPatch): Promise<Task>

  /** Soft-delete (sets deleted_at = now). Idempotent. */
  deleteTask(id: TaskId, expectedVersion: number): Promise<void>

  /* ===== Executions ===== */

  getExecution(id: ExecutionId): Promise<Execution | null>

  listExecutions(
    filter?: ExecutionFilter,
    sort?: readonly SortClause<keyof Execution & string>[],
  ): Promise<Execution[]>

  /** Insert new execution. Throws ConflictError on duplicate id. */
  createExecution(exec: Execution): Promise<void>

  /** Optimistic-locked update. Throws StaleVersionError on mismatch. */
  updateExecution(id: ExecutionId, patch: ExecutionPatch): Promise<Execution>

  /* ===== Users ===== */

  getUser(id: UserId): Promise<User | null>

  getUserByEmail(email: string): Promise<User | null>

  listUsers(filter?: UserFilter): Promise<User[]>

  /**
   * Upsert a user. Throws ConflictError if a DIFFERENT user already
   * has the same email (same id is allowed → in-place update).
   */
  saveUser(user: User): Promise<void>

  /* ===== Groups ===== */

  getGroup(id: GroupId): Promise<Group | null>

  listGroups(filter?: GroupFilter): Promise<Group[]>

  saveGroup(group: Group): Promise<void>

  /** Hard delete (no audit log is auto-emitted). */
  deleteGroup(id: GroupId): Promise<void>

  /**
   * Returns true iff the userId is a member of the groupId.
   * Implementations MUST return false (not throw) for unknown groups
   * so callers can use this as a fail-closed authorisation check.
   */
  isGroupMember(groupId: GroupId, userId: UserId): Promise<boolean>

  /* ===== RBAC roles ===== */

  /**
   * Resolve the active role-permission set for a user.
   *
   * The contract is intentionally generic: implementations may consult a
   * `user_groups` + `group_roles` + `role_permissions` join (DB) or a
   * in-memory map (InMemory). Returned shape:
   *  - `roles[i].id`        — stable role identifier
   *  - `roles[i].name`      — human-friendly label (e.g. "admin")
   *  - `roles[i].scope`     — 'global' | 'group' | 'own'
   *  - `roles[i].groupId`   — non-null when scope = 'group'
   *  - `roles[i].permissions` — every action this role grants
   */
  listUserRoles(userId: UserId): Promise<readonly ResolvedUserRole[]>

  /* ===== Refresh tokens ===== */

  createRefreshToken(token: RefreshToken): Promise<void>

  /** Lookup by hash. Returns null on miss. */
  getRefreshToken(tokenHash: string): Promise<RefreshToken | null>

  /** Hard delete. Idempotent. */
  revokeRefreshToken(tokenHash: string): Promise<void>

  /** All tokens currently issued to a user. */
  listUserRefreshTokens(userId: UserId): Promise<readonly RefreshToken[]>

  /** Revoke every token owned by a user. Returns count removed. */
  revokeAllUserTokens(userId: UserId): Promise<number>

  /* ===== Credentials ===== */

  getCredential(id: CredentialId): Promise<Credential | null>

  listCredentials(filter?: CredentialFilter): Promise<Credential[]>

  saveCredential(cred: Credential): Promise<void>

  /** Hard delete. */
  deleteCredential(id: CredentialId): Promise<void>

  /**
   * Distributed lock: return the currently-running refresh jobs for a
   * credential. Non-empty ⇒ another sweep is already refreshing it.
   */
  listRunningRefreshJobs(credId: CredentialId): Promise<RefreshJob[]>

  /**
   * Acquire the refresh lock. Throws ConflictError if a `running` job
   * already exists for this credential.
   */
  createRefreshJob(job: RefreshJob): Promise<void>

  /** Mark all running refresh jobs for a credential complete. Idempotent. */
  completeRefreshJob(credId: CredentialId, status: 'ok' | 'failed'): Promise<void>

  /** Record one more consecutive refresh failure. Returns the new count. */
  recordRefreshFailure(credId: CredentialId): Promise<number>

  /** Current consecutive-refresh-failure count (0 when none). */
  countConsecutiveRefreshFailures(credId: CredentialId): Promise<number>

  /** Disable a credential (sets disabledAt). Idempotent. */
  disableCredential(credId: CredentialId): Promise<void>

  /** Tasks that depend on this credential (for pause-on-disable). */
  listTasksByCredential(credId: CredentialId): Promise<Task[]>

  /** Record a task → credential dependency. Idempotent. */
  attachCredentialToTask(taskId: TaskId, credId: CredentialId): Promise<void>

  /* ===== Tags ===== */

  getTag(id: TagId): Promise<Tag | null>

  listTags(filter?: TagFilter): Promise<Tag[]>

  saveTag(tag: Tag): Promise<void>

  /** Hard delete. Cascades through task<->tag junctions. */
  deleteTag(id: TagId): Promise<void>

  /** Many-to-many: attach an existing tag to a task. Idempotent. */
  attachTag(taskId: TaskId, tagId: TagId): Promise<void>

  /** Many-to-many: detach. Idempotent. */
  detachTag(taskId: TaskId, tagId: TagId): Promise<void>

  /** All tags attached to a task, sorted by name asc. */
  listTagsByTask(taskId: TaskId): Promise<Tag[]>

  /** All tasks carrying a given tag (excludes soft-deleted). */
  listTasksByTag(tagId: TagId): Promise<Task[]>

  /* ===== Audit ===== */

  /**
   * Append an immutable audit entry. Duplicate id → ConflictError.
   */
  appendAudit(entry: AuditLog): Promise<void>

  listAuditLogs(filter?: AuditFilter): Promise<AuditLog[]>

  /* ===== Lifecycle ===== */

  /**
   * Run at startup. For real DBs this applies migrations.
   * For in-memory, this is a no-op.
   */
  migrate(): Promise<void>

  /** Close underlying connection. Idempotent. */
  close(): Promise<void>
}
