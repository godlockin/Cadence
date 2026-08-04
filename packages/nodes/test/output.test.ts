import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopNotificationNode,
  emailSendNode,
  fileWriteNode,
  httpResponseNode,
  outputWebhookNode,
  shellExecNode,
} from '../src/index.js'
import { lastResult, makeContext } from './helpers.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('output/http-response', () => {
  it('builds a response from the flow value', async () => {
    const { ctx, events } = makeContext({ trigger: { payload: { hello: 'world' } } })
    await httpResponseNode.handler(httpResponseNode.configSchema.parse({ status: 200 }), ctx)
    const result = lastResult(events) as { status: number; body: unknown; headers: Record<string, string> }
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ hello: 'world' })
    expect(result.headers['content-type']).toBe('application/json')
  })

  it('honours an explicit body and custom content type', async () => {
    const { ctx, events } = makeContext()
    await httpResponseNode.handler(
      httpResponseNode.configSchema.parse({
        status: 201,
        body: '<h1>ok</h1>',
        contentType: 'text/html',
      }),
      ctx,
    )
    const result = lastResult(events) as { status: number; body: unknown }
    expect(result.status).toBe(201)
    expect(result.body).toBe('<h1>ok</h1>')
  })
})

describe('output/webhook', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('POSTs the flow value to a webhook', async () => {
    let captured: unknown
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init?.body
      return new Response('accepted', { status: 202 })
    }) as typeof fetch
    const { ctx, events } = makeContext({ trigger: { payload: { event: 'deploy' } } })
    await outputWebhookNode.handler(
      outputWebhookNode.configSchema.parse({
        url: 'https://203.0.113.30/hook',
        skip_dns_check: true,
      }),
      ctx,
    )
    const result = lastResult(events) as { status: number }
    expect(result.status).toBe(202)
    expect(JSON.parse(String(captured))).toEqual({ event: 'deploy' })
  })

  it('throws on a non-2xx webhook response', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 400 })) as typeof fetch
    const { ctx } = makeContext()
    await expect(
      outputWebhookNode.handler(
        outputWebhookNode.configSchema.parse({
          url: 'https://203.0.113.30/hook',
          skip_dns_check: true,
        }),
        ctx,
      ),
    ).rejects.toThrow(/webhook HTTP 400/)
  })
})

describe('output/email-send', () => {
  it('stub mode returns a synthetic message id', async () => {
    const { ctx, events } = makeContext()
    await emailSendNode.handler(
      emailSendNode.configSchema.parse({
        to: ['ops@example.com'],
        subject: 'Deploy',
        body: 'Done',
      }),
      ctx,
    )
    const result = lastResult(events) as { messageId: string; mode: string }
    expect(result.mode).toBe('stub')
    expect(result.messageId).toMatch(/^pulsedeck-/)
  })

  it('rejects smtp mode until implemented', async () => {
    const { ctx } = makeContext()
    await expect(
      emailSendNode.handler(
        emailSendNode.configSchema.parse({
          to: ['a@b.com'],
          subject: 'x',
          body: 'y',
          mode: 'smtp',
        }),
        ctx,
      ),
    ).rejects.toThrow(/not implemented/)
  })
})

describe('output/desktop-notification', () => {
  it('builds a platform command in dryRun mode', async () => {
    const { ctx, events } = makeContext()
    await desktopNotificationNode.handler(
      desktopNotificationNode.configSchema.parse({
        title: 'PulseDeck',
        body: 'Task finished',
        dryRun: true,
      }),
      ctx,
    )
    const result = lastResult(events) as { command: string; args: string[]; dryRun: boolean }
    expect(result.dryRun).toBe(true)
    expect(['osascript', 'notify-send', 'msg', 'echo']).toContain(result.command)
    expect(result.args.length).toBeGreaterThan(0)
  })

  it('defaults to dryRun for safety', () => {
    const parsed = desktopNotificationNode.configSchema.parse({ title: 'T', body: 'B' })
    expect(parsed.dryRun).toBe(true)
  })
})

describe('output/shell-exec', () => {
  it('runs a whitelisted command', async () => {
    const { ctx, events } = makeContext()
    await shellExecNode.handler(
      shellExecNode.configSchema.parse({ cmd: 'echo', args: ['done'] }),
      ctx,
    )
    const result = lastResult(events) as { exitCode: number; stdout: string }
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('done')
  })

  it('throws on a non-zero exit', async () => {
    const { ctx } = makeContext()
    await expect(
      shellExecNode.handler(shellExecNode.configSchema.parse({ cmd: 'grep', args: ['-nope'] }), ctx),
    ).rejects.toThrow()
  })
})

describe('output/file-write', () => {
  it('writes a JSON payload under /tmp', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulsedeck-write-'))
    const file = join(dir, 'out.json')
    try {
      const { ctx, events } = makeContext({ trigger: { payload: { ok: true } } })
      await fileWriteNode.handler(fileWriteNode.configSchema.parse({ path: file }), ctx)
      const result = lastResult(events) as { path: string; bytes: number }
      expect(result.path).toBe(file)
      expect(result.bytes).toBeGreaterThan(0)
      const content = await readFile(file, 'utf8')
      expect(JSON.parse(content)).toEqual({ ok: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('appends in append mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulsedeck-append-'))
    const file = join(dir, 'log.txt')
    try {
      const { ctx } = makeContext()
      await fileWriteNode.handler(
        fileWriteNode.configSchema.parse({ path: file, content: 'first', mode: 'append' }),
        ctx,
      )
      await fileWriteNode.handler(
        fileWriteNode.configSchema.parse({ path: file, content: 'second', mode: 'append' }),
        ctx,
      )
      const content = await readFile(file, 'utf8')
      expect(content.split('\n').filter(Boolean)).toEqual(['first', 'second'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects paths outside /tmp and $HOME', async () => {
    const { ctx } = makeContext()
    await expect(
      fileWriteNode.handler(
        fileWriteNode.configSchema.parse({ path: '/etc/passwd', content: 'x' }),
        ctx,
      ),
    ).rejects.toThrow(/not under \/tmp or \$HOME/)
  })
})
