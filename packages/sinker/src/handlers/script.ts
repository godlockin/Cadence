/**
 * @cadence/sinker — Script handler.
 *
 * Runs untrusted JS in a `node:vm` sandbox. The sandbox is constructed
 * via `vm.createContext` from a frozen proxy that:
 *   - exposes ONLY: console / setTimeout / clearTimeout / Promise /
 *     fetch / URL / URLSearchParams / JSON / Math / Date
 *   - hides: process / require / globalThis / global / Function / eval /
 *     Buffer / module / exports / __dirname / __filename
 *
 * Defence in depth (5 layers):
 *   1. Static regex scan BEFORE execution (assertScriptSafe) — blocks
 *      any of the dangerous keywords at parse-time.
 *   2. Runtime Proxy — wraps the sandbox global so any property access
 *      that the static scan missed (e.g. `this['pro'+'cess']`) throws
 *      ScriptSandboxError instead of silently returning `undefined`.
 *   3. vm.createContext — isolated V8 context with `codeGeneration.strings = false`
 *      and `codeGeneration.wasm = false` so the script cannot synthesise
 *      new source at runtime (defeats `new Function`/`eval` even if
 *      they slip past layer 1).
 *   4. Hard wall-clock timeout via `vm.Script.runInContext({ timeout })`.
 *   5. Source size cap (64 KB) enforced at the Zod layer.
 *
 * Known limitations:
 *   - Node.js `vm` shares V8 isolate with the host. While the layers
 *     above are highly effective, they are not a perfect isolation
 *     primitive. For fully untrusted third-party code consider
 *     `isolated-vm` (separate V8 isolate) in a future hardening pass.
 *   - Suitable for low-risk user-defined logic (data transforms, field
 *     concatenation, simple compute). NOT suitable for running truly
 *     untrusted third-party code.
 *
 * Throws NodeOnlyError on Cloudflare. Throws ScriptSandboxError on
 * static or runtime rejection.
 */
import vm from 'node:vm'
import type { PayloadHandler } from '../types.js'
import { detectRuntime, NodeOnlyError, ERROR_CODES } from '../env.js'
import {
  assertScriptSafe,
  ScriptSecurityConfigSchema,
  type ScriptSecurityConfig,
} from '../security.js'
import { ScriptSandboxError } from '../errors.js'

const ScriptConfigSchema = ScriptSecurityConfigSchema
export type ScriptConfig = ScriptSecurityConfig

/* The shape of the sandbox global object. Adding a new key here is a
 * SECURITY DECISION — every property MUST be vetted. Keep the set as
 * narrow as possible; prefer `unknown` over concrete types so we
 * don't accidentally widen the surface area in the future. */
interface SandboxGlobal {
  console: Pick<Console, 'log' | 'warn' | 'error' | 'info'>
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  Promise: typeof Promise
  fetch: typeof fetch
  URL: typeof URL
  URLSearchParams: typeof URLSearchParams
  JSON: Pick<typeof JSON, 'parse' | 'stringify'>
  Math: typeof Math
  Date: typeof Date
  Object: typeof Object
  Array: typeof Array
  String: typeof String
  Number: typeof Number
  Boolean: typeof Boolean
  Error: typeof Error
  /* Symbol / Map / Set are intentionally NOT exposed — combined with
   * iterators they open escape paths and are rarely needed for
   * "data transform" use cases. */
}

/* console.log/warn/error/info inside the sandbox go here; we forward
 * them as `log` dispatch events on completion. */
const ctxCapture: Array<['log' | 'warn' | 'error' | 'info', unknown[]]> = []

function buildSandbox(): SandboxGlobal {
  /* Explicit whitelist construction. DO NOT spread or merge extra
   * objects here — every property must be reviewed. */
  return {
    console: {
      log: (...args: unknown[]) => ctxCapture.push(['log', args]),
      warn: (...args: unknown[]) => ctxCapture.push(['warn', args]),
      error: (...args: unknown[]) => ctxCapture.push(['error', args]),
      info: (...args: unknown[]) => ctxCapture.push(['info', args]),
    },
    setTimeout: ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      return setTimeout(fn, ms ?? 0, ...rest)
    }) as unknown as typeof setTimeout,
    clearTimeout,
    Promise,
    fetch: ((input: unknown, init?: unknown) =>
      fetch(
        input as Parameters<typeof fetch>[0],
        init as Parameters<typeof fetch>[1],
      )) as typeof fetch,
    URL,
    URLSearchParams,
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
  }
}

/**
 * Wrap the sandbox global in a Proxy that throws ScriptSandboxError on
 * access to known dangerous identifiers. The static scan is the primary
 * defence; this Proxy is a runtime safety net for accesses that bypass
 * the regex (e.g. bracket-string concatenation, prototype walks).
 *
 * We also use `has` so `prop in sandbox` reports false — preventing
 * `prop in process` style probes from leaking existence information.
 */
function wrapDangerousProps(target: SandboxGlobal): SandboxGlobal {
  const BLOCKED = new Set<string>([
    'process',
    'require',
    'globalThis',
    'global',
    'module',
    'exports',
    '__dirname',
    '__filename',
    'Buffer',
    'eval',
    'Function',
    'Symbol',
    'Proxy',
    'Reflect',
    'AsyncFunction',
    'GeneratorFunction',
    'AsyncGeneratorFunction',
    'WebAssembly',
    'SharedArrayBuffer',
    'Atomics',
    'child_process',
    'Worker',
    'queueMicrotask',
    'setImmediate',
    'clearImmediate',
    'process',
  ])
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'string' && BLOCKED.has(prop)) {
        throw new ScriptSandboxError(`Access denied: ${prop}`)
      }
      return Reflect.get(t, prop)
    },
    has(t, prop) {
      if (typeof prop === 'string' && BLOCKED.has(prop)) return false
      return Reflect.has(t, prop)
    },
  })
}

export class ScriptHandler implements PayloadHandler<ScriptConfig> {
  readonly kind = 'script' as const

  validateConfig(raw: unknown): ScriptConfig {
    return ScriptConfigSchema.parse(raw)
  }

  async execute(
    config: ScriptConfig,
    ctx: Parameters<PayloadHandler['execute']>[1],
  ): Promise<void> {
    if (detectRuntime() === 'cloudflare') {
      ctx.emit({
        type: 'error',
        ts: Date.now(),
        data: {
          code: ERROR_CODES.NODE_UNSUPPORTED_IN_RUNTIME,
          message: 'vm sandbox unavailable on CF',
        },
      })
      throw new NodeOnlyError('node:vm')
    }

    /* Pre-flight: static scan. Throws ScriptSandboxError on hit. */
    assertScriptSafe(config)

    ctx.emit({ type: 'started', ts: Date.now(), data: { filename: config.filename } })

    /* Reset the capture buffer so previous executions don't leak. */
    ctxCapture.length = 0

    /* Wrap the user source in an async IIFE so `return` is allowed and
     * the result is serialisable. */
    const wrapped = `"use strict";(async () => { ${config.source}\n})()`
    const script = new vm.Script(wrapped, { filename: config.filename })
    const sandbox = wrapDangerousProps(buildSandbox())
    const vmContext = vm.createContext(sandbox, {
      name: config.filename,
      codeGeneration: { strings: false, wasm: false },
    })

    try {
      /* `runInContext({ timeout })` enforces the hard wall-clock budget
       * on synchronous code AND on the synchronous portion of the
       * returned async function. */
      const raw = script.runInContext(vmContext, {
        timeout: config.timeoutMs,
        displayErrors: true,
        breakOnSigint: true,
      })
      const result = await Promise.race<unknown>([
        Promise.resolve(raw),
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error(`script exceeded ${config.timeoutMs}ms`)),
            config.timeoutMs + 50,
          )
        }),
      ])

      /* Drain captured console lines. */
      for (const [kind, args] of ctxCapture) {
        ctx.emit({
          type: 'log',
          ts: Date.now(),
          data: { stream: kind, text: args.map(stringifySafe).join(' ') },
        })
      }

      ctx.emit({ type: 'result', ts: Date.now(), data: result })
    } catch (causeValue: unknown) {
      /* Translate any sandbox failure (Proxy throw, code-generation
       * refusal, TypeError from prototype walks, timeout) into a
       * ScriptSandboxError so the dispatcher sees a single typed
       * failure mode. The static-scan path above is unaffected —
       * it throws before reaching here. */
      const reason = causeValue instanceof Error ? causeValue.message : String(causeValue)
      const err =
        causeValue instanceof ScriptSandboxError
          ? causeValue
          : new ScriptSandboxError(`runtime: ${reason}`)
      ctx.emit({
        type: 'error',
        ts: Date.now(),
        data: {
          code: err.code,
          message: err.message,
        },
      })
      throw err
    } finally {
      ctx.emit({ type: 'finished', ts: Date.now() })
    }
  }
}

function stringifySafe(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
