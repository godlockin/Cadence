/**
 * @cadence/scheduler — LocalSchedulerAdapter.
 *
 * Node.js implementation: uses `setTimeout` for one-offs. Cron expressions
 * are pre-parsed at `scheduleCron()` time and the schedule runs as a
 * self-rearming `setTimeout` until cancelled.
 *
 * The injected `nextFireAt(spec, from)` lets the adapter stay agnostic of
 * cron-parser — production callers pass the helper from `./cron-parser.ts`.
 */
import type { TaskId } from '@cadence/domain'

import type { CronScheduleSpec, OneOffSchedule, SchedulerAdapter } from '../adapter.js'

export interface LocalSchedulerOptions {
  /** Returns the next fire time for a schedule. */
  readonly nextFireAt: (spec: CronScheduleSpec, from: number) => number | null
  /** Override setTimeout/clearTimeout for tests. */
  readonly setTimeoutFn?: (cb: () => void, ms: number) => NodeJS.Timeout | number
  readonly clearTimeoutFn?: (handle: NodeJS.Timeout | number) => void
  /** Called when a one-off fires. */
  readonly onFireOneOff?: (taskId: TaskId) => void
  /** Called when a cron fires. */
  readonly onFireCron?: (taskId: TaskId, fireAt: number) => void
  readonly now?: () => number
}

interface CronState {
  kind: 'cron'
  readonly spec: CronScheduleSpec
  handle: NodeJS.Timeout | number | null
}

interface OneOffState {
  readonly kind: 'one_off'
  readonly runAt: number
  readonly handle: NodeJS.Timeout | number
}

export class LocalSchedulerAdapter implements SchedulerAdapter {
  private readonly now: () => number
  private readonly nextFireAt: (spec: CronScheduleSpec, from: number) => number | null
  private readonly setTimeoutFn: (cb: () => void, ms: number) => NodeJS.Timeout | number
  private readonly clearTimeoutFn: (handle: NodeJS.Timeout | number) => void
  private readonly onFireOneOff?: (taskId: TaskId) => void
  private readonly onFireCron?: (taskId: TaskId, fireAt: number) => void
  private readonly state = new Map<TaskId, CronState | OneOffState>()

  constructor(opts: LocalSchedulerOptions) {
    this.now = opts.now ?? (() => Date.now())
    this.nextFireAt = opts.nextFireAt
    this.setTimeoutFn =
      opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms) as unknown as NodeJS.Timeout)
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as NodeJS.Timeout))
    if (opts.onFireOneOff) this.onFireOneOff = opts.onFireOneOff
    if (opts.onFireCron) this.onFireCron = opts.onFireCron
  }

  async schedule(taskId: TaskId, opts: OneOffSchedule): Promise<void> {
    await this.cancel(taskId)
    const delay = Math.max(0, opts.runAt - this.now())
    const handle = this.setTimeoutFn(() => {
      this.state.delete(taskId)
      if (this.onFireOneOff) this.onFireOneOff(taskId)
    }, delay)
    const entry: OneOffState = { kind: 'one_off', runAt: opts.runAt, handle }
    this.state.set(taskId, entry)
  }

  async scheduleCron(taskId: TaskId, opts: CronScheduleSpec): Promise<void> {
    await this.cancel(taskId)
    const initial = this.nextFireAt(opts, this.now())
    let entry: CronState = { kind: 'cron', spec: opts, handle: null }
    this.state.set(taskId, entry)
    if (initial === null) return
    const delay = Math.max(0, initial - this.now())
    entry = {
      ...entry,
      handle: this.setTimeoutFn(() => {
        this.armCron(taskId, initial)
      }, delay),
    }
    this.state.set(taskId, entry)
  }

  private armCron(taskId: TaskId, firedAt: number): void {
    const current = this.state.get(taskId)
    if (current === undefined || current.kind !== 'cron') return
    /* Notify the host AFTER the bookkeeping check so a cancel during fire
     * still suppresses side effects. */
    if (this.onFireCron) this.onFireCron(taskId, firedAt)
    const nextFire = this.nextFireAt(current.spec, this.now())
    if (nextFire === null) {
      this.state.delete(taskId)
      return
    }
    const still = this.state.get(taskId)
    if (still === undefined) return
    if (still.kind !== 'cron') return
    const delay = Math.max(0, nextFire - this.now())
    still.handle = this.setTimeoutFn(() => {
      this.armCron(taskId, nextFire)
    }, delay)
  }

  async cancel(taskId: TaskId): Promise<void> {
    const existing = this.state.get(taskId)
    if (existing !== undefined && existing.handle !== null) {
      try {
        this.clearTimeoutFn(existing.handle)
      } catch {
        /* swallow */
      }
    }
    this.state.delete(taskId)
  }

  async hasSchedule(taskId: TaskId): Promise<boolean> {
    return this.state.has(taskId)
  }

  async shutdown(): Promise<void> {
    for (const taskId of Array.from(this.state.keys())) {
      await this.cancel(taskId)
    }
  }

  /** Test helper — count. */
  size(): number {
    return this.state.size
  }
}
