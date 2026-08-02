/**
 * @pulsedeck/domain — entity types + Zod schemas (single source of truth).
 * PHASE 0: skeleton. PHASE 1+ validates against these.
 */
import { z } from 'zod'

/* ----------------------------- User & Auth ----------------------------- */

export const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer'])
export type Role = z.infer<typeof RoleSchema>

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  role: RoleSchema,
  passwordHash: z.string().min(1),
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

/* ------------------------------ Credential ----------------------------- */

export const CredentialKindSchema = z.enum([
  'api-key',
  'oauth2',
  'basic',
  'bearer',
  'webhook-secret',
])
export type CredentialKind = z.infer<typeof CredentialKindSchema>

export const CredentialSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: CredentialKindSchema,
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  createdAt: z.string().datetime(),
})
export type Credential = z.infer<typeof CredentialSchema>

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
