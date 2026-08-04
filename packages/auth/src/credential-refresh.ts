/**
 * @cadence/auth — OAuth2 refresh-token engine.
 *
 * PHASE 6: given a stored OAuth2 credential it:
 *   1. decrypts the refresh_token (+ optional client secret)
 *   2. POSTs `grant_type=refresh_token` to the provider token endpoint
 *   3. parses the new access_token and (optionally rotated) refresh_token
 *   4. re-encrypts the refresh_token and writes it back with the new
 *      expiry, bumping the optimistic-lock `version`
 *
 * Failures raise `CredentialRefreshError` (network, non-2xx, malformed
 * body). Non-OAuth2 credentials raise `CredentialNotRefreshableError`.
 */
import type { Credential, CredentialType } from '@cadence/domain'
import { credentialType } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import type { CredentialCipher, EncryptedCredential } from './credential-crypto.js'
import {
  assertHostResolved,
  defaultDnsLookup,
  parseAndCheckUrl,
  type LookupFn,
} from './lib/ssrf.js'
import {
  CredentialDisabledError,
  CredentialNotRefreshableError,
  CredentialRefreshError,
} from './errors.js'
import type { Logger } from './logger.js'
import { noopLogger } from './logger.js'

export interface CredentialRefresher {
  refresh(cred: Credential): Promise<Credential>
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

export interface OAuth2RefresherOptions {
  /** per-request timeout (ms) — default 10s */
  readonly timeoutMs?: number
  /** injectable fetch (tests). Defaults to global fetch. */
  readonly fetchFn?: typeof fetch
  /** injectable logger. Defaults to noop. */
  readonly logger?: Logger
  /** DNS lookup used by the SSRF guard. Defaults to real node:dns; tests inject a fake. */
  readonly dnsLookup?: LookupFn
}

/** The refresh type this engine can service. */
export const REFRESHABLE_TYPES: readonly CredentialType[] = [
  'oauth2_refresh_token',
  'api_key_with_rotation',
]

export class OAuth2Refresher implements CredentialRefresher {
  private readonly cipher: CredentialCipher
  private readonly storage: StorageAdapter
  private readonly logger: Logger
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch
  private readonly dnsLookup: LookupFn

  constructor(
    cipher: CredentialCipher,
    storage: StorageAdapter,
    logger: Logger = noopLogger,
    options: OAuth2RefresherOptions = {},
  ) {
    this.cipher = cipher
    this.storage = storage
    this.logger = logger
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init))
    this.dnsLookup = options.dnsLookup ?? defaultDnsLookup
  }

  async refresh(cred: Credential): Promise<Credential> {
    const type = credentialType(cred)
    if (type === 'static_token') {
      throw new CredentialNotRefreshableError(
        `Credential ${cred.id} is static_token and cannot be refreshed`,
      )
    }
    if (cred.tokenEndpoint === null || cred.tokenEndpoint === undefined) {
      throw new CredentialNotRefreshableError(
        `Credential ${cred.id} has no token endpoint configured`,
      )
    }
    if (cred.clientId === null || cred.clientId === undefined) {
      throw new CredentialNotRefreshableError(`Credential ${cred.id} has no client_id configured`)
    }
    if (cred.disabledAt !== null && cred.disabledAt !== undefined) {
      throw new CredentialDisabledError(`Credential ${cred.id} is disabled`)
    }

    // SSRF guard: reject loopback / private / plaintext token endpoints before
    // any network I/O. The DNS lookup (default node:dns) defeats rebinding.
    // Guard failures surface as SSRFError so callers can distinguish a blocked
    // endpoint from an ordinary refresh failure.
    const parsedEndpoint = parseAndCheckUrl(cred.tokenEndpoint, { allowInsecure: false })
    await assertHostResolved(parsedEndpoint, this.dnsLookup)

    this.logger.info('credential.refresh_started', { credId: cred.id, type })

    let refreshToken: string
    let clientSecret: string
    try {
      refreshToken = (
        await this.cipher.decrypt(
          this.toEncrypted(cred.ciphertext, cred.iv, cred.authTag, cred.keyId),
        )
      ).toString('utf8')
      clientSecret = await this.decryptClientSecret(cred)
    } catch (e) {
      throw new CredentialRefreshError(`Failed to decrypt credential ${cred.id}`, e)
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cred.clientId,
    })
    if (clientSecret.length > 0) {
      params.set('client_secret', clientSecret)
    }

    let response: Response
    try {
      response = await this.fetchFn(parsedEndpoint.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      throw new CredentialRefreshError(`Token endpoint request failed for ${cred.id}`, e)
    }

    if (!response.ok) {
      const status = response.status
      this.logger.warn('credential.refresh_http_error', {
        credId: cred.id,
        status,
      })
      throw new CredentialRefreshError(`Token endpoint returned HTTP ${String(status)}`)
    }

    let tokens: TokenResponse
    try {
      tokens = (await response.json()) as TokenResponse
    } catch (e) {
      throw new CredentialRefreshError(`Token endpoint returned non-JSON body for ${cred.id}`, e)
    }

    if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) {
      throw new CredentialRefreshError(`Token endpoint returned no access_token for ${cred.id}`)
    }

    /* Providers may rotate the refresh_token; keep the existing one if absent. */
    const newRefreshToken =
      typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0
        ? tokens.refresh_token
        : refreshToken

    const expiresIn =
      typeof tokens.expires_in === 'number' && tokens.expires_in > 0 ? tokens.expires_in : 3600

    let encrypted
    try {
      encrypted = await this.cipher.encrypt(newRefreshToken)
    } catch (e) {
      throw new CredentialRefreshError(`Failed to encrypt refreshed token for ${cred.id}`, e)
    }

    const now = Date.now()
    const next: Credential = {
      ...cred,
      ciphertext: encrypted.ciphertext.toString('base64'),
      iv: encrypted.iv.toString('base64'),
      authTag: encrypted.authTag.toString('base64'),
      keyId: encrypted.keyId,
      expiresAt: now + expiresIn * 1000,
      lastRefreshedAt: now,
      consecutiveFailures: 0,
      updatedAt: now,
      version: (cred.version ?? 1) + 1,
    }

    await this.storage.saveCredential(next)

    this.logger.info('credential.refresh_succeeded', {
      credId: cred.id,
      version: next.version,
      expiresAt: next.expiresAt,
    })
    return next
  }

  private async decryptClientSecret(cred: Credential): Promise<string> {
    if (
      cred.clientSecretCiphertext === null ||
      cred.clientSecretCiphertext === undefined ||
      cred.clientSecretIv === null ||
      cred.clientSecretIv === undefined ||
      cred.clientSecretAuthTag === null ||
      cred.clientSecretAuthTag === undefined
    ) {
      return ''
    }
    const enc: EncryptedCredential = {
      ciphertext: Buffer.from(cred.clientSecretCiphertext, 'base64'),
      iv: Buffer.from(cred.clientSecretIv, 'base64'),
      authTag: Buffer.from(cred.clientSecretAuthTag, 'base64'),
      keyId: cred.keyId ?? this.cipher.keyId,
    }
    return (await this.cipher.decrypt(enc)).toString('utf8')
  }

  private toEncrypted(
    ciphertext: string,
    iv: string,
    authTag: string,
    keyId?: string,
  ): EncryptedCredential {
    return {
      ciphertext: Buffer.from(ciphertext, 'base64'),
      iv: Buffer.from(iv, 'base64'),
      authTag: Buffer.from(authTag, 'base64'),
      keyId: keyId ?? this.cipher.keyId,
    }
  }
}
