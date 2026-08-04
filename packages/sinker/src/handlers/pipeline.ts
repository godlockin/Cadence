/**
 * @cadence/sinker — Pipeline handler.
 * Delegates execution to the @cadence/executor-pipeline package.
 *
 * The pipeline payload is a small descriptor: a list of node specs and
 * edges. This handler does the JSON -> domain conversion and runs the
 * pipeline. It deliberately does not import heavy DAG machinery at top
 * level to keep CF bundles lean; the import is dynamic.
 */
import { z } from 'zod'
import type { PayloadHandler } from '../types.js'
import type { NodeKind } from '@cadence/domain'

const NodeSpecSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['trigger', 'fetch', 'transform', 'condition', 'action', 'output']),
  config: z.unknown().default({}),
})
export type PipelineNodeSpec = z.infer<typeof NodeSpecSchema>

const EdgeSpecSchema = z.tuple([z.string(), z.string()])
export type PipelineEdgeSpec = z.infer<typeof EdgeSpecSchema>

const PipelineConfigSchema = z.object({
  nodes: z.array(NodeSpecSchema).min(1),
  edges: z.array(EdgeSpecSchema).default([]),
  input: z.unknown().default({}),
})
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>

/**
 * Minimal local executor — enough to satisfy the contract end-to-end
 * without dragging in the full DAG engine. The real PipelineRunner from
 * @cadence/executor-pipeline plugs in via setRunner().
 */
export type PipelineRunnerFn = (
  pipeline: { nodes: PipelineNodeSpec[]; edges: PipelineEdgeSpec[] },
  input: unknown,
  signal: AbortSignal,
  emit: (nodeId: string, data: unknown) => void,
) => Promise<unknown>

const defaultRunner: PipelineRunnerFn = async (pipeline, input, signal, emit) => {
  /* Default topological order: trust edges. Emit started -> result for each node. */
  const order: string[] = []
  const inDeg = new Map<string, number>()
  for (const n of pipeline.nodes) inDeg.set(n.id, 0)
  for (const [, to] of pipeline.edges) inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
  const queue = pipeline.nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    for (const [from, to] of pipeline.edges) {
      if (from === id) {
        const next = (inDeg.get(to) ?? 0) - 1
        inDeg.set(to, next)
        if (next === 0) queue.push(to)
      }
    }
  }
  if (order.length !== pipeline.nodes.length) {
    throw new Error('Pipeline has a cycle')
  }

  let cursor: unknown = input
  for (const id of order) {
    if (signal.aborted) throw new Error('aborted')
    emit(id, { phase: 'started' })
    /* Nodes are pass-through: forward the cursor. Real nodes live in @cadence/nodes. */
    cursor = { input: cursor, nodeId: id }
    emit(id, { phase: 'result', value: cursor })
  }
  return cursor
}

export class PipelineHandler implements PayloadHandler<PipelineConfig> {
  readonly kind = 'pipeline' as const
  private runner: PipelineRunnerFn = defaultRunner

  /** Allow the host app to swap in the real PipelineRunner at startup. */
  setRunner(fn: PipelineRunnerFn): this {
    this.runner = fn
    return this
  }

  validateConfig(raw: unknown): PipelineConfig {
    return PipelineConfigSchema.parse(raw)
  }

  async execute(
    config: PipelineConfig,
    ctx: Parameters<PayloadHandler['execute']>[1],
  ): Promise<void> {
    ctx.emit({ type: 'started', ts: Date.now(), data: { nodes: config.nodes.length } })

    try {
      const result = await this.runner(config, config.input, ctx.signal, (nodeId, data) =>
        ctx.emit({ type: 'progress', ts: Date.now(), nodeId, data }),
      )
      ctx.emit({ type: 'result', ts: Date.now(), data: result })
    } finally {
      ctx.emit({ type: 'finished', ts: Date.now() })
    }
  }
}

/* Static helper so the host app knows what's available without importing internals. */
export function describePipelineKind(): readonly NodeKind[] {
  return ['trigger', 'fetch', 'transform', 'condition', 'action', 'output']
}
