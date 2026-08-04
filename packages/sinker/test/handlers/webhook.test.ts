import { describe, it, expect, beforeEach } from 'vitest'
import { WebhookHandler } from '../../src/handlers/webhook.js'
import { makeTask } from '../fixtures/make-task.js'
import type { Execution, PayloadHandler, TriggerContext } from '../../src/index.js'

function makeCtx() {
  const events: { type: string; data?: unknown; ts: number }[] = []
  const task = makeTask({ payload_kind: 'webhook' })
  const execution = {
    id: '01JCCCCCCCCCCCCCCCCCCCCCCC',
    taskId: task.id,
    status: 'running' as const,
    triggerSource: 'webhook' as const,
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
  } as Execution
  const trigger: TriggerContext = { source: 'webhook' }
  const ctx: Parameters<PayloadHandler['execute']>[1] = {
    task,
    execution,
    trigger,
    signal: new AbortController().signal,
    emit: (e) => events.push({ type: e.type, data: e.data, ts: e.ts }),
  }
  return { events, ctx }
}

describe('WebhookHandler', () => {
  let handler: WebhookHandler

  beforeEach(() => {
    handler = new WebhookHandler()
  })

  it('rejects path without leading slash', () => {
    expect(() => handler.validateConfig({ path: 'no-slash' })).toThrow()
  })

  it('builds and tracks a public URL on register', () => {
    const url = handler.register('https://example.com', handler.validateConfig({ path: '/hooks/abc' }))
    expect(url).toBe('https://example.com/hooks/abc')
    expect(handler.registeredUrls()).toContain(url)
  })

  it('emits a confirmation result for a webhook task', async () => {
    const { ctx, events } = makeCtx()
    handler.register('https://example.com', { path: '/hooks/abc', methods: ['POST'], secret: 's' })
    await handler.execute(
      handler.validateConfig({ path: '/hooks/abc', methods: ['POST'] }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toMatchObject({ registered: 1, path: '/hooks/abc' })
  })
})
