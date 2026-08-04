import { afterEach, describe, expect, it } from 'vitest'
import {
  dataMergeNode,
  httpForwardNode,
  llmTextNode,
  llmVisionNode,
  scriptJsNode,
  scriptPythonNode,
  transformJmespathNode,
  transformJsonataNode,
} from '../src/index.js'
import { lastResult, makeContext } from './helpers.js'

describe('process/http-forward', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('forwards a payload and emits the upstream response', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ received: true }), { status: 201 })) as typeof fetch
    const { ctx, events } = makeContext()
    await httpForwardNode.handler(
      httpForwardNode.configSchema.parse({
        url: 'https://203.0.113.20/api',
        method: 'POST',
        body: { hello: 'world' },
        skip_dns_check: true,
      }),
      ctx,
    )
    const result = lastResult(events) as { status: number; body: unknown }
    expect(result.status).toBe(201)
    expect(result.body).toEqual({ received: true })
  })

  it('throws on upstream failure', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
    const { ctx } = makeContext()
    await expect(
      httpForwardNode.handler(
        httpForwardNode.configSchema.parse({ url: 'https://203.0.113.20/x', skip_dns_check: true }),
        ctx,
      ),
    ).rejects.toThrow(/HTTP 500/)
  })
})

describe('process/transform-jmespath', () => {
  it('extracts a nested field', async () => {
    const { ctx, events } = makeContext()
    await transformJmespathNode.handler(
      transformJmespathNode.configSchema.parse({
        expression: 'store.book[0].title',
        data: { store: { book: [{ title: 'Alpha' }, { title: 'Beta' }] } },
      }),
      ctx,
    )
    expect(lastResult(events)).toBe('Alpha')
  })

  it('projects a list with [*]', async () => {
    const { ctx, events } = makeContext()
    await transformJmespathNode.handler(
      transformJmespathNode.configSchema.parse({
        expression: 'items[*].name',
        data: { items: [{ name: 'a' }, { name: 'b' }] },
      }),
      ctx,
    )
    expect(lastResult(events)).toEqual(['a', 'b'])
  })

  it('supports pipes with @', async () => {
    const { ctx, events } = makeContext()
    await transformJmespathNode.handler(
      transformJmespathNode.configSchema.parse({
        expression: 'rows | [0].id',
        data: { rows: [{ id: 1 }, { id: 2 }] },
      }),
      ctx,
    )
    expect(lastResult(events)).toBe(1)
  })

  it('throws a typed error on a bad expression', async () => {
    const { ctx } = makeContext()
    await expect(
      transformJmespathNode.handler(
        transformJmespathNode.configSchema.parse({ expression: '!!!', data: {} }),
        ctx,
      ),
    ).rejects.toThrow(/JMESPath/)
  })
})

describe('process/transform-jsonata', () => {
  it('concatenates strings with &', async () => {
    const { ctx, events } = makeContext()
    await transformJsonataNode.handler(
      transformJsonataNode.configSchema.parse({
        expression: "firstName & ' ' & lastName",
        data: { firstName: 'Ada', lastName: 'Lovelace' },
      }),
      ctx,
    )
    expect(lastResult(events)).toBe('Ada Lovelace')
  })

  it('does arithmetic', async () => {
    const { ctx, events } = makeContext()
    await transformJsonataNode.handler(
      transformJsonataNode.configSchema.parse({ expression: 'price * 2', data: { price: 21 } }),
      ctx,
    )
    expect(lastResult(events)).toBe(42)
  })

  it('indexes arrays', async () => {
    const { ctx, events } = makeContext()
    await transformJsonataNode.handler(
      transformJsonataNode.configSchema.parse({ expression: '$.tags[0]', data: { tags: ['x', 'y'] } }),
      ctx,
    )
    expect(lastResult(events)).toBe('x')
  })
})

describe('process/llm-text', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('calls the LLM endpoint and returns the completion', async () => {
    let capturedBody: unknown
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Hello from LLM' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
    const { ctx, events } = makeContext()
    await llmTextNode.handler(
      llmTextNode.configSchema.parse({
        model: 'gpt-test',
        prompt: 'Say hi',
        endpoint: 'https://api.openai.test/v1/chat/completions',
      }),
      ctx,
    )
    expect(lastResult(events)).toBe('Hello from LLM')
    const parsed = JSON.parse(String(capturedBody)) as { model: string; messages: { role: string }[] }
    expect(parsed.model).toBe('gpt-test')
    expect(parsed.messages[0]?.role).toBe('system')
  })

  it('throws on a non-2xx LLM response', async () => {
    globalThis.fetch = (async () => new Response('rate limited', { status: 429 })) as typeof fetch
    const { ctx } = makeContext()
    await expect(
      llmTextNode.handler(
        llmTextNode.configSchema.parse({
          model: 'gpt-test',
          prompt: 'hi',
          endpoint: 'https://api.openai.test/v1/chat/completions',
        }),
        ctx,
      ),
    ).rejects.toThrow(/LLM API returned 429/)
  })
})

describe('process/llm-vision', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends an image_url content block', async () => {
    let captured: unknown
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init?.body
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'It is a cat' } }] }),
        { status: 200 },
      )
    }) as typeof fetch
    const { ctx, events } = makeContext()
    await llmVisionNode.handler(
      llmVisionNode.configSchema.parse({
        model: 'gpt-vision',
        prompt: 'What is in this image?',
        imageUrl: 'https://example.com/cat.png',
        endpoint: 'https://api.openai.test/v1/chat/completions',
      }),
      ctx,
    )
    expect(lastResult(events)).toBe('It is a cat')
    const body = JSON.parse(String(captured)) as {
      messages: { content: { type: string; image_url: string }[] }[]
    }
    const block = body.messages[1]?.content[1]
    expect(block?.type).toBe('image_url')
    expect(block?.image_url).toBe('https://example.com/cat.png')
  })
})

describe('process/script-js', () => {
  it('runs user JS in the sandbox and returns the result', async () => {
    const { ctx, events } = makeContext()
    await scriptJsNode.handler(
      scriptJsNode.configSchema.parse({ source: 'const x = 40; return x + 2' }),
      ctx,
    )
    expect(lastResult(events)).toBe(42)
  })

  it('captures console.log as log events', async () => {
    const { ctx, events } = makeContext()
    await scriptJsNode.handler(
      scriptJsNode.configSchema.parse({ source: 'console.log("trace"); return 1' }),
      ctx,
    )
    expect(events.filter((e) => e.type === 'log').length).toBeGreaterThan(0)
  })

  it('blocks process access', async () => {
    const { ctx } = makeContext()
    await expect(
      scriptJsNode.handler(
        scriptJsNode.configSchema.parse({ source: 'return process.env.HOME' }),
        ctx,
      ),
    ).rejects.toThrow(/disallowed identifier/)
  })
})

describe('process/script-python', () => {
  it('runs python3 with an injected payload', async () => {
    const { ctx, events } = makeContext()
    await scriptPythonNode.handler(
      scriptPythonNode.configSchema.parse({
        source: 'result = payload["x"] + 1',
        payload: { x: 41 },
      }),
      ctx,
    )
    const result = lastResult(events) as { exitCode: number; stdout: string }
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('42')
  })

  it('propagates a non-zero python exit', async () => {
    const { ctx } = makeContext()
    await expect(
      scriptPythonNode.handler(
        scriptPythonNode.configSchema.parse({ source: 'raise RuntimeError("boom")' }),
        ctx,
      ),
    ).rejects.toThrow()
  })
})

describe('process/data-merge', () => {
  it('left-joins two tables', async () => {
    const { ctx, events } = makeContext()
    await dataMergeNode.handler(
      dataMergeNode.configSchema.parse({
        left: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
        right: [{ id: 1, city: 'NYC' }],
        leftKey: 'id',
        rightKey: 'id',
        type: 'left',
      }),
      ctx,
    )
    const result = lastResult(events) as { id: number; name: string; city: string | null }[]
    expect(result).toHaveLength(2)
    expect(result[0]?.city).toBe('NYC')
    expect(result[1]?.city).toBeNull()
  })

  it('inner-join drops unmatched rows', async () => {
    const { ctx, events } = makeContext()
    await dataMergeNode.handler(
      dataMergeNode.configSchema.parse({
        left: [{ id: 1 }, { id: 2 }],
        right: [{ id: 1 }],
        leftKey: 'id',
        rightKey: 'id',
        type: 'inner',
      }),
      ctx,
    )
    expect(lastResult(events)).toHaveLength(1)
  })

  it('rejects non-object inputs', async () => {
    const { ctx } = makeContext()
    await expect(
      dataMergeNode.handler(
        dataMergeNode.configSchema.parse({
          left: [1, 2],
          right: [],
          leftKey: 'id',
          rightKey: 'id',
        }),
        ctx,
      ),
    ).rejects.toThrow(/array of objects/)
  })
})
