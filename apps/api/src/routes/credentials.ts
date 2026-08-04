/**
 * @cadence/api — credential routes.
 *
 *   GET    /api/credentials                 — list own credentials
 *   POST   /api/credentials                 — create (encrypts secret)
 *   GET    /api/credentials/:id             — read metadata (no plaintext)
 *   PATCH  /api/credentials/:id             — update metadata only
 *   DELETE /api/credentials/:id             — delete
 *   POST   /api/credentials/:id/refresh     — refresh OAuth/bearer token
 *   POST   /api/credentials/:id/rotate      — force rotate + write back
 *
 * Plaintext secrets are encrypted with AES-256-GCM before they hit
 * storage. The route layer never sees the decrypted value again.
 *
 * PHASE 6: when an optional `CredentialRefresher` is wired, refresh/rotate
 * actually hit the provider token endpoint and persist the new token.
 */
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { createCredentialCipher, requireAuth, requirePermission } from '@cadence/auth'
import type { CredentialRefresher, JwtSigner } from '@cadence/auth'
import type { Credential, CredentialId, UserId } from '@cadence/domain'
import { CredentialRefreshPolicySchema, CredentialTypeSchema } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import type { AppEnv } from '../app.js'
import { writeAudit } from '../app.js'
import { loadAndAuthorize } from '../lib/ownership.js'

const CredentialKind = z.enum(['api-key', 'oauth2', 'basic', 'bearer', 'webhook-secret'])

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  kind: CredentialKind,
  /** Plaintext secret. Encrypted at rest by the route; never returned in responses. */
  secret: z.string().min(1).max(8192),
  /* PHASE 6 refresh metadata (all optional) */
  type: CredentialTypeSchema.optional(),
  clientSecret: z.string().max(8192).optional(),
  tokenEndpoint: z.string().url().optional(),
  clientId: z.string().min(1).max(512).optional(),
  expiresInSeconds: z.number().int().min(1).max(31_536_000).optional(),
  refreshPolicy: CredentialRefreshPolicySchema.optional(),
})

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
})

function sanitize(c: Credential): Record<string, unknown> {
  return {
    id: c.id,
    ownerId: c.ownerId,
    name: c.name,
    kind: c.kind,
    type: c.type ?? 'static_token',
    expiresAt: c.expiresAt ?? null,
    disabledAt: c.disabledAt ?? null,
    version: c.version ?? 1,
    createdAt: c.createdAt,
    /* never expose ciphertext / iv / authTag via the API */
  }
}

export interface MountCredentialsDeps {
  readonly storage: StorageAdapter
  readonly jwt: JwtSigner
  /** Master key for AES-GCM (raw bytes, 32). Falls back to a derived key
   *  if the env binding is missing — tests inject their own cipher via
   *  the `encryptionKey` helper. */
  readonly encryptionKey: Uint8Array
  /** Optional PHASE 6 refresher — wires real token refresh/rotate. */
  readonly refresher?: CredentialRefresher
}

export function mountCredentialRoutes(deps: MountCredentialsDeps): Hono<AppEnv> {
  const { storage, jwt, encryptionKey, refresher } = deps
  const cipher = createCredentialCipher(encryptionKey)
  const r = new Hono<AppEnv>()
  const auth = requireAuth(jwt, storage)

  /* GET /api/credentials — list own (admin sees all) */
  r.get('/', auth, async (c) => {
    const user = c.get('user')
    const filter: Parameters<StorageAdapter['listCredentials']>[0] =
      user.role === 'admin' ? {} : { ownerId: user.id }
    const creds = await storage.listCredentials(filter)
    return c.json({ credentials: creds.map(sanitize) })
  })

  /* POST /api/credentials */
  r.post('/', auth, requirePermission('credential:create', undefined, storage), async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = CreateBody.parse(raw)
    const user = c.get('user')
    const enc = await cipher.encrypt(body.secret)
    let clientSecretEnc: { ciphertext: string; iv: string; authTag: string } | null = null
    if (body.clientSecret !== undefined) {
      const cs = await cipher.encrypt(body.clientSecret)
      clientSecretEnc = {
        ciphertext: cs.ciphertext.toString('base64'),
        iv: cs.iv.toString('base64'),
        authTag: cs.authTag.toString('base64'),
      }
    }
    const now = Date.now()
    const cred: Credential = {
      id: randomUUID() as CredentialId,
      ownerId: user.id,
      name: body.name,
      kind: body.kind,
      type: body.type,
      ciphertext: enc.ciphertext.toString('base64'),
      iv: enc.iv.toString('base64'),
      authTag: enc.authTag.toString('base64'),
      keyId: enc.keyId,
      clientSecretCiphertext: clientSecretEnc?.ciphertext ?? null,
      clientSecretIv: clientSecretEnc?.iv ?? null,
      clientSecretAuthTag: clientSecretEnc?.authTag ?? null,
      tokenEndpoint: body.tokenEndpoint ?? null,
      clientId: body.clientId ?? null,
      expiresAt: body.expiresInSeconds !== undefined ? now + body.expiresInSeconds * 1000 : null,
      lastRefreshedAt: null,
      consecutiveFailures: 0,
      disabledAt: null,
      refreshPolicy: body.refreshPolicy,
      version: 1,
      createdAt: new Date(now).toISOString(),
      updatedAt: now,
    }
    await storage.saveCredential(cred)
    await writeAudit(storage, {
      action: 'credential.create',
      actorId: user.id,
      resourceKind: 'credential',
      resourceId: cred.id,
      diff: { name: body.name, kind: body.kind, type: cred.type ?? 'static_token' },
    })
    return c.json({ credential: sanitize(cred) }, 201)
  })

  /* GET /api/credentials/:id — metadata only (owner / admin) */
  r.get('/:id', auth, async (c) => {
    const id = c.req.param('id') as CredentialId
    const cred = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getCredential(rid as CredentialId),
      'credential:read',
      (c2) => ({ ownerId: c2.ownerId as unknown as UserId }),
    )
    return c.json({ credential: sanitize(cred) })
  })

  /* PATCH /api/credentials/:id — metadata only (owner / admin) */
  r.patch('/:id', auth, async (c) => {
    const id = c.req.param('id') as CredentialId
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = PatchBody.parse(raw)
    const cred = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getCredential(rid as CredentialId),
      'credential:update',
      (c2) => ({ ownerId: c2.ownerId as unknown as UserId }),
    )
    const next: Credential = {
      ...cred,
      ...(body.name !== undefined ? { name: body.name } : {}),
    }
    await storage.saveCredential(next)
    await writeAudit(storage, {
      action: 'credential.update',
      actorId: c.get('user').id,
      resourceKind: 'credential',
      resourceId: id,
      diff: body as Record<string, unknown>,
    })
    return c.json({ credential: sanitize(next) })
  })

  /* DELETE /api/credentials/:id — owner / admin */
  r.delete('/:id', auth, async (c) => {
    const id = c.req.param('id') as CredentialId
    await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getCredential(rid as CredentialId),
      'credential:delete',
      (c2) => ({ ownerId: c2.ownerId as unknown as UserId }),
    )
    await storage.deleteCredential(id)
    await writeAudit(storage, {
      action: 'credential.delete',
      actorId: c.get('user').id,
      resourceKind: 'credential',
      resourceId: id,
    })
    return c.json({ ok: true })
  })

  /* POST /api/credentials/:id/refresh — refresh OAuth/bearer token.
   * With a refresher wired and an oauth2 credential it hits the provider;
   * otherwise it records intent (PHASE 3 stub behaviour). */
  r.post('/:id/refresh', auth, async (c) => {
    const id = c.req.param('id') as CredentialId
    const cred = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getCredential(rid as CredentialId),
      'credential:refresh',
      (c2) => ({ ownerId: c2.ownerId as unknown as UserId }),
    )
    if (refresher !== undefined && cred.type === 'oauth2_refresh_token') {
      try {
        const next = await refresher.refresh(cred)
        await writeAudit(storage, {
          action: 'credential.refresh',
          actorId: c.get('user').id,
          resourceKind: 'credential',
          resourceId: id,
          metadata: { outcome: 'ok', version: next.version ?? 1 },
        })
        return c.json({ ok: true, refreshedAt: Date.now(), version: next.version ?? 1 })
      } catch (e) {
        await writeAudit(storage, {
          action: 'credential.refresh',
          actorId: c.get('user').id,
          resourceKind: 'credential',
          resourceId: id,
          metadata: { outcome: 'failed', error: e instanceof Error ? e.message : String(e) },
        })
        throw e
      }
    }
    await writeAudit(storage, {
      action: 'credential.refresh',
      actorId: c.get('user').id,
      resourceKind: 'credential',
      resourceId: id,
    })
    return c.json({ ok: true, refreshedAt: Date.now() })
  })

  /* POST /api/credentials/:id/rotate — force immediate rotation. */
  r.post('/:id/rotate', auth, async (c) => {
    const id = c.req.param('id') as CredentialId
    const cred = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getCredential(rid as CredentialId),
      'credential:update',
      (c2) => ({ ownerId: c2.ownerId as unknown as UserId }),
    )
    if (refresher !== undefined && cred.type === 'oauth2_refresh_token') {
      const next = await refresher.refresh(cred)
      await writeAudit(storage, {
        action: 'credential.rotate',
        actorId: c.get('user').id,
        resourceKind: 'credential',
        resourceId: id,
        metadata: { version: next.version ?? 1 },
      })
      return c.json({ ok: true, rotatedAt: Date.now(), version: next.version ?? 1 })
    }
    await writeAudit(storage, {
      action: 'credential.rotate',
      actorId: c.get('user').id,
      resourceKind: 'credential',
      resourceId: id,
    })
    return c.json({ ok: true, rotatedAt: Date.now() })
  })

  return r
}
