/**
 * @cadence/auth — refresh token generation + sha256 + storage roundtrip.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import {
  buildRefreshTokenRecord,
  DEFAULT_REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_SEPARATOR,
  sha256,
} from '../src/index.js'
import { ulid as makeUlid } from './ulid.js'
import type { UserId } from '@cadence/domain'

function makeUserId(): UserId {
  return makeUlid() as unknown as UserId
}

describe('refresh-token', () => {
  it('generates a token of the form <ulid>.<uuid>', () => {
    const { token, hash, id } = generateRefreshToken()
    expect(token).toContain(REFRESH_TOKEN_SEPARATOR)
    const [prefix, suffix] = token.split(REFRESH_TOKEN_SEPARATOR)
    expect(prefix!.length).toBe(26)
    expect(suffix!.length).toBeGreaterThanOrEqual(36)
    expect(id).toBe(prefix)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a unique token each call', () => {
    const a = generateRefreshToken()
    const b = generateRefreshToken()
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(b.hash)
  })

  it('sha256 returns deterministic hex', () => {
    expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('hashRefreshToken matches sha256(token)', () => {
    const { token, hash } = generateRefreshToken()
    expect(hashRefreshToken(token)).toBe(hash)
  })

  it('builds a record with sane expiry', () => {
    const userId = makeUserId()
    const { token, hash, id } = generateRefreshToken()
    const rec = buildRefreshTokenRecord({ userId, token, hash, id, ttlMs: 1000 })
    expect(rec.expiresAt - rec.createdAt).toBe(1000)
  })

  it('default TTL is 7 days', () => {
    expect(DEFAULT_REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  describe('with InMemoryStorageAdapter', () => {
    let storage: InMemoryStorageAdapter
    beforeEach(() => {
      storage = new InMemoryStorageAdapter()
    })

    it('create + get roundtrips', async () => {
      const userId = makeUserId()
      const { token, hash, id } = generateRefreshToken()
      await storage.createRefreshToken(
        buildRefreshTokenRecord({ userId, token, hash, id, ttlMs: 1000 }),
      )
      const got = await storage.getRefreshToken(hash)
      expect(got).not.toBeNull()
      expect(got!.userId).toBe(userId)
      expect(got!.tokenHash).toBe(hash)
    })

    it('getRefreshToken returns null on miss', async () => {
      expect(await storage.getRefreshToken('nope')).toBeNull()
    })

    it('create throws ConflictError on duplicate hash', async () => {
      const userId = makeUserId()
      const { token, hash, id } = generateRefreshToken()
      await storage.createRefreshToken(
        buildRefreshTokenRecord({ userId, token, hash, id, ttlMs: 1000 }),
      )
      await expect(
        storage.createRefreshToken(
          buildRefreshTokenRecord({ userId, token: 'different.token', hash, id: 'dup', ttlMs: 1000 }),
        ),
      ).rejects.toThrow(/already exists/)
    })

    it('revoke deletes the row', async () => {
      const userId = makeUserId()
      const { token, hash, id } = generateRefreshToken()
      await storage.createRefreshToken(
        buildRefreshTokenRecord({ userId, token, hash, id, ttlMs: 1000 }),
      )
      await storage.revokeRefreshToken(hash)
      expect(await storage.getRefreshToken(hash)).toBeNull()
    })

    it('listUserRefreshTokens returns only the user\'s tokens', async () => {
      const a = makeUserId()
      const b = makeUserId()
      for (let i = 0; i < 3; i++) {
        const t = generateRefreshToken()
        await storage.createRefreshToken(
          buildRefreshTokenRecord({ userId: a, token: t.token, hash: t.hash, id: t.id, ttlMs: 1000 }),
        )
      }
      const t = generateRefreshToken()
      await storage.createRefreshToken(
        buildRefreshTokenRecord({ userId: b, token: t.token, hash: t.hash, id: t.id, ttlMs: 1000 }),
      )
      const list = await storage.listUserRefreshTokens(a)
      expect(list.length).toBe(3)
      expect(list.every((r) => r.userId === a)).toBe(true)
    })

    it('revokeAllUserTokens returns the count', async () => {
      const userId = makeUserId()
      for (let i = 0; i < 5; i++) {
        const t = generateRefreshToken()
        await storage.createRefreshToken(
          buildRefreshTokenRecord({ userId, token: t.token, hash: t.hash, id: t.id, ttlMs: 1000 }),
        )
      }
      const removed = await storage.revokeAllUserTokens(userId)
      expect(removed).toBe(5)
      expect((await storage.listUserRefreshTokens(userId)).length).toBe(0)
    })

    it('revokeAllUserTokens only touches the requested user', async () => {
      const a = makeUserId()
      const b = makeUserId()
      for (let i = 0; i < 2; i++) {
        const t = generateRefreshToken()
        await storage.createRefreshToken(
          buildRefreshTokenRecord({ userId: a, token: t.token, hash: t.hash, id: t.id, ttlMs: 1000 }),
        )
      }
      const t = generateRefreshToken()
      await storage.createRefreshToken(
        buildRefreshTokenRecord({ userId: b, token: t.token, hash: t.hash, id: t.id, ttlMs: 1000 }),
      )
      await storage.revokeAllUserTokens(a)
      expect((await storage.listUserRefreshTokens(b)).length).toBe(1)
    })
  })
})
