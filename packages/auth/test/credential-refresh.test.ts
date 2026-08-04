/**
 * @cadence/auth — OAuth2Refresher tests.
 *
 * Covers: happy path, refresh-token rotation (provider + no-rotation),
 * non-refreshable/disabled guards, network failure + timeout, non-2xx,
 * malformed/missing tokens, optimistic version bump, expires_at mapping.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import {
  CredentialDisabledError,
  CredentialNotRefreshableError,
  CredentialRefreshError,
  OAuth2Refresher,
  SSRFError,
} from '../src/index.js'
import {
  failingFetch,
  fakeDnsLookup,
  hangingFetch,
  makeCipher,
  makeOAuth2Credential,
  mockFetch,
} from './credential-helpers.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function decryptStored(storage: InMemoryStorageAdapter, id: string, cipher: ReturnType<typeof makeCipher>): Promise<string> {
  const stored = await storage.getCredential(id as never)
  if (stored === null) throw new Error('credential missing')
  return (
    await cipher.decrypt({
      ciphertext: Buffer.from(stored.ciphertext, 'base64'),
      iv: Buffer.from(stored.iv, 'base64'),
      authTag: Buffer.from(stored.authTag, 'base64'),
      keyId: stored.keyId ?? cipher.keyId,
    })
  ).toString('utf8')
}

describe('OAuth2Refresher', () => {
  it('happy path: refreshes token and persists new ciphertext', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 })),
    })
    const next = await refresher.refresh(cred)
    expect(next.version).toBe(2)
    expect(await decryptStored(storage, cred.id, cipher)).toBe('rt-2')
    expect(next.lastRefreshedAt).toBeTypeOf('number')
    expect(next.consecutiveFailures).toBe(0)
  })

  it('provider rotates refresh_token — stored secret is the new token', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { refreshToken: 'old-rt' })
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', refresh_token: 'rotated-rt', expires_in: 3600 })),
    })
    await refresher.refresh(cred)
    expect(await decryptStored(storage, cred.id, cipher)).toBe('rotated-rt')
  })

  it('provider does NOT rotate refresh_token — original is kept', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { refreshToken: 'stable-rt' })
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', expires_in: 3600 })),
    })
    await refresher.refresh(cred)
    expect(await decryptStored(storage, cred.id, cipher)).toBe('stable-rt')
  })

  it('sends grant_type + refresh_token + client_id + client_secret in the body', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { clientSecret: 'super-secret' })
    await storage.saveCredential(cred)
    let captured = ''
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch((_url, init) => {
        captured = String(init.body)
        return jsonResponse({ access_token: 'at', expires_in: 3600 })
      }),
    })
    await refresher.refresh(cred)
    expect(captured).toContain('grant_type=refresh_token')
    expect(captured).toContain('refresh_token=refresh-token-001')
    expect(captured).toContain('client_id=client-123')
    expect(captured).toContain('client_secret=super-secret')
  })

  it('omits client_secret when the credential has none', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    cred.clientSecretCiphertext = null
    cred.clientSecretIv = null
    cred.clientSecretAuthTag = null
    await storage.saveCredential(cred)
    let captured = ''
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch((_url, init) => {
        captured = String(init.body)
        return jsonResponse({ access_token: 'at', expires_in: 3600 })
      }),
    })
    await refresher.refresh(cred)
    expect(captured).not.toContain('client_secret')
  })

  it('rejects a static_token credential', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { type: 'static_token' })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialNotRefreshableError)
  })

  it('rejects a credential without a token endpoint', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { tokenEndpoint: null })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialNotRefreshableError)
  })

  it('rejects a credential without a client id', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { clientId: null })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialNotRefreshableError)
  })

  it('rejects a disabled credential', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { disabledAt: Date.now() })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialDisabledError)
  })

  it('wraps a network failure as CredentialRefreshError', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: failingFetch('ECONNRESET'),
    })
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialRefreshError)
  })

  it('wraps a request timeout as CredentialRefreshError', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      timeoutMs: 15,
      dnsLookup: fakeDnsLookup(),
      fetchFn: hangingFetch(),
    })
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialRefreshError)
  })

  it('rejects a non-2xx response', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ error: 'invalid_grant' }, 400)),
    })
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialRefreshError)
  })

  it('rejects a malformed (non-JSON) body', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => new Response('not json', { status: 200 })),
    })
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialRefreshError)
  })

  it('rejects a body without access_token', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ error: 'oops' })),
    })
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(CredentialRefreshError)
  })

  it('bumps the optimistic-lock version on success', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { version: 4 })
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', expires_in: 3600 })),
    })
    const next = await refresher.refresh(cred)
    expect(next.version).toBe(5)
    const stored = await storage.getCredential(cred.id as never)
    expect(stored?.version).toBe(5)
  })

  it('computes expiresAt from expires_in', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const before = Date.now()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', expires_in: 900 })),
    })
    const next = await refresher.refresh(cred)
    expect(next.expiresAt).toBeGreaterThanOrEqual(before + 900_000)
    expect(next.expiresAt).toBeLessThanOrEqual(before + 900_000 + 5_000)
  })

  it('defaults expires_in to 3600s when absent', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at' })),
    })
    const next = await refresher.refresh(cred)
    expect(next.expiresAt).toBeGreaterThanOrEqual(Date.now() + 3_600_000 - 5_000)
  })

  it('resets consecutiveFailures to 0 after a success', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { consecutiveFailures: 2 })
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', expires_in: 3600 })),
    })
    const next = await refresher.refresh(cred)
    expect(next.consecutiveFailures).toBe(0)
  })

  it('keeps the keyId from the cipher (AES keyring generation)', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher('v7')
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', expires_in: 3600 })),
    })
    const next = await refresher.refresh(cred)
    expect(next.keyId).toBe('v7')
  })

  /* ---------- SSRF guard (PHASE 6 security) ---------- */

  it('rejects a loopback token endpoint (127.0.0.1)', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { tokenEndpoint: 'http://127.0.0.1/token' })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects a localhost token endpoint', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { tokenEndpoint: 'http://localhost/token' })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects a private-network token endpoint (192.168.1.1)', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { tokenEndpoint: 'http://192.168.1.1/token' })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects a link-local metadata token endpoint (169.254.169.254)', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, {
      tokenEndpoint: 'http://169.254.169.254/token',
    })
    const refresher = new OAuth2Refresher(cipher, storage)
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(SSRFError)
  })

  it('rejects a hostname that resolves to a private address (DNS rebinding)', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, {
      tokenEndpoint: 'https://attacker.example.com/token',
    })
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup('10.0.0.7'),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', expires_in: 3600 })),
    })
    await expect(refresher.refresh(cred)).rejects.toBeInstanceOf(SSRFError)
  })

  it('allows a public HTTPS token endpoint', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, {
      tokenEndpoint: 'https://oauth.example.com/token',
    })
    await storage.saveCredential(cred)
    const refresher = new OAuth2Refresher(cipher, storage, undefined, {
      dnsLookup: fakeDnsLookup(),
      fetchFn: mockFetch(() => jsonResponse({ access_token: 'at', expires_in: 3600 })),
    })
    const next = await refresher.refresh(cred)
    expect(next.version).toBe(2)
  })
})
