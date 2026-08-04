# @cadence/auth

Authentication, authorization (RBAC), and credential cryptography for PulseDeck.

## Modules

| file                   | role                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `errors.ts`            | Typed `AuthError` hierarchy (`UnauthorizedError` / `ForbiddenError` / token errors). |
| `password.ts`          | Argon2id (64 MiB / t=3 / p=4) password hash + verify.                                |
| `jwt.ts`               | HS256 access-token sign + verify via `jose` (runtime-agnostic).                      |
| `refresh-token.ts`     | ULID+UUID format, SHA-256 hash stored server-side.                                   |
| `rbac.ts`              | 4 built-in roles × 29 atomic actions; `BUILTIN_ROLE_PERMISSIONS` matrix.             |
| `can.ts`               | Runtime `can()` / `assertCan()` with `global` / `own` / `group` scopes.              |
| `service.ts`           | `AuthService` — login / refresh (rotating) / logout / logout-all.                    |
| `middleware.ts`        | Hono `requireAuth` + `requirePermission` middlewares.                                |
| `credential-crypto.ts` | AES-256-GCM via Web Crypto (Node 20 + Cloudflare Workers).                           |

## Architecture

```
                    ┌──────────────────────┐
   POST /login ───▶ │   AuthService.login  │
                    └──────────┬───────────┘
                               │ 1. getUserByEmail
                               │ 2. argon2.verify
                               │ 3. jwt.signAccessToken  (15 min)
                               │ 4. generateRefreshToken  (7 d, hashed in DB)
                               │ 5. appendAudit
                               ▼
                    ┌──────────────────────┐
                    │   StorageAdapter     │
                    │  users / refresh …   │
                    └──────────────────────┘

   POST /refresh ─▶ AuthService.refresh
                    - revoke old token (rotation)
                    - issue new access + refresh
                    - appendAudit('auth.refresh')

   GET  /api/* ──▶ requireAuth → requirePermission(action)
                              │
                              ├─ verifyAccessToken (jose)
                              ├─ storage.getUser(sub)
                              └─ storage.listUserRoles(id) + storage.isGroupMember(...)
                                   └─ assertCan → can()
```

## Role × Action matrix

| action               | super_admin | admin  |     operator      |  viewer   |
| -------------------- | :---------: | :----: | :---------------: | :-------: |
| pipeline:create      |   global    | global |                   |           |
| pipeline:read        |   global    | global |      global       |  global   |
| pipeline:update      |   global    | global |                   |           |
| pipeline:delete      |   global    | global |                   |           |
| pipeline:trigger     |   global    | global |      global       |           |
| schedule:* (7)       |   global    | global | trig/pau/res only | read only |
| credential:create    |   global    | global |                   |           |
| credential:read      |   global    | global |      global       |  global   |
| credential:update    |   global    | global |                   |           |
| credential:delete    |   global    | global |                   |           |
| credential:refresh   |   global    | global |                   |           |
| user:invite          |   global    | global |                   |           |
| user:read            |   global    | global |                   |           |
| user:update          |   global    | global |                   |           |
| user:delete          |   global    | global |                   |           |
| user:assign_role     |   global    | global |                   |           |
| group:create         |   global    | global |                   |           |
| group:read           |   global    | global |                   |           |
| group:update         |   global    | global |                   |           |
| group:delete         |   global    | global |                   |           |
| group:manage_members |   global    | global |                   |           |
| audit:read           |   global    | global |      global       |  global   |
| system:config        |   global    |        |                   |           |

`super_admin` is enforced via `user.isSuperadmin = true` (a single user-level flag), bypassing role lookup.

## Permission scopes

| scope    | grant condition                                                          |
| -------- | ------------------------------------------------------------------------ |
| `global` | Allow regardless of resource.                                            |
| `own`    | Allow iff `resource.ownerId === user.id`.                                |
| `group`  | Allow iff `resource.groupId !== null` AND `storage.isGroupMember(g, u)`. |

## Credential encryption

`createCredentialCipher(masterKey: Buffer)` returns an object with `encrypt(plain) → blob` and `decrypt(blob) → Buffer`. `masterKey` must be 32 bytes (256-bit) and lives in the deployment env (e.g. `wrangler secret`).

```
plain ──┬─[12-byte IV]── AES-256-GCM ──▶ ciphertext || authTag(16)
        │
        └─ keyId (rotates with key version)
```

A `keyId` mismatch or any byte-tampered blob causes `decrypt` to throw — GCM integrity is enforced.

## Hono middleware

```ts
import { Hono } from 'hono'
import {
  AuthError,
  createJwtSigner,
  ForbiddenError,
  requireAuth,
  requirePermission,
} from '@cadence/auth'

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof AuthError) {
    const status = err instanceof ForbiddenError ? 403 : 401
    return c.json({ code: err.code, message: err.message }, status)
  }
  throw err
})

const jwt = createJwtSigner(process.env.AUTH_SECRET!)
app.use('/api/*', requireAuth(jwt, storage))
app.use(
  '/api/pipelines/:id/trigger',
  requirePermission('pipeline:trigger', async (c) => {
    const pipeline = await storage.pipelines.findById(c.req.param('id'))
    return pipeline ? { ownerId: pipeline.ownerId, groupId: pipeline.groupId } : undefined
  }),
)
```

## Security considerations

- **Argon2id** at 64 MiB / 3 iters / 4 lanes (OWASP 2024 baseline). Library errors during `verify` are swallowed to `false` so a malformed hash doesn't leak implementation details.
- **JWT** uses `jose` (Web Crypto underneath) — runtime-agnostic. The signing key must be ≥ 16 bytes; the constructor throws otherwise. `sub` + `jti` are mandatory; the claim shape is enforced at the type level.
- **Refresh tokens** are random (ULID + UUIDv4), hashed with SHA-256 before storage, and **rotated on every refresh**. The cleartext is only seen by the caller. Stolen tokens become useless the next time the legitimate user authenticates.
- **`logoutAllDevices`** is provided for incident response (e.g. password change).
- **Audit log** is append-only (`storage.appendAudit`) and records every login success, login failure, refresh, logout, and mass logout.
- **`sanitizeUser`** drops `passwordHash` from any user response. The `PublicUser` type makes this a compile-time invariant.
- **Web Crypto** (AES-GCM) is the only crypto primitive, so the same code path runs on Node 20 and Cloudflare Workers.
- **Fail-closed**: an inactive user, unknown token, malformed token, or unknown group all deny.

## Storage contract

`@cadence/storage` exposes six new methods (PHASE 3 additions):

```ts
interface StorageAdapter {
  // RBAC
  listUserRoles(userId: UserId): Promise<readonly ResolvedUserRole[]>
  // Refresh tokens
  createRefreshToken(token: RefreshToken): Promise<void>
  getRefreshToken(tokenHash: string): Promise<RefreshToken | null>
  revokeRefreshToken(tokenHash: string): Promise<void>
  listUserRefreshTokens(userId: UserId): Promise<readonly RefreshToken[]>
  revokeAllUserTokens(userId: UserId): Promise<number>
}
```

`InMemoryStorageAdapter` ships full implementations; `SqliteStorageAdapter` and `D1StorageAdapter` throw `not implemented` for the new methods — they land in a follow-up phase alongside the `roles` / `role_permissions` / `group_roles` table wiring in `@cadence/db`.

## Tests

`pnpm test` runs 102 cases across 8 files:

| file                             | cases   |
| -------------------------------- | ------- |
| `test/password.test.ts`          | 10      |
| `test/jwt.test.ts`               | 10      |
| `test/refresh-token.test.ts`     | 13      |
| `test/rbac.test.ts`              | 11      |
| `test/can.test.ts`               | 22      |
| `test/service.test.ts`           | 15      |
| `test/middleware.test.ts`        | 11      |
| `test/credential-crypto.test.ts` | 10      |
| **Total**                        | **102** |
