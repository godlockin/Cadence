/**
 * @cadence/auth — typed error hierarchy.
 *
 * Every error carries a `code` (machine-readable) and a `status` (HTTP)
 * so middleware and tests can match without string sniffing.
 */

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'invalid_refresh_token'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_token'
  | 'expired_token'
  | 'inactive_user'
  | 'credential_refresh_failed'
  | 'credential_disabled'
  | 'credential_not_refreshable'

export abstract class AuthError extends Error {
  public abstract readonly code: AuthErrorCode
  public abstract readonly status: number
  public override readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = new.target.name
    this.cause = cause
  }
}

export class InvalidCredentialsError extends AuthError {
  public readonly code = 'invalid_credentials' as const
  public readonly status = 401 as const
  constructor(message = 'Invalid credentials') {
    super(message)
  }
}

export class InvalidRefreshTokenError extends AuthError {
  public readonly code = 'invalid_refresh_token' as const
  public readonly status = 401 as const
  constructor(message = 'Invalid or expired refresh token') {
    super(message)
  }
}

export class UnauthorizedError extends AuthError {
  public readonly code = 'unauthorized' as const
  public readonly status = 401 as const
  constructor(message = 'Unauthorized') {
    super(message)
  }
}

export class ForbiddenError extends AuthError {
  public readonly code = 'forbidden' as const
  public readonly status = 403 as const
  constructor(message = 'Forbidden') {
    super(message)
  }
}

export class InvalidTokenError extends AuthError {
  public readonly code = 'invalid_token' as const
  public readonly status = 401 as const
  constructor(message = 'Invalid token', cause?: unknown) {
    super(message, cause)
  }
}

export class ExpiredTokenError extends AuthError {
  public readonly code = 'expired_token' as const
  public readonly status = 401 as const
  constructor(message = 'Token expired', cause?: unknown) {
    super(message, cause)
  }
}

export class InactiveUserError extends AuthError {
  public readonly code = 'inactive_user' as const
  public readonly status = 401 as const
  constructor(message = 'User is inactive') {
    super(message)
  }
}

export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError
}

/* -------------------------------------------------------------------------
 * Credential refresh errors (PHASE 6)
 * ------------------------------------------------------------------------- */

export class CredentialRefreshError extends AuthError {
  public readonly code = 'credential_refresh_failed' as const
  public readonly status = 502 as const
  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class CredentialDisabledError extends AuthError {
  public readonly code = 'credential_disabled' as const
  public readonly status = 423 as const
  constructor(message = 'Credential is disabled after repeated refresh failures') {
    super(message)
  }
}

export class CredentialNotRefreshableError extends AuthError {
  public readonly code = 'credential_not_refreshable' as const
  public readonly status = 400 as const
  constructor(message = 'Credential is not refreshable') {
    super(message)
  }
}
