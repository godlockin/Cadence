/**
 * @cadence/nodes — PROCESS category (8 nodes).
 *
 * Transform or enrich a payload mid-flow.
 */
import { z } from 'zod'
import { defineNode } from '../registry.js'
import { emitFinished, emitResult, emitStarted, flowInput } from '../lib/context.js'
import { HttpRequestConfigSchema, runGuardedHttp } from '../lib/http.js'
import { search as jmespathSearch, JmesPathError } from '../lib/jmespath.js'
import { evaluate as jsonataEvaluate, JsonataError } from '../lib/jsonata.js'
import { callLlm, emitLlmResult } from '../lib/llm.js'
import { runScript } from '../lib/vm.js'
import { joinRows, type Row } from '../lib/join.js'

/* ------------------------------------------------------------ http-forward -- */

export const httpForwardNode = defineNode<z.infer<typeof HttpRequestConfigSchema>>({
  kind: 'http-forward.v1',
  type: 'process',
  configSchema: HttpRequestConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { url: config.url })
    const res = await runGuardedHttp(config, ctx.signal)
    emitResult(ctx, { status: res.status, headers: res.headers, body: res.body, url: res.url })
    emitFinished(ctx)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
})

/* ------------------------------------------------------ transform-jmespath -- */

const JmespathTransformConfigSchema = z.object({
  /** The payload to transform (defaults to trigger payload). */
  data: z.unknown().optional(),
  /** JMESPath expression, e.g. `store.book[*].title`. */
  expression: z.string().min(1),
})

export const transformJmespathNode = defineNode<z.infer<typeof JmespathTransformConfigSchema>>({
  kind: 'transform-jmespath.v1',
  type: 'process',
  configSchema: JmespathTransformConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const input = config.data ?? flowInput(config, ctx)
    emitStarted(ctx, { expression: config.expression })
    let result: unknown
    try {
      result = jmespathSearch(config.expression, input)
    } catch (causeValue) {
      const err =
        causeValue instanceof JmesPathError
          ? causeValue
          : new JmesPathError(config.expression, String(causeValue))
      ctx.emit({ type: 'error', ts: Date.now(), data: { code: 400, message: err.message } })
      throw err
    }
    emitResult(ctx, result)
    emitFinished(ctx)
  },
})

/* ------------------------------------------------------- transform-jsonata -- */

const JsonataTransformConfigSchema = z.object({
  data: z.unknown().optional(),
  /** JSONata expression, e.g. `firstName & ' ' & lastName`. */
  expression: z.string().min(1),
})

export const transformJsonataNode = defineNode<z.infer<typeof JsonataTransformConfigSchema>>({
  kind: 'transform-jsonata.v1',
  type: 'process',
  configSchema: JsonataTransformConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const input = config.data ?? flowInput(config, ctx)
    emitStarted(ctx, { expression: config.expression })
    let result: unknown
    try {
      result = jsonataEvaluate(config.expression, input)
    } catch (causeValue) {
      const err =
        causeValue instanceof JsonataError
          ? causeValue
          : new JsonataError(config.expression, String(causeValue))
      ctx.emit({ type: 'error', ts: Date.now(), data: { code: 400, message: err.message } })
      throw err
    }
    emitResult(ctx, result)
    emitFinished(ctx)
  },
})

/* ---------------------------------------------------------------- llm-text -- */

const LlmTextConfigSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  /** Defaults to an OpenAI-compatible local gateway; override for hosted. */
  endpoint: z.string().url().default('https://api.openai.com/v1/chat/completions'),
  apiKey: z.string().optional(),
  maxTokens: z.number().int().min(1).max(100_000).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  /** Optional extra context injected after the prompt. */
  context: z.string().optional(),
})

export const llmTextNode = defineNode<z.infer<typeof LlmTextConfigSchema>>({
  kind: 'llm-text.v1',
  type: 'process',
  configSchema: LlmTextConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { model: config.model })
    const messages = [
      { role: 'system' as const, content: 'You are a precise data-processing assistant.' },
      {
        role: 'user' as const,
        content: config.prompt + (config.context ? `\n\nContext:\n${config.context}` : ''),
      },
    ]
    const result = await callLlm(
      {
        model: config.model,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        messages,
      },
      ctx.signal,
    )
    emitLlmResult(ctx, result)
    emitFinished(ctx)
  },
})

/* -------------------------------------------------------------- llm-vision -- */

const LlmVisionConfigSchema = z.object({
  model: z.string().min(1),
  prompt: z.string().min(1),
  /** URL of the image to analyse. */
  imageUrl: z.string().url(),
  endpoint: z.string().url().default('https://api.openai.com/v1/chat/completions'),
  apiKey: z.string().optional(),
  maxTokens: z.number().int().min(1).max(100_000).default(1024),
  temperature: z.number().min(0).max(2).default(0.2),
})

export const llmVisionNode = defineNode<z.infer<typeof LlmVisionConfigSchema>>({
  kind: 'llm-vision.v1',
  type: 'process',
  configSchema: LlmVisionConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { model: config.model, imageUrl: config.imageUrl })
    const result = await callLlm(
      {
        model: config.model,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        messages: [
          { role: 'system' as const, content: 'You are a precise image-analysis assistant.' },
          {
            role: 'user' as const,
            content: [
              { type: 'text', text: config.prompt },
              { type: 'image_url', image_url: config.imageUrl },
            ],
          },
        ],
      },
      ctx.signal,
    )
    emitLlmResult(ctx, result)
    emitFinished(ctx)
  },
})

/* ---------------------------------------------------------------- script-js -- */

const ScriptJsConfigSchema = z.object({
  source: z.string().min(1).max(64_000),
  filename: z.string().min(1).default('inline-script.js'),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
  /** A `payload` binding injected into the sandbox (defaults to flow input). */
  payload: z.unknown().optional(),
})

export const scriptJsNode = defineNode<z.infer<typeof ScriptJsConfigSchema>>({
  kind: 'script-js.v1',
  type: 'process',
  configSchema: ScriptJsConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { filename: config.filename })
    await runScript(config, ctx)
    emitFinished(ctx)
  },
})

/* ----------------------------------------------------------- script-python -- */

const ScriptPythonConfigSchema = z.object({
  /** Python source. Must be self-contained; runs under `python3 -c`. */
  source: z.string().min(1).max(64_000),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
  /** JSON payload serialised to the `payload` variable in the script. */
  payload: z.unknown().optional(),
})

export const scriptPythonNode = defineNode<z.infer<typeof ScriptPythonConfigSchema>>({
  kind: 'script-python.v1',
  type: 'process',
  configSchema: ScriptPythonConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx)
    const payloadJson = JSON.stringify(config.payload ?? flowInput(config, ctx) ?? null)
    const header = `import json\npayload = json.loads(${JSON.stringify(payloadJson)})\n`
    const full = `${header}${config.source}\nprint(json.dumps(result))`
    /* Write the source to a temp file and run `python3 <file>` — passing the
     * source through `-c` would trip the argv sandbox (braces/newlines). */
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulsedeck-py-'))
    const file = path.join(dir, 'main.py')
    try {
      await fs.writeFile(file, full, 'utf8')
      const { runCommand } = await import('../lib/shell.js')
      const result = await runCommand(
        { cmd: 'python3', args: [file], env: {}, timeoutMs: config.timeoutMs },
        ctx,
      )
      emitResult(ctx, { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr })
      emitFinished(ctx)
      if (result.exitCode !== 0) throw new Error(`python exited ${result.exitCode}`)
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  },
})

/* -------------------------------------------------------------- data-merge -- */

const DataMergeConfigSchema = z.object({
  left: z.unknown().optional(),
  right: z.unknown().optional(),
  leftKey: z.string().min(1),
  rightKey: z.string().min(1),
  type: z.enum(['left', 'inner', 'right']).default('left'),
})

export const dataMergeNode = defineNode<z.infer<typeof DataMergeConfigSchema>>({
  kind: 'data-merge.v1',
  type: 'process',
  configSchema: DataMergeConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const left = asRows(config.left ?? flowInput(config, ctx))
    const right = asRows(config.right)
    if (!left) throw new Error('data-merge: left input must be an array of objects')
    if (!right) throw new Error('data-merge: right input must be an array of objects')
    emitStarted(ctx, { type: config.type })
    const merged = joinRows(left, right, config.leftKey, config.rightKey, config.type)
    emitResult(ctx, merged)
    emitFinished(ctx)
  },
})

function asRows(value: unknown): readonly Row[] | null {
  if (!Array.isArray(value)) return null
  const rows: Row[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
    rows.push(item as unknown as Row)
  }
  return rows
}

export const PROCESS_NODES = [
  httpForwardNode,
  transformJmespathNode,
  transformJsonataNode,
  llmTextNode,
  llmVisionNode,
  scriptJsNode,
  scriptPythonNode,
  dataMergeNode,
] as const
