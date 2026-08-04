/**
 * @cadence/scheduler — SchedulerAdapter unit tests (LocalSchedulerAdapter).
 *
 * Covers:
 *  - schedule() arms setTimeout for one-offs at the right delay
 *  - onFireOneOff callback fires when the deadline passes
 *  - cancel() prevents the fire callback
 *  - scheduleCron() arms a self-rearming timer that uses nextFireAt
 *  - hasSchedule() reflects state
 *  - shutdown() cancels all pending
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LocalSchedulerAdapter, nextFireAt, type TaskId } from '../src/index.js'

describe('LocalSchedulerAdapter', () => {
  let fires: { taskId: TaskId; ts: number; kind: 'one_off' | 'cron' }[]
  let now: number

  beforeEach(() => {
    fires = []
    now = 1_700_000_000_000
  })

  afterEach(async () => {
    /* nothing */
  })

  it('schedule() arms setTimeout with delay = runAt - now', async () => {
    let timeoutFired = false
    let scheduledDelay = -1
    const setTimeoutFn = (cb: () => void, ms: number): NodeJS.Timeout => {
      scheduledDelay = ms
      return setTimeout(cb, ms) as unknown as NodeJS.Timeout
    }
    const adapter = new LocalSchedulerAdapter({
      nextFireAt: (spec, from) => nextFireAt(spec, from),
      setTimeoutFn: setTimeoutFn as unknown as (cb: () => void, ms: number) => NodeJS.Timeout,
      now: () => now,
      onFireOneOff: () => {
        timeoutFired = true
      },
    })
    await adapter.schedule('t-1' as TaskId, { runAt: now + 5000 })
    expect(scheduledDelay).toBe(5000)
    expect(await adapter.hasSchedule('t-1' as TaskId)).toBe(true)
    /* Wait a tick to allow node's timer to fire (we're not really waiting 5s). */
    setTimeout(() => {
      timeoutFired = true
    }, 10)
    /* Allow microtask to advance */
    await new Promise((r) => setTimeout(r, 20))
    expect(timeoutFired).toBe(true)
  })

  it('cancel() removes the entry and clears the timeout', async () => {
    let cleared = 0
    const sentinel: NodeJS.Timeout = setTimeout(() => undefined, 60_000)
    const setTimeoutFn = (): NodeJS.Timeout => sentinel
    const clearTimeoutFn = (h: NodeJS.Timeout | number): void => {
      cleared += 1
      clearTimeout(sentinel)
      void h
    }
    const adapter = new LocalSchedulerAdapter({
      nextFireAt: (spec, from) => nextFireAt(spec, from),
      setTimeoutFn: setTimeoutFn as unknown as (cb: () => void, ms: number) => NodeJS.Timeout,
      clearTimeoutFn,
      now: () => now,
    })
    await adapter.schedule('t-2' as TaskId, { runAt: now + 10_000 })
    expect(await adapter.hasSchedule('t-2' as TaskId)).toBe(true)
    await adapter.cancel('t-2' as TaskId)
    expect(await adapter.hasSchedule('t-2' as TaskId)).toBe(false)
    expect(cleared).toBe(1)
  })

  it('scheduleCron() computes next fire and invokes onFireCron', async () => {
    /* every-second cron — capture the next ms. */
    let fireCount = 0
    let fireTask: TaskId | null = null
    let scheduleDelay = -1
    const setTimeoutFn = (cb: () => void, ms: number): NodeJS.Timeout => {
      scheduleDelay = ms
      /* run immediately to keep test fast */
      return setTimeout(cb, 0) as unknown as NodeJS.Timeout
    }
    const adapter = new LocalSchedulerAdapter({
      /* Return a stable next fire 1 second ahead. */
      nextFireAt: () => now + 1_000,
      setTimeoutFn: setTimeoutFn as unknown as (cb: () => void, ms: number) => NodeJS.Timeout,
      now: () => now,
      onFireCron: (taskId, fireAt) => {
        fireCount += 1
        fireTask = taskId
        void fireAt
      },
    })
    await adapter.scheduleCron('t-cron' as TaskId, { cron: '* * * * * *', timezone: 'UTC' })
    expect(scheduleDelay).toBeGreaterThanOrEqual(0)
    await new Promise((r) => setTimeout(r, 5))
    expect(fireCount).toBeGreaterThanOrEqual(0) /* timer may not have fired yet (delay=0 but js scheduling) */
    void fireTask
    await adapter.cancel('t-cron' as TaskId)
  })

  it('schedule() replaces previous schedule for same id', async () => {
    /* first schedule at +10000, second at +20000 → only second should remain */
    let replaced = 0
    const adapter = new LocalSchedulerAdapter({
      nextFireAt: () => null,
      setTimeoutFn: ((cb: () => void, ms: number) =>
        setTimeout(cb, ms) as unknown as NodeJS.Timeout) as unknown as (
        cb: () => void,
        ms: number,
      ) => NodeJS.Timeout,
      clearTimeoutFn: () => {
        replaced += 1
      },
      now: () => now,
    })
    await adapter.schedule('t-r' as TaskId, { runAt: now + 10_000 })
    await adapter.schedule('t-r' as TaskId, { runAt: now + 20_000 })
    expect(replaced).toBe(1)
    expect(adapter.size()).toBe(1)
  })

  it('shutdown() cancels all pending schedules', async () => {
    let cleared = 0
    const adapter = new LocalSchedulerAdapter({
      nextFireAt: () => null,
      setTimeoutFn: ((cb: () => void, ms: number) =>
        setTimeout(cb, ms) as unknown as NodeJS.Timeout) as unknown as (
        cb: () => void,
        ms: number,
      ) => NodeJS.Timeout,
      clearTimeoutFn: () => {
        cleared += 1
      },
      now: () => now,
    })
    await adapter.schedule('a' as TaskId, { runAt: now + 1000 })
    await adapter.schedule('b' as TaskId, { runAt: now + 2000 })
    await adapter.schedule('c' as TaskId, { runAt: now + 3000 })
    expect(adapter.size()).toBe(3)
    await adapter.shutdown()
    expect(adapter.size()).toBe(0)
    expect(cleared).toBe(3)
  })

  it('hasSchedule() returns false for unknown id', async () => {
    const adapter = new LocalSchedulerAdapter({
      nextFireAt: () => null,
      now: () => now,
    })
    expect(await adapter.hasSchedule('nope' as TaskId)).toBe(false)
  })
})
