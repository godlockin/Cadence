/**
 * Crockford base32 ULID generator — minimal implementation for tests.
 * Matches the regex `/^[0-9A-HJKMNP-TV-Z]{26}$/` from `@cadence/domain`.
 *
 * Format: 10 chars timestamp (ms) + 16 chars randomness = 26 chars.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeTime(now: number, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % 32
    out = ALPHABET[mod] + out
    now = (now - mod) / 32
  }
  return out
}

function encodeRandom(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * 32)]
  }
  return out
}

export function ulid(seed?: number): string {
  const ts = seed ?? Date.now()
  return encodeTime(ts, 10) + encodeRandom(16)
}