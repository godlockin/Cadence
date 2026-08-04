/**
 * @cadence/api — Hono app skeleton.
 *
 * `createApp(env)` wires together auth, storage, and sinker into a
 * single Hono instance. Two runtimes consume it:
 *  - Cloudflare Workers (`worker.ts`) — `env` = Workers env (DB binding + secrets)
 *  - Node.js          (`node.ts`)    — `env` = process.env derived object
 *
 * The runtime-agnostic shape (`AppEnv`) keeps the same routes usable on
 * both targets. Only `adapters/cloudflare.ts` and `adapters/node.ts`
 * know how to map `env` → real driver.
 */
import { Hono } from 'hono'
import type { AuditAction, User, UserId } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import type { PermissionAction } from '@cadence/domain'
import type { JwtSigner } from '@cadence/auth'
import type { AuthService } from '@cadence/auth'
import type { CanResource } from '@cadence/auth'
import type { CredentialRefresher } from '@cadence/auth'
import type { SchedulerHandle } from '@cadence/scheduler'
import { mountAuthRoutes } from './routes/auth.js'
import { mountAdminRoutes } from './routes/admin.js'
import { mountTaskRoutes } from './routes/tasks.js'
import { mountCredentialRoutes } from './routes/credentials.js'
import { mountAuditRoutes } from './routes/audit.js'
import { mountWebhookRoutes } from './routes/webhooks.js'
import { mountSchedulerRoutes } from './routes/scheduler.js'
import { mapErrorToResponse } from './errors.js'
import { healthCheck } from './health.js'

export interface AppVariables {
  user: User
  userId: UserId
  storage: StorageAdapter
  auth: AuthService
  jwt: JwtSigner
  /** Optional resource resolver for the current request (set by RBAC middleware). */
  resource?: CanResource
  /** Optional scheduler handle for the /api/health endpoint. */
  scheduler?: SchedulerHandle
}

export interface AppBindings {
  /* bindings are environment-specific; minimal cloudflare-friendly shape */
  JWT_SECRET?: string
  ENCRYPTION_KEY?: string
  NODE_ENV?: string
}

export type AppEnv = {
  Variables: AppVariables
  Bindings: AppBindings
}

/* Re-export the audit writer (defined in its own module to break
 * the app.ts ↔ errors.ts import cycle). */
export { writeAudit, type AuditWriteInput } from './audit.js'

export interface CreateAppDeps {
  readonly storage: StorageAdapter
  readonly auth: AuthService
  readonly jwt: JwtSigner
  /** AES-256-GCM key (32 bytes) for credential encryption. */
  readonly encryptionKey: Uint8Array
  /** Optional scheduler handle — surfaces in /api/health. */
  readonly scheduler?: SchedulerHandle
  /** Optional PHASE 6 credential refresher — wires real refresh/rotate. */
  readonly credentialRefresher?: CredentialRefresher
}

export function createApp(deps: CreateAppDeps): Hono<AppEnv> {
  const { storage, auth, jwt, encryptionKey, scheduler, credentialRefresher } = deps

  const app = new Hono<AppEnv>()

  /* ----- Healthcheck (enhanced if scheduler present) ----- */

  app.get('/health', async (c) => {
    if (scheduler !== undefined) {
      return c.json(await healthCheck(storage, scheduler))
    }
    return c.json({
      ok: true,
      ts: Date.now(),
      db: true,
      uptime: process.uptime(),
      version: '0.4.0',
    })
  })

  app.get('/api/health', async (c) => {
    if (scheduler !== undefined) {
      return c.json(await healthCheck(storage, scheduler))
    }
    return c.json({
      status: 'ok',
      db: true,
      scheduler: {
        running: false,
        cron: false,
        webhookRegistrations: 0,
        webhookCacheSize: 0,
        uptimeSeconds: 0,
      },
      uptime: process.uptime(),
      version: '0.4.0',
      ts: Date.now(),
    })
  })

  /* ----- Routes (mounted as sub-apps; each injects middleware) ----- */

  app.route('/api/auth', mountAuthRoutes({ storage, auth, jwt }))
  app.route('/api/users', mountAdminRoutes.users({ storage, jwt }))
  app.route('/api/groups', mountAdminRoutes.groups({ storage, jwt }))
  app.route('/api/roles', mountAdminRoutes.roles({ storage, jwt }))
  app.route('/api/tasks', mountTaskRoutes.tasks({ storage, jwt }))
  app.route('/api/executions', mountTaskRoutes.executions({ storage, jwt }))
  app.route(
    '/api/credentials',
    mountCredentialRoutes({ storage, jwt, encryptionKey, refresher: credentialRefresher }),
  )
  app.route('/api/audit', mountAuditRoutes({ storage, jwt }))
  app.route('/api/webhooks', mountWebhookRoutes({ storage }))
  app.route('/api/scheduler', mountSchedulerRoutes({ scheduler }))

  /* ----- 404 ----- */

  app.notFound((c) => c.json({ error: 'not_found' }, 404))

  /* ----- Global error handler ----- */

  app.onError((err, c) => mapErrorToResponse(err, c))

  return app
}

/* re-export the most common things for tests / entry points */

export type { AuditAction, PermissionAction }
