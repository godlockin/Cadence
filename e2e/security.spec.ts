import { test, expect } from '@playwright/test'
import { adminLogin, createTask, registerUser, bearer } from './helpers'

test.describe('security / RBAC', () => {
  let adminToken = ''

  test.beforeEach(async ({ request }) => {
    const { accessToken } = await adminLogin(request)
    adminToken = accessToken
  })

  test('viewer cannot create a task (403)', async ({ request }) => {
    const viewer = await registerUser(request)
    const res = await request.post('/api/tasks', {
      headers: bearer(viewer.tokens.accessToken),
      data: {
        name: 'forbidden-task',
        payloadKind: 'command',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    expect(res.status()).toBe(403)
  })

  test('viewer cannot create a credential (403)', async ({ request }) => {
    const viewer = await registerUser(request)
    const res = await request.post('/api/credentials', {
      headers: bearer(viewer.tokens.accessToken),
      data: { name: 'forbidden-cred', kind: 'api-key', secret: 'nope' },
    })
    expect(res.status()).toBe(403)
  })

  test('viewer cannot update or trigger another users task (403)', async ({ request }) => {
    const viewer = await registerUser(request)
    const task = await createTask(request, adminToken)

    const update = await request.patch(`/api/tasks/${task.id}`, {
      headers: bearer(viewer.tokens.accessToken),
      data: { name: 'hijack', expectedVersion: task.version },
    })
    expect(update.status()).toBe(403)

    const trigger = await request.post(`/api/tasks/${task.id}/trigger`, {
      headers: bearer(viewer.tokens.accessToken),
      data: {},
    })
    expect(trigger.status()).toBe(403)
  })

  test('GET /health reports ok with db up', async ({ request }) => {
    const res = await request.get('http://localhost:8787/health')
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { status?: string; db?: boolean }
    expect(body.db).toBe(true)
  })

  test('GET /api/health reports scheduler status', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { status?: string; scheduler?: { running?: boolean } }
    expect(body.status).toBe('ok')
    expect(body.scheduler?.running).toBe(true)
  })
})
