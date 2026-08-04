/**
 * @cadence/scheduler — CronTrigger.
 *
 * Polls StorageAdapter on an interval, parses each task's `cron` field with
 * `cron-parser`, and dispatches any task whose next fire time is within the
 * poll window.
 *
 * Lifecycle:
 *   const cron = new CronTrigger({ triggerFn, intervalMs: 1000, systemActorId })
 *   await cron.start(storage)
 *   ...
 *   await cron.stop()
 *
 * Tests call `tick()` directly to advance the clock deterministically.
 */
import cronParser from 'cron-parser'
import type { Task, TaskId, TriggerContext } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

import type { SchedulerPort, TriggerFn } from './index.js'
import { triggerTask, type TriggerOutcome } from './trigger.js'

export interface CronTriggerOptions {
  readonly triggerFn: TriggerFn
  /** poll interval (default 1000ms) */
  readonly intervalMs?: number
  readonly systemActorId?: string
  /** Override clock for tests */
  readonly now?: () => number
  /** Sleep function (overridable for tests) */
  readonly sleep?: (ms: number) => Promise<void>
  /** Soft wall-clock cap (default 60000ms). */
  readonly maxRunMs?: number
}

export class CronTrigger implements SchedulerPort {
  private readonly intervalMs: number
  private readonly systemActorId: string
  private readonly triggerFn: TriggerFn
  private readonly now: () => number
  private readonly sleepFn: (ms: number) => Promise<void>
  private readonly maxRunMs: number

  private running = false
  private abortController: AbortController | null = null
  private readonly lastFire: Map<TaskId, number> = new Map()
  /** Per-task outcomes from the most recent tick (test introspection). */
  private lastOutcomes: TriggerOutcome[] = []

  constructor(opts: CronTriggerOptions) {
    this.triggerFn = opts.triggerFn
    this.intervalMs = opts.intervalMs ?? 1000
    this.systemActorId = opts.systemActorId ?? 'system:cron'
    this.now = opts.now ?? (() => Date.now())
    this.sleepFn = opts.sleep ?? defaultSleep
    this.maxRunMs = opts.maxRunMs ?? 60_000
  }

  /** Compute the next fire time for a task from `from`. */
  next(task: Task, from: Date): Date | null {
    if (typeof task.cron !== 'string' || task.cron.length === 0) return null
    try {
      const interval = cronParser.parseExpression(task.cron, {
        currentDate: from,
        tz: task.timezone ?? 'UTC',
      })
      const next = interval.next()
      return next.toDate()
    } catch {
      return null
    }
  }

  /** Compute next fire time relative to current `now`. */
  nextFromNow(task: Task): Date | null {
    return this.next(task, new Date(this.now()))
  }

  async start(storage: StorageAdapter): Promise<void> {
    if (this.running) return
    this.running = true
    const controller = new AbortController()
    this.abortController = controller
    const startedAt = this.now()
    while (!controller.signal.aborted) {
      if (this.now() - startedAt > this.maxRunMs) break
      await this.tick(storage).catch(() => {
        /* swallow per-tick errors so one bad task doesn't kill the loop */
      })
      if (controller.signal.aborted) break
      await this.sleepFn(this.intervalMs)
    }
    this.running = false
  }

  async stop(): Promise<void> {
    const ref = this.abortController
    if (ref !== null) {
      ref.abort()
      this.abortController = null
    }
  }

  /** Execute one polling round. Public so tests can drive it. */
  async tick(storage: StorageAdapter): Promise<TriggerOutcome[]> {
    const before = this.now()
    const tasks = await storage.listTasks({ triggerKind: 'cron', status: 'scheduled' })
    const outcomes: TriggerOutcome[] = []
    const aborted = this.abortController?.signal.aborted === true
    for (const task of tasks) {
      if (aborted) break
      /* Respect Task.start_at / Task.end_at window. */
      if (task.start_at !== null && before < task.start_at) continue
      if (task.end_at !== null && before > task.end_at) {
        /* Window expired — clear any prior lastFire marker so a future
         * re-enable (start_at moved forward) starts fresh. */
        this.lastFire.delete(task.id)
        continue
      }
      /* Decide if this task is due: compute the previous fire time and
       * compare it to the lastFire marker. If we've never fired AND the
       * "previous" minute already passed, we are due now. */
      const prevFireAt = this.previousFire(task, new Date(before))
      if (prevFireAt === null) continue
      const prev = this.lastFire.get(task.id) ?? 0
      /* Only fire if the previous slot is <= before AND we haven't already
       * fired it. Also enforce lower bound — don't fire a slot that
       * occurred before start_at even if start_at is in the past now
       * (the task was added later). */
      if (prevFireAt.getTime() > before) continue
      if (prev >= prevFireAt.getTime()) continue
      if (task.start_at !== null && prevFireAt.getTime() < task.start_at) {
        /* Don't skip — only set the marker so we don't re-fire this slot
         * when start_at is in the future we get to it. */
        this.lastFire.set(task.id, prevFireAt.getTime())
        continue
      }
      this.lastFire.set(task.id, prevFireAt.getTime())

      const ctx: TriggerContext = {
        source: 'cron',
        triggeredBy: this.systemActorId,
      }
      const outcome = await triggerTask(storage, this.triggerFn, task.id, ctx, this.systemActorId, {
        now: this.now,
      })
      outcomes.push(outcome)
    }
    this.lastOutcomes = outcomes
    return outcomes
  }

  /** Compute the previous fire time for a task from `from`. If `from` is
   * exactly on a boundary, this returns that boundary. Otherwise it
   * returns the most recent boundary BEFORE `from`. */
  previousFire(task: Task, from: Date): Date | null {
    if (typeof task.cron !== 'string' || task.cron.length === 0) return null
    try {
      const interval = cronParser.parseExpression(task.cron, {
        currentDate: from,
        tz: task.timezone ?? 'UTC',
        endDate: from /* clamp lookback to 'from' so we only get the prev */,
      })
      const prev = interval.prev()
      return prev.toDate()
    } catch {
      return null
    }
  }

  /** Out-comes from the most recent tick (test helper). */
  outcomes(): readonly TriggerOutcome[] {
    return this.lastOutcomes
  }

  isRunning(): boolean {
    return this.running
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
