import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  curlNode,
  dbPollNode,
  emailInboxNode,
  fileWatcherNode,
  inputShellNode,
  inputWebhookNode,
  manualTriggerNode,
  scheduleTriggerNode,
} from '../src/index.js'
import { lastResult, makeContext } from './helpers.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('input/curl', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('fetches a URL and emits body/status/headers', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, n: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-foo': 'bar' },
      })) as typeof fetch
    const { ctx, events } = makeContext()
    await curlNode.handler(
      curlNode.configSchema.parse({
        url: 'https://203.0.113.10/data',
        method: 'GET',
        skip_dns_check: true,
      }),
      ctx,
    )
    const result = lastResult(events) as { status: number; body: unknown; headers: Record<string, string> }
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, n: 42 })
    expect(result.headers['x-foo']).toBe('bar')
    expect(events.map((e) => e.type)).toContain('started')
    expect(events.map((e) => e.type)).toContain('finished')
  })

  it('rejects a blocked private host', async () => {
    const { ctx } = makeContext()
    await expect(
      curlNode.handler(
        curlNode.configSchema.parse({ url: 'http://169.254.169.254/latest/meta-data' }),
        ctx,
      ),
    ).rejects.toThrow(/SSRF blocked/i)
  })

  it('throws on a non-2xx response', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch
    const { ctx } = makeContext()
    await expect(
      curlNode.handler(
        curlNode.configSchema.parse({ url: 'https://203.0.113.10/x', skip_dns_check: true }),
        ctx,
      ),
    ).rejects.toThrow(/HTTP 503/)
  })
})

describe('input/webhook', () => {
  it('validates path and emits registered result', async () => {
    const { ctx, events } = makeContext({ trigger: { payload: { hello: 'world' } } })
    await inputWebhookNode.handler(
      inputWebhookNode.configSchema.parse({ path: '/hooks/abc123', methods: ['POST'] }),
      ctx,
    )
    const result = lastResult(events) as { path: string; payload: unknown }
    expect(result.path).toBe('/hooks/abc123')
    expect(result.payload).toEqual({ hello: 'world' })
  })

  it('rejects a path without a leading slash', () => {
    expect(() => inputWebhookNode.configSchema.parse({ path: 'hooks/abc' })).toThrow()
  })
})

describe('input/shell', () => {
  it('runs a whitelisted command and emits stdout', async () => {
    const { ctx, events } = makeContext()
    await inputShellNode.handler(
      inputShellNode.configSchema.parse({ cmd: 'echo', args: ['hello'] }),
      ctx,
    )
    const result = lastResult(events) as { exitCode: number; stdout: string }
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
  })

  it('rejects a non-whitelisted binary', async () => {
    const { ctx } = makeContext()
    await expect(
      inputShellNode.handler(inputShellNode.configSchema.parse({ cmd: 'rm', args: ['-rf', '/'] }), ctx),
    ).rejects.toThrow(/not in the whitelist/)
  })
})

describe('input/schedule-trigger', () => {
  it('requires cron or everyMs', () => {
    expect(() => scheduleTriggerNode.configSchema.parse({})).toThrow()
  })

  it('emits the schedule descriptor', async () => {
    const { ctx, events } = makeContext()
    await scheduleTriggerNode.handler(
      scheduleTriggerNode.configSchema.parse({ cron: '0 9 * * *', timezone: 'UTC' }),
      ctx,
    )
    const result = lastResult(events) as { schedule: { cron: string } }
    expect(result.schedule.cron).toBe('0 9 * * *')
  })
})

describe('input/manual-trigger', () => {
  it('passes through the payload', async () => {
    const { ctx, events } = makeContext({ trigger: { payload: { user: 'alice' } } })
    await manualTriggerNode.handler(manualTriggerNode.configSchema.parse({ note: 'debug run' }), ctx)
    const result = lastResult(events) as { note: string; payload: unknown }
    expect(result.note).toBe('debug run')
    expect(result.payload).toEqual({ user: 'alice' })
  })
})

describe('input/file-watcher', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulsedeck-watch-'))
    await writeFile(join(dir, 'a.txt'), 'aaa')
    await writeFile(join(dir, 'b.json'), '{}')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('snapshots files under a directory', async () => {
    const { ctx, events } = makeContext()
    await fileWatcherNode.handler(fileWatcherNode.configSchema.parse({ path: dir }), ctx)
    const result = lastResult(events) as { files: { path: string }[]; count: number }
    expect(result.count).toBe(2)
    const names = result.files.map((f) => f.path.split('/').pop())
    expect(names).toContain('a.txt')
    expect(names).toContain('b.json')
  })

  it('filters by extension', async () => {
    const { ctx, events } = makeContext()
    await fileWatcherNode.handler(
      fileWatcherNode.configSchema.parse({ path: dir, extensions: ['.json'] }),
      ctx,
    )
    const result = lastResult(events) as { count: number; files: { path: string }[] }
    expect(result.count).toBe(1)
    expect(result.files[0]?.path.endsWith('.json')).toBe(true)
  })
})

describe('input/email-inbox', () => {
  it('stub mode returns an empty mailbox without a connection', async () => {
    const { ctx, events } = makeContext()
    await emailInboxNode.handler(
      emailInboxNode.configSchema.parse({ host: 'imap.example.com', username: 'user' }),
      ctx,
    )
    const result = lastResult(events) as { count: number; mode: string; messages: unknown[] }
    expect(result.mode).toBe('stub')
    expect(result.count).toBe(0)
    expect(Array.isArray(result.messages)).toBe(true)
  })

  it('rejects missing username', () => {
    expect(() => emailInboxNode.configSchema.parse({ host: 'imap.example.com' })).toThrow()
  })
})

describe('input/db-poll', () => {
  it('runs a JSONPath query over the dataset', async () => {
    const { ctx, events } = makeContext()
    await dbPollNode.handler(
      dbPollNode.configSchema.parse({
        dialect: 'json',
        data: [{ id: 1, status: 'ok' }, { id: 2, status: 'err' }],
        query: '$[*].id',
      }),
      ctx,
    )
    const result = lastResult(events) as { rows: unknown[]; count: number }
    expect(result.count).toBe(2)
    expect(result.rows).toEqual([1, 2])
  })

  it('throws on sqlite dialect (not implemented)', async () => {
    const { ctx } = makeContext()
    await expect(
      dbPollNode.handler(dbPollNode.configSchema.parse({ dialect: 'sqlite' }), ctx),
    ).rejects.toThrow(/not implemented/)
  })
})
