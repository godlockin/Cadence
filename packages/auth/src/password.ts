/**
 * @cadence/auth — Argon2id password hashing.
 *
 * Parameters follow OWASP 2024 guidance:
 *  - argon2id hybrid
 *  - memoryCost 64 MiB
 *  - timeCost 3
 *  - parallelism 4
 *
 * Verification is wrapped in try/catch so malformed hashes / library
 * errors resolve to `false` rather than throwing — this keeps auth flows
 * single-path.
 */
import argon2 from 'argon2'

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
}

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new TypeError('hashPassword: plain must be a non-empty string')
  }
  return argon2.hash(plain, ARGON2_OPTIONS)
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (typeof hash !== 'string' || typeof plain !== 'string') return false
  if (hash.length === 0 || plain.length === 0) return false
  try {
    return await argon2.verify(hash, plain)
  } catch {
    return false
  }
}

export const ARGON2_PARAMS = {
  algorithm: 'argon2id',
  memoryCost: ARGON2_OPTIONS.memoryCost,
  timeCost: ARGON2_OPTIONS.timeCost,
  parallelism: ARGON2_OPTIONS.parallelism,
} as const
