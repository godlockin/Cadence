/**
 * @cadence/api — error mapping tests.
 *
 * Verifies that typed errors thrown from any layer (auth, storage,
 * sinker) bubble up to the correct HTTP status + envelope.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'
import { mapErrorToResponse } from '../src/errors.js'
import {
  ConflictError,
  NotFoundError,
  StaleVersionError,
} from '@cadence/storage'
import {
  InvalidCredentialsError,
  ForbiddenError,
  UnauthorizedError,
  ExpiredTokenError,
} from '@cadence/auth'
import { CommandInjectionError, ScriptSandboxError, SSRFError } from '@cadence/sinker'

describe('error mapping', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('InvalidCredentialsError → 401 invalid_credentials', () => {
    const out = mapErrorToResponse(new InvalidCredentialsError(), makeC())
    expect(out.status).toBe(401)
  })

  it('UnauthorizedError → 401', () => {
    const out = mapErrorToResponse(new UnauthorizedError(), makeC())
    expect(out.status).toBe(401)
  })

  it('ForbiddenError → 403', () => {
    const out = mapErrorToResponse(new ForbiddenError(), makeC())
    expect(out.status).toBe(403)
  })

  it('ExpiredTokenError → 401 expired_token', () => {
    const out = mapErrorToResponse(new ExpiredTokenError(), makeC())
    expect(out.status).toBe(401)
  })

  it('NotFoundError → 404', () => {
    const out = mapErrorToResponse(new NotFoundError('Task', 'x'), makeC())
    expect(out.status).toBe(404)
  })

  it('ConflictError → 409', () => {
    const out = mapErrorToResponse(new ConflictError('dup'), makeC())
    expect(out.status).toBe(409)
  })

  it('StaleVersionError → 409 with expected/actual', () => {
    const out = mapErrorToResponse(new StaleVersionError('Task', 1, 2), makeC())
    expect(out.status).toBe(409)
  })

  it('SSRFError → 422', () => {
    const out = mapErrorToResponse(new SSRFError('https://x', 'private'), makeC())
    expect(out.status).toBe(422)
  })

  it('CommandInjectionError → 422', () => {
    const out = mapErrorToResponse(new CommandInjectionError('command', 'metachar'), makeC())
    expect(out.status).toBe(422)
  })

  it('ScriptSandboxError → 422', () => {
    const out = mapErrorToResponse(new ScriptSandboxError('eval'), makeC())
    expect(out.status).toBe(422)
  })

  it('ZodError → 400 validation', async () => {
    /* POST /api/auth/register with bad body → 400 via global handler */
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      body: { email: 'not-an-email', password: 'short' },
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('validation')
  })

  it('unknown error → 500 internal', () => {
    const out = mapErrorToResponse(new Error('boom'), makeC())
    expect(out.status).toBe(500)
  })
})

/* Minimal stub Hono context — only json() is needed by mapErrorToResponse. */
function makeC(): {
  json: (v: unknown, s?: number) => Response
} {
  return {
    json: (v, s) =>
      new Response(JSON.stringify(v), {
        status: s ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  }
}