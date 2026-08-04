/**
 * @cadence/auth — password hashing tests.
 *
 * Covers:
 *  - round-trip: hash + verify same password
 *  - wrong password returns false
 *  - malformed hash returns false (no throw)
 *  - empty inputs are rejected
 *  - performance baseline (single hash < 1500ms — argon2id @ 64MiB)
 *  - hash format (argon2id, $argon2id$v=19$m=65536,t=3,p=4$...)
 */
import { describe, it, expect } from 'vitest'
import { ARGON2_PARAMS, hashPassword, verifyPassword } from '../src/password.js'

describe('password', () => {
  it('hashes and verifies the same password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/)
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true)
  })

  it('rejects a different password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false)
  })

  it('verify is case-sensitive', async () => {
    const hash = await hashPassword('P@ssw0rd')
    expect(await verifyPassword(hash, 'p@ssw0rd')).toBe(false)
  })

  it('returns false for a malformed hash (no throw)', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false)
    expect(await verifyPassword('', 'whatever')).toBe(false)
  })

  it('returns false for empty plain (no throw)', async () => {
    const hash = await hashPassword('whatever')
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('rejects empty plain on hash', async () => {
    await expect(hashPassword('')).rejects.toThrow(TypeError)
  })

  it('hashes the same password to different values (salted)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })

  it('hash carries the configured argon2id parameters', () => {
    expect(ARGON2_PARAMS.algorithm).toBe('argon2id')
    expect(ARGON2_PARAMS.memoryCost).toBe(65536)
    expect(ARGON2_PARAMS.timeCost).toBe(3)
    expect(ARGON2_PARAMS.parallelism).toBe(4)
  })

  it('meets the 1.5s baseline on a single hash (64 MiB argon2id)', async () => {
    const t0 = Date.now()
    await hashPassword('benchmark-password')
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(1500)
  })

  it('produces 22+ char base64-ish hashes', async () => {
    const hash = await hashPassword('short')
    expect(hash.length).toBeGreaterThanOrEqual(60)
  })
})
