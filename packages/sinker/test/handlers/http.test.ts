import { describe, it, expect, beforeEach } from 'vitest'
import { HttpHandler } from '../../src/handlers/http.js'
import { SSRFError } from '../../src/errors.js'
import { makeTask } from '../fixtures/make-task.js'
import type { Execution, PayloadHandler, TriggerContext } from '../../src/index.js'

function makeContext(signal: AbortSignal = new AbortController().signal) {
  const events: { type: string; data?: unknown; ts: number }[] = []
  const task = makeTask({ payload_kind: 'http' })
  const execution = {
    id: '01JCCCCCCCCCCCCCCCCCCCCCCC',
    taskId: task.id,
    status: 'running' as const,
    triggerSource: 'manual' as const,
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
  const trigger: TriggerContext = { source: 'manual' }
  const ctx: Parameters<PayloadHandler['execute']>[1] = {
    task,
    execution,
    trigger,
    signal,
    emit: (e) => events.push({ type: e.type, data: e.data, ts: e.ts }),
  }
  return { events, task, execution, trigger, ctx }
}

describe('HttpHandler', () => {
  let handler: HttpHandler

  beforeEach(() => {
    handler = new HttpHandler()
  })

  it('rejects invalid config', () => {
    expect(() => handler.validateConfig({ url: 'not-a-url' })).toThrow()
  })

  it('emits started/result/finished on success', async () => {
    const { ctx, events } = makeContext()
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch

    try {
      await handler.execute(
        handler.validateConfig({ url: 'https://example.com', method: 'POST', body: { hi: 1 } }),
        ctx,
      )
    } finally {
      globalThis.fetch = original
    }

    const types = events.map((e) => e.type)
    expect(types).toContain('started')
    expect(types).toContain('result')
    expect(types).toContain('finished')
  })

  it('throws on non-2xx response', async () => {
    const { ctx } = makeContext()
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('nope', { status: 500, statusText: 'Internal Server Error' })) as typeof fetch
    try {
      await expect(
        handler.execute(handler.validateConfig({ url: 'https://example.com' }), ctx),
      ).rejects.toThrow(/HTTP 500/)
    } finally {
      globalThis.fetch = original
    }
  })

  /* ---------- SSRF guard ---------- */

  it('rejects http://localhost', async () => {
    const { ctx } = makeContext()
    await expect(
      handler.execute(
        handler.validateConfig({ url: 'http://localhost:3000/secret' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects http://127.0.0.1', async () => {
    const { ctx } = makeContext()
    await expect(
      handler.execute(
        handler.validateConfig({ url: 'http://127.0.0.1/' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects http://192.168.1.1', async () => {
    const { ctx } = makeContext()
    await expect(
      handler.execute(
        handler.validateConfig({ url: 'http://192.168.1.1/' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects AWS metadata IP 169.254.169.254', async () => {
    const { ctx } = makeContext()
    await expect(
      handler.execute(
        handler.validateConfig({ url: 'http://169.254.169.254/latest/meta-data/' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects plaintext HTTP unless allow_insecure=true', async () => {
    const { ctx } = makeContext()
    await expect(
      handler.execute(
        handler.validateConfig({ url: 'http://example.com' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(SSRFError)
  })

  it('accepts HTTPS', async () => {
    const { ctx, events } = makeContext()
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('ok', { status: 200 })) as typeof fetch
    try {
      await handler.execute(
        handler.validateConfig({ url: 'https://api.github.com/users/octocat' }),
        ctx,
      )
      const types = events.map((e) => e.type)
      expect(types).toContain('result')
    } finally {
      globalThis.fetch = original
    }
  })

  it('blocks 30x redirect to an internal host', async () => {
    const { ctx } = makeContext()
    const original = globalThis.fetch
    let count = 0
    globalThis.fetch = (async () => {
      count += 1
      if (count === 1) {
        return new Response(null, { status: 302, headers: { location: 'http://localhost:3000' } })
      }
      return new Response('never', { status: 200 })
    }) as typeof fetch
    try {
      await expect(
        handler.execute(
          handler.validateConfig({ url: 'https://api.github.com/redirect' }),
          ctx,
        ),
      ).rejects.toBeInstanceOf(SSRFError)
    } finally {
      globalThis.fetch = original
    }
  })

  it('rejects DNS-rebinding: hostname resolves to private IP after parse', async () => {
    const handlerWithLookup = new HttpHandler({
      lookup: async (_h, _opts) => [{ address: '10.0.0.1', family: 4 }],
    })
    const { ctx } = makeContext()
    await expect(
      handlerWithLookup.execute(
        handlerWithLookup.validateConfig({ url: 'https://attacker.example.com/' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(SSRFError)
  })
})
