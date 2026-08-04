import { test, expect } from '@playwright/test'
import { adminLogin, createTask, bearer } from './helpers'

test.describe('task lifecycle', () => {
  let adminToken = ''

  test.beforeEach(async ({ request }) => {
    const { accessToken } = await adminLogin(request)
    adminToken = accessToken
  })

  test('create task -> list -> read round trip', async ({ request }) => {
    const task = await createTask(request, adminToken, { name: 'round-trip-task' })
    expect(task.status).toBe('pending')
    expect(task.payloadKind).toBe('command')

    const list = await request.get('/api/tasks', { headers: bearer(adminToken) })
    expect(list.status()).toBe(200)
    const listBody = (await list.json()) as { tasks: Array<{ id: string; name?: string }> }
    expect(listBody.tasks.some((t) => t.id === task.id)).toBe(true)

    const read = await request.get(`/api/tasks/${task.id}`, { headers: bearer(adminToken) })
    expect(read.status()).toBe(200)
    const readBody = (await read.json()) as { task: { name?: string } }
    expect(readBody.task.name).toBe('round-trip-task')
  })

  test('update bumps version and persists name', async ({ request }) => {
    const task = await createTask(request, adminToken)
    const res = await request.patch(`/api/tasks/${task.id}`, {
      headers: bearer(adminToken),
      data: { name: 'renamed-task', expectedVersion: task.version },
    })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { task: { name?: string; version?: number } }
    expect(body.task.name).toBe('renamed-task')
    expect(body.task.version).toBe((task.version ?? 1) + 1)
  })

  test('stale optimistic-lock update is rejected 409', async ({ request }) => {
    const task = await createTask(request, adminToken)
    await request.patch(`/api/tasks/${task.id}`, {
      headers: bearer(adminToken),
      data: { description: 'first', expectedVersion: task.version },
    })
    // Reuse the stale version → conflict.
    const stale = await request.patch(`/api/tasks/${task.id}`, {
      headers: bearer(adminToken),
      data: { description: 'stale', expectedVersion: task.version },
    })
    expect(stale.status()).toBe(409)
  })

  test('manual trigger creates an execution', async ({ request }) => {
    const task = await createTask(request, adminToken)
    const trig = await request.post(`/api/tasks/${task.id}/trigger`, {
      headers: bearer(adminToken),
      data: {},
    })
    expect(trig.status()).toBe(202)
    const trigBody = (await trig.json()) as { executionId: string }
    expect(trigBody.executionId).toBeTruthy()

    const ex = await request.get(`/api/executions/${trigBody.executionId}`, {
      headers: bearer(adminToken),
    })
    expect(ex.status()).toBe(200)
    const exBody = (await ex.json()) as {
      execution: { status?: string; triggerSource?: string; taskId?: string }
    }
    expect(exBody.execution.status).toBe('queued')
    expect(exBody.execution.triggerSource).toBe('manual')
    expect(exBody.execution.taskId).toBe(task.id)
  })

  test('suspend then resume transitions task status', async ({ request }) => {
    const task = await createTask(request, adminToken)
    const susp = await request.post(`/api/tasks/${task.id}/suspend`, {
      headers: bearer(adminToken),
    })
    expect(susp.status()).toBe(200)
    let body = (await susp.json()) as { task: { status?: string } }
    expect(body.task.status).toBe('suspended')

    const res = await request.post(`/api/tasks/${task.id}/resume`, {
      headers: bearer(adminToken),
    })
    expect(res.status()).toBe(200)
    body = (await res.json()) as { task: { status?: string } }
    expect(body.task.status).toBe('pending')
  })

  test('delete soft-deletes the task', async ({ request }) => {
    const task = await createTask(request, adminToken)
    const del = await request.delete(`/api/tasks/${task.id}`, { headers: bearer(adminToken) })
    expect(del.status()).toBe(200)

    const read = await request.get(`/api/tasks/${task.id}`, { headers: bearer(adminToken) })
    expect(read.status()).toBe(404)
  })
})
