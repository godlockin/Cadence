/**
 * @cadence/api — webhook route tests.
 *
 *  - POST /api/webhooks/:token/trigger with valid token spawns an execution
 *  - 404 for unknown token
 *  - 404 for too-short token
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'

describe('webhook routes', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('trigger: spawns an execution for matching task', async () => {
    const { user, tokens } = await t.registerUser({ email: 'wh@e.com' })
    t.setUserRole(user.id, 'admin')
    const token = 'token-supersecret1234'
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'webhook-task',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'webhook',
        triggerConfig: { token },
      },
    })
    expect(created.status).toBe(201)

    const res = await callApp(t.app, 'POST', `/api/webhooks/${token}/trigger`, {
      body: { payload: { hello: 'world' } },
    })
    expect(res.status).toBe(202)
    const json = (await res.json()) as { executionId: string; taskId: string }
    expect(json.executionId.length).toBe(26)
  })

  it('unknown token → 404', async () => {
    const res = await callApp(t.app, 'POST', '/api/webhooks/zzzzzzzzzzzzzzzzzzzz/trigger', {
      body: {},
    })
    expect(res.status).toBe(404)
  })

  it('short token → 404', async () => {
    const res = await callApp(t.app, 'POST', '/api/webhooks/abc/trigger', {
      body: {},
    })
    expect(res.status).toBe(404)
  })

  it('execution stream: emits a snapshot event', async () => {
    const { user, tokens } = await t.registerUser({ email: 'whs@e.com' })
    t.setUserRole(user.id, 'admin')
    const token = 'token-streamtest1234'
    await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'stream-task',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'webhook',
        triggerConfig: { token },
      },
    })
    const trig = await callApp(t.app, 'POST', `/api/webhooks/${token}/trigger`, {
      body: {},
    })
    const executionId = ((await trig.json()) as { executionId: string }).executionId
    const stream = await callApp(t.app, 'GET', `/api/executions/${executionId}/stream`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
  })
})