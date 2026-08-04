import { beforeEach, describe, expect, it } from 'vitest'
import {
  dbWriteNode,
  jsonTable,
  logSaveNode,
  metricEmitNode,
  notificationDispatchNode,
  resetCounters,
  resetJsonTable,
  snapshotCounters,
} from '../src/index.js'
import { lastResult, makeContext } from './helpers.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('post-process/db-write', () => {
  beforeEach(() => resetJsonTable())

  it('appends rows to the json table', async () => {
    const { ctx, events } = makeContext()
    await dbWriteNode.handler(
      dbWriteNode.configSchema.parse({ rows: [{ id: 1 }, { id: 2 }] }),
      ctx,
    )
    const result = lastResult(events) as { written: number; total: number }
    expect(result.written).toBe(2)
    expect(result.total).toBe(2)
    expect(jsonTable).toHaveLength(2)
  })

  it('falls back to the flow value when rows is empty', async () => {
    const { ctx } = makeContext({ trigger: { payload: [{ a: 1 }, { a: 2 }] } })
    await dbWriteNode.handler(dbWriteNode.configSchema.parse({}), ctx)
    expect(jsonTable).toHaveLength(2)
  })
})

describe('post-process/log-save', () => {
  it('emits a structured log event', async () => {
    const { ctx, events } = makeContext()
    await logSaveNode.handler(
      logSaveNode.configSchema.parse({ message: 'job completed', level: 'info' }),
      ctx,
    )
    const logEvents = events.filter((e) => e.type === 'log')
    expect(logEvents.length).toBeGreaterThan(0)
    const data = logEvents[0]?.data as { stream: string; text: string }
    expect(data.stream).toBe('info')
    expect(data.text).toContain('job completed')
  })

  it('appends to a file when configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulsedeck-log-'))
    const file = join(dir, 'run.log')
    try {
      const { ctx } = makeContext()
      await logSaveNode.handler(
        logSaveNode.configSchema.parse({ message: 'line1', level: 'warn', file }),
        ctx,
      )
      const content = await readFile(file, 'utf8')
      expect(content).toContain('line1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('post-process/notification-dispatch', () => {
  it('dispatches a log notification', async () => {
    const { ctx, events } = makeContext()
    await notificationDispatchNode.handler(
      notificationDispatchNode.configSchema.parse({ channel: 'log', body: 'hello' }),
      ctx,
    )
    const result = lastResult(events) as { channel: string }
    expect(result.channel).toBe('log')
  })

  it('requires a url for the http channel', async () => {
    const { ctx } = makeContext()
    await expect(
      notificationDispatchNode.handler(
        notificationDispatchNode.configSchema.parse({ channel: 'http', body: 'x' }),
        ctx,
      ),
    ).rejects.toThrow(/requires url/)
  })
})

describe('post-process/metric-emit', () => {
  beforeEach(() => resetCounters())

  it('increments a named counter', async () => {
    const { ctx, events } = makeContext()
    await metricEmitNode.handler(
      metricEmitNode.configSchema.parse({ name: 'jobs_completed', help: 'jobs done' }),
      ctx,
    )
    await metricEmitNode.handler(
      metricEmitNode.configSchema.parse({ name: 'jobs_completed', help: 'jobs done' }),
      ctx,
    )
    const result = lastResult(events) as { name: string; value: number }
    expect(result.name).toBe('jobs_completed')
    expect(result.value).toBe(2)
  })

  it('keeps distinct label sets separate', async () => {
    const { ctx } = makeContext()
    await metricEmitNode.handler(
      metricEmitNode.configSchema.parse({ name: 'requests', labels: { status: 'ok' } }),
      ctx,
    )
    await metricEmitNode.handler(
      metricEmitNode.configSchema.parse({ name: 'requests', labels: { status: 'err' } }),
      ctx,
    )
    const snapshot = snapshotCounters()
    expect(snapshot).toHaveLength(2)
    const byLabel = new Map(snapshot.map((c) => [c.labels['status'], c.value]))
    expect(byLabel.get('ok')).toBe(1)
    expect(byLabel.get('err')).toBe(1)
  })
})
