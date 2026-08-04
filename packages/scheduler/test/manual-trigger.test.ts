/**
 * @cadence/scheduler — ManualTrigger unit tests.
 *
 * Covers:
 *  - fires a task with the right TriggerContext (source=manual, triggeredBy=userId)
 *  - rejects on missing task (returns task_not_found)
 *  - rejects on terminal task (success/cancelled) — returns terminal_state
 *  - throws TypeError when userId is missing
 *  - audit row appended on fire
 *  - payload is forwarded to trigger function
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { ulid } from 'ulid'

import { ManualTrigger } from '../src/index.js'
import { FakeSinker, type TriggerRecord } from './fakes.js'
import { buildTask } from './helpers.js'

const USER_ID = '11111111-2222-4333-8444-555555555555'

describe('ManualTrigger', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker
  let trigger: ManualTrigger

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
    trigger = new ManualTrigger({ triggerFn: sinker.asTriggerFn() })
  })

  afterEach(() => {
    sinker.reset()
  })

  it('fires a pending task and records the trigger', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const result = await trigger.fire(storage, task.id, { userId: USER_ID })
    expect(result.reason).toBe('fired')
    expect(result.executionId).not.toBeNull()
    expect(sinker.records.length).toBe(1)
    expect(sinker.records[0]?.ctx.source).toBe('manual')
    expect(sinker.records[0]?.opts.bypassAuth).toBe(false)
    expect(sinker.records[0]?.opts.bypassGuard).toBe(false)
  })

  it('passes userId as TriggerContext.triggeredBy', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    await trigger.fire(storage, task.id, { userId: USER_ID })
    const rec: TriggerRecord | undefined = sinker.records[0]
    expect(rec?.ctx.triggeredBy).toBe(USER_ID)
    expect(rec?.opts.userId).toBe(USER_ID)
  })

  it('returns task_not_found for unknown id', async () => {
    const result = await trigger.fire(storage, ulid() as never, { userId: USER_ID })
    expect(result.reason).toBe('task_not_found')
    expect(result.executionId).toBeNull()
    expect(sinker.records.length).toBe(0)
  })

  it('returns terminal_state for cancelled task', async () => {
    const task = buildTask({ status: 'cancelled' })
    await storage.saveTask(task)
    const result = await trigger.fire(storage, task.id, { userId: USER_ID })
    expect(result.reason).toBe('terminal_state')
    expect(result.executionId).toBeNull()
  })

  it('returns terminal_state for success task', async () => {
    const task = buildTask({ status: 'success' })
    await storage.saveTask(task)
    const result = await trigger.fire(storage, task.id, { userId: USER_ID })
    expect(result.reason).toBe('terminal_state')
  })

  it('throws TypeError when userId is empty', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    await expect(trigger.fire(storage, task.id, { userId: '' })).rejects.toBeInstanceOf(TypeError)
  })

  it('forwards arbitrary payload to trigger function', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    await trigger.fire(storage, task.id, {
      userId: USER_ID,
      payload: { foo: 'bar', n: 42 },
    })
    expect(sinker.records[0]?.ctx.payload).toEqual({ foo: 'bar', n: 42 })
  })

  it('writes an audit row after firing', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    await trigger.fire(storage, task.id, { userId: USER_ID })
    const audit = await storage.listAuditLogs({ resourceKind: 'task', resourceId: task.id })
    expect(audit.length).toBeGreaterThanOrEqual(1)
    expect(audit.some((a) => a.action === 'task.triggered_manually')).toBe(true)
  })
})
