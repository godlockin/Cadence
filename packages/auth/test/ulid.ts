/**
 * Tiny ULID generator for tests. Matches the format used by the `ulid` package:
 * 26 Crockford base32 chars (timestamp 10 + randomness 16).
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

export function ulid(): string {
  return encodeTime(Date.now(), 10) + encodeRandom(16)
}
