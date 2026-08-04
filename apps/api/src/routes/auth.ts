/**
 * @cadence/api — auth routes.
 *
 *   POST   /api/auth/register        — public, {email,password,displayName}
 *   POST   /api/auth/login           — public, {email,password}
 *   POST   /api/auth/refresh         — public, {refreshToken}
 *   POST   /api/auth/logout          — public, {refreshToken}
 *   POST   /api/auth/logout-all      — requireAuth
 *   GET    /api/auth/me              — requireAuth
 *
 * Security notes:
 *  - `POST /register` ignores any `role` field in the request body.
 *    The role is always `viewer` (legacy field) for normal signups.
 *  - If the system has zero users, the first registration is promoted
 *    to `isSuperadmin: true` so the operator can bootstrap.
 *  - Subsequent users must be created via `POST /api/users/invite`
 *    (admin only).
 *  - Already-authenticated users cannot re-register → 403.
 *
 * Errors come from the typed error hierarchy (InvalidCredentialsError,
 * InvalidRefreshTokenError, etc.) and the global error handler maps them
 * to HTTP status + JSON envelope.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthService, JwtSigner } from '@cadence/auth'
import { ForbiddenError, requireAuth } from '@cadence/auth'
import type { StorageAdapter } from '@cadence/storage'
import type { AppEnv } from '../app.js'
import { writeAudit } from '../app.js'

/**
 * Strict schema: rejects any extra fields (incl. `role`) so privilege
 * escalation via the public endpoint is impossible.
 */
const RegisterBody = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).max(200),
    displayName: z.string().min(1).max(120),
  })
  .strict()
const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
})
const RefreshBody = z.object({
  refreshToken: z.string().min(1),
})
const LogoutBody = z.object({
  refreshToken: z.string().min(1),
})
const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})

export interface MountAuthDeps {
  readonly storage: StorageAdapter
  readonly auth: AuthService
  readonly jwt: JwtSigner
}

export function mountAuthRoutes(deps: MountAuthDeps): Hono<AppEnv> {
  const { storage, auth, jwt } = deps
  const r = new Hono<AppEnv>()

  /* POST /register */
  r.post('/register', async (c) => {
    /* If the caller is already authenticated, refuse — they should use
     * /api/users/invite (admin only) to add new users. */
    const header = c.req.header('authorization')
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      throw new ForbiddenError('Already authenticated; cannot register a new account')
    }
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = RegisterBody.parse(raw)
    const ip = c.req.header('x-forwarded-for') ?? undefined
    const userAgent = c.req.header('user-agent') ?? undefined
    /* Bootstrap: first-ever user becomes super_admin so the operator can
     * manage the install. All other registrations get role=viewer. */
    const existing = await storage.listUsers()
    const isFirstUser = existing.length === 0
    const out = await auth.register({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      role: 'viewer',
      isSuperadmin: isFirstUser,
      ip,
      userAgent,
    })
    await writeAudit(storage, {
      action: 'user.create',
      actorId: out.user.id,
      resourceKind: 'user',
      resourceId: out.user.id,
      metadata: {
        via: 'register',
        bootstrap: isFirstUser,
        ip: ip ?? '',
        userAgent: userAgent ?? '',
      },
    })
    return c.json(out, 201)
  })

  /* POST /login */
  r.post('/login', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = LoginBody.parse(raw)
    const ip = c.req.header('x-forwarded-for') ?? undefined
    const userAgent = c.req.header('user-agent') ?? undefined
    const out = await auth.login({ email: body.email, password: body.password, ip, userAgent })
    return c.json(out)
  })

  /* POST /refresh */
  r.post('/refresh', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = RefreshBody.parse(raw)
    const out = await auth.refresh(body.refreshToken)
    return c.json(out)
  })

  /* POST /logout (single token) */
  r.post('/logout', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = LogoutBody.parse(raw)
    await auth.logout(body.refreshToken)
    return c.json({ ok: true })
  })

  /* POST /logout-all — requireAuth */
  r.post('/logout-all', requireAuth(jwt, storage), async (c) => {
    const user = c.get('user')
    const count = await auth.logoutAllDevices(user.id)
    return c.json({ revoked: count })
  })

  /* GET /me — requireAuth */
  r.get('/me', requireAuth(jwt, storage), async (c) => {
    const user = c.get('user')
    const me = await auth.me(user.id)
    return c.json(me)
  })

  /* POST /change-password — requireAuth */
  r.post('/change-password', requireAuth(jwt, storage), async (c) => {
    const user = c.get('user')
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = ChangePasswordBody.parse(raw)
    const updated = await auth.changePassword!(user.id, body.currentPassword, body.newPassword)
    return c.json(updated)
  })

  return r
}
