/**
 * @cadence/scheduler — EmbeddedSchedulerAdapter unit tests.
 *
 * Covers:
 *  - schedule() arms a setTimeout (deterministic via injected clock)
 *  - onFire callback invoked when the deadline elapses
 *  - cancel() prevents fire
 *  - hasSchedule() reflects state
 *  - shutdown() clears all timers
 *  - scheduleCron() is bookkeeping-only (no setTimeout)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskId } from '@cadence/domain'

import { EmbeddedSchedulerAdapter } from '../src/index.js'

describe('EmbeddedSchedulerAdapter', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('schedule() arms a timer at runAt - now', () => {
    const fired: TaskId[] = []
    const setTimeoutFn = vi.fn(
      (cb: () => void, _ms: number) => setTimeout(cb, 0) as unknown as NodeJS.Timeout,
    )
    let now = 1_000_000
    const adapter = new EmbeddedSchedulerAdapter({
      now: () => now,
      setTimeoutFn: setTimeoutFn as unknown as (cb: () => void, ms: number) => NodeJS.Timeout,
      onFire: (id) => fired.push(id),
    })
    void adapter.schedule('t-1' as TaskId, { runAt: now + 1000 })
    expect(setTimeoutFn).toHaveBeenCalledTimes(1)
    expect(setTimeoutFn.mock.calls[0]?.[1]).toBe(1000)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(fired).toContain('t-1' as TaskId)
        resolve()
      }, 10)
    })
  })

  it('cancel() removes pending entry and clears the timer', async () => {
    const cleared: unknown[] = []
    const adapter = new EmbeddedSchedulerAdapter({
      now: () => 0,
      setTimeoutFn: ((_cb: () => void, ms: number) =>
        ms + 1) as unknown as (cb: () => void, ms: number) => NodeJS.Timeout,
      clearTimeoutFn: (h) => cleared.push(h),
    })
    await adapter.schedule('t-x' as TaskId, { runAt: 5_000 })
    await adapter.cancel('t-x' as TaskId)
    expect(await adapter.hasSchedule('t-x' as TaskId)).toBe(false)
    expect(cleared.length).toBe(1)
  })

  it('scheduleCron() is bookkeeping only (no setTimeout)', async () => {
    const setTimeoutFn = vi.fn()
    const adapter = new EmbeddedSchedulerAdapter({
      now: () => 0,
      setTimeoutFn: setTimeoutFn as unknown as (cb: () => void, ms: number) => NodeJS.Timeout,
    })
    await adapter.scheduleCron('t-c' as TaskId, { cron: '0 9 * * *', timezone: 'UTC' })
    expect(setTimeoutFn).not.toHaveBeenCalled()
    expect(await adapter.hasSchedule('t-c' as TaskId)).toBe(true)
    expect(adapter.pendingCount()).toBe(1)
  })

  it('shutdown() cancels everything', async () => {
    const adapter = new EmbeddedSchedulerAdapter({ now: () => 0 })
    await adapter.schedule('a' as TaskId, { runAt: 1000 })
    await adapter.schedule('b' as TaskId, { runAt: 2000 })
    expect(adapter.pendingCount()).toBe(2)
    await adapter.shutdown()
    expect(adapter.pendingCount()).toBe(0)
  })
})
