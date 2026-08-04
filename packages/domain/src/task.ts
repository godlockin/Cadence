/**
 * @cadence/domain — Task entity (top-level orchestrator unit).
 * PHASE 0: schema only. PHASE 1 validates against this.
 */
import { z } from 'zod'

/* ULID format: 26 chars, Crockford base32 (no I, L, O, U) */
export const TaskIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
export type TaskId = z.infer<typeof TaskIdSchema>

export const ExecutionIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
export type ExecutionId = z.infer<typeof ExecutionIdSchema>

export const TaskStatusSchema = z.enum([
  'pending',
  'scheduled',
  'queued',
  'dispatched',
  'running',
  'success',
  'failed',
  'cancelled',
  'suspended',
])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const PayloadKindSchema = z.enum(['pipeline', 'command', 'http', 'script', 'webhook'])
export type PayloadKind = z.infer<typeof PayloadKindSchema>

export const TriggerKindSchema = z.enum(['cron', 'manual', 'webhook', 'event'])
export type TriggerKind = z.infer<typeof TriggerKindSchema>

export const ConcurrencyPolicySchema = z.enum(['skip', 'queue', 'parallel', 'kill_old'])
export type ConcurrencyPolicy = z.infer<typeof ConcurrencyPolicySchema>

export const RetryBackoffSchema = z.enum(['fixed', 'exponential'])
export type RetryBackoff = z.infer<typeof RetryBackoffSchema>

export const TaskSchema = z.object({
  id: TaskIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  /* owner_id references a user (UUID), not a task ULID. */
  owner_id: z.string().min(1),
  group_id: TaskIdSchema.nullable(),
  payload_kind: PayloadKindSchema,
  payload_json: z.string(), // serialized payload config
  trigger_kind: TriggerKindSchema,
  trigger_config_json: z.string(), // cron expression / webhook path / event topic
  status: TaskStatusSchema.default('pending'),
  cron: z.string().nullable(),
  timezone: z.string().default('UTC'),
  start_at: z.number().int().nullable(), // ms epoch
  end_at: z.number().int().nullable(), // null = no end
  max_retries: z.number().int().min(0).default(0),
  retry_backoff: RetryBackoffSchema.default('exponential'),
  concurrency_policy: ConcurrencyPolicySchema.default('skip'),
  jitter_ms: z.number().int().min(0).default(0),
  timeout_ms: z.number().int().min(100).default(30000),
  tags: z.array(z.string()).default([]),
  notifications_json: z.string().nullable(),
  metadata_json: z.string().default('{}'),
  version: z.number().int().default(1),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
})
export type Task = z.infer<typeof TaskSchema>

/**
 * Partial patch for an existing task. Every save expects `expectedVersion`
 * to enforce optimistic locking — the adapter throws StaleVersionError
 * if the row's current version differs.
 *
 * id is required, all other fields optional.
 */
export const TaskPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    group_id: TaskIdSchema.nullable().optional(),
    payload_kind: PayloadKindSchema.optional(),
    payload_json: z.string().optional(),
    trigger_kind: TriggerKindSchema.optional(),
    trigger_config_json: z.string().optional(),
    status: TaskStatusSchema.optional(),
    cron: z.string().nullable().optional(),
    timezone: z.string().optional(),
    start_at: z.number().int().nullable().optional(),
    end_at: z.number().int().nullable().optional(),
    max_retries: z.number().int().min(0).optional(),
    retry_backoff: RetryBackoffSchema.optional(),
    concurrency_policy: ConcurrencyPolicySchema.optional(),
    jitter_ms: z.number().int().min(0).optional(),
    timeout_ms: z.number().int().min(100).optional(),
    tags: z.array(z.string()).optional(),
    notifications_json: z.string().nullable().optional(),
    metadata_json: z.string().optional(),
    expectedVersion: z.number().int(),
  })
  .strict()
export type TaskPatch = z.infer<typeof TaskPatchSchema>
