import { describe, expect, it } from 'vitest'
import { httpStatusNode, resultZodSchemaNode } from '../src/index.js'
import { lastResult, makeContext } from './helpers.js'

describe('result-validate/zod-schema', () => {
  it('validates the flow value', async () => {
    const { ctx, events } = makeContext({ trigger: { payload: { status: 'ok' } } })
    await resultZodSchemaNode.handler(
      resultZodSchemaNode.configSchema.parse({
        schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' } } },
      }),
      ctx,
    )
    expect((lastResult(events) as { valid: boolean }).valid).toBe(true)
  })

  it('validates against the execution result when source=execution', async () => {
    const { ctx, events } = makeContext({
      execution: { resultJson: JSON.stringify({ ok: true }) },
    })
    await resultZodSchemaNode.handler(
      resultZodSchemaNode.configSchema.parse({
        schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
        source: 'execution',
      }),
      ctx,
    )
    expect((lastResult(events) as { valid: boolean }).valid).toBe(true)
  })

  it('rejects a bad result (strict)', async () => {
    const { ctx } = makeContext({ trigger: { payload: { count: 'many' } } })
    await expect(
      resultZodSchemaNode.handler(
        resultZodSchemaNode.configSchema.parse({
          schema: { type: 'object', properties: { count: { type: 'integer' } } },
        }),
        ctx,
      ),
    ).rejects.toThrow(/result validation failed/)
  })
})

describe('result-validate/http-status', () => {
  it('passes when the status is expected and headers present', async () => {
    const { ctx, events } = makeContext({
      trigger: { payload: { status: 200, headers: { 'content-type': 'application/json' } } },
    })
    await httpStatusNode.handler(
      httpStatusNode.configSchema.parse({
        statuses: [200, 201],
        requireHeaders: { 'content-type': 'application/json' },
      }),
      ctx,
    )
    const result = lastResult(events) as { ok: boolean; failures: unknown[] }
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails when the status is unexpected', async () => {
    const { ctx } = makeContext({ trigger: { payload: { status: 500 } } })
    await expect(
      httpStatusNode.handler(httpStatusNode.configSchema.parse({ statuses: [200] }), ctx),
    ).rejects.toThrow(/http-status failed/)
  })

  it('fails when a required header is missing', async () => {
    const { ctx } = makeContext({ trigger: { payload: { status: 200, headers: {} } } })
    await expect(
      httpStatusNode.handler(
        httpStatusNode.configSchema.parse({ statuses: [200], requireHeaders: { 'x-trace': 'abc' } }),
        ctx,
      ),
    ).rejects.toThrow(/missing header/)
  })

  it('non-strict mode reports failures without throwing', async () => {
    const { ctx, events } = makeContext({ trigger: { payload: { status: 404 } } })
    await httpStatusNode.handler(
      httpStatusNode.configSchema.parse({ statuses: [200], strict: false }),
      ctx,
    )
    expect((lastResult(events) as { ok: boolean }).ok).toBe(false)
  })
})
