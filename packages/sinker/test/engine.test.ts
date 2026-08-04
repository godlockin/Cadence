import { describe, it, expect, beforeEach } from 'vitest'
import { SinkerEngine, PayloadDispatcher, BufferedLogger, StateTransitionError, TaskNotFoundError, ForbiddenError } from '../src/index.js'
import { HttpHandler } from '../src/handlers/http.js'
import { FakeStorage } from './fixtures/fake-storage.js'
import { FakeQueue } from './fixtures/fake-queue.js'
import { FakeScheduler } from './fixtures/fake-scheduler.js'
import { FakeNotifier } from './fixtures/fake-notifier.js'
import { FakeExecutor } from './fixtures/fake-executor.js'
import { makeTask } from './fixtures/make-task.js'
import type { Task } from '@cadence/domain'

const OWNER = '01J00000000000000000000000'
const STRANGER = '01JDEADBEEFDEADBEEFDEADBEE'

function makeEngine(opts: { storage: FakeStorage; dispatcher: PayloadDispatcher }) {
  const queue = new FakeQueue()
  const scheduler = new FakeScheduler()
  const notifier = new FakeNotifier()
  const executor = new FakeExecutor()
  const logger = new BufferedLogger()
  return {
    engine: new SinkerEngine({
      storage: opts.storage.asAdapter(),
      queue,
      executor,
      scheduler,
      notifier,
      logger,
      dispatcher: opts.dispatcher,
      runtime: 'local',
    }),
    queue,
    scheduler,
    notifier,
    logger,
  }
}

describe('SinkerEngine.trigger', () => {
  let storage: FakeStorage
  let dispatcher: PayloadDispatcher
  let fixture: ReturnType<typeof makeEngine>

  beforeEach(() => {
    storage = new FakeStorage()
    dispatcher = new PayloadDispatcher({ logger: new BufferedLogger() }).register(new HttpHandler())
    fixture = makeEngine({ storage, dispatcher })
  })

  it('rejects when task not found', async () => {
    await expect(
      fixture.engine.trigger('01JZZZZZZZZZZZZZZZZZZZZZZZ' as never, { source: 'manual' }, { userId: OWNER }),
    ).rejects.toBeInstanceOf(TaskNotFoundError)
  })

  it('rejects when task is in a non-triggerable state', async () => {
    const task: Task = makeTask({ status: 'running' })
    storage.putTask(task)
    await expect(
      fixture.engine.trigger(task.id, { source: 'manual' }, { userId: OWNER }),
    ).rejects.toBeInstanceOf(StateTransitionError)
  })

  it('writes execution row and enqueues item on success', async () => {
    const task: Task = makeTask({ status: 'pending' })
    storage.putTask(task)
    const id = await fixture.engine.trigger(task.id, { source: 'manual' }, { userId: OWNER })
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)

    const execution = await storage.getExecution(id)
    expect(execution).not.toBeNull()
    expect(execution?.status).toBe('queued')
    expect(execution?.triggerSource).toBe('manual')
    expect(fixture.queue.enqueuedItems().length).toBe(1)
    expect(fixture.queue.enqueuedItems()[0]?.taskId).toBe(task.id)
  })

  it('accepts scheduled, suspended, and pending statuses', async () => {
    for (const status of ['pending', 'scheduled', 'suspended'] as const) {
      const t = makeTask({ status })
      storage.putTask(t)
      const id = await fixture.engine.trigger(t.id, { source: 'manual' }, { userId: OWNER })
      expect(id).toBeTruthy()
    }
  })
})

describe('SinkerEngine.trigger authorization (IDOR)', () => {
  let storage: FakeStorage
  let dispatcher: PayloadDispatcher
  let fixture: ReturnType<typeof makeEngine>

  beforeEach(() => {
    storage = new FakeStorage()
    dispatcher = new PayloadDispatcher({ logger: new BufferedLogger() }).register(new HttpHandler())
    fixture = makeEngine({ storage, dispatcher })
  })

  it('owner can trigger own task', async () => {
    const t = makeTask({ status: 'pending' })
    storage.putTask(t)
    const id = await fixture.engine.trigger(t.id, { source: 'manual' }, { userId: OWNER })
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('stranger is rejected with ForbiddenError', async () => {
    const t = makeTask({ status: 'pending' })
    storage.putTask(t)
    await expect(
      fixture.engine.trigger(t.id, { source: 'manual' }, { userId: STRANGER }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('group member can trigger a task belonging to a group', async () => {
    const groupId = 'g-1'
    const t = makeTask({ status: 'pending', group_id: groupId as never })
    storage.putTask(t)
    storage.addGroupMember(groupId, STRANGER)
    const id = await fixture.engine.trigger(t.id, { source: 'manual' }, { userId: STRANGER })
    expect(id).toBeTruthy()
  })

  it('group non-member is rejected', async () => {
    const t = makeTask({ status: 'pending', group_id: 'g-2' as never })
    storage.putTask(t)
    await expect(
      fixture.engine.trigger(t.id, { source: 'manual' }, { userId: STRANGER }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('system trigger (bypassAuth) succeeds regardless of userId', async () => {
    const t = makeTask({ status: 'pending' })
    storage.putTask(t)
    const id = await fixture.engine.trigger(
      t.id,
      { source: 'cron' },
      { userId: 'system', bypassAuth: true },
    )
    expect(id).toBeTruthy()
  })

  it('missing userId is rejected with TypeError', async () => {
    const t = makeTask({ status: 'pending' })
    storage.putTask(t)
    await expect(
      fixture.engine.trigger(t.id, { source: 'manual' }, { userId: '' as never }),
    ).rejects.toBeInstanceOf(TypeError)
  })
})

describe('SinkerEngine.suspend / resume', () => {
  let storage: FakeStorage
  let dispatcher: PayloadDispatcher
  let fixture: ReturnType<typeof makeEngine>

  beforeEach(() => {
    storage = new FakeStorage()
    dispatcher = new PayloadDispatcher({ logger: new BufferedLogger() }).register(new HttpHandler())
    fixture = makeEngine({ storage, dispatcher })
  })

  it('suspend transitions scheduled -> suspended and unschedules', async () => {
    const t = makeTask({ status: 'scheduled' })
    storage.putTask(t)
    await fixture.scheduler.reschedule(t)
    expect(fixture.scheduler.isScheduled(t.id)).toBe(true)

    await fixture.engine.suspend(t.id, 'maintenance')
    const after = await storage.getTask(t.id)
    expect(after?.status).toBe('suspended')
    expect(fixture.scheduler.isScheduled(t.id)).toBe(false)
  })

  it('resume transitions suspended -> scheduled and reschedules', async () => {
    const t = makeTask({ status: 'suspended' })
    storage.putTask(t)
    await fixture.engine.resume(t.id)
    const after = await storage.getTask(t.id)
    expect(after?.status).toBe('scheduled')
    expect(fixture.scheduler.isScheduled(t.id)).toBe(true)
  })

  it('suspend rejects from running', async () => {
    const t = makeTask({ status: 'running' })
    storage.putTask(t)
    await expect(fixture.engine.suspend(t.id, 'x')).rejects.toBeInstanceOf(StateTransitionError)
  })
})

describe('SinkerEngine.cancel', () => {
  let storage: FakeStorage
  let dispatcher: PayloadDispatcher
  let fixture: ReturnType<typeof makeEngine>

  beforeEach(() => {
    storage = new FakeStorage()
    dispatcher = new PayloadDispatcher({ logger: new BufferedLogger() }).register(new HttpHandler())
    fixture = makeEngine({ storage, dispatcher })
  })

  it('cancels a running execution', async () => {
    const t = makeTask({ status: 'running' })
    storage.putTask(t)
    const exec = await storage.createExecution({
      id: '01JAAAAAAAAAAAAAAAAAAAAAA' as never,
      taskId: t.id,
      triggerSource: 'manual',
      triggeredBy: null,
      retryCount: 0,
      startedAt: Date.now(),
    })
    // Bump version to reflect the prior state changes
    await fixture.engine.cancel(exec.id)
    const after = await storage.getExecution(exec.id)
    expect(after?.status).toBe('cancelled')
  })

  it('is a no-op for terminal executions', async () => {
    const t = makeTask({ status: 'success' })
    storage.putTask(t)
    const exec = await storage.createExecution({
      id: '01JBBBBBBBBBBBBBBBBBBBBBB' as never,
      taskId: t.id,
      triggerSource: 'manual',
      triggeredBy: null,
      retryCount: 0,
      startedAt: Date.now(),
    })
    await storage.patchExecution(exec.id, { status: 'success', finishedAt: Date.now() }, exec.version)
    await fixture.engine.cancel(exec.id)
    const after = await storage.getExecution(exec.id)
    expect(after?.status).toBe('success')
  })
})

describe('SinkerEngine.workerLoop', () => {
  let storage: FakeStorage
  let dispatcher: PayloadDispatcher
  let fixture: ReturnType<typeof makeEngine>

  beforeEach(() => {
    storage = new FakeStorage()
    dispatcher = new PayloadDispatcher({ logger: new BufferedLogger() }).register(new HttpHandler())
    fixture = makeEngine({ storage, dispatcher })
  })

  it('pulls an item, runs it, and finalises the execution', async () => {
    const t = makeTask({ status: 'pending' })
    storage.putTask(t)
    const id = await fixture.engine.trigger(t.id, { source: 'manual' }, { userId: OWNER })

    const ac = new AbortController()
    /* spin the worker until queue is empty, then abort */
    const worker = fixture.engine.workerLoop('w1', ac.signal)
    /* give the worker a moment to consume */
    await new Promise((r) => setTimeout(r, 100))
    ac.abort()
    await worker

    const after = await storage.getExecution(id)
    expect(after?.status).toBe('success')
    expect(fixture.notifier.sent.length).toBe(1)
    expect(fixture.notifier.sent[0]?.status).toBe('success')
  })

  it('marks the execution failed when the executor throws', async () => {
    const t = makeTask({ status: 'pending' })
    storage.putTask(t)

    const failingQueue = new FakeQueue()
    const failingExecutor = new FakeExecutor(async () => {
      throw new Error('boom')
    })
    const failingEngine = new SinkerEngine({
      storage: storage.asAdapter(),
      queue: failingQueue,
      executor: failingExecutor,
      scheduler: new FakeScheduler(),
      notifier: new FakeNotifier(),
      logger: new BufferedLogger(),
      dispatcher,
    })

    const id = await failingEngine.trigger(t.id, { source: 'manual' }, { userId: OWNER })
    const ac = new AbortController()
    const worker = failingEngine.workerLoop('w1', ac.signal)
    await new Promise((r) => setTimeout(r, 80))
    ac.abort()
    await worker

    const after = await storage.getExecution(id)
    expect(after?.status).toBe('failed')
  })
})
