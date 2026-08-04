/**
 * @cadence/auth — shared helpers for credential-refresh tests.
 */
import { randomBytes } from 'node:crypto'
import type { Credential, CredentialId, UserId } from '@cadence/domain'
import type { LookupFn } from '../src/index.js'
import {
  AES_GCM_KEY_LENGTH,
  createCredentialCipher,
  type CredentialCipher,
  type EncryptedCredential,
} from '../src/index.js'

export function makeCipher(keyId = 'v1'): CredentialCipher {
  return createCredentialCipher(Buffer.from(randomBytes(AES_GCM_KEY_LENGTH)), { keyId })
}

/** Base64-string form of an encrypted blob. */
export function b64(enc: EncryptedCredential): { ciphertext: string; iv: string; authTag: string; keyId: string } {
  return {
    ciphertext: enc.ciphertext.toString('base64'),
    iv: enc.iv.toString('base64'),
    authTag: enc.authTag.toString('base64'),
    keyId: enc.keyId,
  }
}

export interface OAuth2CredentialOverrides {
  refreshToken?: string
  clientSecret?: string
  type?: Credential['type']
  tokenEndpoint?: string | null
  clientId?: string | null
  expiresAt?: number | null
  disabledAt?: number | null
  consecutiveFailures?: number
  version?: number
  refreshPolicy?: Credential['refreshPolicy']
  id?: CredentialId
  ownerId?: UserId
  name?: string
  kind?: Credential['kind']
}

/** Build a fully-populated OAuth2 credential whose secret is encrypted. */
export async function makeOAuth2Credential(
  cipher: CredentialCipher,
  overrides: OAuth2CredentialOverrides = {},
): Promise<Credential> {
  const enc = await cipher.encrypt(overrides.refreshToken ?? 'refresh-token-001')
  const clientSecret = await cipher.encrypt(overrides.clientSecret ?? 'client-secret-abc')
  const b = b64(enc)
  const cs = b64(clientSecret)
  const now = Date.now()
  return {
    id: overrides.id ?? (crypto.randomUUID() as CredentialId),
    ownerId: overrides.ownerId ?? (crypto.randomUUID() as UserId),
    name: overrides.name ?? 'GitHub OAuth',
    kind: overrides.kind ?? 'oauth2',
    type: overrides.type ?? 'oauth2_refresh_token',
    ciphertext: b.ciphertext,
    iv: b.iv,
    authTag: b.authTag,
    keyId: b.keyId,
    clientSecretCiphertext: cs.ciphertext,
    clientSecretIv: cs.iv,
    clientSecretAuthTag: cs.authTag,
    tokenEndpoint:
      overrides.tokenEndpoint === undefined
        ? 'https://provider.example.com/oauth/token'
        : overrides.tokenEndpoint,
    clientId: overrides.clientId === undefined ? 'client-123' : overrides.clientId,
    expiresAt: overrides.expiresAt === undefined ? now - 60_000 : overrides.expiresAt,
    lastRefreshedAt: now - 3_600_000,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    disabledAt: overrides.disabledAt === undefined ? null : overrides.disabledAt,
    refreshPolicy: overrides.refreshPolicy ?? {
      leadMinutes: 5,
      maxRetries: 3,
      backoff: 'exponential',
      disabledOnFail: true,
    },
    version: overrides.version ?? 1,
    createdAt: new Date(now - 86_400_000).toISOString(),
    updatedAt: now - 3_600_000,
  }
}

/** A `typeof fetch` that dispatches to a handler. */
export function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {}))) as typeof fetch
}

/** A fetch that never resolves and rejects when the signal aborts (timeout test). */
export function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      })
    })) as typeof fetch
}

/** A fetch that rejects immediately with a network-style error. */
export function failingFetch(message = 'network down'): typeof fetch {
  return ((_input: RequestInfo | URL) => Promise.reject(new Error(message))) as typeof fetch
}

/** A DNS lookup that always resolves to one public IPv4 address (SSRF guard). */
export function fakeDnsLookup(address = '93.184.216.34'): LookupFn {
  return async (_hostname: string) => [{ address, family: 4 }]
}
