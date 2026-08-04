/**
 * @cadence/auth — JWT signer tests.
 */
import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { ulid as makeUlid } from './ulid.js'
import {
  createJwtSigner,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  ExpiredTokenError,
  InvalidTokenError,
} from '../src/index.js'
import type { UserId } from '@cadence/domain'

const SECRET = 'a-test-secret-that-is-definitely-long-enough'

describe('jwt', () => {
  it('signs and verifies a token with the matching userId', async () => {
    const signer = createJwtSigner(SECRET)
    const userId = makeUlid() as unknown as UserId
    const { token, claims } = await signer.signAccessToken(userId)
    expect(token.split('.').length).toBe(3)
    const verified = await signer.verifyAccessToken(token)
    expect(verified.sub).toBe(userId)
    expect(verified.jti).toBe(claims.jti)
  })

  it('exposes a default 15-minute TTL', async () => {
    const signer = createJwtSigner(SECRET)
    const userId = makeUlid() as unknown as UserId
    const { claims } = await signer.signAccessToken(userId)
    expect(claims.exp - claims.iat).toBe(DEFAULT_ACCESS_TOKEN_TTL_SECONDS)
  })

  it('honors a custom TTL', async () => {
    const signer = createJwtSigner(SECRET)
    const userId = makeUlid() as unknown as UserId
    const { claims } = await signer.signAccessToken(userId, { ttlSeconds: 60 })
    expect(claims.exp - claims.iat).toBe(60)
  })

  it('rejects a token signed with a different secret', async () => {
    const a = createJwtSigner('secret-a-padded-to-be-long-enough')
    const b = createJwtSigner('secret-b-padded-to-be-long-enough')
    const userId = makeUlid() as unknown as UserId
    const { token } = await a.signAccessToken(userId)
    await expect(b.verifyAccessToken(token)).rejects.toBeInstanceOf(InvalidTokenError)
  })

  it('rejects a tampered token (signature broken)', async () => {
    const signer = createJwtSigner(SECRET)
    const userId = makeUlid() as unknown as UserId
    const { token } = await signer.signAccessToken(userId)
    const parts = token.split('.')
    const lastChar = parts[2]!.slice(-1)
    const flipped = lastChar === 'A' ? 'B' : 'A'
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -1)}${flipped}`
    expect(tampered).not.toBe(token)
    await expect(signer.verifyAccessToken(tampered)).rejects.toBeInstanceOf(InvalidTokenError)
  })

  it('rejects an expired token', async () => {
    const signer = createJwtSigner(SECRET)
    const userId = makeUlid() as unknown as UserId
    // Sign a token that expired 1s ago.
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ sub: userId, jti: 'past' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now - 100)
      .setExpirationTime(now - 1)
      .setJti('past')
      .sign(new TextEncoder().encode(SECRET))
    await expect(signer.verifyAccessToken(token)).rejects.toBeInstanceOf(ExpiredTokenError)
  })

  it('rejects a malformed token', async () => {
    const signer = createJwtSigner(SECRET)
    await expect(signer.verifyAccessToken('not.a.jwt')).rejects.toBeInstanceOf(InvalidTokenError)
    await expect(signer.verifyAccessToken('')).rejects.toBeInstanceOf(InvalidTokenError)
    await expect(signer.verifyAccessToken('only.two')).rejects.toBeInstanceOf(InvalidTokenError)
  })

  it('enforces minimum secret length on construction', () => {
    expect(() => createJwtSigner('short')).toThrow(/at least 16 bytes/)
  })

  it('embeds a fresh ULID jti every sign', async () => {
    const signer = createJwtSigner(SECRET)
    const userId = makeUlid() as unknown as UserId
    const a = await signer.signAccessToken(userId)
    const b = await signer.signAccessToken(userId)
    expect(a.claims.jti).not.toBe(b.claims.jti)
  })

  it('rejects when the token claims are missing sub', async () => {
    const signer = createJwtSigner(SECRET)
    const now = Math.floor(Date.now() / 1000)
    // Sign without `sub` in payload.
    const token = await new SignJWT({ jti: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setJti('x')
      .sign(new TextEncoder().encode(SECRET))
    await expect(signer.verifyAccessToken(token)).rejects.toBeInstanceOf(InvalidTokenError)
  })
})
