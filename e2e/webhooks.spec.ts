import { test, expect } from '@playwright/test'
import { adminLogin, createTask, bearer } from './helpers'

test.describe('webhooks', () => {
  let adminToken = ''

  test.beforeEach(async ({ request }) => {
    const { accessToken } = await adminLogin(request)
    adminToken = accessToken
  })

  test('webhook trigger spawns an execution', async ({ request }) => {
    const token = `wh-${Math.random().toString(36).slice(2, 12)}` // >= 8 chars
    const task = await createTask(request, adminToken, {
      name: 'webhook-task',
      triggerKind: 'webhook',
      triggerConfig: { token },
    })

    const res = await request.post(`/api/webhooks/${token}/trigger`, {
      data: { payload: { repo: 'pulsedeck' } },
    })
    expect(res.status()).toBe(202)
    const body = (await res.json()) as { executionId: string; taskId: string; replay?: boolean }
    expect(body.executionId).toBeTruthy()
    expect(body.taskId).toBe(task.id)
    expect(body.replay).toBe(false)
  })

  test('webhook idempotency returns the same executionId for a key', async ({ request }) => {
    const token = `wh-${Math.random().toString(36).slice(2, 12)}`
    await createTask(request, adminToken, {
      name: 'webhook-idem',
      triggerKind: 'webhook',
      triggerConfig: { token },
    })
    const payload = { payload: { event: 'push' } }
    const headers = { 'Idempotency-Key': 'fixed-key-123' }

    const first = await request.post(`/api/webhooks/${token}/trigger`, { data: payload, headers })
    const second = await request.post(`/api/webhooks/${token}/trigger`, { data: payload, headers })
    expect(first.status()).toBe(202)
    expect(second.status()).toBe(200)

    const firstBody = (await first.json()) as { executionId: string }
    const secondBody = (await second.json()) as { executionId: string; replay?: boolean }
    expect(secondBody.executionId).toBe(firstBody.executionId)
    expect(secondBody.replay).toBe(true)
  })

  test('unknown webhook token is 404', async ({ request }) => {
    const res = await request.post('/api/webhooks/does-not-exist-0000/trigger', { data: {} })
    expect(res.status()).toBe(404)
  })
})
