import { test, expect } from '@playwright/test'
import { adminLogin, createTask, bearer } from './helpers'

test.describe('scheduler', () => {
  let adminToken = ''

  test.beforeEach(async ({ request }) => {
    const { accessToken } = await adminLogin(request)
    adminToken = accessToken
  })

  test('GET /api/scheduler/status reports running cron loop', async ({ request }) => {
    const res = await request.get('/api/scheduler/status', { headers: bearer(adminToken) })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { running?: boolean; cron?: boolean; uptimeSeconds?: number }
    expect(body.running).toBe(true)
    expect(body.cron).toBe(true)
  })

  test('cron schedule fires an execution end-to-end', async ({ request }) => {
    // Create a task that fires every minute and put it in `scheduled`.
    const task = await createTask(request, adminToken, {
      name: 'cron-e2e',
      triggerKind: 'cron',
      cron: '* * * * *',
      timezone: 'UTC',
    })
    const patch = await request.patch(`/api/tasks/${task.id}`, {
      headers: bearer(adminToken),
      data: { status: 'scheduled', expectedVersion: task.version },
    })
    expect(patch.status()).toBe(200)

    // The poller ticks every ~1s; the current minute slot is already due,
    // so the first execution should appear within a few seconds.
    let found: { id: string; triggerSource?: string; status?: string } | null = null
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/executions?taskId=${task.id}`, {
            headers: bearer(adminToken),
          })
          if (res.status() !== 200) return null
          const body = (await res.json()) as { executions: Array<Record<string, unknown>> }
          const ex = body.executions[0] as
            | { id: string; triggerSource?: string; status?: string }
            | undefined
          if (ex === undefined) return null
          found = ex
          return ex
        },
        { timeout: 20_000, intervals: [1000] },
      )
      .not.toBeNull()

    expect(found).not.toBeNull()
    expect(found?.triggerSource).toBe('cron')
    expect(found?.status).toBe('queued')
  })
})
