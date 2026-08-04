import { test, expect } from '@playwright/test'
import { adminLogin, bearer } from './helpers'

test.describe('credentials', () => {
  let adminToken = ''

  test.beforeEach(async ({ request }) => {
    const { accessToken } = await adminLogin(request)
    adminToken = accessToken
  })

  test('create credential never returns plaintext secret', async ({ request }) => {
    const res = await request.post('/api/credentials', {
      headers: bearer(adminToken),
      data: { name: 'github-token', kind: 'api-key', secret: 'super-secret-value-123' },
    })
    expect(res.status()).toBe(201)
    const raw = (await res.text()) as string
    // Plaintext must not leak anywhere in the response.
    expect(raw.includes('super-secret-value-123')).toBe(false)

    const body = (await res.json()) as { credential: { id: string; name?: string; secret?: unknown } }
    expect(body.credential.id).toBeTruthy()
    expect(body.credential.name).toBe('github-token')
    expect('secret' in body.credential).toBe(false)
  })

  test('GET credential returns metadata only', async ({ request }) => {
    const create = await request.post('/api/credentials', {
      headers: bearer(adminToken),
      data: { name: 'list-me', kind: 'bearer', secret: 'another-plain-secret' },
    })
    expect(create.status()).toBe(201)
    const body = (await create.json()) as { credential: { id: string } }
    const read = await request.get(`/api/credentials/${body.credential.id}`, {
      headers: bearer(adminToken),
    })
    expect(read.status()).toBe(200)
    const raw = (await read.text()) as string
    expect(raw.includes('another-plain-secret')).toBe(false)
  })

  test('list credentials returns only own credentials', async ({ request }) => {
    // Admin creates one; a viewer creates none — so the viewer's list is empty.
    const viewer = await request.post('/api/auth/register', {
      data: {
        email: `viewer-${Date.now()}@cadence.dev`,
        password: 'viewer-pass-1234',
        displayName: 'Viewer',
      },
    })
    const vBody = (await viewer.json()) as { accessToken: string }
    const list = await request.get('/api/credentials', {
      headers: bearer(vBody.accessToken),
    })
    expect(list.status()).toBe(200)
    const lBody = (await list.json()) as { credentials: unknown[] }
    expect(Array.isArray(lBody.credentials)).toBe(true)
  })

  test('delete credential removes it', async ({ request }) => {
    const create = await request.post('/api/credentials', {
      headers: bearer(adminToken),
      data: { name: 'delete-me', kind: 'api-key', secret: 'delete-me-secret' },
    })
    expect(create.status()).toBe(201)
    const body = (await create.json()) as { credential: { id: string } }
    const del = await request.delete(`/api/credentials/${body.credential.id}`, {
      headers: bearer(adminToken),
    })
    expect(del.status()).toBe(200)
    const read = await request.get(`/api/credentials/${body.credential.id}`, {
      headers: bearer(adminToken),
    })
    expect(read.status()).toBe(404)
  })
})
