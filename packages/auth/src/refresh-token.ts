/**
 * @cadence/auth — Refresh token generation + hashing.
 *
 * The cleartext token never touches the database. We store only its
 * SHA-256 hash, so a DB leak does not yield replayable tokens.
 *
 * Format: `<ulid>.<uuid>` — ULID is the public id (jti) and the
 * uuid provides the secret entropy.
 */
import { createHash, randomUUID } from 'node:crypto'
import { ulid } from 'ulid'
import type { UserId } from '@cadence/domain'
import type { RefreshToken } from '@cadence/storage'

const SEP = '.'

export function generateRefreshToken(): { token: string; hash: string; id: string } {
  const id = ulid()
  const secret = randomUUID()
  const token = `${id}${SEP}${secret}`
  const hash = sha256(token)
  return { token, hash, id }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function hashRefreshToken(token: string): string {
  return sha256(token)
}

export const REFRESH_TOKEN_SEPARATOR = SEP

export function buildRefreshTokenRecord(args: {
  userId: UserId
  token: string
  hash: string
  id: string
  ttlMs: number
  userAgent?: string
  ip?: string
  now?: number
}): RefreshToken {
  const now = args.now ?? Date.now()
  return {
    id: args.id,
    userId: args.userId,
    tokenHash: args.hash,
    userAgent: args.userAgent,
    ip: args.ip,
    createdAt: now,
    expiresAt: now + args.ttlMs,
  }
}

export const DEFAULT_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
