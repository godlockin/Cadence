/**
 * @cadence/domain — Trigger types (caller context for a task firing).
 *
 * Moved from @cadence/sinker so @cadence/queue can import the
 * type without depending on sinker (breaks the sinker↔queue cycle).
 */
import type { TaskId, ExecutionId } from './task.js'

/* ---------------- Trigger context ---------------- */

export const TriggerSourceSchema = ['cron', 'manual', 'webhook', 'event'] as const
export type TriggerSource = (typeof TriggerSourceSchema)[number]

/**
 * Validated trigger input. The HTTP/CLI layer is responsible for parsing
 * and validating with Zod before calling SinkerEngine.trigger.
 */
export interface TriggerContext {
  readonly source: TriggerSource
  readonly triggeredBy?: string
  readonly payload?: Readonly<Record<string, unknown>>
  readonly idempotencyKey?: string
}

/* ---------------- Queue item ---------------- */

export interface QueueItem {
  readonly taskId: TaskId
  readonly executionId: ExecutionId
  readonly context: TriggerContext
  readonly enqueuedAt: number
}

/* ---------------- QueueAdapter port ---------------- */

export interface QueueAdapter {
  enqueue(item: QueueItem): Promise<void>
  dequeue(): Promise<QueueItem | null>
  size(): Promise<number>
}
