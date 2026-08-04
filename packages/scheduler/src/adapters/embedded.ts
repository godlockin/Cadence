/**
 * @cadence/scheduler — EmbeddedSchedulerAdapter.
 *
 * Pure in-memory schedule registry. Used by:
 *  - Unit tests (no real timers, deterministic)
 *  - Embedded single-process deployments where the cron & webhook triggers
 *    own their own loop anyway and the adapter is just bookkeeping.
 *
 * Holds a Map<taskId, scheduleSpec> + a Map<taskId, NodeJS.Timeout>. `shutdown()`
 * clears all timers. Time can be injected via `now`.
 */
import type { TaskId } from '@cadence/domain'

import type { CronScheduleSpec, OneOffSchedule, SchedulerAdapter } from '../adapter.js'

export interface EmbeddedSchedulerOptions {
  readonly now?: () => number
  /** Replace setTimeout — used for deterministic tests. */
  readonly setTimeoutFn?: (cb: () => void, ms: number) => NodeJS.Timeout | number
  readonly clearTimeoutFn?: (handle: NodeJS.Timeout | number) => void
  /** Invoked when a scheduled firing "fires". */
  readonly onFire?: (taskId: TaskId) => void
}

interface PendingOneOff {
  readonly kind: 'one_off'
  readonly runAt: number
  readonly handle: NodeJS.Timeout | number
}

interface PendingCron {
  readonly kind: 'cron'
  readonly spec: CronScheduleSpec
}

type Pending = PendingOneOff | PendingCron

export class EmbeddedSchedulerAdapter implements SchedulerAdapter {
  private readonly now: () => number
  private readonly setTimeoutFn: (cb: () => void, ms: number) => NodeJS.Timeout | number
  private readonly clearTimeoutFn: (handle: NodeJS.Timeout | number) => void
  private readonly onFire?: (taskId: TaskId) => void
  private readonly pending = new Map<TaskId, Pending>()

  constructor(opts: EmbeddedSchedulerOptions = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.setTimeoutFn =
      opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms) as unknown as NodeJS.Timeout)
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as NodeJS.Timeout))
    if (opts.onFire) this.onFire = opts.onFire
  }

  async schedule(taskId: TaskId, opts: OneOffSchedule): Promise<void> {
    this.cancel(taskId)
    const delay = Math.max(0, opts.runAt - this.now())
    const handle = this.setTimeoutFn(() => {
      this.pending.delete(taskId)
      if (this.onFire) this.onFire(taskId)
    }, delay)
    this.pending.set(taskId, { kind: 'one_off', runAt: opts.runAt, handle })
  }

  async scheduleCron(taskId: TaskId, opts: CronScheduleSpec): Promise<void> {
    this.cancel(taskId)
    this.pending.set(taskId, { kind: 'cron', spec: opts })
  }

  async cancel(taskId: TaskId): Promise<void> {
    const existing = this.pending.get(taskId)
    if (existing !== undefined && existing.kind === 'one_off') {
      try {
        this.clearTimeoutFn(existing.handle)
      } catch {
        /* swallow */
      }
    }
    this.pending.delete(taskId)
  }

  async hasSchedule(taskId: TaskId): Promise<boolean> {
    return this.pending.has(taskId)
  }

  async shutdown(): Promise<void> {
    for (const [id] of this.pending) {
      await this.cancel(id)
    }
  }

  /** Test helper — count of pending schedules. */
  pendingCount(): number {
    return this.pending.size
  }
}
