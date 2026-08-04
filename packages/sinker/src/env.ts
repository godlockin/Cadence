/**
 * Runtime detection. CF Workers and Node expose different globals, so the
 * handler layer needs to short-circuit before calling a Node-only API.
 */
export type Runtime = 'local' | 'cloudflare'

export function detectRuntime(): Runtime {
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== undefined
  ) {
    return 'cloudflare'
  }
  return 'local'
}

export class NodeOnlyError extends Error {
  constructor(api: string) {
    super(`API '${api}' is not available in the current runtime (Cloudflare Workers)`)
    this.name = 'NodeOnlyError'
  }
}

export const ERROR_CODES = {
  NODE_UNSUPPORTED_IN_RUNTIME: 422,
  PAYLOAD_INVALID: 400,
  EXECUTION_TIMEOUT: 408,
  EXECUTION_FAILED: 500,
} as const
