/**
 * @cadence/domain — Execution entity (single task run instance).
 * PHASE 1: schema only.
 */
import { z } from 'zod'
import { ExecutionIdSchema, TaskIdSchema, TaskStatusSchema } from './task.js'

export { ExecutionIdSchema } from './task.js'

export const ExecutionTriggerSourceSchema = z.enum(['cron', 'manual', 'webhook', 'event', 'retry'])
export type ExecutionTriggerSource = z.infer<typeof ExecutionTriggerSourceSchema>

export const ExecutionSchema = z.object({
  id: ExecutionIdSchema,
  taskId: TaskIdSchema,
  status: TaskStatusSchema,
  triggerSource: ExecutionTriggerSourceSchema,
  triggeredBy: z.string().uuid().nullable(), // userId or null (system)
  startedAt: z.number().int().nullable(), // ms epoch
  finishedAt: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  retryCount: z.number().int().min(0).default(0),
  errorJson: z.string().nullable(),
  resultJson: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  version: z.number().int().default(1),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type Execution = z.infer<typeof ExecutionSchema>

/**
 * Partial patch for an existing execution (only mutable fields).
 * version field is mandatory for optimistic locking.
 */
export const ExecutionPatchSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    startedAt: z.number().int().nullable().optional(),
    finishedAt: z.number().int().nullable().optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
    retryCount: z.number().int().min(0).optional(),
    errorJson: z.string().nullable().optional(),
    resultJson: z.string().nullable().optional(),
    expectedVersion: z.number().int(),
  })
  .strict()
export type ExecutionPatch = z.infer<typeof ExecutionPatchSchema>
