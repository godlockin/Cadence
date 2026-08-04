/**
 * @cadence/executor-pipeline — PipelineRunner implementation.
 *   Sinker's sub-package. PHASE 1 implements the DAG executor.
 *   PHASE 0: interface skeletons.
 */
import type { NodeKind } from '@cadence/domain'

export interface PipelineContext {
  readonly runId: string
  readonly pipelineId: string
  readonly trace: readonly PipelineSpan[]
  readonly nodes: ReadonlyMap<string, PipelineNode<unknown, unknown>>
}

export interface PipelineSpan {
  readonly nodeId: string
  readonly startedAt: number
  readonly finishedAt: number
  readonly status: 'ok' | 'error' | 'skipped'
  readonly error?: string
}

export interface PipelineNode<TInput = unknown, TOutput = unknown> {
  readonly id: string
  readonly kind: NodeKind
  readonly version: string
  /** validate node configuration at edit-time */
  validateConfig(config: unknown): { ok: true } | { ok: false; error: string }
  /** execute with typed input, return typed output */
  execute(input: TInput, config: unknown, ctx: PipelineContext): Promise<TOutput>
}

/* the 6 base kinds (interfaces for downstream node packages) */

export interface TriggerNode extends PipelineNode<{ now: Date }, { trigger: string }> {
  readonly kind: 'trigger'
}
export interface FetchNode extends PipelineNode<unknown, unknown> {
  readonly kind: 'fetch'
}
export interface TransformNode extends PipelineNode<unknown, unknown> {
  readonly kind: 'transform'
}
export interface ConditionNode extends PipelineNode<unknown, unknown> {
  readonly kind: 'condition'
}
export interface ActionNode extends PipelineNode<unknown, unknown> {
  readonly kind: 'action'
}
export interface OutputNode extends PipelineNode<unknown, unknown> {
  readonly kind: 'output'
}

export type AnyNode =
  TriggerNode | FetchNode | TransformNode | ConditionNode | ActionNode | OutputNode

export interface PipelineExecutor {
  init(pipeline: {
    nodes: AnyNode[]
    edges: ReadonlyArray<readonly [string, string]>
  }): Promise<void>
  run(input: unknown): Promise<unknown>
  cancel(reason: string): Promise<void>
}

export const VERSION = '0.1.0'
