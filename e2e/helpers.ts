import { expect, type APIRequestContext } from '@playwright/test'

export const ADMIN_EMAIL = 'admin@cadence.local'
export const ADMIN_PASSWORD = 'pulsedeck'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

/** Log in as the bootstrap super_admin account. */
export async function adminLogin(request: APIRequestContext): Promise<AuthTokens> {
  const res = await request.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  expect(res.status(), 'admin login should succeed').toBe(200)
  const body = (await res.json()) as { accessToken: string; refreshToken: string }
  return { accessToken: body.accessToken, refreshToken: body.refreshToken }
}

export interface RegisteredUser {
  email: string
  password: string
  tokens: AuthTokens
  role: string
}

/** Register a brand-new user (role=viewer unless it is the bootstrap). */
export async function registerUser(
  request: APIRequestContext,
  opts: { email?: string; password?: string; displayName?: string } = {},
): Promise<RegisteredUser> {
  const email = opts.email ?? `user-${Math.random().toString(36).slice(2, 10)}@cadence.dev`
  const password = opts.password ?? 'test-pass-1234'
  const displayName = opts.displayName ?? 'E2E User'
  const res = await request.post('/api/auth/register', {
    data: { email, password, displayName },
  })
  expect(res.status(), 'register should succeed').toBe(201)
  const body = (await res.json()) as {
    accessToken: string
    refreshToken: string
    user: { role: string }
  }
  return {
    email,
    password,
    tokens: { accessToken: body.accessToken, refreshToken: body.refreshToken },
    role: body.user.role,
  }
}

/** Create a task as an admin. Returns the task JSON + the created task id. */
export async function createTask(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number } & Record<string, unknown>> {
  const res = await request.post('/api/tasks', {
    headers: bearer(token),
    data: {
      name: `task-${Math.random().toString(36).slice(2, 8)}`,
      payloadKind: 'command',
      payload: { action: 'noop' },
      triggerKind: 'manual',
      triggerConfig: {},
      maxRetries: 0,
      ...overrides,
    },
  })
  expect(res.status(), 'create task should succeed').toBe(201)
  const body = (await res.json()) as { task: { id: string; version: number } & Record<string, unknown> }
  return body.task as { id: string; version: number } & Record<string, unknown>
}
