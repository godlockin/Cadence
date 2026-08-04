/**
 * @cadence/nodes — core node contracts.
 *
 * A node is a deployable building block with a versioned `kind`, a category
 * (`type`), a Zod config schema, a runtime allow-list (CF hides local-only
 * nodes) and a `PayloadHandler`-compatible execution function.
 *
 * The `NodeContext` is structurally compatible with `@cadence/sinker`'s
 * `ExecutorContext`, so sinker can register these handlers directly.
 */
import type { Execution, Task, TriggerContext } from '@cadence/domain'
import type { ZodType, ZodTypeDef } from 'zod'

export type NodeType =
  'input' | 'input-validate' | 'process' | 'result-validate' | 'post-process' | 'output'

/** Deployment targets a node supports. `node` = local Node.js, `cloudflare` = Workers. */
export type Runtime = 'node' | 'cloudflare' | 'embedded'

export interface NodeDispatchEvent {
  readonly type: 'started' | 'progress' | 'log' | 'result' | 'error' | 'finished'
  readonly nodeId?: string
  readonly data?: unknown
  readonly ts: number
}

/**
 * Execution context handed to every node. Structurally a subset of sinker's
 * `ExecutorContext` so `PayloadDispatcher.register(node)` works unchanged.
 */
export interface NodeContext {
  readonly task: Task
  readonly execution: Execution
  readonly trigger: TriggerContext
  readonly signal: AbortSignal
  readonly emit: (event: NodeDispatchEvent) => void
}

/**
 * A built-in node. `handler(rawConfig, ctx)` is the sinker `PayloadHandler`
 * shape (config is pre-validated through `configSchema` before the call).
 */
export interface NodeHandler {
  readonly kind: string
  readonly type: NodeType
  readonly configSchema: ZodType<unknown, ZodTypeDef, unknown>
  readonly runtimes: readonly Runtime[]
  readonly handler: (config: unknown, ctx: NodeContext) => Promise<void>
}

export interface NodeDefinition<TConfig> {
  readonly kind: string
  readonly type: NodeType
  readonly configSchema: ZodType<TConfig, ZodTypeDef, unknown>
  readonly runtimes: readonly Runtime[]
  readonly handler: (config: TConfig, ctx: NodeContext) => Promise<void>
}

export const NODE_TYPE_LABELS: Readonly<Record<NodeType, string>> = {
  input: 'Input',
  'input-validate': 'Input Validate',
  process: 'Process',
  'result-validate': 'Result Validate',
  'post-process': 'Post Process',
  output: 'Output',
}
