/**
 * @cadence/api — shared test helpers.
 *
 * `buildTestApp()` wires a real Hono app backed by InMemoryStorageAdapter
 * + a deterministic JwtSigner. `setUserRole()` lets tests grant
 * built-in RBAC roles without a real roles table.
 */
import { Hono } from 'hono'
import {
  AuthService,
  createJwtSigner,
  BUILTIN_ROLE_PERMISSIONS,
  type ResolvedUserRole,
} from '@cadence/auth'
import { InMemoryStorageAdapter } from '@cadence/storage'
import type { StorageAdapter } from '@cadence/storage'
import type { UserId } from '@cadence/domain'
import { createApp, type AppEnv, type CreateAppDeps } from '../src/index.js'

export const TEST_JWT_SECRET = 'test-secret-please-do-not-use-in-prod-32b'
export const TEST_ENCRYPTION_KEY = new Uint8Array(32) // 32 zero bytes

export interface TestApp {
  app: Hono<AppEnv>
  storage: InMemoryStorageAdapter
  auth: AuthService
  jwt: ReturnType<typeof createJwtSigner>
  deps: CreateAppDeps
  /** Convenience: attach a built-in role to a user for RBAC tests. */
  setUserRole(userId: UserId, role: keyof typeof BUILTIN_ROLE_PERMISSIONS): void
  /** Build an Authorization header value for a user. */
  async authHeader(userId: UserId): Promise<string>
  /** Register a user and return { user, tokens }. */
  registerUser(opts: { email?: string; password?: string; displayName?: string; role?: 'owner' | 'admin' | 'editor' | 'viewer' }): Promise<{
    user: { id: UserId; email: string }
    tokens: { accessToken: string; refreshToken: string }
  }>
}

export function buildTestApp(): TestApp {
  const storage = new InMemoryStorageAdapter()
  const jwt = createJwtSigner(TEST_JWT_SECRET)
  const auth = new AuthService({ storage, jwt })
  const deps: CreateAppDeps = { storage, auth, jwt, encryptionKey: TEST_ENCRYPTION_KEY }
  const app = createApp(deps)

  function setUserRole(userId: UserId, role: keyof typeof BUILTIN_ROLE_PERMISSIONS): void {
    const resolved: ResolvedUserRole = BUILTIN_ROLE_PERMISSIONS[role]
    storage.setUserRole(userId, resolved)
  }

  async function authHeader(userId: UserId): Promise<string> {
    const { token } = await jwt.signAccessToken(userId)
    return `Bearer ${token}`
  }

  async function registerUser(opts: {
    email?: string
    password?: string
    displayName?: string
    role?: 'owner' | 'admin' | 'editor' | 'viewer'
  } = {}): Promise<{
    user: { id: UserId; email: string }
    tokens: { accessToken: string; refreshToken: string }
  }> {
    const email = opts.email ?? `u${Math.random().toString(36).slice(2, 8)}@example.com`
    const password = opts.password ?? 'super-secret-password'
    const displayName = opts.displayName ?? 'Test User'
    const role = opts.role ?? 'viewer'
    const out = await auth.register({ email, password, displayName, role })
    return {
      user: { id: out.user.id, email: out.user.email },
      tokens: { accessToken: out.accessToken, refreshToken: out.refreshToken },
    }
  }

  return { app, storage, auth, jwt, deps, setUserRole, authHeader, registerUser }
}

/** Issue a request to the Hono app. Mirrors what `app.fetch` does. */
export async function callApp(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const url = `http://test.local${path}`
  const req = new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  return app.fetch(req)
}

export type { StorageAdapter }