/**
 * @cadence/db — drizzle ORM schema.
 *
 * Single source of truth for SQLite + Cloudflare D1 (same SQL dialect).
 *
 * Conventions:
 *  - TS field names: camelCase (matches @cadence/domain)
 *  - DB column names: snake_case
 *  - Primary keys: TEXT (ULID for tasks/executions/audit, UUID for users/groups/credentials/tags)
 *  - Timestamps: INTEGER ms epoch
 *  - Booleans: INTEGER 0/1
 *  - Soft delete: `deleted_at` column on tasks
 *  - Optimistic lock: `version` column on tasks/executions
 *
 * 9 logical tables (plus 4 RBAC junction tables for completeness):
 *   users, groups, user_groups,
 *   roles, permissions, role_permissions, group_roles,
 *   tasks, executions, credentials, tags, pipeline_tags, audit_logs
 */
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'

/* -------------------------------------------------------------------------
 * users
 * ------------------------------------------------------------------------- */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: integer('is_active').notNull().default(1),
    isSuperadmin: integer('is_superadmin').notNull().default(0),
    mustChangePassword: integer('must_change_password').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    emailUniq: uniqueIndex('users_email_uniq').on(t.email),
  }),
)
export type UserRow = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert

/* -------------------------------------------------------------------------
 * refresh_tokens — opaque, hash-addressed refresh sessions
 * ------------------------------------------------------------------------- */
export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => ({
    userIdIdx: index('refresh_tokens_user_idx').on(t.userId),
    tokenHashUniq: uniqueIndex('refresh_tokens_hash_uniq').on(t.tokenHash),
  }),
)
export type RefreshTokenRow = typeof refreshTokens.$inferSelect
export type RefreshTokenInsert = typeof refreshTokens.$inferInsert

/* -------------------------------------------------------------------------
 * groups
 * ------------------------------------------------------------------------- */
export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    ownerId: text('owner_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    ownerIdx: index('groups_owner_idx').on(t.ownerId),
  }),
)
export type GroupRow = typeof groups.$inferSelect
export type GroupInsert = typeof groups.$inferInsert

/* -------------------------------------------------------------------------
 * user_groups (m:n)
 * ------------------------------------------------------------------------- */
export const userGroups = sqliteTable(
  'user_groups',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.groupId] }),
  }),
)

/* -------------------------------------------------------------------------
 * roles / permissions / role_permissions / group_roles
 * ------------------------------------------------------------------------- */
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
})

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
})

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  }),
)

export const groupRoles = sqliteTable(
  'group_roles',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedAt: integer('assigned_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.roleId, t.userId] }),
  }),
)

/* -------------------------------------------------------------------------
 * tasks
 * ------------------------------------------------------------------------- */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: text('owner_id').notNull(),
    groupId: text('group_id'),
    payloadKind: text('payload_kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    triggerKind: text('trigger_kind').notNull(),
    triggerConfigJson: text('trigger_config_json').notNull(),
    status: text('status').notNull().default('pending'),
    cron: text('cron'),
    timezone: text('timezone').notNull().default('UTC'),
    startAt: integer('start_at'),
    endAt: integer('end_at'),
    maxRetries: integer('max_retries').notNull().default(0),
    retryBackoff: text('retry_backoff').notNull().default('exponential'),
    concurrencyPolicy: text('concurrency_policy').notNull().default('skip'),
    jitterMs: integer('jitter_ms').notNull().default(0),
    timeoutMs: integer('timeout_ms').notNull().default(30000),
    tagsJson: text('tags_json').notNull().default('[]'),
    notificationsJson: text('notifications_json'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => ({
    ownerIdx: index('tasks_owner_idx').on(t.ownerId),
    groupIdx: index('tasks_group_idx').on(t.groupId),
    statusIdx: index('tasks_status_idx').on(t.status),
    payloadKindIdx: index('tasks_payload_kind_idx').on(t.payloadKind),
    triggerKindIdx: index('tasks_trigger_kind_idx').on(t.triggerKind),
    deletedAtIdx: index('tasks_deleted_at_idx').on(t.deletedAt),
  }),
)
export type TaskRow = typeof tasks.$inferSelect
export type TaskInsert = typeof tasks.$inferInsert

/* -------------------------------------------------------------------------
 * executions
 * ------------------------------------------------------------------------- */
export const executions = sqliteTable(
  'executions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    status: text('status').notNull(),
    triggerSource: text('trigger_source').notNull(),
    triggeredBy: text('triggered_by'),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    durationMs: integer('duration_ms'),
    retryCount: integer('retry_count').notNull().default(0),
    errorJson: text('error_json'),
    resultJson: text('result_json'),
    idempotencyKey: text('idempotency_key'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    taskIdIdx: index('executions_task_id_idx').on(t.taskId),
    statusIdx: index('executions_status_idx').on(t.status),
    startedAtIdx: index('executions_started_at_idx').on(t.startedAt),
  }),
)
export type ExecutionRow = typeof executions.$inferSelect
export type ExecutionInsert = typeof executions.$inferInsert

/* -------------------------------------------------------------------------
 * credentials
 * ------------------------------------------------------------------------- */
export const credentials = sqliteTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    createdAt: text('created_at').notNull(),
    /* ---- PHASE 6: credential refresh model (all nullable for legacy rows) ---- */
    type: text('type'),
    keyId: text('key_id'),
    clientSecretCiphertext: text('client_secret_ciphertext'),
    clientSecretIv: text('client_secret_iv'),
    clientSecretAuthTag: text('client_secret_auth_tag'),
    tokenEndpoint: text('token_endpoint'),
    clientId: text('client_id'),
    expiresAt: integer('expires_at'),
    lastRefreshedAt: integer('last_refreshed_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    disabledAt: integer('disabled_at'),
    refreshPolicyLeadMinutes: integer('refresh_policy_lead_minutes').notNull().default(5),
    refreshPolicyMaxRetries: integer('refresh_policy_max_retries').notNull().default(3),
    refreshPolicyBackoff: text('refresh_policy_backoff').notNull().default('exponential'),
    refreshPolicyDisabledOnFail: integer('refresh_policy_disabled_on_fail').notNull().default(1),
    version: integer('version').notNull().default(1),
    updatedAt: integer('updated_at'),
  },
  (t) => ({
    ownerIdx: index('credentials_owner_idx').on(t.ownerId),
    kindIdx: index('credentials_kind_idx').on(t.kind),
    expiresAtIdx: index('credentials_expires_at_idx').on(t.expiresAt),
  }),
)
export type CredentialRow = typeof credentials.$inferSelect
export type CredentialInsert = typeof credentials.$inferInsert

/* -------------------------------------------------------------------------
 * credential_refresh_jobs — distributed-lock ledger for refresh sweeps
 * ------------------------------------------------------------------------- */
export const credentialRefreshJobs = sqliteTable(
  'credential_refresh_jobs',
  {
    id: text('id').primaryKey(),
    credId: text('cred_id').notNull(),
    status: text('status').notNull(), // running | ok | failed
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => ({
    credIdIdx: index('credential_refresh_jobs_cred_id_idx').on(t.credId),
    statusIdx: index('credential_refresh_jobs_status_idx').on(t.status),
  }),
)
export type CredentialRefreshJobRow = typeof credentialRefreshJobs.$inferSelect
export type CredentialRefreshJobInsert = typeof credentialRefreshJobs.$inferInsert

/* -------------------------------------------------------------------------
 * task_credentials — which tasks depend on which credential (pause on disable)
 * ------------------------------------------------------------------------- */
export const taskCredentials = sqliteTable(
  'task_credentials',
  {
    taskId: text('task_id').notNull(),
    credentialId: text('credential_id').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.credentialId] }),
    credentialIdx: index('task_credentials_credential_idx').on(t.credentialId),
  }),
)
export type TaskCredentialRow = typeof taskCredentials.$inferSelect
export type TaskCredentialInsert = typeof taskCredentials.$inferInsert

/* -------------------------------------------------------------------------
 * tags
 * ------------------------------------------------------------------------- */
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    nameUniq: uniqueIndex('tags_name_uniq').on(t.name),
  }),
)
export type TagRow = typeof tags.$inferSelect
export type TagInsert = typeof tags.$inferInsert

/* -------------------------------------------------------------------------
 * pipeline_tags (m:n)  — generic m:n (renamed from task_tags for forward compat)
 * ------------------------------------------------------------------------- */
export const pipelineTags = sqliteTable(
  'pipeline_tags',
  {
    taskId: text('task_id').notNull(),
    tagId: text('tag_id').notNull(),
    attachedAt: integer('attached_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.tagId] }),
    taskIdIdx: index('pipeline_tags_task_idx').on(t.taskId),
    tagIdIdx: index('pipeline_tags_tag_idx').on(t.tagId),
  }),
)

/* -------------------------------------------------------------------------
 * audit_logs
 * ------------------------------------------------------------------------- */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(),
    actorId: text('actor_id'),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    diffJson: text('diff_json').notNull().default('{}'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    resourceIdx: index('audit_logs_resource_idx').on(t.resourceKind, t.resourceId),
    actorIdx: index('audit_logs_actor_idx').on(t.actorId),
    actionIdx: index('audit_logs_action_idx').on(t.action),
    createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt),
  }),
)
export type AuditLogRow = typeof auditLogs.$inferSelect
export type AuditLogInsert = typeof auditLogs.$inferInsert

/* -------------------------------------------------------------------------
 * schema_migrations  (used by the runner in @cadence/db/src/migrate.ts)
 * ------------------------------------------------------------------------- */
export const schemaMigrations = sqliteTable('schema_migrations', {
  filename: text('filename').primaryKey(),
  checksum: text('checksum').notNull(),
  appliedAt: integer('applied_at').notNull(),
})
