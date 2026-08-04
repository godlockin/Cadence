import { describe, expect, it } from 'vitest'
import { inputZodSchemaNode, jsonpathAssertNode } from '../src/index.js'
import { lastResult, makeContext } from './helpers.js'

describe('input-validate/zod-schema', () => {
  it('passes a payload matching the schema', async () => {
    const { ctx, events } = makeContext({ trigger: { payload: { user: 'alice', age: 30 } } })
    await inputZodSchemaNode.handler(
      inputZodSchemaNode.configSchema.parse({
        schema: { type: 'object', required: ['user'], properties: { user: { type: 'string' } } },
      }),
      ctx,
    )
    const result = lastResult(events) as { valid: boolean; errors: unknown[] }
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects a payload with a missing required field (strict)', async () => {
    const { ctx } = makeContext({ trigger: { payload: { age: 30 } } })
    await expect(
      inputZodSchemaNode.handler(
        inputZodSchemaNode.configSchema.parse({
          schema: { type: 'object', required: ['user'], properties: { user: { type: 'string' } } },
        }),
        ctx,
      ),
    ).rejects.toThrow(/validation failed/)
  })

  it('non-strict mode reports failures without throwing', async () => {
    const { ctx, events } = makeContext({ trigger: { payload: { age: 'nope' } } })
    await inputZodSchemaNode.handler(
      inputZodSchemaNode.configSchema.parse({
        schema: { type: 'object', properties: { age: { type: 'integer' } } },
        strict: false,
      }),
      ctx,
    )
    const result = lastResult(events) as { valid: boolean; errors: unknown[] }
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('checks string length constraints', async () => {
    const { ctx } = makeContext({ trigger: { payload: { code: 'abc' } } })
    await expect(
      inputZodSchemaNode.handler(
        inputZodSchemaNode.configSchema.parse({
          schema: { type: 'object', properties: { code: { type: 'string', minLength: 5 } } },
        }),
        ctx,
      ),
    ).rejects.toThrow()
  })
})

describe('input-validate/jsonpath-assert', () => {
  it('asserts a nested value with equals', async () => {
    const { ctx, events } = makeContext({
      trigger: { payload: { store: { book: [{ title: 'A' }, { title: 'B' }] } } },
    })
    await jsonpathAssertNode.handler(
      jsonpathAssertNode.configSchema.parse({ path: '$.store.book[0].title', equals: 'A' }),
      ctx,
    )
    const result = lastResult(events) as { ok: boolean; matches: number }
    expect(result.ok).toBe(true)
    expect(result.matches).toBe(1)
  })

  it('asserts match count', async () => {
    const { ctx, events } = makeContext({
      trigger: { payload: { items: [1, 2, 3, 4] } },
    })
    await jsonpathAssertNode.handler(
      jsonpathAssertNode.configSchema.parse({ path: '$.items[*]', count: 4 }),
      ctx,
    )
    expect((lastResult(events) as { ok: boolean }).ok).toBe(true)
  })

  it('fails when the expected value does not match', async () => {
    const { ctx } = makeContext({ trigger: { payload: { user: { id: 7 } } } })
    await expect(
      jsonpathAssertNode.handler(
        jsonpathAssertNode.configSchema.parse({ path: '$.user.id', equals: 9 }),
        ctx,
      ),
    ).rejects.toThrow(/jsonpath-assert failed/)
  })

  it('supports deep-scan and filters', async () => {
    const { ctx, events } = makeContext({
      trigger: { payload: { a: { b: { c: 1 } }, d: [{ c: 2 }, { c: 3 }] } },
    })
    await jsonpathAssertNode.handler(
      jsonpathAssertNode.configSchema.parse({ path: '$..c', count: 3 }),
      ctx,
    )
    expect((lastResult(events) as { ok: boolean }).ok).toBe(true)
  })
})
