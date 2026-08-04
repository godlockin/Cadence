/**
 * @cadence/scheduler — WebhookTrigger unit tests.
 *
 * Covers:
 *  - register + resolve round-trip
 *  - fire on unknown token → task_not_found
 *  - fire on known token → sinker.trigger called with correct ctx
 *  - duplicate (token, body) within TTL → returns same executionId (deduplicated)
 *  - expiry TTL → cache miss fires new execution
 *  - idempotencyKey on ctx is set to deterministic SHA-256
 *  - body is forwarded as ctx.payload
 *  - unregister removes token mapping
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { ulid } from 'ulid'

import { WebhookTrigger } from '../src/index.js'
import { FakeSinker } from './fakes.js'
import { buildTask } from './helpers.js'

describe('WebhookTrigger', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker
  let wh: WebhookTrigger

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
    wh = new WebhookTrigger({
      triggerFn: sinker.asTriggerFn(),
      systemActorId: 'system:webhook',
      dedupTtlMs: 60_000,
      now: () => 1_700_000_000_000,
    })
  })

  it('register + unregister', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    expect(wh.registrations()).toBe(1)
    expect(wh.unregister(token)).toBe(true)
    expect(wh.unregister(token)).toBe(false)
    expect(wh.registrations()).toBe(0)
  })

  it('fire returns task_not_found for unknown token', async () => {
    const result = await wh.fire(storage, 'unknown-token', { foo: 'bar' })
    expect(result.outcome.reason).toBe('task_not_found')
    expect(result.outcome.executionId).toBeNull()
    expect(result.deduplicated).toBe(false)
    expect(sinker.records.length).toBe(0)
  })

  it('fire invokes trigger with source=webhook and ctx.payload', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    const body = { foo: 'bar', n: 1 }
    const result = await wh.fire(storage, token, body)
    expect(result.outcome.reason).toBe('fired')
    expect(result.deduplicated).toBe(false)
    expect(sinker.records.length).toBe(1)
    expect(sinker.records[0]?.ctx.source).toBe('webhook')
    expect(sinker.records[0]?.ctx.payload).toEqual(body)
  })

  it('duplicate (token, body) replays the same executionId', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    const body = { kind: 'order.created', id: 'o-123' }
    const first = await wh.fire(storage, token, body)
    const second = await wh.fire(storage, token, body)
    expect(second.deduplicated).toBe(true)
    expect(second.outcome.executionId).toBe(first.outcome.executionId)
    /* Only the FIRST should have called the sinker — the second is a replay. */
    expect(sinker.records.length).toBe(1)
  })

  it('different bodies bypass dedup', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    await wh.fire(storage, token, { kind: 'a' })
    await wh.fire(storage, token, { kind: 'b' })
    expect(sinker.records.length).toBe(2)
  })

  it('expires dedup TTL — second call fires a new execution', async () => {
    /* Use a single WebhookTrigger with mutable now() so we can advance
     * the clock without losing the token map. */
    let now = 1_700_000_000_000
    const localWh = new WebhookTrigger({
      triggerFn: sinker.asTriggerFn(),
      systemActorId: 'system:webhook',
      dedupTtlMs: 60_000,
      now: () => now,
    })
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = localWh.register(task.id)
    const body = { x: 1 }
    const first = await localWh.fire(storage, token, body)
    expect(first.deduplicated).toBe(false)

    /* Advance clock past TTL. */
    now = 1_700_000_061_000
    const second = await localWh.fire(storage, token, body)
    expect(second.deduplicated).toBe(false)
    expect(sinker.countFor(task.id)).toBeGreaterThanOrEqual(2)
  })

  it('idempotencyKey is a deterministic SHA-256', () => {
    const a = WebhookTrigger.idempotencyKey('tok-1', { foo: 'bar' })
    const b = WebhookTrigger.idempotencyKey('tok-1', { foo: 'bar' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)

    const c = WebhookTrigger.idempotencyKey('tok-2', { foo: 'bar' })
    expect(c).not.toBe(a)
  })

  it('forwards token-derived ctx (source + system triggeredBy)', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    await wh.fire(storage, token, { z: 1 })
    expect(sinker.records[0]?.ctx.source).toBe('webhook')
    expect(sinker.records[0]?.ctx.triggeredBy).toBe('system:webhook')
    expect(sinker.records[0]?.opts.bypassAuth).toBe(true)
  })

  it('reject unknown token still computes idempotency key', async () => {
    const id = WebhookTrigger.idempotencyKey('unknown', { a: 1 })
    const r = await wh.fire(storage, 'unknown', { a: 1 })
    expect(r.idempotencyKey).toBe(id)
  })

  it('handles non-object body (string)', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    await expect(wh.fire(storage, token, 'plain-text')).resolves.toBeDefined()
  })

  it('handles null body', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    await expect(wh.fire(storage, token, null)).resolves.toBeDefined()
  })

  it('two different tokens for the same task → two independent registries', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const t1 = wh.register(task.id)
    const t2 = wh.register(task.id, 'second-token')
    expect(t1).not.toBe(t2)
    expect(wh.registrations()).toBe(2)
    /* Both fire successfully. */
    await wh.fire(storage, t1, { x: 1 })
    await wh.fire(storage, t2, { x: 1 })
    /* Different dedup keys → both dispatch. */
    expect(sinker.records.length).toBe(2)
  })

  it('register explicit token vs auto-generated token', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const explicit = wh.register(task.id, 'explicit-token-001')
    expect(explicit).toBe('explicit-token-001')
    expect(wh.registrations()).toBe(1)
  })

  it('prune() removes expired entries', async () => {
    const task = buildTask({ status: 'scheduled' })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    await wh.fire(storage, token, { x: 1 })
    expect(wh.cacheSize()).toBe(1)
    /* TTL is 60_000ms so prune at now+30s (within TTL) → 0 removed. */
    const removed = wh.prune(1_700_000_000_000 + 30_000)
    expect(removed).toBe(0)
    /* prune at now+90s (past TTL) → 1 removed. */
    const removed2 = wh.prune(1_700_000_000_000 + 90_000)
    expect(removed2).toBe(1)
    expect(wh.cacheSize()).toBe(0)
  })

  it('ulid tasks handled', async () => {
    const task = buildTask({ status: 'scheduled', id: ulid() as never })
    await storage.saveTask(task)
    const token = wh.register(task.id)
    await wh.fire(storage, token, { y: 0 })
    expect(sinker.countFor(task.id)).toBe(1)
  })
})
