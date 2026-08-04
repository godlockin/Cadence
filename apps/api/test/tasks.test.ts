/**
 * @cadence/api — task route tests.
 *
 *  - CRUD: create + read + patch + delete + list (with filters)
 *  - trigger: owner can trigger, stranger gets 403
 *  - suspend / resume: status transitions
 *  - cancel: cancels active executions
 *  - RBAC: viewer cannot create (forbidden)
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'

describe('task routes', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('create + read: pipeline:create permission required', async () => {
    const { user, tokens } = await t.registerUser({ email: 'owner@e.com' })
    t.setUserRole(user.id, 'admin')
    const create = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'My pipeline',
        payloadKind: 'http',
        payload: { url: 'https://example.com' },
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    expect(create.status).toBe(201)
    const created = (await create.json()) as { task: { id: string; name: string; version: number } }
    expect(created.task.name).toBe('My pipeline')

    const read = await callApp(t.app, 'GET', `/api/tasks/${created.task.id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(read.status).toBe(200)
  })

  it('create: viewer gets 403', async () => {
    const { tokens } = await t.registerUser({ email: 'viewer@e.com' })
    /* viewer role has pipeline:read only */
    const res = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'Nope',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    expect(res.status).toBe(403)
  })

  it('list: filters by status and q', async () => {
    const { user, tokens } = await t.registerUser({ email: 'lister@e.com' })
    t.setUserRole(user.id, 'admin')
    for (const name of ['alpha', 'beta', 'gamma']) {
      await callApp(t.app, 'POST', '/api/tasks', {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
        body: {
          name,
          payloadKind: 'http',
          payload: {},
          triggerKind: 'manual',
          triggerConfig: {},
        },
      })
    }
    const res = await callApp(t.app, 'GET', '/api/tasks?q=alpha', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { tasks: { name: string }[] }
    expect(json.tasks).toHaveLength(1)
    expect(json.tasks[0]?.name).toBe('alpha')
  })

  it('patch: optimistic lock — stale version → 409', async () => {
    const { user, tokens } = await t.registerUser({ email: 'patch@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'orig',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    /* patch with wrong version */
    const bad = await callApp(t.app, 'PATCH', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'newer', expectedVersion: 999 },
    })
    expect(bad.status).toBe(409)
    const json = (await bad.json()) as { error: string }
    expect(json.error).toBe('stale_version')
  })

  it('delete: soft-deletes (returns ok)', async () => {
    const { user, tokens } = await t.registerUser({ email: 'del@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'to-delete',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string; version: number } }).task.id
    const del = await callApp(t.app, 'DELETE', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(del.status).toBe(200)
  })

  it('trigger: owner can trigger their task', async () => {
    const { user, tokens } = await t.registerUser({ email: 'trig@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'trig-me',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    const trig = await callApp(t.app, 'POST', `/api/tasks/${id}/trigger`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { payload: { hello: 'world' } },
    })
    expect(trig.status).toBe(202)
    const json = (await trig.json()) as { executionId: string }
    expect(json.executionId.length).toBe(26)
  })

  it('trigger: stranger gets 403', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'own@e.com' })
    t.setUserRole(owner.id, 'admin')
    /* Stranger has viewer role (no pipeline:trigger) → can() denies → 403. */
    const { tokens: stranger } = await t.registerUser({ email: 'stranger@e.com' })
    const strangerUser = await t.storage.getUserByEmail('stranger@e.com')
    t.setUserRole(strangerUser?.id ?? owner.id, 'viewer')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${ownerTok.accessToken}` },
      body: {
        name: 'private',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    const trig = await callApp(t.app, 'POST', `/api/tasks/${id}/trigger`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
      body: {},
    })
    expect(trig.status).toBe(403)
  })

  it('suspend + resume: flips status', async () => {
    const { user, tokens } = await t.registerUser({ email: 'sus@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'suspend-me',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    const sus = await callApp(t.app, 'POST', `/api/tasks/${id}/suspend`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(sus.status).toBe(200)
    const susJson = (await sus.json()) as { task: { status: string } }
    expect(susJson.task.status).toBe('suspended')

    const res = await callApp(t.app, 'POST', `/api/tasks/${id}/resume`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const resJson = (await res.json()) as { task: { status: string } }
    expect(resJson.task.status).toBe('pending')
  })

  it('cancel: cancels active executions', async () => {
    const { user, tokens } = await t.registerUser({ email: 'can@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'cancel-me',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    /* trigger once to spawn an execution */
    await callApp(t.app, 'POST', `/api/tasks/${id}/trigger`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {},
    })
    const cancel = await callApp(t.app, 'POST', `/api/tasks/${id}/cancel`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(cancel.status).toBe(200)
    const json = (await cancel.json()) as { cancelled: number }
    expect(json.cancelled).toBeGreaterThanOrEqual(1)
  })

  it('list executions: filter by taskId', async () => {
    const { user, tokens } = await t.registerUser({ email: 'lex@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'lex',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    await callApp(t.app, 'POST', `/api/tasks/${id}/trigger`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {},
    })
    const list = await callApp(t.app, 'GET', `/api/executions?taskId=${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(list.status).toBe(200)
    const json = (await list.json()) as { executions: { taskId: string }[] }
    expect(json.executions.length).toBeGreaterThanOrEqual(1)
    expect(json.executions[0]?.taskId).toBe(id)
  })

  it('GET /api/tasks without auth → 401', async () => {
    const res = await callApp(t.app, 'GET', '/api/tasks')
    expect(res.status).toBe(401)
  })
})