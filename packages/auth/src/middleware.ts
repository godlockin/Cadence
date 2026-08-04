/**
 * @cadence/auth — Hono middleware.
 *
 * Two middlewares:
 *  - `requireAuth`: parses Bearer token, verifies, looks up user,
 *    stuffs `user` + `userId` + `claims` into the context.
 *  - `requirePermission`: runs `assertCan` after `requireAuth`.
 *
 * Designed for Hono v4 (the version pinned in apps/api). The context
 * variable helpers (`c.set` / `c.get`) are typed via module
 * augmentation in `types.ts`.
 */
import type { Context, MiddlewareHandler } from 'hono'
import type { GroupId, PermissionAction, User, UserId } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import {
  AuthError,
  ExpiredTokenError,
  ForbiddenError,
  InvalidTokenError,
  UnauthorizedError,
} from './errors.js'
import type { AccessTokenClaims, JwtSigner } from './jwt.js'
import { assertCan, type CanContext, type CanResource } from './can.js'

export interface AuthContextVariables {
  user?: User
  userId?: UserId
  claims?: AccessTokenClaims
  storage?: StorageAdapter
}

export function requireAuth(
  jwt: JwtSigner,
  storage: StorageAdapter,
): MiddlewareHandler<{ Variables: AuthContextVariables }> {
  return async (c, next) => {
    const header = c.req.header('authorization')
    if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedError('Missing bearer token')
    }
    const token = header.slice(7).trim()
    if (token.length === 0) {
      throw new UnauthorizedError('Empty bearer token')
    }
    const claims = await jwt.verifyAccessToken(token)
    const user = await storage.getUser(claims.sub)
    if (user === null || !user.isActive) {
      throw new UnauthorizedError('User not found or inactive')
    }
    c.set('user', user)
    c.set('userId', user.id)
    c.set('claims', claims)
    c.set('storage', storage)
    await next()
  }
}

export type ResourceResolver = (
  c: Context,
) => Promise<CanResource | undefined> | CanResource | undefined

export function requirePermission(
  action: PermissionAction,
  resolveResource?: ResourceResolver,
  storageFallback?: StorageAdapter,
): MiddlewareHandler<{ Variables: AuthContextVariables }> {
  return async (c, next) => {
    const user = c.get('user')
    if (user === undefined) {
      throw new UnauthorizedError('requirePermission used without requireAuth')
    }
    const storage = c.get('storage') ?? storageFallback
    if (storage === undefined) {
      throw new Error('requirePermission: storage is not available on context')
    }
    const resource = resolveResource ? await resolveResource(c) : undefined
    const ctx: CanContext = { user, storage }
    try {
      await assertCan(ctx, action, resource)
    } catch (e: unknown) {
      if (e instanceof ForbiddenError) throw e
      throw e
    }
    await next()
  }
}

export function onAuthError(err: unknown, c: Context): Response {
  if (err instanceof AuthError) {
    const status: 401 | 403 = err instanceof ForbiddenError ? 403 : 401
    return c.json({ code: err.code, message: err.message }, status)
  }
  throw err
}

export function isAuthErrorForStatus(err: unknown): err is AuthError {
  return err instanceof AuthError
}

export { InvalidTokenError, ExpiredTokenError }

export type RequireAuth = ReturnType<typeof requireAuth>
export type RequirePermission = ReturnType<typeof requirePermission>

/* ---- re-export for callers ---- */

export { ForbiddenError, UnauthorizedError } from './errors.js'
export type { CanContext, CanResource }
export type { PermissionAction }

// Re-export the GroupId type so tests can type their resources
export type { GroupId, User, UserId }
