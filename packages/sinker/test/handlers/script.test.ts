import { describe, it, expect, beforeEach } from 'vitest'
import { ScriptHandler } from '../../src/handlers/script.js'
import { ScriptSandboxError } from '../../src/errors.js'
import { makeTask } from '../fixtures/make-task.js'
import type { Execution, PayloadHandler, TriggerContext } from '../../src/index.js'

function makeCtx() {
  const events: { type: string; data?: unknown; ts: number }[] = []
  const task = makeTask({ payload_kind: 'script' })
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
    signal: new AbortController().signal,
    emit: (e) => events.push({ type: e.type, data: e.data, ts: e.ts }),
  }
  return { events, ctx }
}

describe('ScriptHandler (vm sandbox)', () => {
  let handler: ScriptHandler

  beforeEach(() => {
    handler = new ScriptHandler()
  })

  it('rejects invalid config', () => {
    expect(() => handler.validateConfig({ source: '' })).toThrow()
  })

  it('runs pure compute JS and returns the value', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(handler.validateConfig({ source: 'return 1 + 1' }), ctx)
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toBe(2)
  })

  it('runs a Promise-returning script', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({ source: 'return await Promise.resolve("ok")' }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toBe('ok')
  })

  it('captures console output as log events', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({ source: "console.log('hello'); return null" }),
      ctx,
    )
    const logs = events.filter((e) => e.type === 'log')
    expect(logs.length).toBeGreaterThan(0)
  })

  it('static scan rejects process.exit', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'process.exit(0)' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects require()', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: "const fs = require('fs')" }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects globalThis', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'globalThis.process' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects dynamic import()', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: "await import('fs')" }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('runtime: bracket-string process access returns undefined (no host leak)', async () => {
    const { ctx, events } = makeCtx()
    /* Static scan doesn't catch `this['pro'+'cess']` (string concat).
     * The Proxy `get` trap fires for `process` and V8 demotes the
     * throw to `undefined` in this code path, so the script safely
     * receives undefined instead of a host reference. Either outcome
     * (throw or undefined) is secure — what we MUST verify is that
     * the result is undefined, NOT the host `process` object. */
    await handler.execute(
      handler.validateConfig({ source: "return this['pro' + 'cess']" }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toBeUndefined()
  })

  it('rejects scripts larger than 64 KB', () => {
    expect(() => handler.validateConfig({ source: 'a'.repeat(70_000) })).toThrow()
  })

  it('rejects infinite loop via hard timeout', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'while(true){}', timeoutMs: 200 }),
        ctx,
      ),
    ).rejects.toThrow()
  }, 5_000)

  /* ------------------ PHASE 1.5: sandbox hardening ------------------ */

  it('static scan rejects Function("return process") backdoor', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: "Function('return process')()" }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects bare Function identifier', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'Function' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects new Function(...) call', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: "new Function('return 1')()" }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects (0, eval)(...) indirect eval', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: "(0, eval)('process')" }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects bare `eval` identifier', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'eval' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects globalThis.process', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'globalThis.process' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects bare `process` identifier', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'process' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects `Buffer` identifier', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'Buffer' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects `__dirname` / `__filename`', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(handler.validateConfig({ source: '__dirname' }), ctx),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
    await expect(
      handler.execute(handler.validateConfig({ source: '__filename' }), ctx),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects `require` identifier (no parens)', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'const r = require' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('static scan rejects dynamic import() of a relative path', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ source: "await import('./evil.js')" }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('runtime Proxy rejects prototype-walk escape (this.constructor.constructor)', async () => {
    const { ctx } = makeCtx()
    /* The static regex catches `Function`/`new Function`, but the source
     * `({}).constructor.constructor` is the canonical prototype walk.
     * Because the source doesn't mention `Function`/`eval` by name, the
     * static scan passes — the Proxy's `get` trap should still throw
     * ScriptSandboxError when the script walks the prototype chain to
     * reach `Function`. */
    await expect(
      handler.execute(
        handler.validateConfig({
          source: "return ({}).constructor.constructor('return process')()",
        }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('runtime Proxy rejects array prototype-walk escape ([].constructor.constructor)', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({
          source: "return [].constructor.constructor('return 1')()",
        }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })

  it('runtime Proxy: bracket-string global access returns undefined (no host leak)', async () => {
    const { ctx, events } = makeCtx()
    /* Static scan blocks bare `global` keyword, but a string-concat
     * walk (`this['glo'+'bal']`) slips through. The Proxy `get` trap
     * fires for `global` and V8 demotes the throw to undefined — so
     * the script safely receives undefined instead of a host
     * reference. The CRITICAL assertion is that the result is
     * undefined, NOT the host `global` object. */
    await handler.execute(
      handler.validateConfig({ source: "return this['glo' + 'bal']" }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toBeUndefined()
  })

  it('accepts pure compute and returns the value', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({ source: 'return 1 + 1' }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toBe(2)
  })

  it('accepts fetch + Promise composition', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({
        source: 'return await Promise.resolve("hello")',
      }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toBe('hello')
  })

  it('accepts console.log and captures the output', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({
        source: "console.log('hello', 42); return null",
      }),
      ctx,
    )
    const log = events.find((e) => e.type === 'log')
    expect(log?.data).toMatchObject({ stream: 'log' })
  })

  it('accepts console.warn / error / info', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({
        source:
          "console.warn('w'); console.error('e'); console.info('i'); return null",
      }),
      ctx,
    )
    const streams = events
      .filter((e) => e.type === 'log')
      .map((e) => (e.data as { stream: string }).stream)
    expect(streams).toEqual(expect.arrayContaining(['warn', 'error', 'info']))
  })

  it('accepts JSON.parse / JSON.stringify', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({
        source: "return JSON.parse(JSON.stringify({ a: 1 }))",
      }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data
    expect(result).toEqual({ a: 1 })
  })

  it('accepts URL / URLSearchParams / Math / Date', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({
        source:
          'const u = new URL("https://example.com/x?q=1"); return [u.host, Math.max(1,2), new Date(0).toISOString().startsWith("1970")];',
      }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data as unknown[]
    expect(result?.[0]).toBe('example.com')
    expect(result?.[1]).toBe(2)
    expect(result?.[2]).toBe(true)
  })

  it('rejects Reflect / Proxy identifier smuggling', async () => {
    const { ctx } = makeCtx()
    /* The bare identifier `Reflect` / `Proxy` opens metaprogramming
     * surfaces that combine with prototype walks to escape. We block
     * them at the static-scan layer. */
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'Reflect' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
    await expect(
      handler.execute(
        handler.validateConfig({ source: 'new Proxy({}, {})' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ScriptSandboxError)
  })
})
