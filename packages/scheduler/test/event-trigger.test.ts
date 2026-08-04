/**
 * @cadence/scheduler — EventTrigger unit tests.
 *
 * Covers:
 *  - publish dispatches to every subscriber matching the topic
 *  - topics parsed from trigger_config_json.topic
 *  - unknown topics → zero firings
 *  - multiple subscribers → parallel trigger
 *  - payload carries the topic + supplied payload
 *  - throws TypeError on missing topic
 *  - parseTopic helper: returns null on malformed JSON or wrong kind
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'

import { EventTrigger, parseTopic } from '../src/index.js'
import { FakeSinker } from './fakes.js'
import { buildTask } from './helpers.js'

describe('EventTrigger.publish', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker
  let events: EventTrigger

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
    events = new EventTrigger({ triggerFn: sinker.asTriggerFn() })
  })

  it('throws TypeError on empty topic', async () => {
    await expect(events.publish(storage, '', { foo: 'bar' })).rejects.toBeInstanceOf(TypeError)
  })

  it('fires every task subscribed to the topic', async () => {
    const a = buildTask({
      status: 'scheduled',
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 'order.created' }),
    })
    const b = buildTask({
      status: 'scheduled',
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 'order.created' }),
    })
    await storage.saveTask(a)
    await storage.saveTask(b)
    const outcomes = await events.publish(storage, 'order.created', { id: 'x' })
    expect(outcomes.length).toBe(2)
    expect(sinker.countFor(a.id)).toBe(1)
    expect(sinker.countFor(b.id)).toBe(1)
  })

  it('unknown topic → zero firings', async () => {
    const a = buildTask({
      status: 'scheduled',
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 'a' }),
    })
    await storage.saveTask(a)
    const outcomes = await events.publish(storage, 'b', {})
    expect(outcomes.length).toBe(0)
    expect(sinker.records.length).toBe(0)
  })

  it('non-matching topic does not leak', async () => {
    const a = buildTask({
      status: 'scheduled',
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 'foo' }),
    })
    const b = buildTask({
      status: 'scheduled',
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 'bar' }),
    })
    await storage.saveTask(a)
    await storage.saveTask(b)
    await events.publish(storage, 'foo', {})
    expect(sinker.countFor(a.id)).toBe(1)
    expect(sinker.countFor(b.id)).toBe(0)
  })

  it('topic + payload passed into TriggerContext', async () => {
    const a = buildTask({
      status: 'scheduled',
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 'pay.completed' }),
    })
    await storage.saveTask(a)
    await events.publish(storage, 'pay.completed', { amount: 100 })
    const rec = sinker.records[0]
    expect(rec?.ctx.source).toBe('event')
    expect(rec?.ctx.payload).toEqual({ topic: 'pay.completed', amount: 100 })
    expect(rec?.opts.bypassAuth).toBe(true)
  })

  it('multiple subscribers fire in parallel', async () => {
    const tasks = []
    for (let i = 0; i < 5; i++) {
      const t = buildTask({
        status: 'scheduled',
        trigger_kind: 'event',
        trigger_config_json: JSON.stringify({ topic: 'bulk' }),
      })
      await storage.saveTask(t)
      tasks.push(t)
    }
    await events.publish(storage, 'bulk', { x: 1 })
    for (const t of tasks) {
      expect(sinker.countFor(t.id)).toBe(1)
    }
  })

  it('malformed trigger_config_json is skipped, not crashed', async () => {
    const a = buildTask({
      status: 'scheduled',
      trigger_kind: 'event',
      trigger_config_json: '{not-json',
    })
    await storage.saveTask(a)
    const outcomes = await events.publish(storage, 'x', {})
    expect(outcomes.length).toBe(0)
  })

  it('non-event tasks are ignored', async () => {
    const a = buildTask({
      status: 'scheduled',
      trigger_kind: 'cron',
      trigger_config_json: JSON.stringify({ topic: 'a' }),
    })
    await storage.saveTask(a)
    const outcomes = await events.publish(storage, 'a', {})
    expect(outcomes.length).toBe(0)
  })
})

describe('parseTopic', () => {
  it('returns null on non-event trigger_kind', () => {
    const t = buildTask({ trigger_kind: 'cron' })
    expect(parseTopic(t)).toBeNull()
  })

  it('returns the topic from valid config', () => {
    const t = buildTask({
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 'foo' }),
    })
    expect(parseTopic(t)).toBe('foo')
  })

  it('returns null on malformed JSON', () => {
    const t = buildTask({
      trigger_kind: 'event',
      trigger_config_json: '{bad',
    })
    expect(parseTopic(t)).toBeNull()
  })

  it('returns null when topic key is missing', () => {
    const t = buildTask({
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ name: 'no-topic' }),
    })
    expect(parseTopic(t)).toBeNull()
  })

  it('returns null when topic is not a string', () => {
    const t = buildTask({
      trigger_kind: 'event',
      trigger_config_json: JSON.stringify({ topic: 42 }),
    })
    expect(parseTopic(t)).toBeNull()
  })
})
