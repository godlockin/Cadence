/**
 * @cadence/domain — Credential entity (PHASE 6: credential refresh model).
 *
 * PHASE 3 shipped a flat storage credential: id/ownerId/name/kind +
 * encrypted blob. PHASE 6 layers a refresh-aware model on top:
 *
 *  - `type`            — which refresh behaviour applies to this credential
 *  - `refreshPolicy`   — lead time, retries, backoff, disable-on-fail
 *  - `expiresAt`       — access-token expiry (ms epoch); null = never
 *  - `consecutiveFailures` / `disabledAt` — fail-safe circuit breaker
 *  - `version`         — optimistic lock for refresh write-back
 *
 * Every new field is OPTIONAL so the PHASE 3 shape (a plain API-key
 * credential) remains valid — `static_token` is the implicit default.
 */
import { z } from 'zod'

export const CredentialIdSchema = z.string().uuid()
export type CredentialId = z.infer<typeof CredentialIdSchema>

export const CredentialKindSchema = z.enum([
  'api-key',
  'oauth2',
  'basic',
  'bearer',
  'webhook-secret',
])
export type CredentialKind = z.infer<typeof CredentialKindSchema>

/** Refresh behaviour enum — drives the credential-refresh engine. */
export const CredentialTypeSchema = z.enum([
  'oauth2_refresh_token',
  'api_key_with_rotation',
  'static_token',
])
export type CredentialType = z.infer<typeof CredentialTypeSchema>

export const RefreshBackoffSchema = z.enum(['fixed', 'exponential'])
export type RefreshBackoff = z.infer<typeof RefreshBackoffSchema>

export const CredentialRefreshPolicySchema = z.object({
  /** minutes before expiry to start refreshing (default 5) */
  leadMinutes: z.number().int().min(0).default(5),
  /** max consecutive failures before the circuit breaker trips */
  maxRetries: z.number().int().min(0).default(3),
  backoff: RefreshBackoffSchema.default('exponential'),
  /** when true, the credential is disabled after maxRetries consecutive failures */
  disabledOnFail: z.boolean().default(true),
})
export type CredentialRefreshPolicy = z.infer<typeof CredentialRefreshPolicySchema>

/** Encrypted-at-rest blob (base64 string form of the crypto output). */
export const EncryptedBlobSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  /** AES keyring generation id — supports multi-generation master keys. */
  keyId: z.string().default('v1'),
})
export type EncryptedBlob = z.infer<typeof EncryptedBlobSchema>

export const CredentialSchema = z.object({
  id: CredentialIdSchema,
  ownerId: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: CredentialKindSchema,
  /** PHASE 6 refresh type. Legacy credentials are treated as static_token. */
  type: CredentialTypeSchema.optional(),
  /** encrypted secret (refresh_token / api key / static token) — base64 */
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  /** AES keyring generation id — matches the key used to encrypt `ciphertext`. */
  keyId: z.string().optional(),
  /* OAuth2 client secret (encrypted, base64). Null for non-OAuth2 creds. */
  clientSecretCiphertext: z.string().nullable().optional(),
  clientSecretIv: z.string().nullable().optional(),
  clientSecretAuthTag: z.string().nullable().optional(),
  /** OAuth2 token endpoint. Null for non-OAuth2 creds. */
  tokenEndpoint: z.string().url().nullable().optional(),
  /** OAuth2 client id. Null for non-OAuth2 creds. */
  clientId: z.string().nullable().optional(),
  /** access-token expiry (ms epoch). Null = no expiry. */
  expiresAt: z.number().int().nullable().optional(),
  lastRefreshedAt: z.number().int().nullable().optional(),
  /** consecutive refresh failures (since last success) — circuit breaker input. */
  consecutiveFailures: z.number().int().min(0).optional(),
  /** ms epoch when the credential was disabled after repeated failures. */
  disabledAt: z.number().int().nullable().optional(),
  refreshPolicy: CredentialRefreshPolicySchema.optional(),
  /** optimistic-lock version — bumped on every successful refresh. */
  version: z.number().int().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.number().int().nullable().optional(),
})
export type Credential = z.infer<typeof CredentialSchema>

/** Default refresh policy (used when a credential omits `refreshPolicy`). */
export const DEFAULT_REFRESH_POLICY: CredentialRefreshPolicy = {
  leadMinutes: 5,
  maxRetries: 3,
  backoff: 'exponential',
  disabledOnFail: true,
}

/** Infer a credential's effective refresh type (legacy = static_token). */
export function credentialType(cred: Pick<Credential, 'type'>): CredentialType {
  return cred.type ?? 'static_token'
}

/** Infer a credential's effective refresh policy. */
export function credentialRefreshPolicy(
  cred: Pick<Credential, 'refreshPolicy'>,
): CredentialRefreshPolicy {
  return {
    ...DEFAULT_REFRESH_POLICY,
    ...(cred.refreshPolicy ?? {}),
  }
}
