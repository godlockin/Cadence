/**
 * @cadence/auth — JWT sign + verify (HS256, jose).
 *
 * Access tokens are short-lived (default 15 min) and carry the user id
 * only. Permission resolution happens server-side on every request, so
 * role/group state is always live.
 *
 * jose is runtime-agnostic (Web Crypto under the hood), so the same
 * signer works on Node 20 and Cloudflare Workers.
 */
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import { ulid } from 'ulid'
import type { UserId } from '@cadence/domain'
import { ExpiredTokenError, InvalidTokenError } from './errors.js'

export interface AccessTokenClaims {
  sub: UserId
  /** ULID jti — used for revocation tracking. */
  jti: string
  iat: number
  /** Seconds-since-epoch. */
  exp: number
}

export interface JwtSigner {
  signAccessToken(
    userId: UserId,
    options?: { ttlSeconds?: number; issuer?: string; audience?: string },
  ): Promise<{ token: string; claims: AccessTokenClaims }>
  verifyAccessToken(
    token: string,
    options?: { issuer?: string; audience?: string },
  ): Promise<AccessTokenClaims>
}

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60

export function createJwtSigner(
  secret: string | Uint8Array,
  defaults?: { issuer?: string; audience?: string },
): JwtSigner {
  const key = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret
  if (key.byteLength < 16) {
    throw new Error('createJwtSigner: secret must be at least 16 bytes')
  }

  return {
    async signAccessToken(userId, options) {
      const now = Math.floor(Date.now() / 1000)
      const ttl = options?.ttlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS
      const claims: AccessTokenClaims = {
        sub: userId,
        jti: ulid(),
        iat: now,
        exp: now + ttl,
      }
      let builder = new SignJWT({ sub: userId, jti: claims.jti })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(claims.iat)
        .setExpirationTime(claims.exp)
        .setJti(claims.jti)
      const iss = options?.issuer ?? defaults?.issuer
      const aud = options?.audience ?? defaults?.audience
      if (iss !== undefined) builder = builder.setIssuer(iss)
      if (aud !== undefined) builder = builder.setAudience(aud)
      const token = await builder.sign(key)
      return { token, claims }
    },

    async verifyAccessToken(token, options) {
      try {
        const verifyOpts: Parameters<typeof jwtVerify>[2] = {}
        const iss = options?.issuer ?? defaults?.issuer
        const aud = options?.audience ?? defaults?.audience
        if (iss !== undefined) verifyOpts.issuer = iss
        if (aud !== undefined) verifyOpts.audience = aud
        const { payload } = await jwtVerify(token, key, verifyOpts)
        const sub = payload.sub
        const jti = payload.jti
        const iat = payload.iat
        const exp = payload.exp
        if (typeof sub !== 'string' || sub.length === 0) {
          throw new InvalidTokenError('Missing sub claim')
        }
        if (typeof jti !== 'string' || jti.length === 0) {
          throw new InvalidTokenError('Missing jti claim')
        }
        if (typeof iat !== 'number' || typeof exp !== 'number') {
          throw new InvalidTokenError('Missing iat/exp claim')
        }
        return {
          sub: sub as UserId,
          jti,
          iat,
          exp,
        }
      } catch (e) {
        if (e instanceof joseErrors.JWTExpired) {
          throw new ExpiredTokenError('Access token expired', e)
        }
        if (e instanceof joseErrors.JWTInvalid || e instanceof InvalidTokenError) {
          throw e instanceof InvalidTokenError
            ? e
            : new InvalidTokenError('Invalid access token', e)
        }
        if (e instanceof joseErrors.JOSEError) {
          throw new InvalidTokenError('Token verification failed', e)
        }
        throw new InvalidTokenError('Token verification failed', e)
      }
    },
  }
}
