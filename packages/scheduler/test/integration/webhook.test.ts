/**
 * @cadence/scheduler — webhook trigger integration tests.
 *
 *   - register webhook, get token
 *   - simulated external fetch → triggers task via WebhookTrigger
 *   - dedup: same idempotency key → returns SAME execution id
 *   - unregister webhook → fire() returns task_not_found
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { WebhookTrigger } from '../../src/index.js'
import { FakeSinker } from '../fakes.js'
import { buildTask, persistTask } from '../helpers.js'

describe('WebhookTrigger (e2e)', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker
  let wh: WebhookTrigger

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
    wh = new WebhookTrigger({
      triggerFn: sinker.asTriggerFn(),
      dedupTtlMs: 60_000,
    })
  })

  it('register → fire → sinker gets called with the right ctx', async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'webhook' }),
    )
    const token = wh.register(task.id, 'token-supersecret1234')
    expect(token).toBe('token-supersecret1234')

    const out = await wh.fire(storage, token, { foo: 'bar' })
    expect(out.outcome.reason).toBe('fired')
    expect(out.deduplicated).toBe(false)
    expect(sinker.countFor(task.id)).toBe(1)
    const rec = sinker.records[0]!
    expect(rec.ctx.source).toBe('webhook')
    expect(rec.ctx.idempotencyKey).toBeDefined()
  })

  it('idempotent: same body → same execution id (no double-fire)', async () => {
    const task = await persistTask(storage, buildTask({ trigger_kind: 'webhook' }))
    const token = wh.register(task.id)
    const body = { event: 'order.created', id: 'abc' }

    const a = await wh.fire(storage, token, body)
    const b = await wh.fire(storage, token, body)

    expect(a.outcome.executionId).not.toBeNull()
    expect(b.outcome.executionId).toBe(a.outcome.executionId)
    expect(b.deduplicated).toBe(true)
    expect(sinker.countFor(task.id)).toBe(1)
  })

  it('different body → separate executions', async () => {
    const task = await persistTask(storage, buildTask({ trigger_kind: 'webhook' }))
    const token = wh.register(task.id)

    const a = await wh.fire(storage, token, { event: 'a' })
    const b = await wh.fire(storage, token, { event: 'b' })

    expect(a.outcome.executionId).not.toEqual(b.outcome.executionId)
    expect(sinker.countFor(task.id)).toBe(2)
  })

  it('unregistered token returns task_not_found (404 semantics)', async () => {
    const out = await wh.fire(storage, 'unknown-token', { hello: 'world' })
    expect(out.outcome.reason).toBe('task_not_found')
    expect(sinker.records.length).toBe(0)
  })

  it('explicit unregister invalidates the token', async () => {
    const task = await persistTask(storage, buildTask({ trigger_kind: 'webhook' }))
    const token = wh.register(task.id)
    expect(wh.registrations()).toBe(1)
    wh.unregister(token)
    expect(wh.registrations()).toBe(0)

    const out = await wh.fire(storage, token, { foo: 'bar' })
    expect(out.outcome.reason).toBe('task_not_found')
  })

  it('idempotencyKey is deterministic sha256 of (token:body)', () => {
    const k1 = WebhookTrigger.idempotencyKey('t', { a: 1 })
    const k2 = WebhookTrigger.idempotencyKey('t', { a: 1 })
    const k3 = WebhookTrigger.idempotencyKey('t', { a: 2 })
    expect(k1).toBe(k2)
    expect(k1).not.toBe(k3)
    expect(k1).toHaveLength(64)
  })
})
