/**
 * @cadence/auth — public surface.
 *
 * PHASE 3 ships:
 *  - Argon2id password hashing           (password)
 *  - JWT sign/verify (HS256, jose)       (jwt)
 *  - Refresh token gen + sha256 hashing  (refresh-token)
 *  - RBAC role/permission definitions    (rbac)
 *  - Runtime permission check (can/assertCan)
 *  - AuthService (login/refresh/logout)  (service)
 *  - Hono middleware                     (middleware)
 *  - AES-256-GCM credential encryption   (credential-crypto)
 *  - Typed error hierarchy               (errors)
 */

export * from './errors.js'
export * from './password.js'
export * from './jwt.js'
export * from './refresh-token.js'
export * from './rbac.js'
export * from './can.js'
export * from './service.js'
export * from './middleware.js'
export * from './credential-crypto.js'
export * from './credential-refresh.js'
export * from './refresh-scheduler.js'
export * from './logger.js'
export * from './lib/ssrf.js'

export const VERSION = '0.4.0'
