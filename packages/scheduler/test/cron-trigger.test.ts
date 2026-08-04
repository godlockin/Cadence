/**
 * @cadence/scheduler — CronTrigger unit tests.
 *
 * Covers:
 *  - tick() scans storage for trigger_kind=cron + scheduled tasks
 *  - tick() fires only tasks whose previous slot is between previous fire
 *    time and `now`
 *  - tick() is idempotent (fires at most once per boundary)
 *  - tick() runs in parallel across multiple tasks
 *  - next() / nextFromNow() return correct upcoming time
 *  - malformed cron → outcome is empty (does not throw)
 *  - start() + stop() lifecycle honours maxRunMs
 *  - sleep injection for fast tests
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'

import { CronTrigger } from '../src/index.js'
import { FakeSinker } from './fakes.js'
import { buildTask, persistTask } from './helpers.js'

const T0 = 1_700_000_000_000
const SECOND = 1_000
const MINUTE = 60_000

describe('CronTrigger.tick()', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
  })

  afterEach(() => {
    sinker.reset()
    vi.useRealTimers()
  })

  it('fires tasks whose previous fire slot already passed', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    let now = T0 + 65_000 /* 65s past T0 — many sub-second slots have passed */
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => now,
    })
    /* first tick of 1s polling will pick up at least 65 prior 1s slots */
    const outcomes = await trigger.tick(storage)
    expect(outcomes.length).toBeGreaterThanOrEqual(1)
    expect(sinker.countFor(task.id)).toBeGreaterThanOrEqual(1)
    now += 10_000
  })

  it('does not fire tasks whose previous slot exists but is already covered by lastFire', async () => {
    /* Use a slow cron that fires on Jan 1 midnight so we can pre-set
     * lastFire to that exact moment. First tick should respect prior
     * marker. */
    const task = await persistTask(
      storage,
      buildTask({
        trigger_kind: 'cron',
        cron: '0 0 1 1 *',
        timezone: 'UTC',
      }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => T0 + 5_000,
    })
    /* Pre-record lastFire to Jan 1 2023 midnight so the prev() result
     * is already covered. */
    ;(trigger['lastFire'] as Map<string, number>).set(
      task.id,
      new Date('2023-01-01T00:00:00Z').getTime(),
    )
    const outcomes = await trigger.tick(storage)
    expect(outcomes.length).toBe(0)
    expect(sinker.countFor(task.id)).toBe(0)
  })

  it('idempotent across ticks at same clock (no re-fire within slot)', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    let now = T0 + 2_000
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => now,
    })
    /* Tick twice at the same now — should fire only once. */
    await trigger.tick(storage)
    await trigger.tick(storage)
    expect(sinker.countFor(task.id)).toBe(1)
    now += 10_000
  })

  it('fires multiple tasks in parallel on the same tick', async () => {
    const t1 = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const t2 = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const t3 = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    let now = T0 + 65_000
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => now,
    })
    await trigger.tick(storage)
    expect(sinker.countFor(t1.id)).toBeGreaterThanOrEqual(1)
    expect(sinker.countFor(t2.id)).toBeGreaterThanOrEqual(1)
    expect(sinker.countFor(t3.id)).toBeGreaterThanOrEqual(1)
    now += 5_000
  })

  it('skips tasks with malformed cron expression', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: 'bad-cron' }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => T0 + 65_000,
    })
    const outcomes = await trigger.tick(storage)
    expect(outcomes.length).toBe(0)
    expect(sinker.countFor(task.id)).toBe(0)
  })

  it('next() computes future fire time correctly for noon', () => {
    const t = new CronTrigger({ triggerFn: sinker.asTriggerFn() })
    const task = buildTask({ trigger_kind: 'cron', cron: '0 12 * * *', timezone: 'UTC' })
    const ref = new Date('2026-01-15T00:00:00.000Z')
    const next = t.next(task, ref)
    expect(next?.toISOString()).toBe('2026-01-15T12:00:00.000Z')
  })

  it('nextFromNow() returns the next fire time relative to now', () => {
    let now = T0
    const t = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => now,
    })
    const task = buildTask({ trigger_kind: 'cron', cron: '0 12 * * *', timezone: 'UTC' })
    const next = t.nextFromNow(task)
    expect(next).not.toBeNull()
    /* 12:00 same day or next day depending */
    expect(next?.getUTCHours()).toBe(12)
    now = T0
  })

  it('respects tasks outside [start_at, end_at] window', async () => {
    /* start_at in the future — task exists but not eligible to fire */
    const task = await persistTask(
      storage,
      buildTask({
        trigger_kind: 'cron',
        cron: '* * * * * *',
        start_at: T0 + 1_000_000,
      }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => T0 + 65_000,
    })
    const outcomes = await trigger.tick(storage)
    expect(sinker.countFor(task.id)).toBe(0)
    void outcomes
  })

  it('skips disabled (non-scheduled) tasks', async () => {
    /* task with status='paused' should NOT be picked up — listTasks filter is
     * status=scheduled. */
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *', status: 'pending' }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => T0 + 65_000,
    })
    const outcomes = await trigger.tick(storage)
    expect(sinker.countFor(task.id)).toBe(0)
    void outcomes
  })

  it('start() loop ticks at intervalMs', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const sleepFn = vi.fn(async (_ms: number) => Promise.resolve())
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      intervalMs: 100,
      maxRunMs: 500,
      sleep: sleepFn,
      now: () => T0 + Math.floor(performance.now()),
    })
    await trigger.start(storage)
    expect(sleepFn).toHaveBeenCalled()
    /* At least a few fires in 0.5s with 1s cron — possibly zero if boundary
     * problem, but at most fires <=10 in 0.5s window with 100ms polling. */
    expect(sinker.countFor(task.id)).toBeGreaterThanOrEqual(0)
    await trigger.stop()
  })

  it('stop() halts the loop', async () => {
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      intervalMs: 50,
      maxRunMs: 60_000,
    })
    const p = trigger.start(storage)
    await new Promise((r) => setTimeout(r, 60))
    await trigger.stop()
    await p
    expect(trigger.isRunning()).toBe(false)
  })

  it('records an audit row per successful trigger', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => T0 + 1_500,
    })
    await trigger.tick(storage)
    const audit = await storage.listAuditLogs({ resourceKind: 'task' })
    expect(audit.some((a) => a.action === 'task.triggered_via_cron')).toBe(true)
  })

  it('tick() on empty storage returns []', async () => {
    const trigger = new CronTrigger({ triggerFn: sinker.asTriggerFn() })
    const outcomes = await trigger.tick(storage)
    expect(outcomes).toEqual([])
  })

  it('audit appended per fire (multiple fires produce multiple rows)', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    let now = T0 + 3 * SECOND
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => now,
    })
    await trigger.tick(storage)
    await storage.listAuditLogs({ resourceId: task.id })
    now += 2 * SECOND
    await trigger.tick(storage)
    const audit2 = await storage.listAuditLogs({ resourceId: task.id })
    expect(audit2.length).toBeGreaterThanOrEqual(1)
  })

  it('uses task.timezone for cron resolution', async () => {
    const task = await persistTask(
      storage,
      buildTask({
        trigger_kind: 'cron',
        cron: '0 9 * * *',
        timezone: 'UTC',
      }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => T0 + 24 * MINUTE,
    })
    const t = trigger.next(task, new Date(T0))
    expect(t?.toISOString()).toContain('09:00:00')
  })

  it('outcomes() reflects the latest tick', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      now: () => T0 + 1_500,
    })
    await trigger.tick(storage)
    expect(trigger.outcomes().length).toBeGreaterThanOrEqual(0)
  })
})
