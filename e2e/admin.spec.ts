import { test, expect } from '@playwright/test'
import { adminLogin, registerUser, bearer } from './helpers'

/**
 * Admin user management (API level — the admin UI is covered by the
 * browser suite): invite → list → read → update role → disable.
 */
test.describe('admin user CRUD', () => {
  let adminToken = ''

  test.beforeEach(async ({ request }) => {
    const { accessToken } = await adminLogin(request)
    adminToken = accessToken
  })

  test('invite, list, read, update role, and disable a user', async ({ request }) => {
    const email = `invite-${Date.now()}@cadence.dev`

    // Invite
    const invite = await request.post('/api/users/invite', {
      headers: bearer(adminToken),
      data: {
        email,
        password: 'invite-pass-1234',
        displayName: 'Invited User',
        role: 'viewer',
      },
    })
    expect(invite.status()).toBe(201)
    const created = (await invite.json()) as { user: { id: string; role: string; isActive: boolean } }
    expect(created.user.role).toBe('viewer')
    expect(created.user.isActive).toBe(true)

    // List contains the new user
    const list = await request.get('/api/users', { headers: bearer(adminToken) })
    expect(list.status()).toBe(200)
    const listBody = (await list.json()) as { users: Array<{ id: string; email: string }> }
    expect(listBody.users.some((u) => u.email === email)).toBe(true)

    // Read
    const read = await request.get(`/api/users/${created.user.id}`, {
      headers: bearer(adminToken),
    })
    expect(read.status()).toBe(200)
    const readBody = (await read.json()) as { user: { displayName?: string; passwordHash?: unknown } }
    expect(readBody.user.displayName).toBe('Invited User')
    // Password hash must never be exposed.
    expect('passwordHash' in (readBody.user as object)).toBe(false)

    // Update role → editor
    const patch = await request.patch(`/api/users/${created.user.id}`, {
      headers: bearer(adminToken),
      data: { role: 'editor' },
    })
    expect(patch.status()).toBe(200)
    const patchBody = (await patch.json()) as { user: { role?: string } }
    expect(patchBody.user.role).toBe('editor')

    // Disable (delete = soft disable)
    const del = await request.delete(`/api/users/${created.user.id}`, {
      headers: bearer(adminToken),
    })
    expect(del.status()).toBe(200)
    const after = await request.get(`/api/users/${created.user.id}`, {
      headers: bearer(adminToken),
    })
    expect(after.status()).toBe(200)
    const afterBody = (await after.json()) as { user: { isActive?: boolean } }
    expect(afterBody.user.isActive).toBe(false)
  })

  test('duplicate invite is rejected 409', async ({ request }) => {
    const email = `dup-${Date.now()}@cadence.dev`
    const body = {
      email,
      password: 'invite-pass-1234',
      displayName: 'Dup',
      role: 'viewer',
    }
    const first = await request.post('/api/users/invite', {
      headers: bearer(adminToken),
      data: body,
    })
    expect(first.status()).toBe(201)
    const second = await request.post('/api/users/invite', {
      headers: bearer(adminToken),
      data: body,
    })
    expect(second.status()).toBe(409)
  })

  test('viewer cannot list users (403)', async ({ request }) => {
    const viewer = await registerUser(request)
    const res = await request.get('/api/users', {
      headers: bearer(viewer.tokens.accessToken),
    })
    expect(res.status()).toBe(403)
  })
})
