/**
 * @cadence/domain — entity types + Zod schemas (single source of truth).
 * PHASE 0: skeleton. PHASE 1+ validates against these.
 */
import { z } from 'zod'

/* Re-export the new top-level Task entity */
export * from './task.js'
export * from './execution.js'
export * from './group.js'
export * from './tag.js'
export * from './audit.js'
export * from './credential.js'
/* Queue + trigger types — single source of truth (extracted from @cadence/sinker
   so @cadence/queue can import without creating a sinker↔queue cycle). */
export * from './queue.js'

/* ----------------------------- User & Auth ----------------------------- */

export const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer'])
export type Role = z.infer<typeof RoleSchema>

/* Built-in RBAC role identifiers (separate from User.role which is a legacy
 * 4-level admin concept). These map to entries in the `roles` table managed by
 * @cadence/db. Permission resolution lives in @cadence/auth. */
export const BuiltinRoleSchema = z.enum(['super_admin', 'admin', 'operator', 'viewer'])
export type BuiltinRole = z.infer<typeof BuiltinRoleSchema>

export const UserIdSchema = z.string().uuid()
export type UserId = z.infer<typeof UserIdSchema>

export const UserSchema = z.object({
  id: UserIdSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  role: RoleSchema,
  passwordHash: z.string().min(1),
  isActive: z.boolean().default(true),
  isSuperadmin: z.boolean().default(false),
  mustChangePassword: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>

/* ------------------------------- Pipeline ------------------------------ */

export const NodeKindSchema = z.enum([
  'trigger',
  'fetch',
  'transform',
  'condition',
  'action',
  'output',
])
export type NodeKind = z.infer<typeof NodeKindSchema>

export const PipelineStatusSchema = z.enum(['draft', 'active', 'paused', 'archived'])
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>

export const PipelineDefinitionSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  status: PipelineStatusSchema,
  version: z.number().int().nonnegative(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type PipelineDefinition = z.infer<typeof PipelineDefinitionSchema>

/* ------------------------------ Schedule ------------------------------- */

export const ScheduleKindSchema = z.enum(['cron', 'interval', 'one-off', 'manual'])
export type ScheduleKind = z.infer<typeof ScheduleKindSchema>

export const ScheduleSchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid(),
  kind: ScheduleKindSchema,
  expression: z.string().min(1),
  timezone: z.string().default('UTC'),
  enabled: z.boolean(),
  nextRunAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type Schedule = z.infer<typeof ScheduleSchema>

/* -------------------------------- Run ---------------------------------- */

export const RunStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled'])
export type RunStatus = z.infer<typeof RunStatusSchema>

export const PipelineRunSchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid(),
  status: RunStatusSchema,
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  triggeredBy: z.enum(['schedule', 'manual', 'webhook', 'retry']),
})
export type PipelineRun = z.infer<typeof PipelineRunSchema>

export const VERSION = '0.1.0'

/* ----------------------------- RBAC types ----------------------------- */

/** Atomic permission action strings (resource:verb). Owned by domain so that
 * the storage + auth packages can refer to them without creating a cycle. */
export const PermissionActionSchema = z.enum([
  'pipeline:create',
  'pipeline:read',
  'pipeline:update',
  'pipeline:delete',
  'pipeline:trigger',
  'schedule:create',
  'schedule:read',
  'schedule:update',
  'schedule:delete',
  'schedule:trigger',
  'schedule:pause',
  'schedule:resume',
  'credential:create',
  'credential:read',
  'credential:update',
  'credential:delete',
  'credential:refresh',
  'user:invite',
  'user:read',
  'user:update',
  'user:delete',
  'user:assign_role',
  'group:create',
  'group:read',
  'group:update',
  'group:delete',
  'group:manage_members',
  'audit:read',
  'system:config',
])
export type PermissionAction = z.infer<typeof PermissionActionSchema>

export const PermissionScopeSchema = z.enum(['global', 'group', 'own'])
export type PermissionScope = z.infer<typeof PermissionScopeSchema>

/* -------------------------------------------------------------------------
 * Built-in role grants (single source of truth).
 *
 * Owned by @cadence/domain so both @cadence/auth (RBAC resolution) and
 * @cadence/storage (persisted role mapping for D1 / SQLite) can reference
 * the same grants without a package cycle.
 * ------------------------------------------------------------------------- */

export interface BuiltinGrant {
  readonly action: PermissionAction
  readonly scope: PermissionScope
}

const grant = (action: PermissionAction, scope: PermissionScope = 'global'): BuiltinGrant => ({
  action,
  scope,
})

export const BUILTIN_ROLE_GRANTS: Readonly<Record<BuiltinRole, readonly BuiltinGrant[]>> = {
  super_admin: (PermissionActionSchema.options as readonly PermissionAction[]).map((a) => grant(a)),
  admin: [
    'pipeline:create',
    'pipeline:read',
    'pipeline:update',
    'pipeline:delete',
    'pipeline:trigger',
    'schedule:create',
    'schedule:read',
    'schedule:update',
    'schedule:delete',
    'schedule:trigger',
    'schedule:pause',
    'schedule:resume',
    'credential:create',
    'credential:read',
    'credential:update',
    'credential:delete',
    'credential:refresh',
    'user:invite',
    'user:read',
    'user:update',
    'user:delete',
    'user:assign_role',
    'group:create',
    'group:read',
    'group:update',
    'group:delete',
    'group:manage_members',
    'audit:read',
  ].map((a) => grant(a as PermissionAction)),
  operator: [
    'pipeline:read',
    'pipeline:trigger',
    'schedule:read',
    'schedule:trigger',
    'schedule:pause',
    'schedule:resume',
    'credential:read',
    'audit:read',
  ].map((a) => grant(a as PermissionAction)),
  viewer: ['pipeline:read', 'schedule:read', 'credential:read', 'audit:read'].map((a) =>
    grant(a as PermissionAction),
  ),
}

export function grantsForBuiltinRole(role: BuiltinRole): readonly BuiltinGrant[] {
  return BUILTIN_ROLE_GRANTS[role]
}
