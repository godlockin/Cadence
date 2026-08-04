/**
 * @cadence/nodes — `node:vm` sandbox runner (ported from sinker script.ts).
 *
 * Runs untrusted JS in a hardened `vm` context:
 *   1. static regex scan (assertScriptSafe),
 *   2. Proxy-wrapped sandbox global that throws on blocked identifiers,
 *   3. `codeGeneration.strings=false` / `wasm=false`,
 *   4. hard wall-clock timeout,
 *   5. source size cap (64 KB) enforced at the schema layer.
 *
 * Throws NodeScriptSandboxError on any rejection.
 */
import vm from 'node:vm'
import type { NodeContext } from '../types.js'
import { emitLog, emitResult } from './context.js'
import {
  assertScriptSafe,
  ScriptSecurityConfigSchema,
  type ScriptSecurityConfig,
} from './security.js'
import { NodeScriptSandboxError } from './security.js'

export const ScriptRunConfigSchema = ScriptSecurityConfigSchema
export type ScriptRunConfig = ScriptSecurityConfig

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
}

const ctxCapture: Array<['log' | 'warn' | 'error' | 'info', unknown[]]> = []

function buildSandbox(): SandboxGlobal {
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
  ])
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'string' && BLOCKED.has(prop)) {
        throw new NodeScriptSandboxError(`Access denied: ${prop}`)
      }
      return Reflect.get(t, prop)
    },
    has(t, prop) {
      if (typeof prop === 'string' && BLOCKED.has(prop)) return false
      return Reflect.has(t, prop)
    },
  })
}

function stringifySafe(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Run a script in the sandbox; returns the script's resolved result. */
export async function runScript(config: ScriptRunConfig, ctx: NodeContext): Promise<unknown> {
  assertScriptSafe(config)

  ctxCapture.length = 0

  const wrapped = `"use strict";(async () => { ${config.source}\n})()`
  const script = new vm.Script(wrapped, { filename: config.filename })
  const sandbox = wrapDangerousProps(buildSandbox())
  const vmContext = vm.createContext(sandbox, {
    name: config.filename,
    codeGeneration: { strings: false, wasm: false },
  })

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

  for (const [kind, args] of ctxCapture) {
    emitLog(ctx, args.map(stringifySafe).join(' '), kind)
  }

  emitResult(ctx, result)
  return result
}
