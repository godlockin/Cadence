/**
 * @cadence/scheduler — SchedulerAdapter.
 *
 * A runtime-portable interface so the queue / app can request "schedule
 * this task to run at time T", "schedule it with a cron expression", or
 * "cancel the schedule" without caring whether the underlying runtime is:
 *
 *  - LocalSchedulerAdapter  → Node.js setTimeout / setInterval
 *  - CloudflareSchedulerAdapter → Durable Object alarm + Workers Cron Triggers
 *  - EmbeddedSchedulerAdapter → in-memory Map (tests + ephemeral scenarios)
 *
 * All three implementations guarantee that calling `schedule()` /
 * `scheduleCron()` for a `taskId` REPLACES any previous schedule for that
 * task (idempotent for the same taskId).
 */
import type { TaskId } from '@cadence/domain'

export interface OneOffSchedule {
  readonly runAt: number /* ms epoch */
}

export interface CronScheduleSpec {
  readonly cron: string
  readonly timezone: string
}

export interface SchedulerAdapter {
  /**
   * Schedule a one-off firing. `opts.runAt` is absolute ms.
   * Idempotent for the same `taskId` — replaces any prior schedule.
   */
  schedule(taskId: TaskId, opts: OneOffSchedule): Promise<void>

  /**
   * Schedule a recurring firing. Idempotent for the same `taskId`.
   */
  scheduleCron(taskId: TaskId, opts: CronScheduleSpec): Promise<void>

  /** Cancel any pending schedule for this task. Idempotent. */
  cancel(taskId: TaskId): Promise<void>

  /** For diagnostics: is there a pending schedule? */
  hasSchedule(taskId: TaskId): Promise<boolean>

  /** Stop the adapter — releases timers, alarms, intervals. */
  shutdown(): Promise<void>
}
