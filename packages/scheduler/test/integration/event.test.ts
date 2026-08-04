/**
 * @cadence/scheduler — event fan-out integration tests.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { EventTrigger } from '../../src/index.js'
import { FakeSinker } from '../fakes.js'
import { buildTask, persistTask } from '../helpers.js'

describe('EventTrigger (e2e)', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker
  let events: EventTrigger

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
    events = new EventTrigger({ triggerFn: sinker.asTriggerFn() })
  })

  it('publishes an event to all tasks subscribed to the topic', async () => {
    const taskA = await persistTask(
      storage,
      buildTask({
        trigger_kind: 'event',
        trigger_config_json: JSON.stringify({ topic: 'user.created' }),
      }),
    )
    const taskB = await persistTask(
      storage,
      buildTask({
        trigger_kind: 'event',
        trigger_config_json: JSON.stringify({ topic: 'user.created' }),
      }),
    )
    const taskC = await persistTask(
      storage,
      buildTask({
        trigger_kind: 'event',
        trigger_config_json: JSON.stringify({ topic: 'user.deleted' }),
      }),
    )
    const outcomes = await events.publish(storage, 'user.created', { id: '42' })
    expect(outcomes.length).toBe(2)
    expect(sinker.countFor(taskA.id)).toBe(1)
    expect(sinker.countFor(taskB.id)).toBe(1)
    expect(sinker.countFor(taskC.id)).toBe(0)
    /* Each sinker call carries the payload. */
    for (const rec of sinker.records) {
      expect(rec.ctx.payload).toBeDefined()
      expect((rec.ctx.payload as Record<string, unknown>)['topic']).toBe('user.created')
    }
  })

  it('parallel fan-out: 3 subscriptions fire within a single publish()', async () => {
    const ids = []
    for (let i = 0; i < 3; i++) {
      const t = await persistTask(
        storage,
        buildTask({
          trigger_kind: 'event',
          trigger_config_json: JSON.stringify({ topic: 'broadcast' }),
        }),
      )
      ids.push(t.id)
    }
    const outcomes = await events.publish(storage, 'broadcast', { hello: 'world' })
    expect(outcomes.length).toBe(3)
    for (const id of ids) expect(sinker.countFor(id)).toBe(1)
  })

  it('no matchers → empty outcomes (no spurious fires)', async () => {
    await persistTask(
      storage,
      buildTask({
        trigger_kind: 'event',
        trigger_config_json: JSON.stringify({ topic: 'newsletter.sent' }),
      }),
    )
    const outcomes = await events.publish(storage, 'other.event', {})
    expect(outcomes.length).toBe(0)
    expect(sinker.records.length).toBe(0)
  })

  it('rejects empty topic with TypeError', async () => {
    await expect(events.publish(storage, '', {})).rejects.toThrow(TypeError)
  })
})
