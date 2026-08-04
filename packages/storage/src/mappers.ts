/**
 * @cadence/storage — row ↔ domain mappers.
 *
 * Bridges the snake_case DB shape (drizzle rows) and the camelCase domain
 * shapes from @cadence/domain.  Each mapper:
 *   - `toDomain(row)`  — DB row → entity
 *   - `toRow(entity)`  — entity → DB row (snake_case keys)
 *
 * Convention: domain field names are camelCase in Zod (e.g. `taskId`,
 * `createdAt`) but the in-memory + drizzle test fixtures already
 * normalize to `created_at` (per the domain Zod schema in @cadence/domain
 * — `created_at`, `updated_at`, `deleted_at` are snake_case in the Task
 * schema, while Execution uses camelCase like `createdAt`).
 *
 * To avoid surprise at the boundary, mappers are pure functions — no I/O.
 */
import type { AuditLog, Credential, Execution, Group, Tag, Task, User } from '@cadence/domain'
import {
  AuditLogSchema,
  CredentialSchema,
  ExecutionSchema,
  GroupSchema,
  TagSchema,
  TaskSchema,
  UserSchema,
} from '@cadence/domain'
import type {
  AuditLogRow,
  CredentialRow,
  ExecutionRow,
  GroupRow,
  TagRow,
  TaskRow,
  UserRow,
} from '@cadence/db'

/* -------------------------------------------------------------------------
 * Task
 * ------------------------------------------------------------------------- */

export function taskRowToDomain(row: TaskRow): Task {
  return TaskSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    owner_id: row.ownerId,
    group_id: row.groupId,
    payload_kind: row.payloadKind,
    payload_json: row.payloadJson,
    trigger_kind: row.triggerKind,
    trigger_config_json: row.triggerConfigJson,
    status: row.status,
    cron: row.cron,
    timezone: row.timezone,
    start_at: row.startAt,
    end_at: row.endAt,
    max_retries: row.maxRetries,
    retry_backoff: row.retryBackoff,
    concurrency_policy: row.concurrencyPolicy,
    jitter_ms: row.jitterMs,
    timeout_ms: row.timeoutMs,
    tags: row.tagsJson ? (JSON.parse(row.tagsJson) as string[]) : [],
    notifications_json: row.notificationsJson,
    metadata_json: row.metadataJson,
    version: row.version,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  })
}

export function taskDomainToRow(task: Task): TaskRow {
  return {
    id: task.id,
    name: task.name,
    description: task.description ?? null,
    ownerId: task.owner_id,
    groupId: task.group_id,
    payloadKind: task.payload_kind,
    payloadJson: task.payload_json,
    triggerKind: task.trigger_kind,
    triggerConfigJson: task.trigger_config_json,
    status: task.status,
    cron: task.cron,
    timezone: task.timezone,
    startAt: task.start_at,
    endAt: task.end_at,
    maxRetries: task.max_retries,
    retryBackoff: task.retry_backoff,
    concurrencyPolicy: task.concurrency_policy,
    jitterMs: task.jitter_ms,
    timeoutMs: task.timeout_ms,
    tagsJson: JSON.stringify(task.tags ?? []),
    notificationsJson: task.notifications_json,
    metadataJson: task.metadata_json,
    version: task.version,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    deletedAt: task.deleted_at,
  }
}

/* -------------------------------------------------------------------------
 * Execution
 * ------------------------------------------------------------------------- */

export function executionRowToDomain(row: ExecutionRow): Execution {
  return ExecutionSchema.parse({
    id: row.id,
    taskId: row.taskId,
    status: row.status,
    triggerSource: row.triggerSource,
    triggeredBy: row.triggeredBy,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    retryCount: row.retryCount,
    errorJson: row.errorJson,
    resultJson: row.resultJson,
    idempotencyKey: row.idempotencyKey,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function executionDomainToRow(exec: Execution): ExecutionRow {
  return {
    id: exec.id,
    taskId: exec.taskId,
    status: exec.status,
    triggerSource: exec.triggerSource,
    triggeredBy: exec.triggeredBy,
    startedAt: exec.startedAt,
    finishedAt: exec.finishedAt,
    durationMs: exec.durationMs,
    retryCount: exec.retryCount,
    errorJson: exec.errorJson,
    resultJson: exec.resultJson,
    idempotencyKey: exec.idempotencyKey,
    version: exec.version,
    createdAt: exec.createdAt,
    updatedAt: exec.updatedAt,
  }
}

/* -------------------------------------------------------------------------
 * User
 * ------------------------------------------------------------------------- */

export function userRowToDomain(row: UserRow): User {
  const raw = row as unknown as Record<string, unknown>
  return UserSchema.parse({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    passwordHash: row.passwordHash,
    isActive: raw['isActive'] === undefined ? true : Boolean(raw['isActive']),
    isSuperadmin: raw['isSuperadmin'] === undefined ? false : Boolean(raw['isSuperadmin']),
    mustChangePassword:
      raw['mustChangePassword'] === undefined ? false : Boolean(raw['mustChangePassword']),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function userDomainToRow(user: User): UserRow {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    passwordHash: user.passwordHash,
    isActive: user.isActive ? 1 : 0,
    isSuperadmin: user.isSuperadmin ? 1 : 0,
    mustChangePassword: user.mustChangePassword ? 1 : 0,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

/* -------------------------------------------------------------------------
 * Group
 * ------------------------------------------------------------------------- */

export function groupRowToDomain(row: GroupRow): Group {
  return GroupSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

export function groupDomainToRow(group: Group): GroupRow {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    ownerId: group.ownerId,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }
}

/* -------------------------------------------------------------------------
 * Credential
 * ------------------------------------------------------------------------- */

export function credentialRowToDomain(row: CredentialRow): Credential {
  return CredentialSchema.parse({
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    kind: row.kind,
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.authTag,
    createdAt: row.createdAt,
    type: row.type ?? undefined,
    keyId: row.keyId ?? undefined,
    clientSecretCiphertext: row.clientSecretCiphertext,
    clientSecretIv: row.clientSecretIv,
    clientSecretAuthTag: row.clientSecretAuthTag,
    tokenEndpoint: row.tokenEndpoint,
    clientId: row.clientId,
    expiresAt: row.expiresAt,
    lastRefreshedAt: row.lastRefreshedAt,
    consecutiveFailures: row.consecutiveFailures,
    disabledAt: row.disabledAt,
    refreshPolicy: {
      leadMinutes: row.refreshPolicyLeadMinutes,
      maxRetries: row.refreshPolicyMaxRetries,
      backoff: row.refreshPolicyBackoff,
      disabledOnFail: row.refreshPolicyDisabledOnFail === 1,
    },
    version: row.version,
    updatedAt: row.updatedAt,
  })
}

export function credentialDomainToRow(cred: Credential): CredentialRow {
  const policy = cred.refreshPolicy
  return {
    id: cred.id,
    ownerId: cred.ownerId,
    name: cred.name,
    kind: cred.kind,
    ciphertext: cred.ciphertext,
    iv: cred.iv,
    authTag: cred.authTag,
    createdAt: cred.createdAt,
    type: cred.type ?? null,
    keyId: cred.keyId ?? null,
    clientSecretCiphertext: cred.clientSecretCiphertext ?? null,
    clientSecretIv: cred.clientSecretIv ?? null,
    clientSecretAuthTag: cred.clientSecretAuthTag ?? null,
    tokenEndpoint: cred.tokenEndpoint ?? null,
    clientId: cred.clientId ?? null,
    expiresAt: cred.expiresAt ?? null,
    lastRefreshedAt: cred.lastRefreshedAt ?? null,
    consecutiveFailures: cred.consecutiveFailures ?? 0,
    disabledAt: cred.disabledAt ?? null,
    refreshPolicyLeadMinutes: policy?.leadMinutes ?? 5,
    refreshPolicyMaxRetries: policy?.maxRetries ?? 3,
    refreshPolicyBackoff: policy?.backoff ?? 'exponential',
    refreshPolicyDisabledOnFail: policy?.disabledOnFail === false ? 0 : 1,
    version: cred.version ?? 1,
    updatedAt: cred.updatedAt ?? null,
  }
}

/* -------------------------------------------------------------------------
 * Tag
 * ------------------------------------------------------------------------- */

export function tagRowToDomain(row: TagRow): Tag {
  return TagSchema.parse({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
  })
}

export function tagDomainToRow(tag: Tag): TagRow {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    createdAt: tag.createdAt,
  }
}

/* -------------------------------------------------------------------------
 * AuditLog
 * ------------------------------------------------------------------------- */

export function auditLogRowToDomain(row: AuditLogRow): AuditLog {
  return AuditLogSchema.parse({
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    resourceKind: row.resourceKind,
    resourceId: row.resourceId,
    diffJson: row.diffJson,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
  })
}

export function auditLogDomainToRow(entry: AuditLog): AuditLogRow {
  return {
    id: entry.id,
    action: entry.action,
    actorId: entry.actorId,
    resourceKind: entry.resourceKind,
    resourceId: entry.resourceId,
    diffJson: entry.diffJson,
    metadataJson: entry.metadataJson,
    createdAt: entry.createdAt,
  }
}
