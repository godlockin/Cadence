/**
 * @cadence/api — audit log tests.
 *
 *  - register writes user.create + auth.login_success
 *  - login writes auth.login_success / auth.login_failed
 *  - create task writes task.create
 *  - patch writes task.update
 *  - delete writes task.delete
 *  - credential create writes credential.create
 *  - logout-all writes auth.logout_all
 *  - audit endpoint requires audit:read (admin) and supports filters
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'

describe('audit log', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('register writes user.create + login_success', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au1@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'GET', '/api/audit/logs?actorId=' + user.id, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { logs: { action: string }[] }
    const actions = json.logs.map((l) => l.action)
    expect(actions).toContain('user.create')
    expect(actions).toContain('auth.login_success')
  })

  it('login: failed password writes auth.login_failed', async () => {
    const { user } = await t.registerUser({ email: 'au2@e.com', password: 'right-password' })
    /* attempt a wrong login */
    const failed = await callApp(t.app, 'POST', '/api/auth/login', {
      body: { email: 'au2@e.com', password: 'wrong-password' },
    })
    expect(failed.status).toBe(401)
    const logs = await t.storage.listAuditLogs({ actorId: user.id })
    const failedLog = logs.find((l) => l.action === 'auth.login_failed')
    expect(failedLog).toBeDefined()
  })

  it('create task writes task.create', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au3@e.com' })
    t.setUserRole(user.id, 'admin')
    await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'audit-task',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const logs = await t.storage.listAuditLogs({ action: 'task.create' })
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  it('patch task writes task.update', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au4@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'patch-audit',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string; version: number } }).task.id
    await callApp(t.app, 'PATCH', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'renamed', expectedVersion: 1 },
    })
    const logs = await t.storage.listAuditLogs({ action: 'task.update' })
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  it('delete task writes task.delete', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au5@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'del-audit',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const id = ((await created.json()) as { task: { id: string } }).task.id
    await callApp(t.app, 'DELETE', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    const logs = await t.storage.listAuditLogs({ action: 'task.delete' })
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  it('credential create writes credential.create', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au6@e.com' })
    t.setUserRole(user.id, 'admin')
    await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'cre', kind: 'api-key', secret: 'plaintext' },
    })
    const logs = await t.storage.listAuditLogs({ action: 'credential.create' })
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  it('logout-all writes auth.logout_all', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au7@e.com' })
    t.setUserRole(user.id, 'admin')
    await callApp(t.app, 'POST', '/api/auth/logout-all', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    const logs = await t.storage.listAuditLogs({ action: 'auth.logout_all' })
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  it('audit endpoint filters by resourceKind', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au8@e.com' })
    t.setUserRole(user.id, 'admin')
    await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'audit-filter',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    const res = await callApp(t.app, 'GET', '/api/audit/logs?resourceKind=task', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { logs: { resourceKind: string }[] }
    expect(json.logs.length).toBeGreaterThanOrEqual(1)
    expect(json.logs.every((l) => l.resourceKind === 'task')).toBe(true)
  })
})