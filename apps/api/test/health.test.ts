/**
 * @cadence/api — health + scheduler-route tests.
 *
 *   GET /api/health  → returns { status, db, scheduler, uptime, version, ts }
 *   GET /api/scheduler/status → reports SchedulerHandle.status() or stub
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'

describe('health + scheduler routes', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('GET /api/health returns the basic shape', async () => {
    const res = await callApp(t.app, 'GET', '/api/health')
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      status: string
      db: boolean
      scheduler: { running: boolean; cron: boolean; webhookRegistrations: number; webhookCacheSize: number; uptimeSeconds: number }
      uptime: number
      version: string
      ts: number
    }
    expect(json.status).toBe('ok')
    expect(json.db).toBe(true)
    expect(json.uptime).toBeGreaterThan(0)
    expect(typeof json.version).toBe('string')
    expect(typeof json.ts).toBe('number')
    /* Without a scheduler installed, defaults are reported. */
    expect(json.scheduler.running).toBe(false)
    expect(json.scheduler.cron).toBe(false)
  })

  it('GET /health returns 200 even without auth', async () => {
    const res = await callApp(t.app, 'GET', '/health')
    expect(res.status).toBe(200)
  })

  it('GET /api/scheduler/status reports "not installed" stub', async () => {
    const res = await callApp(t.app, 'GET', '/api/scheduler/status')
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      running: boolean
      cron: boolean
      webhookRegistrations: number
      webhookCacheSize: number
      uptimeSeconds: number
      message?: string
    }
    expect(json.running).toBe(false)
    expect(json.message).toMatch(/not installed/)
  })

  it('GET /api/health is accessible without auth (health should be public)', async () => {
    const res = await callApp(t.app, 'GET', '/api/health')
    /* Should NOT 401 even with no Authorization header. */
    expect(res.status).not.toBe(401)
  })
})
