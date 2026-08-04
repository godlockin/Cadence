/**
 * @cadence/sinker — typed security errors.
 *
 * Every handler that rejects a payload for safety reasons throws one of
 * these. Callers (worker loop) translate them into a 4xx dispatch event
 * with the original `code` and never expose raw stack traces to the
 * execution audit log.
 */
import type { PayloadKind } from '@cadence/domain'

/* HTTP-style status codes surfaced through the dispatch event bus. */
export const SECURITY_ERROR_CODES = {
  FORBIDDEN: 403,
  SSRF_BLOCKED: 421, // misdirected request — host blacklisted
  COMMAND_INJECTION: 422, // unprocessable payload (semantic)
  SCRIPT_SANDBOX: 422,
  PAYLOAD_INVALID: 400,
  EXECUTION_TIMEOUT: 408,
  EXECUTION_FAILED: 500,
} as const

export class ForbiddenError extends Error {
  public readonly code: number = SECURITY_ERROR_CODES.FORBIDDEN
  constructor(
    public readonly userId: string,
    public readonly resourceId: string,
    message?: string,
  ) {
    super(message ?? `User ${userId} is not authorised to operate on ${resourceId}`)
    this.name = 'ForbiddenError'
  }
}

export class SSRFError extends Error {
  public readonly code: number = SECURITY_ERROR_CODES.SSRF_BLOCKED
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`SSRF blocked: ${reason} (${url})`)
    this.name = 'SSRFError'
  }
}

export class CommandInjectionError extends Error {
  public readonly code: number = SECURITY_ERROR_CODES.COMMAND_INJECTION
  constructor(
    public readonly payloadKind: PayloadKind,
    public readonly reason: string,
  ) {
    super(`Command rejected: ${reason}`)
    this.name = 'CommandInjectionError'
  }
}

export class ScriptSandboxError extends Error {
  public readonly code: number = SECURITY_ERROR_CODES.SCRIPT_SANDBOX
  constructor(public readonly reason: string) {
    super(`Script sandbox rejected: ${reason}`)
    this.name = 'ScriptSandboxError'
  }
}
