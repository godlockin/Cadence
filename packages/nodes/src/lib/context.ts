/**
 * @cadence/nodes — runtime + context helpers shared by all nodes.
 */
import type { NodeContext, NodeDispatchEvent, Runtime } from '../types.js'

export type { Runtime } from '../types.js'

/** HTTP-style code surfaced for nodes that cannot run on the current runtime. */
export const NODE_UNSUPPORTED_IN_RUNTIME = 422

export function detectRuntime(): Runtime {
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== undefined
  ) {
    return 'cloudflare'
  }
  return 'node'
}

export class NodeUnsupportedError extends Error {
  constructor(
    public readonly nodeKind: string,
    public readonly runtime: string,
  ) {
    super(`Node '${nodeKind}' is not supported in runtime '${runtime}'`)
    this.name = 'NodeUnsupportedError'
  }
}

/**
 * Gate a local-only node. Emits a typed error event then throws, so CF
 * invocations never reach a Node-only API.
 */
export function assertRuntime(
  nodeKind: string,
  supported: readonly Runtime[],
  ctx: NodeContext,
): void {
  const runtime = detectRuntime()
  if (!supported.includes(runtime)) {
    ctx.emit({
      type: 'error',
      ts: Date.now(),
      data: {
        code: NODE_UNSUPPORTED_IN_RUNTIME,
        message: `node '${nodeKind}' unsupported in '${runtime}'`,
      },
    })
    throw new NodeUnsupportedError(nodeKind, runtime)
  }
}

export function emitStarted(ctx: NodeContext, data?: unknown): void {
  ctx.emit({ type: 'started', ts: Date.now(), data })
}

export function emitResult(ctx: NodeContext, data: unknown): void {
  ctx.emit({ type: 'result', ts: Date.now(), data })
}

export function emitFinished(ctx: NodeContext, data?: unknown): void {
  ctx.emit({ type: 'finished', ts: Date.now(), data })
}

export function emitLog(ctx: NodeContext, text: string, stream = 'node'): void {
  ctx.emit({ type: 'log', ts: Date.now(), data: { stream, text } })
}

/**
 * The "flow value" a node operates on. Precedence:
 *   1. explicit `data` field in the node config (pipeline injects this),
 *   2. the trigger payload that started the run.
 */
export function flowInput(config: unknown, ctx: NodeContext): unknown {
  if (config !== null && typeof config === 'object') {
    const cfg = config as unknown as Record<string, unknown>
    if ('data' in cfg && cfg['data'] !== undefined) return cfg['data']
  }
  return ctx.trigger.payload ?? {}
}

/** Last emitted `result` payload, or the execution result if available. */
export function flowResult(ctx: NodeContext): unknown {
  if (ctx.execution.resultJson) {
    try {
      return JSON.parse(ctx.execution.resultJson) as unknown
    } catch {
      /* fall through */
    }
  }
  return null
}

/** Serialise an arbitrary value to a JSON string, preserving readable text. */
export function jsonStringifySafe(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Collect every `result` event emitted during a handler run (test helper). */
export function collectResults(events: readonly NodeDispatchEvent[]): unknown[] {
  return events.filter((e) => e.type === 'result').map((e) => e.data)
}
