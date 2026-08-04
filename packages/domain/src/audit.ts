/**
 * @cadence/domain — AuditLog entity (immutable append-only ledger).
 * PHASE 1: schema only.
 */
import { z } from 'zod'

export const AuditLogIdSchema = z.string().uuid()
export type AuditLogId = z.infer<typeof AuditLogIdSchema>

export const AuditActionSchema = z.enum([
  'task.create',
  'task.update',
  'task.delete',
  'task.restore',
  'task.triggered_via_cron',
  'task.triggered_via_webhook',
  'task.triggered_via_event',
  'task.triggered_manually',
  'task.concurrency_skipped',
  'execution.create',
  'execution.update',
  'execution.cancel',
  'user.create',
  'user.update',
  'user.delete',
  'credential.create',
  'credential.update',
  'credential.delete',
  'credential.refresh',
  'credential.rotate',
  'credential.disabled_after_failures',
  'group.create',
  'group.update',
  'group.delete',
  'role.assign',
  'role.revoke',
  'tag.attach',
  'tag.detach',
  'auth.login_success',
  'auth.login_failed',
  'auth.logout',
  'auth.logout_all',
  'auth.refresh',
  'auth.token_revoked',
  'auth.forbidden',
])
export type AuditAction = z.infer<typeof AuditActionSchema>

export const AuditResourceKindSchema = z.enum([
  'task',
  'execution',
  'user',
  'group',
  'credential',
  'tag',
  'role',
  'auth',
])
export type AuditResourceKind = z.infer<typeof AuditResourceKindSchema>

export const AuditLogSchema = z.object({
  id: AuditLogIdSchema,
  action: AuditActionSchema,
  actorId: z.string().uuid().nullable(), // userId or null (system)
  resourceKind: AuditResourceKindSchema,
  resourceId: z.string(),
  diffJson: z.string().default('{}'), // before/after snapshot
  metadataJson: z.string().default('{}'),
  createdAt: z.number().int(),
})
export type AuditLog = z.infer<typeof AuditLogSchema>
