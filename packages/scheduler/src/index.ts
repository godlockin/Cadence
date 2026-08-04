/**
 * @cadence/scheduler — Cron + Cloudflare DO Alarm adapter.
 *
 * PHASE 4 adds:
 *  - `CronTrigger`       (Node.js) — polls storage for due cron tasks
 *  - `EventTrigger`      (in-memory pub/sub) — fan out events to subscribed tasks
 *  - `WebhookTrigger`    (with idempotency dedup via SHA-256 of token+body)
 *  - `SchedulerHandle`   — the lifecycle wrapper used by both runtimes
 *  - `triggerTask(...)`  — single entry point that respects Task.concurrency_policy
 *  - `RetryPolicy`       — computes delays for Task.max_retries + backoff
 *
 * The scheduler is intentionally runtime-agnostic: it consumes the
 * `StorageAdapter` contract (PHASE 2) and a `triggerFn` callback supplied by
 * the host. Hosts inject either the real SinkerEngine.trigger() or a fake for
 * integration tests.
 */
import type { ExecutionId, Task, TaskId, TriggerContext } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

export interface SchedulerTick {
  readonly due: readonly Task[]
  readonly polledAt: Date
}

export interface SchedulerPort {
  /** compute next fire time for a task */
  next(task: Task, from: Date): Date | null
  /** start polling loop, emitting ticks via callback */
  start(storage: StorageAdapter, onTick: (tick: SchedulerTick) => Promise<void>): Promise<void>
  /** stop the loop gracefully */
  stop(): Promise<void>
}

export interface DurableObjectAlarmPort {
  /** schedule the next DO alarm for `scheduleId` at `at` */
  schedule(scheduleId: string, at: Date): Promise<void>
  /** cancel the upcoming alarm */
  cancel(scheduleId: string): Promise<void>
}

/**
 * The trigger function shape used by the scheduler. The host injects either
 * SinkerEngine.trigger() (production) or a recording fake (tests).
 *
 * Returning `null` means the trigger was intentionally skipped. Throwing
 * means an error path.
 */
export type TriggerFn = (
  taskId: TaskId,
  ctx: TriggerContext,
  opts: { userId: string; bypassGuard: boolean; bypassAuth: boolean },
) => Promise<ExecutionId | null>

export { CronTrigger, type CronTriggerOptions } from './cron-trigger.js'
export { EventTrigger, type EventTriggerOptions, parseTopic } from './event-trigger.js'
export {
  WebhookTrigger,
  type WebhookTriggerOptions,
  type WebhookFireOutcome,
} from './webhook-trigger.js'
export {
  ManualTrigger,
  type ManualTriggerOptions,
  type ManualFireResult,
} from './manual-trigger.js'
export { SchedulerHandle, type SchedulerHandleOptions, type SchedulerStatus } from './handle.js'
export {
  triggerTask,
  auditActionForTrigger,
  type TriggerReason,
  type TriggerOutcome,
} from './trigger.js'
export { RetryPolicy, type RetryDecision, type RetryPolicyOptions } from './retry-policy.js'
export { nextRetryDelay, type RetryBackoff, type RetryDelayOptions } from './retry.js'
export { checkConcurrency, ConcurrencyError, type ConcurrencyDecision } from './concurrency.js'
export {
  parseCron,
  nextFireAt,
  InvalidCronError,
  type CronSchedule,
  type NextOccurrences,
} from './cron-parser.js'
export type { SchedulerAdapter, OneOffSchedule, CronScheduleSpec } from './adapter.js'
export { EmbeddedSchedulerAdapter, type EmbeddedSchedulerOptions } from './adapters/embedded.js'
export { LocalSchedulerAdapter, type LocalSchedulerOptions } from './adapters/local.js'
export {
  CloudflareSchedulerAdapter,
  type CloudflareSchedulerOptions,
  type DoStub,
  type ResolveStub,
  type AlarmHandler,
} from './adapters/cloudflare.js'

export const VERSION = '0.4.0'
