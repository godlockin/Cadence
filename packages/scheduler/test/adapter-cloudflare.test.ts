/**
 * @cadence/scheduler — CloudflareSchedulerAdapter unit tests.
 *
 * Covers:
 *  - schedule() calls setAlarm on the resolved DO stub with the right time
 *  - scheduleCron() is bookkeeping-only (no setAlarm fired)
 *  - cancel() delegates to deleteAlarm on the stub
 *  - cancel() tolerates stub lookup errors (still removes the record)
 *  - hasSchedule() reflects the registry
 *  - declaredCrons() returns the constructor-injected list
 *  - shutdown() clears records
 *  - DO stub resolver is invoked with each taskId
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskId } from '@cadence/domain'

import { CloudflareSchedulerAdapter, type DoStub, type ResolveStub } from '../src/index.js'

interface SpyStub extends DoStub {
  setAlarm: ReturnType<typeof spy>
  deleteAlarm: ReturnType<typeof spy>
}

function spy(): ReturnType<typeof spy> & { calls: unknown[][] } {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args)
    return Promise.resolve()
  }) as unknown as ReturnType<typeof spy> & { calls: unknown[][] }
  fn.calls = []
  return fn
}

function makeStub(): SpyStub {
  return {
    id: { toString: () => 'stub-1' },
    setAlarm: spy(),
    deleteAlarm: spy(),
  } as SpyStub
}

describe('CloudflareSchedulerAdapter', () => {
  let stubs: Map<string, SpyStub>

  beforeEach(() => {
    stubs = new Map<string, SpyStub>()
  })

  it('schedule() resolves the stub and calls setAlarm with ms timestamp', async () => {
    const stub = makeStub()
    stubs.set('t-1', stub)
    const resolveStub: ResolveStub = (id) => {
      const s = stubs.get(String(id))
      if (s === undefined) throw new Error('no stub')
      return s
    }
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub,
    })
    await adapter.schedule('t-1' as TaskId, { runAt: 5_000 })
    expect(stub.setAlarm.calls.length).toBe(1)
    expect(stub.setAlarm.calls[0]?.[0]).toBe(5_000)
    expect(await adapter.hasSchedule('t-1' as TaskId)).toBe(true)
  })

  it('scheduleCron() does NOT call setAlarm', async () => {
    const stub = makeStub()
    stubs.set('t-1', stub)
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => stub,
    })
    await adapter.scheduleCron('t-1' as TaskId, { cron: '0 9 * * *', timezone: 'UTC' })
    expect(stub.setAlarm.calls.length).toBe(0)
    expect(await adapter.hasSchedule('t-1' as TaskId)).toBe(true)
  })

  it('cancel() invokes deleteAlarm', async () => {
    const stub = makeStub()
    stubs.set('t-2', stub)
    const adapter = new CloudflareSchedulerAdapter({ resolveStub: () => stub })
    await adapter.schedule('t-2' as TaskId, { runAt: 5_000 })
    await adapter.cancel('t-2' as TaskId)
    expect(stub.deleteAlarm.calls.length).toBe(1)
    expect(await adapter.hasSchedule('t-2' as TaskId)).toBe(false)
  })

  it('cancel() tolerates stub lookup failure', async () => {
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => {
        throw new Error('stub missing')
      },
    })
    /* Still removes the record even if lookup fails. */
    await adapter.schedule('t-missing' as TaskId, { runAt: 1 }).catch(() => undefined)
    /* schedule() will throw because resolveStub fails; cancel() must not. */
    await expect(adapter.cancel('t-missing' as TaskId)).resolves.toBeUndefined()
  })

  it('declaredCrons() returns constructor list', () => {
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => makeStub(),
      deployCrons: ['*/5 * * * *', '0 * * * *'],
    })
    expect(adapter.declaredCrons()).toEqual(['*/5 * * * *', '0 * * * *'])
  })

  it('listCron() surfaces registered cron entries', async () => {
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => makeStub(),
    })
    await adapter.scheduleCron('t-a' as TaskId, { cron: '0 9 * * *', timezone: 'UTC' })
    await adapter.scheduleCron('t-b' as TaskId, { cron: '0 18 * * *', timezone: 'Asia/Shanghai' })
    const listed = adapter.listCron()
    expect(listed.length).toBe(2)
    expect(listed.some((e) => e.taskId === ('t-a' as TaskId))).toBe(true)
  })

  it('shutdown() clears records', async () => {
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => makeStub(),
    })
    await adapter.scheduleCron('t-a' as TaskId, { cron: '0 9 * * *', timezone: 'UTC' })
    await adapter.shutdown()
    expect(await adapter.hasSchedule('t-a' as TaskId)).toBe(false)
  })

  it('onScheduleOneOff callback fires', async () => {
    let captured: { taskId: TaskId | null; runAt: number } = { taskId: null, runAt: 0 }
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => makeStub(),
      onScheduleOneOff: (taskId, runAt) => {
        captured = { taskId, runAt }
      },
    })
    await adapter.schedule('t-cb' as TaskId, { runAt: 1234 })
    expect(captured.taskId).toBe('t-cb' as TaskId)
    expect(captured.runAt).toBe(1234)
  })

  it('onScheduleCron callback fires', async () => {
    let fired = 0
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => makeStub(),
      onScheduleCron: () => {
        fired += 1
      },
    })
    await adapter.scheduleCron('t-x' as TaskId, { cron: '0 9 * * *', timezone: 'UTC' })
    expect(fired).toBe(1)
  })

  it('re-scheduling replaces any prior record', async () => {
    const adapter = new CloudflareSchedulerAdapter({
      resolveStub: () => makeStub(),
    })
    await adapter.schedule('t-1' as TaskId, { runAt: 1_000 })
    await adapter.schedule('t-1' as TaskId, { runAt: 2_000 })
    expect(adapter['records'].size).toBe(1)
  })
})
