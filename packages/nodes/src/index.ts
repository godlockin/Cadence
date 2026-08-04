/**
 * @cadence/nodes — 30 built-in nodes, organised by the 6 pipeline kinds.
 *
 * PHASE 5: full node catalog.
 *   - input (8):          curl, webhook, shell, schedule-trigger, manual-trigger,
 *                         file-watcher, email-inbox, db-poll
 *   - input-validate (2): zod-schema, jsonpath-assert
 *   - process (8):        http-forward, transform-jmespath, transform-jsonata,
 *                         llm-text, llm-vision, script-js, script-python, data-merge
 *   - result-validate (2): zod-schema, http-status
 *   - post-process (4):   db-write, log-save, notification-dispatch, metric-emit
 *   - output (6):         http-response, webhook, email-send,
 *                         desktop-notification, shell-exec, file-write
 */
export type {
  NodeContext,
  NodeDefinition,
  NodeDispatchEvent,
  NodeHandler,
  NodeType,
  Runtime,
} from './types.js'
export { NODE_TYPE_LABELS } from './types.js'
export { defineNode, supportedOn, toCatalog, type CatalogEntry } from './registry.js'

export * from './input/index.js'
export * from './input-validate/index.js'
export * from './process/index.js'
export * from './result-validate/index.js'
export * from './post-process/index.js'
export * from './output/index.js'

export {
  NodeUnsupportedError,
  detectRuntime,
  NODE_UNSUPPORTED_IN_RUNTIME,
  flowInput,
  flowResult,
} from './lib/context.js'
export {
  NodeCommandError,
  NodeSSRFError,
  NodeScriptSandboxError,
  assertCommandSafe,
  assertScriptSafe,
} from './lib/security.js'
export { evaluateJsonPath } from './lib/json-path.js'
export { validateWithSchema } from './lib/json-schema.js'
export { search as jmespathSearch } from './lib/jmespath.js'
export { evaluate as jsonataEvaluate } from './lib/jsonata.js'
export { joinRows } from './lib/join.js'
export { incrementCounter, resetCounters, snapshotCounters } from './lib/metrics.js'

import { INPUT_NODES } from './input/index.js'
import { INPUT_VALIDATE_NODES } from './input-validate/index.js'
import { PROCESS_NODES } from './process/index.js'
import { RESULT_VALIDATE_NODES } from './result-validate/index.js'
import { POST_PROCESS_NODES } from './post-process/index.js'
import { OUTPUT_NODES } from './output/index.js'
import type { NodeHandler } from './types.js'

/** All 30 built-in nodes across the 6 categories. */
export const ALL_NODES: readonly NodeHandler[] = [
  ...INPUT_NODES,
  ...INPUT_VALIDATE_NODES,
  ...PROCESS_NODES,
  ...RESULT_VALIDATE_NODES,
  ...POST_PROCESS_NODES,
  ...OUTPUT_NODES,
] as const

/** Nodes available in the Cloudflare Workers runtime (local-only nodes hidden). */
export const CLOUDFLARE_NODES: readonly NodeHandler[] = ALL_NODES.filter((n) =>
  n.runtimes.includes('cloudflare'),
)

export const NODE_CATALOG = ALL_NODES.map((n) => ({
  kind: n.kind,
  type: n.type,
  name: n.kind,
  description: n.kind,
  runtimes: [...n.runtimes],
}))

export const VERSION = '0.1.0'
