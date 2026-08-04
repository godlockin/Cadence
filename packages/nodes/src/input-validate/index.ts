/**
 * @cadence/nodes — INPUT-VALIDATE category (2 nodes).
 *
 * Validate the incoming payload before downstream processing.
 */
import { z } from 'zod'
import { defineNode } from '../registry.js'
import { emitFinished, emitResult, emitStarted, flowInput } from '../lib/context.js'
import { deepEqual, validateWithSchema, type JsonSchema } from '../lib/json-schema.js'
import { evaluateJsonPath, JsonPathError } from '../lib/json-path.js'

/* ------------------------------------------------------------ zod-schema -- */

const InputZodSchemaConfigSchema = z.object({
  /** JSON-Schema (draft-07 subset) the incoming payload must satisfy. */
  schema: z.record(z.unknown()),
  /** When true, reject (throw) on invalid payload instead of passing through. */
  strict: z.boolean().default(true),
})

export const inputZodSchemaNode = defineNode<z.infer<typeof InputZodSchemaConfigSchema>>({
  kind: 'zod-schema.v1',
  type: 'input-validate',
  configSchema: InputZodSchemaConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const payload = flowInput(config, ctx)
    emitStarted(ctx)
    const errors = validateWithSchema(config.schema as unknown as JsonSchema, payload)
    if (errors.length > 0 && config.strict) {
      ctx.emit({ type: 'error', ts: Date.now(), data: { code: 400, errors } })
      throw new Error(`input validation failed: ${errors[0]?.message ?? 'unknown'}`)
    }
    emitResult(ctx, { valid: errors.length === 0, errors })
    emitFinished(ctx)
  },
})

/* -------------------------------------------------------- jsonpath-assert -- */

const JsonpathAssertConfigSchema = z.object({
  /** JSONPath into the payload, e.g. `$.user.id`. */
  path: z.string().min(1),
  /** Optional expected value (deep-equal). */
  equals: z.unknown().optional(),
  /** Expected match count (default 1). */
  count: z.number().int().min(0).optional(),
  /** When true, reject on a failed assertion. */
  strict: z.boolean().default(true),
})

export const jsonpathAssertNode = defineNode<z.infer<typeof JsonpathAssertConfigSchema>>({
  kind: 'jsonpath-assert.v1',
  type: 'input-validate',
  configSchema: JsonpathAssertConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const payload = flowInput(config, ctx)
    emitStarted(ctx, { path: config.path })

    let matches: unknown[]
    try {
      matches = evaluateJsonPath(config.path, payload)
    } catch (causeValue) {
      const err =
        causeValue instanceof JsonPathError
          ? causeValue
          : new JsonPathError(config.path, String(causeValue))
      ctx.emit({ type: 'error', ts: Date.now(), data: { code: 400, message: err.message } })
      throw err
    }

    const failures: string[] = []
    if (config.count !== undefined && matches.length !== config.count) {
      failures.push(`expected ${config.count} match(es), got ${matches.length}`)
    }
    if (config.equals !== undefined) {
      const match = matches.some((m) => deepEqual(m, config.equals))
      if (!match) failures.push('no match equals the expected value')
    }

    const ok = failures.length === 0
    if (!ok && config.strict) {
      ctx.emit({ type: 'error', ts: Date.now(), data: { code: 400, failures } })
      throw new Error(`jsonpath-assert failed: ${failures[0]}`)
    }
    emitResult(ctx, { ok, matches: matches.length, failures })
    emitFinished(ctx)
  },
})

export const INPUT_VALIDATE_NODES = [inputZodSchemaNode, jsonpathAssertNode] as const
