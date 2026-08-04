import { describe, it, expect, beforeEach } from 'vitest'
import { PipelineHandler, describePipelineKind } from '../../src/handlers/pipeline.js'
import { makeTask } from '../fixtures/make-task.js'
import type { Execution, PayloadHandler, TriggerContext } from '../../src/index.js'

function makeCtx() {
  const events: { type: string; data?: unknown; ts: number }[] = []
  const task = makeTask({ payload_kind: 'pipeline' })
  const execution = {
    id: '01JCCCCCCCCCCCCCCCCCCCCCCC',
    taskId: task.id,
    status: 'running' as const,
    triggerSource: 'manual' as const,
    triggeredBy: null,
    startedAt: Date.now(),
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    errorJson: null,
    resultJson: null,
    idempotencyKey: null,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Execution
  const trigger: TriggerContext = { source: 'manual' }
  const ctx: Parameters<PayloadHandler['execute']>[1] = {
    task,
    execution,
    trigger,
    signal: new AbortController().signal,
    emit: (e) => events.push({ type: e.type, data: e.data, ts: e.ts }),
  }
  return { events, ctx }
}

describe('PipelineHandler', () => {
  let handler: PipelineHandler

  beforeEach(() => {
    handler = new PipelineHandler()
  })

  it('rejects invalid config', () => {
    expect(() => handler.validateConfig({ nodes: [] })).toThrow()
    expect(() => handler.validateConfig({ nodes: 'nope' })).toThrow()
  })

  it('runs a tiny linear pipeline and emits progress for each node', async () => {
    const { ctx, events } = makeCtx()
    const cfg = handler.validateConfig({
      nodes: [
        { id: 'a', kind: 'trigger' },
        { id: 'b', kind: 'action' },
      ],
      edges: [['a', 'b']],
      input: { seed: 1 },
    })
    await handler.execute(cfg, ctx)
    const result = events.find((e) => e.type === 'result')?.data
    /* Default runner chains input -> output, so the last node's value is { input: <chain>, nodeId } */
    expect(result).toMatchObject({ nodeId: 'b' })
    const progress = events.filter((e) => e.type === 'progress')
    expect(progress.length).toBeGreaterThanOrEqual(4) // 2 started + 2 result events
  })

  it('detects a cycle in the pipeline', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({
          nodes: [
            { id: 'a', kind: 'action' },
            { id: 'b', kind: 'action' },
          ],
          edges: [
            ['a', 'b'],
            ['b', 'a'],
          ],
          input: {},
        }),
        ctx,
      ),
    ).rejects.toThrow(/cycle/)
  })

  it('exposes the supported node kinds', () => {
    expect(describePipelineKind()).toEqual([
      'trigger',
      'fetch',
      'transform',
      'condition',
      'action',
      'output',
    ])
  })
})
