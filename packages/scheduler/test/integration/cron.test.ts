/**
 * @cadence/scheduler — CronTrigger integration tests.
 *
 * Exercises a real `CronTrigger` against an `InMemoryStorageAdapter`
 * and a `FakeSinker` (records trigger calls without dispatching).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { CronTrigger } from '../../src/index.js'
import { FakeSinker } from '../fakes.js'
import { buildTask, persistTask } from '../helpers.js'

describe('CronTrigger (e2e)', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
  })

  afterEach(async () => {
    /* global cleanup — per-test triggers are stopped explicitly */
  })

  /** Helper to start a cron trigger and return its stop function. */
  function startCron(opts: Parameters<typeof CronTrigger.prototype['start']>[1] extends infer _ ? unknown : never = {}): {
    trigger: CronTrigger
    stop: () => Promise<void>
  } {
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      intervalMs: 100,
      maxRunMs: 5000,
    })
    let stopped = false
    const stop = async () => {
      if (stopped) return
      stopped = true
      await trigger.stop()
    }
    void trigger.start(storage).catch(() => {
      /* loop exits cleanly via stop() or maxRunMs */
    })
    return { trigger, stop }
  }

  it('fires a per-second cron task at least twice within 2.5s', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const { stop } = startCron()
    await new Promise((r) => setTimeout(r, 2500))
    await stop()

    expect(sinker.countFor(task.id)).toBeGreaterThanOrEqual(2)
  })

  it('fires at most once per cron slot (idempotent)', async () => {
    /* "every 5 minutes" expression; guarantees at most one fire per 5-min window. */
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '*/5 * * * *' }),
    )
    const { stop } = startCron()
    await new Promise((r) => setTimeout(r, 1500))
    await stop()
    /* We may have fired 0 or 1 times depending on the boundary — but
     * never more than 1. */
    expect(sinker.countFor(task.id)).toBeLessThanOrEqual(1)
  })

  it('audit log records `task.triggered_via_cron` on each fire', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const { stop } = startCron()
    await new Promise((r) => setTimeout(r, 1300))
    await stop()

    const audit = await storage.listAuditLogs({ resourceKind: 'task' })
    const viaCron = audit.filter((a) => a.action === 'task.triggered_via_cron')
    expect(viaCron.length).toBeGreaterThan(0)
    expect(viaCron.some((a) => a.resourceId === task.id)).toBe(true)
  })

  it('stop() halts subsequent ticks', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'cron', cron: '* * * * * *' }),
    )
    const { stop } = startCron()
    await new Promise((r) => setTimeout(r, 1300))
    const beforeStop = sinker.countFor(task.id)
    expect(beforeStop).toBeGreaterThan(0)
    await stop()

    const before = sinker.countFor(task.id)
    await new Promise((r) => setTimeout(r, 1100))
    const after = sinker.countFor(task.id)
    expect(after).toBe(before)
  })

  it('next() computes the next fire time after a reference date', () => {
    const t = new CronTrigger({ triggerFn: sinker.asTriggerFn() })
    const task = buildTask({
      trigger_kind: 'cron',
      cron: '0 12 * * *', /* noon every day */
      timezone: 'UTC',
    })
    const ref = new Date('2024-06-01T00:00:00Z')
    const next = t.next(task, ref)
    expect(next).not.toBeNull()
    expect(next?.toISOString()).toContain('12:00:00')
  })

  it('skips malformed cron tasks gracefully (does not throw)', async () => {
    const task = await persistTask(
      storage,
      buildTask({
        trigger_kind: 'cron',
        cron: 'not a cron expression',
        status: 'scheduled',
      }),
    )
    const trigger = new CronTrigger({
      triggerFn: sinker.asTriggerFn(),
      intervalMs: 100,
      maxRunMs: 100,
    })
    /* tick() drives one polling round without the long-running loop. */
    const outcomes = await trigger.tick(storage)
    expect(outcomes).toEqual([])
    expect(sinker.countFor(task.id)).toBe(0)
  })
})
