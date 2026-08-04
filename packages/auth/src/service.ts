/**
 * @cadence/auth — AuthService.
 *
 * The single entry point for credential-based auth. Owns:
 *  - login: verify password, mint access + refresh, audit success/fail
 *  - refresh: rotate (revoke old, mint new), audit
 *  - logout: revoke a single token, audit
 *  - logoutAllDevices: revoke every token, audit
 *
 * Refresh tokens are **rotated on every refresh** so a stolen token
 * becomes useless the moment the legitimate user re-authenticates.
 */
import { randomUUID } from 'node:crypto'
import type { AuditLog, Role, User, UserId } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import { ConflictError, NotFoundError } from '@cadence/storage'
import { InvalidCredentialsError, InvalidRefreshTokenError } from './errors.js'
import type { JwtSigner } from './jwt.js'
import { hashPassword, verifyPassword } from './password.js'
import {
  DEFAULT_REFRESH_TOKEN_TTL_MS,
  buildRefreshTokenRecord,
  generateRefreshToken,
  hashRefreshToken,
} from './refresh-token.js'

/** Re-export the public User type so callers don't need a second import. */
export type { User, UserId }

/** Structured logger shape (see ./logger.ts for default implementations). */
export type { Logger } from './logger.js'
import type { Logger } from './logger.js'

export interface AuthServiceDeps {
  storage: StorageAdapter
  jwt: JwtSigner
  logger?: Logger
  refreshTtlMs?: number
  now?: () => number
}

export interface LoginInput {
  email: string
  password: string
  userAgent?: string
  ip?: string
}

export interface RegisterInput {
  email: string
  password: string
  /** Human-friendly display name (1-120 chars). */
  displayName: string
  /** Default role for new users (typically 'viewer'). */
  role?: Role
  /** Bootstrap flag: first user becomes super_admin. Default false. */
  isSuperadmin?: boolean
  userAgent?: string
  ip?: string
}

export interface RegisterOutput {
  user: PublicUser
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface LoginOutput {
  user: PublicUser
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface PublicUser {
  id: UserId
  email: string
  displayName: string
  role: User['role']
  isActive: boolean
  isSuperadmin: boolean
  mustChangePassword: boolean
}

export interface RefreshOutput {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export function sanitizeUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    isSuperadmin: user.isSuperadmin,
    mustChangePassword: user.mustChangePassword,
  }
}

export class AuthService {
  private readonly storage: StorageAdapter
  private readonly jwt: JwtSigner
  private readonly logger: Logger | undefined
  private readonly refreshTtlMs: number
  private readonly now: () => number

  constructor(deps: AuthServiceDeps) {
    this.storage = deps.storage
    this.jwt = deps.jwt
    this.logger = deps.logger
    this.refreshTtlMs = deps.refreshTtlMs ?? DEFAULT_REFRESH_TOKEN_TTL_MS
    this.now = deps.now ?? (() => Date.now())
  }

  /* -------- helpers -------- */

  private buildAuditEntry(args: {
    action: AuditLog['action']
    actorId: UserId | null
    resourceKind: AuditLog['resourceKind']
    resourceId: string
    ip?: string
    userAgent?: string
  }): AuditLog {
    const metadata: Record<string, unknown> = {}
    if (args.ip !== undefined) metadata.ip = args.ip
    if (args.userAgent !== undefined) metadata.userAgent = args.userAgent
    return {
      id: randomUUID(),
      action: args.action,
      actorId: args.actorId,
      resourceKind: args.resourceKind,
      resourceId: args.resourceId,
      diffJson: '{}',
      metadataJson: JSON.stringify(metadata),
      createdAt: this.now(),
    }
  }

  private async writeAudit(entry: AuditLog): Promise<void> {
    try {
      await this.storage.appendAudit(entry)
    } catch (e: unknown) {
      this.logger?.error('audit append failed', { err: String(e) })
    }
  }

  /* -------- public API -------- */

  /**
   * Create a new user account + immediately mint tokens (signup-and-login
   * pattern). Throws `ConflictError` if the email is already taken.
   */
  async register(input: RegisterInput): Promise<RegisterOutput> {
    if (typeof input.email !== 'string' || input.email.length === 0) {
      throw new TypeError('register: email required')
    }
    if (typeof input.password !== 'string' || input.password.length < 8) {
      throw new TypeError('register: password must be at least 8 characters')
    }
    const existing = await this.storage.getUserByEmail(input.email)
    if (existing !== null) {
      throw new ConflictError(`Email already in use: ${input.email}`)
    }
    const now = this.now()
    const user: User = {
      id: randomUUID() as UserId,
      email: input.email,
      displayName: input.displayName,
      role: input.role ?? 'viewer',
      passwordHash: await hashPassword(input.password),
      isActive: true,
      isSuperadmin: input.isSuperadmin === true,
      mustChangePassword: input.isSuperadmin === true,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }
    await this.storage.saveUser(user)

    const access = await this.jwt.signAccessToken(user.id)
    const refresh = generateRefreshToken()
    await this.storage.createRefreshToken(
      buildRefreshTokenRecord({
        userId: user.id,
        token: refresh.token,
        hash: refresh.hash,
        id: refresh.id,
        ttlMs: this.refreshTtlMs,
        userAgent: input.userAgent,
        ip: input.ip,
        now,
      }),
    )
    await this.writeAudit(
      this.buildAuditEntry({
        action: 'user.create',
        actorId: user.id,
        resourceKind: 'user',
        resourceId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
      }),
    )
    await this.writeAudit(
      this.buildAuditEntry({
        action: 'auth.login_success',
        actorId: user.id,
        resourceKind: 'auth',
        resourceId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
      }),
    )
    return {
      user: sanitizeUser(user),
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.claims.exp - access.claims.iat,
    }
  }

  /**
   * Look up the user that owns the given access token. Used by `GET /me`.
   */
  async me(userId: UserId): Promise<PublicUser> {
    const user = await this.storage.getUser(userId)
    if (user === null) throw new NotFoundError('User', userId)
    return sanitizeUser(user)
  }

  async login(input: LoginInput): Promise<LoginOutput> {
    const user = await this.storage.getUserByEmail(input.email)
    if (user === null || !user.isActive) {
      // Constant-time-ish: still run a dummy hash to reduce timing oracles
      await verifyPassword(
        '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlzYWx0ZHVtbXlzYWx0$ZHVtbXk',
        input.password,
      ).catch(() => false)
      await this.writeAudit(
        this.buildAuditEntry({
          action: 'auth.login_failed',
          actorId: user?.id ?? null,
          resourceKind: 'auth',
          resourceId: input.email,
          ip: input.ip,
          userAgent: input.userAgent,
        }),
      )
      throw new InvalidCredentialsError()
    }

    const ok = await verifyPassword(user.passwordHash, input.password)
    if (!ok) {
      await this.writeAudit(
        this.buildAuditEntry({
          action: 'auth.login_failed',
          actorId: user.id,
          resourceKind: 'auth',
          resourceId: user.id,
          ip: input.ip,
          userAgent: input.userAgent,
        }),
      )
      throw new InvalidCredentialsError()
    }

    const access = await this.jwt.signAccessToken(user.id)
    const refresh = generateRefreshToken()
    await this.storage.createRefreshToken(
      buildRefreshTokenRecord({
        userId: user.id,
        token: refresh.token,
        hash: refresh.hash,
        id: refresh.id,
        ttlMs: this.refreshTtlMs,
        userAgent: input.userAgent,
        ip: input.ip,
        now: this.now(),
      }),
    )
    await this.writeAudit(
      this.buildAuditEntry({
        action: 'auth.login_success',
        actorId: user.id,
        resourceKind: 'auth',
        resourceId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
      }),
    )
    return {
      user: sanitizeUser(user),
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.claims.exp - access.claims.iat,
    }
  }

  async refresh(refreshToken: string): Promise<RefreshOutput> {
    const hash = hashRefreshToken(refreshToken)
    const stored = await this.storage.getRefreshToken(hash)
    if (stored === null) {
      throw new InvalidRefreshTokenError('Refresh token not found')
    }
    if (stored.expiresAt < this.now()) {
      await this.storage.revokeRefreshToken(hash)
      throw new InvalidRefreshTokenError('Refresh token expired')
    }

    // Rotate: revoke the consumed token, mint a new pair.
    await this.storage.revokeRefreshToken(hash)
    const access = await this.jwt.signAccessToken(stored.userId)
    const next = generateRefreshToken()
    await this.storage.createRefreshToken(
      buildRefreshTokenRecord({
        userId: stored.userId,
        token: next.token,
        hash: next.hash,
        id: next.id,
        ttlMs: this.refreshTtlMs,
        userAgent: stored.userAgent,
        ip: stored.ip,
        now: this.now(),
      }),
    )
    await this.writeAudit(
      this.buildAuditEntry({
        action: 'auth.refresh',
        actorId: stored.userId,
        resourceKind: 'auth',
        resourceId: next.id,
        ip: stored.ip,
        userAgent: stored.userAgent,
      }),
    )
    return {
      accessToken: access.token,
      refreshToken: next.token,
      expiresIn: access.claims.exp - access.claims.iat,
    }
  }

  async changePassword(
    userId: UserId,
    currentPassword: string,
    newPassword: string,
  ): Promise<PublicUser> {
    const user = await this.storage.getUser(userId)
    if (user === null) throw new NotFoundError('User', userId)
    const ok = await verifyPassword(user.passwordHash, currentPassword)
    if (!ok) throw new InvalidCredentialsError('Current password is incorrect')
    if (newPassword.length < 8) throw new TypeError('New password must be at least 8 characters')

    const updated: User = {
      ...user,
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      updatedAt: new Date(this.now()).toISOString(),
    }
    await this.storage.saveUser(updated) // overwrite by id
    return sanitizeUser(updated)
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = hashRefreshToken(refreshToken)
    const stored = await this.storage.getRefreshToken(hash)
    await this.storage.revokeRefreshToken(hash)
    await this.writeAudit(
      this.buildAuditEntry({
        action: 'auth.logout',
        actorId: stored?.userId ?? null,
        resourceKind: 'auth',
        resourceId: stored?.id ?? hash,
      }),
    )
  }

  async logoutAllDevices(userId: UserId): Promise<number> {
    const count = await this.storage.revokeAllUserTokens(userId)
    await this.writeAudit(
      this.buildAuditEntry({
        action: 'auth.logout_all',
        actorId: userId,
        resourceKind: 'auth',
        resourceId: userId,
      }),
    )
    return count
  }
}
