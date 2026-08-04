/**
 * @cadence/api — typed error mapping.
 *
 * Every storage/auth/sinker typed error gets translated to a single
 * JSON envelope. The route layer never hardcodes HTTP codes — it lets
 * the error handler do it via the global app.onError hook.
 *
 * 403 events are also recorded in the audit log (best-effort, never
 * blocks the response) so security teams can see IDOR / privilege
 * escalation attempts.
 */
import type { Context } from 'hono'
import { ZodError } from 'zod'
import {
  CommandInjectionError,
  ForbiddenError,
  ScriptSandboxError,
  SSRFError,
} from '@cadence/sinker'
import { ConflictError, NotFoundError, StaleVersionError } from '@cadence/storage'
import {
  ExpiredTokenError,
  ForbiddenError as AuthForbiddenError,
  CredentialDisabledError,
  CredentialNotRefreshableError,
  CredentialRefreshError,
  InactiveUserError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidTokenError,
  SSRFError as AuthSSRFError,
  UnauthorizedError,
} from '@cadence/auth'
import { writeAudit } from './audit.js'
import type { AppEnv } from './app.js'

export interface ErrorEnvelope {
  readonly error: string
  readonly code?: string
  readonly details?: unknown
  readonly message?: string
  readonly expected?: number
  readonly actual?: number
  readonly resource?: string
  readonly reason?: string
  readonly url?: string
}

/** Best-effort audit of a 403 (forbidden) response. Never throws. */
function recordForbidden(c: Context<AppEnv>, reason: string): void {
  try {
    const user = c.get('user')
    const storage = c.get('storage')
    if (storage === undefined) return
    void writeAudit(storage, {
      action: 'auth.forbidden',
      actorId: user?.id ?? null,
      resourceKind: 'auth',
      resourceId: c.req.path,
      metadata: {
        method: c.req.method,
        reason,
      },
    }).catch(() => {
      /* never let audit failure break the response */
    })
  } catch {
    /* swallow */
  }
}

export function mapErrorToResponse(err: unknown, c: Context<AppEnv>): Response {
  /* ----- typed errors ----- */

  if (err instanceof InvalidCredentialsError) {
    return c.json({ error: 'invalid_credentials', code: err.code } satisfies ErrorEnvelope, 401)
  }
  if (err instanceof InvalidRefreshTokenError) {
    return c.json({ error: 'invalid_refresh_token', code: err.code } satisfies ErrorEnvelope, 401)
  }
  if (err instanceof ExpiredTokenError) {
    return c.json({ error: 'expired_token', code: err.code } satisfies ErrorEnvelope, 401)
  }
  if (err instanceof InvalidTokenError) {
    return c.json({ error: 'invalid_token', code: err.code } satisfies ErrorEnvelope, 401)
  }
  if (err instanceof InactiveUserError) {
    return c.json({ error: 'inactive_user', code: err.code } satisfies ErrorEnvelope, 401)
  }
  if (err instanceof UnauthorizedError) {
    return c.json({ error: 'unauthorized', code: err.code } satisfies ErrorEnvelope, 401)
  }
  if (err instanceof CredentialRefreshError) {
    return c.json(
      { error: 'credential_refresh_failed', code: err.code } satisfies ErrorEnvelope,
      502,
    )
  }
  if (err instanceof CredentialDisabledError) {
    return c.json({ error: 'credential_disabled', code: err.code } satisfies ErrorEnvelope, 423)
  }
  if (err instanceof CredentialNotRefreshableError) {
    return c.json(
      { error: 'credential_not_refreshable', code: err.code } satisfies ErrorEnvelope,
      400,
    )
  }
  /* sinker's ForbiddenError takes precedence (HTTP-style status code) but
   * auth's ForbiddenError wins on `code`. Match auth first since the
   * middleware throws the auth variant. */
  if (err instanceof AuthForbiddenError) {
    recordForbidden(c, err.message)
    return c.json({ error: 'forbidden', code: err.code } satisfies ErrorEnvelope, 403)
  }
  if (err instanceof ForbiddenError) {
    recordForbidden(c, err.message)
    return c.json({ error: 'forbidden', code: 'forbidden' } satisfies ErrorEnvelope, 403)
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: 'not_found', resource: err.resource } satisfies ErrorEnvelope, 404)
  }
  if (err instanceof StaleVersionError) {
    return c.json(
      {
        error: 'stale_version',
        expected: err.expected,
        actual: err.actual,
      } satisfies ErrorEnvelope,
      409,
    )
  }
  if (err instanceof ConflictError) {
    return c.json({ error: 'conflict', message: err.message } satisfies ErrorEnvelope, 409)
  }
  if (err instanceof SSRFError) {
    return c.json(
      { error: 'ssrf_blocked', reason: err.reason, url: err.url } satisfies ErrorEnvelope,
      422,
    )
  }
  if (err instanceof AuthSSRFError) {
    return c.json(
      { error: 'ssrf_blocked', reason: err.reason, url: err.url } satisfies ErrorEnvelope,
      422,
    )
  }
  if (err instanceof CommandInjectionError) {
    return c.json({ error: 'command_blocked', reason: err.reason } satisfies ErrorEnvelope, 422)
  }
  if (err instanceof ScriptSandboxError) {
    return c.json({ error: 'script_blocked', reason: err.reason } satisfies ErrorEnvelope, 422)
  }
  if (err instanceof ZodError) {
    return c.json({ error: 'validation', details: err.errors } satisfies ErrorEnvelope, 400)
  }

  /* ----- unknown ----- */
  if (err instanceof Error) {
    console.error('[pulsedeck/api] unhandled error:', err.message, err.stack)
  } else {
    console.error('[pulsedeck/api] unhandled non-Error throwable:', err)
  }
  return c.json({ error: 'internal' } satisfies ErrorEnvelope, 500)
}

export const __testing = {
  mapErrorToResponse,
  recordForbidden,
}
