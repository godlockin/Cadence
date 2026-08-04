import { describe, it, expect, beforeEach } from 'vitest'
import { PayloadDispatcher, BufferedLogger, HandlerNotFoundError, PayloadValidationError } from '../src/index.js'
import { HttpHandler } from '../src/handlers/http.js'
import { makeTask } from './fixtures/make-task.js'
import type { Execution } from '@cadence/domain'

function makeExec(taskId: string): Execution {
  return {
    id: '01JCCCCCCCCCCCCCCCCCCCCCCC',
    taskId: taskId as never,
    status: 'running',
    triggerSource: 'manual',
    triggeredBy: null,
    startedAt: Date.now(),
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    errorJson: null,
    resultJson: null,
    idempotencyKey: null,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('PayloadDispatcher', () => {
  let dispatcher: PayloadDispatcher

  beforeEach(() => {
    dispatcher = new PayloadDispatcher({ logger: new BufferedLogger() })
  })

  it('rejects unknown payload kinds', async () => {
    const task = makeTask({ payload_kind: 'http', payload_json: '{}' })
    await expect(
      dispatcher.dispatch(task, makeExec(task.id), { source: 'manual' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(HandlerNotFoundError)
  })

  it('rejects invalid payload JSON', async () => {
    dispatcher.register(new HttpHandler())
    const task = makeTask({ payload_kind: 'http', payload_json: 'not-json' })
    await expect(
      dispatcher.dispatch(task, makeExec(task.id), { source: 'manual' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(PayloadValidationError)
  })

  it('rejects schema-invalid payload', async () => {
    dispatcher.register(new HttpHandler())
    const task = makeTask({ payload_kind: 'http', payload_json: JSON.stringify({ url: 'nope' }) })
    await expect(
      dispatcher.dispatch(task, makeExec(task.id), { source: 'manual' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(PayloadValidationError)
  })

  it('runs a registered handler', async () => {
    dispatcher.register(new HttpHandler())
    const task = makeTask({ payload_kind: 'http', payload_json: JSON.stringify({ url: 'https://example.com' }) })
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch
    try {
      await dispatcher.dispatch(task, makeExec(task.id), { source: 'manual' }, new AbortController().signal)
    } finally {
      globalThis.fetch = original
    }
  })

  it('lists registered kinds', () => {
    expect(dispatcher.kinds()).toEqual([])
    dispatcher.register(new HttpHandler())
    expect(dispatcher.kinds()).toEqual(['http'])
    expect(dispatcher.has('http')).toBe(true)
    expect(dispatcher.has('command')).toBe(false)
  })
})
