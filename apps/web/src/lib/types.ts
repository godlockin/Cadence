/**
 * API DTO types — single source of truth for the frontend.
 *
 * The backend returns camelCase projections of the snake_case domain
 * entities (see `toTaskResponse`/`toExecutionResponse` in the API routes).
 * Enum values are re-used from `@cadence/domain` so validation stays
 * shared between frontend and backend.
 */
import { z } from 'zod'
import {
  ConcurrencyPolicySchema,
  CredentialKindSchema,
  ExecutionTriggerSourceSchema,
  PayloadKindSchema,
  RetryBackoffSchema,
  TaskStatusSchema,
  TriggerKindSchema,
} from '@cadence/domain'

export {
  ConcurrencyPolicySchema,
  CredentialKindSchema,
  ExecutionTriggerSourceSchema,
  PayloadKindSchema,
  RetryBackoffSchema,
  TaskStatusSchema,
  TriggerKindSchema,
}

export type TaskStatus = z.infer<typeof TaskStatusSchema>
export type PayloadKind = z.infer<typeof PayloadKindSchema>
export type TriggerKind = z.infer<typeof TriggerKindSchema>
export type ConcurrencyPolicy = z.infer<typeof ConcurrencyPolicySchema>
export type RetryBackoff = z.infer<typeof RetryBackoffSchema>
export type CredentialKind = z.infer<typeof CredentialKindSchema>
export type ExecutionTriggerSource = z.infer<typeof ExecutionTriggerSourceSchema>

export const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  ownerId: z.string(),
  groupId: z.string().nullable(),
  payloadKind: PayloadKindSchema,
  payload: z.unknown(),
  triggerKind: TriggerKindSchema,
  triggerConfig: z.unknown(),
  status: TaskStatusSchema,
  cron: z.string().nullable(),
  timezone: z.string(),
  startAt: z.number().int().nullable(),
  endAt: z.number().int().nullable(),
  maxRetries: z.number().int(),
  retryBackoff: RetryBackoffSchema,
  concurrencyPolicy: ConcurrencyPolicySchema,
  jitterMs: z.number().int(),
  timeoutMs: z.number().int(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
})
export type Task = z.infer<typeof TaskSchema>

export const ExecutionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  status: TaskStatusSchema,
  triggerSource: ExecutionTriggerSourceSchema,
  triggeredBy: z.string().nullable(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  retryCount: z.number().int(),
  error: z.unknown(),
  result: z.unknown(),
  version: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type Execution = z.infer<typeof ExecutionSchema>

export const CredentialSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  kind: CredentialKindSchema,
  type: z.string(),
  expiresAt: z.number().int().nullable(),
  disabledAt: z.number().int().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
})
export type Credential = z.infer<typeof CredentialSchema>

export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(['owner', 'admin', 'editor', 'viewer']),
  isActive: z.boolean(),
  isSuperadmin: z.boolean(),
})
export type PublicUser = z.infer<typeof PublicUserSchema>

export const AuthResponseSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
})
export type AuthResponse = z.infer<typeof AuthResponseSchema>

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Group = z.infer<typeof GroupSchema>

export const AuditLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  resourceKind: z.string(),
  resourceId: z.string(),
  diff: z.unknown(),
  metadata: z.unknown(),
  createdAt: z.number().int(),
})
export type AuditLog = z.infer<typeof AuditLogSchema>

export interface HealthStatus {
  status: 'ok' | 'degraded'
  db: boolean
  scheduler: {
    running: boolean
    cron: boolean
    webhookRegistrations: number
    webhookCacheSize: number
    uptimeSeconds: number
  }
  uptime: number
  version: string
  ts: number
}

/** Execution stream events (SSE). */
export const SSEEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), execution: ExecutionSchema }),
  z.object({ type: z.literal('log'), line: z.string(), ts: z.number().int() }),
  z.object({ type: z.literal('status'), status: TaskStatusSchema, ts: z.number().int() }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type SSEEvent = z.infer<typeof SSEEventSchema>
