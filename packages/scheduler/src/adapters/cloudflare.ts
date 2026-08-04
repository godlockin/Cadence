/**
 * @cadence/scheduler — CloudflareSchedulerAdapter.
 *
 * Cloudflare Workers runtime. Two scheduling primitives are exposed:
 *
 *   1. DO Alarms — `binding.setAlarm(ms)` per task. Caller instantiates
 *      one Durable Object per task ID and we call `setAlarm` against the
 *      stub. On alarm fire the DO's `alarm()` handler calls back into
 *      the shared `triggerFn`.
 *
 *   2. Cron Triggers — `binding.scheduled(controller, env)` is fired by
 *      Cloudflare's cron expression that matches the wrangler.toml
 *      `triggers.crons` array. This adapter ignores cron expressions
 *      provided at runtime (they MUST be declared at deploy time), so
 *      `scheduleCron()` here becomes a bookkeeping-only operation: we
 *      record the schedule but only the deploy-time cron will actually
 *      fire it.
 *
 * The adapter is intentionally typed structurally — DO bindings are
 * injected as duck-typed `DoStub` / `DoEnv` shapes so this package does
 * NOT depend on `cloudflare:workers` or `wrangler`.
 */
import type { TaskId } from '@cadence/domain'

import type { CronScheduleSpec, OneOffSchedule, SchedulerAdapter } from '../adapter.js'

/** Minimal DO stub interface — matches `cloudflare:workers` `DurableObjectStub`. */
export interface DoStub {
  readonly id: { readonly toString: () => string }
  setAlarm(scheduledTime: number | Date): Promise<void>
  deleteAlarm?(): Promise<void>
}

/** Function that takes a taskId and returns the corresponding DO stub. */
export type ResolveStub = (taskId: TaskId) => Promise<DoStub> | DoStub

/** Hook called by the DO when its alarm fires. */
export type AlarmHandler = (taskId: TaskId) => Promise<void> | void

export interface CloudflareSchedulerOptions {
  readonly resolveStub: ResolveStub
  readonly now?: () => number
  /** Optional: register the cron-triggers expectation for diagnostics. */
  readonly deployCrons?: readonly string[]
  /** Helper for tests — invoked whenever scheduleCron() is called. */
  readonly onScheduleCron?: (taskId: TaskId, spec: CronScheduleSpec) => void
  /** Helper for tests — invoked whenever schedule() (one-off) is called. */
  readonly onScheduleOneOff?: (taskId: TaskId, runAt: number) => void
}

interface CronRecord {
  readonly kind: 'cron'
  readonly spec: CronScheduleSpec
}
interface OneOffRecord {
  readonly kind: 'one_off'
  readonly runAt: number
}
type Record = CronRecord | OneOffRecord

export class CloudflareSchedulerAdapter implements SchedulerAdapter {
  private readonly resolveStub: ResolveStub
  private readonly now: () => number
  private readonly deployCrons: readonly string[]
  private readonly onScheduleCron?: (taskId: TaskId, spec: CronScheduleSpec) => void
  private readonly onScheduleOneOff?: (taskId: TaskId, runAt: number) => void
  private readonly records = new Map<TaskId, Record>()

  constructor(opts: CloudflareSchedulerOptions) {
    this.resolveStub = opts.resolveStub
    this.now = opts.now ?? (() => Date.now())
    this.deployCrons = opts.deployCrons ?? []
    if (opts.onScheduleCron) this.onScheduleCron = opts.onScheduleCron
    if (opts.onScheduleOneOff) this.onScheduleOneOff = opts.onScheduleOneOff
  }

  async schedule(taskId: TaskId, opts: OneOffSchedule): Promise<void> {
    await this.cancel(taskId)
    const stub = await this.resolveStub(taskId)
    await stub.setAlarm(opts.runAt)
    this.records.set(taskId, { kind: 'one_off', runAt: opts.runAt })
    if (this.onScheduleOneOff) this.onScheduleOneOff(taskId, opts.runAt)
  }

  async scheduleCron(taskId: TaskId, opts: CronScheduleSpec): Promise<void> {
    await this.cancel(taskId)
    /* We can only schedule DoAlarms here — actual cron firing requires
     * the wrangler.toml `triggers.crons` entry, which is deploy-time.
     * We record the intent so the alarm-based fallback can pick it up.
     *
     * For full cron support the host must declare `crons: [<expr>]` in
     * wrangler.toml AND bind the controller.scheduled handler to a
     * routing layer that maps the current minute → taskId(s). */
    this.records.set(taskId, { kind: 'cron', spec: opts })
    if (this.onScheduleCron) this.onScheduleCron(taskId, opts)
  }

  async cancel(taskId: TaskId): Promise<void> {
    const existing = this.records.get(taskId)
    if (existing !== undefined) {
      try {
        const stub = await this.resolveStub(taskId)
        if (typeof stub.deleteAlarm === 'function') {
          await stub.deleteAlarm()
        }
      } catch {
        /* DOs may not exist; ignore */
      }
    }
    this.records.delete(taskId)
  }

  async hasSchedule(taskId: TaskId): Promise<boolean> {
    return this.records.has(taskId)
  }

  async shutdown(): Promise<void> {
    this.records.clear()
  }

  /** Test helper — list registered cron schedules. */
  listCron(): readonly { taskId: TaskId; spec: CronScheduleSpec }[] {
    const out: { taskId: TaskId; spec: CronScheduleSpec }[] = []
    for (const [id, rec] of this.records.entries()) {
      if (rec.kind === 'cron') out.push({ taskId: id, spec: rec.spec })
    }
    return out
  }

  /** Diagnostics — the cron expressions expected at deploy time. */
  declaredCrons(): readonly string[] {
    return this.deployCrons
  }
}
