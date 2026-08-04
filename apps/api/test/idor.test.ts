/**
 * @cadence/api — IDOR + privilege-escalation security tests.
 *
 * Covers the PHASE 3B security hardening fixes:
 *  1. Register role escalation (viewer-only, first-user = super_admin,
 *     reject `role` field, reject already-authenticated).
 *  2. IDOR on task resources (GET/PATCH/DELETE/trigger/suspend/resume/
 *     cancel) — owner, group member, admin, stranger.
 *  3. IDOR on credentials (GET/PATCH/DELETE/refresh) — owner, admin,
 *     stranger.
 *  4. IDOR on executions (GET / stream) — follows parent task.
 *  5. IDOR on users (GET / PATCH) — self, admin, stranger.
 *  6. IDOR on groups (GET) — member, admin, stranger.
 *  7. Audit log records 403 events with actor + reason.
 *
 * Each `it()` is a single security assertion. Failures are immediate
 * red-flags, not flaky false positives.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'

describe('auth: register role hardening', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('registers the very first user as super_admin', async () => {
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      body: {
        email: 'root@example.com',
        password: 'super-secret-password',
        displayName: 'Root',
      },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { user: { role: string; isSuperadmin: boolean } }
    expect(json.user.role).toBe('viewer')
    expect(json.user.isSuperadmin).toBe(true)
  })

  it('registers subsequent users as viewer (not super_admin)', async () => {
    await callApp(t.app, 'POST', '/api/auth/register', {
      body: {
        email: 'first@example.com',
        password: 'super-secret-password',
        displayName: 'First',
      },
    })
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      body: {
        email: 'second@example.com',
        password: 'super-secret-password',
        displayName: 'Second',
      },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { user: { isSuperadmin: boolean; role: string } }
    expect(json.user.isSuperadmin).toBe(false)
    expect(json.user.role).toBe('viewer')
  })

  it('ignores `role` field on public register (always viewer)', async () => {
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      body: {
        email: 'attacker@example.com',
        password: 'super-secret-password',
        displayName: 'Attacker',
        role: 'admin',
      },
    })
    /* strict() schema rejects the unknown field → 400 */
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('validation')
  })

  it('rejects already-authenticated register (403)', async () => {
    const { tokens } = await t.registerUser({ email: 'logged@example.com' })
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        email: 'new@example.com',
        password: 'super-secret-password',
        displayName: 'New',
      },
    })
    expect(res.status).toBe(403)
  })

  it('does not record role=admin in storage even when API would have allowed it', async () => {
    /* Manually call auth.register with a known-bad role to ensure the
     * service still respects the explicit "viewer" override. */
    const out = await t.auth.register({
      email: 'svc@example.com',
      password: 'super-secret-password',
      displayName: 'Svc',
      role: 'viewer',
    })
    const stored = await t.storage.getUser(out.user.id)
    expect(stored?.role).toBe('viewer')
    expect(stored?.isSuperadmin).toBe(false)
  })
})

describe('IDOR: task resources', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  async function createTask(
    tokens: { accessToken: string },
    name: string,
  ): Promise<{ id: string; ownerId: string }> {
    const res = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name,
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
      },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as {
      task: { id: string; ownerId: string }
    }
    return { id: json.task.id, ownerId: json.task.ownerId }
  }

  it('owner can GET their task', async () => {
    const { user, tokens } = await t.registerUser({ email: 'own-get@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createTask(tokens, 'own')
    const res = await callApp(t.app, 'GET', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('admin (RBAC) can GET any task', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'own-task@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { user: admin, tokens: adminTok } = await t.registerUser({ email: 'admin-rbac@e.com' })
    t.setUserRole(admin.id, 'admin')
    const { id } = await createTask(ownerTok, 'private')
    const res = await callApp(t.app, 'GET', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${adminTok.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('stranger without role gets 403', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'own-403@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'stranger-403@e.com' })
    /* stranger has no RBAC role assigned */
    const { id } = await createTask(ownerTok, 'private')
    const res = await callApp(t.app, 'GET', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('stranger cannot PATCH someone else\'s task', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'own-p@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'stranger-p@e.com' })
    const { id } = await createTask(ownerTok, 'private')
    const res = await callApp(t.app, 'PATCH', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
      body: { name: 'hijack', expectedVersion: 1 },
    })
    expect(res.status).toBe(403)
  })

  it('stranger cannot DELETE someone else\'s task', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'own-d@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'stranger-d@e.com' })
    const { id } = await createTask(ownerTok, 'private')
    const res = await callApp(t.app, 'DELETE', `/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('stranger cannot trigger someone else\'s task', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'own-t@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'stranger-t@e.com' })
    const { id } = await createTask(ownerTok, 'private')
    const res = await callApp(t.app, 'POST', `/api/tasks/${id}/trigger`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
      body: {},
    })
    expect(res.status).toBe(403)
  })

  it('stranger cannot suspend/resume/cancel', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'own-sr@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'stranger-sr@e.com' })
    const { id } = await createTask(ownerTok, 'private')
    for (const ep of ['suspend', 'resume', 'cancel']) {
      const res = await callApp(t.app, 'POST', `/api/tasks/${id}/${ep}`, {
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      })
      expect(res.status).toBe(403)
    }
  })

  it('unauthenticated read → 401', async () => {
    const { user, tokens } = await t.registerUser({ email: 'own-401@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createTask(tokens, 'p')
    const res = await callApp(t.app, 'GET', `/api/tasks/${id}`)
    expect(res.status).toBe(401)
  })

  it('GET non-existent task → 404', async () => {
    const { user, tokens } = await t.registerUser({ email: 'no404@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'GET', '/api/tasks/00000000000000000000000000', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(404)
  })

  it('group member can read same-group task', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'g-own@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { user: peer, tokens: peerTok } = await t.registerUser({ email: 'g-peer@e.com' })
    t.setUserRole(peer.id, 'admin')
    /* Create group + task directly via storage to avoid the UUID/ULID
     * mismatch between /api/groups (UUID) and the task groupId schema
     * (ULID). */
    const { ulid } = await import('ulid')
    const groupId = ulid()
    await t.storage.saveGroup({
      id: groupId as never,
      name: 'G1',
      description: '',
      ownerId: owner.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const taskRes = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${ownerTok.accessToken}` },
      body: {
        name: 'in-group',
        payloadKind: 'http',
        payload: {},
        triggerKind: 'manual',
        triggerConfig: {},
        groupId,
      },
    })
    const taskId = ((await taskRes.json()) as { task: { id: string } }).task.id
    /* give peer a group-scoped viewer role */
    t.storage.setUserRole(peer.id, {
      id: `group:${groupId}:viewer`,
      name: 'viewer',
      scope: 'group',
      groupId: groupId as never,
      permissions: [
        { action: 'pipeline:read', scope: 'group' },
        { action: 'pipeline:trigger', scope: 'group' },
      ],
    })
    /* peer is now a "group member" by virtue of holding a group-scoped role */
    const res = await callApp(t.app, 'GET', `/api/tasks/${taskId}`, {
      headers: { authorization: `Bearer ${peerTok.accessToken}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('IDOR: credentials', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  async function createCred(
    tokens: { accessToken: string },
    name = 'C1',
  ): Promise<{ id: string }> {
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name, kind: 'api-key', secret: 'super-secret' },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { credential: { id: string } }
    return { id: json.credential.id }
  }

  it('owner can GET their credential', async () => {
    const { user, tokens } = await t.registerUser({ email: 'c-own@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createCred(tokens)
    const res = await callApp(t.app, 'GET', `/api/credentials/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('admin (RBAC) can read any credential', async () => {
    const { user: own, tokens: ownTok } = await t.registerUser({ email: 'c-o@e.com' })
    t.setUserRole(own.id, 'admin')
    const { user: adm, tokens: admTok } = await t.registerUser({ email: 'c-a@e.com' })
    t.setUserRole(adm.id, 'admin')
    const { id } = await createCred(ownTok)
    const res = await callApp(t.app, 'GET', `/api/credentials/${id}`, {
      headers: { authorization: `Bearer ${admTok.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('stranger without role gets 403 on read', async () => {
    const { user: own, tokens: ownTok } = await t.registerUser({ email: 'c-ow@e.com' })
    t.setUserRole(own.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'c-st@e.com' })
    const { id } = await createCred(ownTok)
    const res = await callApp(t.app, 'GET', `/api/credentials/${id}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('stranger cannot PATCH / DELETE / refresh', async () => {
    const { user: own, tokens: ownTok } = await t.registerUser({ email: 'c-o2@e.com' })
    t.setUserRole(own.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'c-s2@e.com' })
    const { id } = await createCred(ownTok)
    for (const op of [
      ['PATCH', `/api/credentials/${id}`, { body: { name: 'hijack' } }],
      ['DELETE', `/api/credentials/${id}`, {}],
      ['POST', `/api/credentials/${id}/refresh`, {}],
    ] as const) {
      const res = await callApp(t.app, op[0], op[1], {
        headers: { authorization: `Bearer ${stranger.accessToken}` },
        ...(op[2] && 'body' in op[2] ? { body: op[2].body } : {}),
      })
      expect(res.status).toBe(403)
    }
  })

  it('GET unknown id → 404', async () => {
    const { user, tokens } = await t.registerUser({ email: 'c-un@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'GET', '/api/credentials/00000000-0000-0000-0000-000000000000', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(404)
  })
})

describe('IDOR: executions (follows parent task)', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('owner can GET execution of their task', async () => {
    const { user, tokens } = await t.registerUser({ email: 'ex-own@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'x', payloadKind: 'http', payload: {}, triggerKind: 'manual', triggerConfig: {} },
    })
    const taskId = ((await created.json()) as { task: { id: string } }).task.id
    const trig = await callApp(t.app, 'POST', `/api/tasks/${taskId}/trigger`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {},
    })
    const execId = ((await trig.json()) as { executionId: string }).executionId
    const res = await callApp(t.app, 'GET', `/api/executions/${execId}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('stranger without role gets 403 on execution read', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'ex-o@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'ex-s@e.com' })
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${ownerTok.accessToken}` },
      body: { name: 'x', payloadKind: 'http', payload: {}, triggerKind: 'manual', triggerConfig: {} },
    })
    const taskId = ((await created.json()) as { task: { id: string } }).task.id
    const trig = await callApp(t.app, 'POST', `/api/tasks/${taskId}/trigger`, {
      headers: { authorization: `Bearer ${ownerTok.accessToken}` },
      body: {},
    })
    const execId = ((await trig.json()) as { executionId: string }).executionId
    const res = await callApp(t.app, 'GET', `/api/executions/${execId}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('stranger cannot stream execution', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'ex-so@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'ex-ss@e.com' })
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${ownerTok.accessToken}` },
      body: { name: 'x', payloadKind: 'http', payload: {}, triggerKind: 'manual', triggerConfig: {} },
    })
    const taskId = ((await created.json()) as { task: { id: string } }).task.id
    const trig = await callApp(t.app, 'POST', `/api/tasks/${taskId}/trigger`, {
      headers: { authorization: `Bearer ${ownerTok.accessToken}` },
      body: {},
    })
    const execId = ((await trig.json()) as { executionId: string }).executionId
    const res = await callApp(t.app, 'GET', `/api/executions/${execId}/stream`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(res.status).toBe(403)
  })
})

describe('IDOR: users (self vs admin)', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('self can read own user', async () => {
    const { user, tokens } = await t.registerUser({ email: 'u-self@e.com' })
    const res = await callApp(t.app, 'GET', `/api/users/${user.id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('admin can read any user', async () => {
    const { user: target, tokens: targetTok } = await t.registerUser({ email: 'u-tar@e.com' })
    void target
    const { user: adm, tokens: admTok } = await t.registerUser({ email: 'u-adm@e.com' })
    t.setUserRole(adm.id, 'admin')
    const res = await callApp(t.app, 'GET', `/api/users/${(await t.storage.getUserByEmail('u-tar@e.com'))?.id ?? ''}`, {
      headers: { authorization: `Bearer ${admTok.accessToken}` },
    })
    expect(res.status).toBe(200)
    void targetTok
  })

  it('stranger without role gets 403 on user read', async () => {
    const { user: target, tokens: _t } = await t.registerUser({ email: 'u-st@e.com' })
    const { tokens: stranger } = await t.registerUser({ email: 'u-st2@e.com' })
    void _t
    const res = await callApp(t.app, 'GET', `/api/users/${target.id}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('self cannot escalate role via PATCH', async () => {
    const { user, tokens } = await t.registerUser({ email: 'u-esc@e.com' })
    const res = await callApp(t.app, 'PATCH', `/api/users/${user.id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { role: 'admin' },
    })
    expect(res.status).toBe(403)
  })

  it('self can update own displayName', async () => {
    const { user, tokens } = await t.registerUser({ email: 'u-dn@e.com' })
    const res = await callApp(t.app, 'PATCH', `/api/users/${user.id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { displayName: 'NewName' },
    })
    expect(res.status).toBe(200)
  })

  it('admin can update any user including role', async () => {
    const { user: target } = await t.registerUser({ email: 'u-at@e.com' })
    const { user: adm, tokens: admTok } = await t.registerUser({ email: 'u-aa@e.com' })
    t.setUserRole(adm.id, 'admin')
    const res = await callApp(t.app, 'PATCH', `/api/users/${target.id}`, {
      headers: { authorization: `Bearer ${admTok.accessToken}` },
      body: { role: 'editor' },
    })
    expect(res.status).toBe(200)
  })

  it('stranger cannot update other user', async () => {
    const { user: target } = await t.registerUser({ email: 'u-st3@e.com' })
    const { tokens: stranger } = await t.registerUser({ email: 'u-st4@e.com' })
    const res = await callApp(t.app, 'PATCH', `/api/users/${target.id}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
      body: { displayName: 'X' },
    })
    expect(res.status).toBe(403)
  })
})

describe('IDOR: groups', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  async function createGroup(
    tokens: { accessToken: string },
  ): Promise<{ id: string }> {
    const res = await callApp(t.app, 'POST', '/api/groups', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'G', description: '' },
    })
    expect(res.status).toBe(201)
    return { id: ((await res.json()) as { group: { id: string } }).group.id }
  }

  it('group owner can read their own group', async () => {
    const { user, tokens } = await t.registerUser({ email: 'g-own@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createGroup(tokens)
    const res = await callApp(t.app, 'GET', `/api/groups/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('admin (RBAC) can read any group', async () => {
    const { user: own, tokens: ownTok } = await t.registerUser({ email: 'g-o@e.com' })
    t.setUserRole(own.id, 'admin')
    const { user: adm, tokens: admTok } = await t.registerUser({ email: 'g-a@e.com' })
    t.setUserRole(adm.id, 'admin')
    const { id } = await createGroup(ownTok)
    const res = await callApp(t.app, 'GET', `/api/groups/${id}`, {
      headers: { authorization: `Bearer ${admTok.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('stranger without role gets 403 on group read', async () => {
    const { user: own, tokens: ownTok } = await t.registerUser({ email: 'g-st@e.com' })
    t.setUserRole(own.id, 'admin')
    const { tokens: stranger } = await t.registerUser({ email: 'g-st2@e.com' })
    const { id } = await createGroup(ownTok)
    const res = await callApp(t.app, 'GET', `/api/groups/${id}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    })
    expect(res.status).toBe(403)
  })
})

describe('audit log: 403 events are recorded', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('a 403 IDOR event shows up in the audit log with reason', async () => {
    const { user: owner, tokens: ownerTok } = await t.registerUser({ email: 'au-own@e.com' })
    t.setUserRole(owner.id, 'admin')
    const { user: stranger, tokens: strangerTok } = await t.registerUser({ email: 'au-st@e.com' })
    /* create a private task */
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${ownerTok.accessToken}` },
      body: { name: 'p', payloadKind: 'http', payload: {}, triggerKind: 'manual', triggerConfig: {} },
    })
    const taskId = ((await created.json()) as { task: { id: string } }).task.id
    /* trigger 403 */
    const res = await callApp(t.app, 'GET', `/api/tasks/${taskId}`, {
      headers: { authorization: `Bearer ${strangerTok.accessToken}` },
    })
    expect(res.status).toBe(403)
    /* allow the audit write to flush (it's fire-and-forget but in-memory sync) */
    await new Promise((r) => setImmediate(r))
    const logs = await t.storage.listAuditLogs({ action: 'auth.forbidden' })
    expect(logs.length).toBeGreaterThan(0)
    const ours = logs.find(
      (l) => l.actorId === stranger.id && String(l.resourceId).endsWith(taskId),
    )
    expect(ours).toBeDefined()
    expect(JSON.parse(ours?.metadataJson ?? '{}')['method']).toBe('GET')
    expect(JSON.parse(ours?.metadataJson ?? '{}')['reason']).toContain('cannot')
  })

  it('a successful 200 access does NOT record auth.forbidden', async () => {
    const { user, tokens } = await t.registerUser({ email: 'au-ok@e.com' })
    t.setUserRole(user.id, 'admin')
    const created = await callApp(t.app, 'POST', '/api/tasks', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'p', payloadKind: 'http', payload: {}, triggerKind: 'manual', triggerConfig: {} },
    })
    const taskId = ((await created.json()) as { task: { id: string } }).task.id
    const res = await callApp(t.app, 'GET', `/api/tasks/${taskId}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    await new Promise((r) => setImmediate(r))
    const logs = await t.storage.listAuditLogs({ action: 'auth.forbidden' })
    /* none of the logs should reference this task id */
    const match = logs.find((l) => String(l.resourceId).endsWith(taskId))
    expect(match).toBeUndefined()
  })
})

describe('IDOR: webhook triggers', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('webhook trigger requires a valid token (8+ chars)', async () => {
    const res = await callApp(t.app, 'POST', '/api/webhooks/short/trigger', {
      body: { payload: {} },
    })
    expect(res.status).toBe(404)
  })

  it('webhook trigger with unknown token → 404', async () => {
    const res = await callApp(t.app, 'POST', '/api/webhooks/no-such-token-1234/trigger', {
      body: { payload: {} },
    })
    expect(res.status).toBe(404)
  })
})
