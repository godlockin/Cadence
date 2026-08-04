/**
 * @cadence/auth — AES-256-GCM credential encryption.
 *
 * Used to encrypt at-rest secrets (OAuth refresh tokens, webhook
 * secrets) before they hit the storage layer. The master key lives in
 * the deployment env (Node: env var; Workers: `wrangler secret`).
 *
 * Format produced by `encrypt`:
 *   {
 *     ciphertext: Buffer,   // encrypted bytes (auth tag stripped)
 *     iv: Buffer,           // 12 random bytes
 *     authTag: Buffer,      // 16 bytes (GCM integrity tag)
 *     keyId: string         // master key version — supports rotation
 *   }
 *
 * `decrypt` is strict: any tampering with ciphertext / iv / authTag
 * throws (Web Crypto enforces GCM integrity). A wrong master key
 * raises an `OperationError` from subtle.crypto.
 *
 * Uses Web Crypto (`globalThis.crypto.subtle`) so the module is
 * runtime-agnostic: same code path on Node 20 and Cloudflare Workers.
 */

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH_BYTES = 32

export interface EncryptedCredential {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
  keyId: string
}

export interface CredentialCipher {
  encrypt(plaintext: Buffer | string): Promise<EncryptedCredential>
  decrypt(encrypted: EncryptedCredential): Promise<Buffer>
  keyId: string
}

export function createCredentialCipher(
  masterKey: Buffer | Uint8Array,
  options?: { keyId?: string },
): CredentialCipher {
  if (masterKey.byteLength !== KEY_LENGTH_BYTES) {
    throw new Error(
      `createCredentialCipher: masterKey must be ${KEY_LENGTH_BYTES.toString()} bytes (got ${masterKey.byteLength.toString()})`,
    )
  }
  // Copy to a fresh ArrayBuffer to keep the key immutable.
  const keyBytes = new Uint8Array(masterKey.byteLength)
  keyBytes.set(masterKey)
  const keyId = options?.keyId ?? 'v1'
  let cachedKey: CryptoKey | null = null

  async function getKey(): Promise<CryptoKey> {
    if (cachedKey !== null) return cachedKey
    cachedKey = await crypto.subtle.importKey('raw', keyBytes, ALGORITHM, false, [
      'encrypt',
      'decrypt',
    ])
    return cachedKey
  }

  return {
    keyId,
    async encrypt(plaintext) {
      const source =
        typeof plaintext === 'string'
          ? new TextEncoder().encode(plaintext)
          : new Uint8Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
      // Copy into a fresh ArrayBuffer to satisfy WebCrypto's stricter
      // BufferSource signature in TS 5.7+ (ArrayBuffer, not ArrayBufferLike).
      const data = new Uint8Array(source.byteLength)
      data.set(source)
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
      const key = await getKey()
      const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, data)
      const buf = Buffer.from(encrypted)
      if (buf.byteLength < AUTH_TAG_LENGTH) {
        throw new Error('encrypt: ciphertext shorter than auth tag — corrupt output')
      }
      return {
        ciphertext: Buffer.from(buf.subarray(0, buf.byteLength - AUTH_TAG_LENGTH)),
        iv: Buffer.from(iv),
        authTag: Buffer.from(buf.subarray(buf.byteLength - AUTH_TAG_LENGTH)),
        keyId,
      }
    },
    async decrypt({ ciphertext, iv, authTag, keyId: blobKeyId }) {
      if (blobKeyId !== keyId) {
        throw new Error(`decrypt: keyId mismatch (blob=${blobKeyId}, cipher=${keyId})`)
      }
      if (iv.byteLength !== IV_LENGTH) {
        throw new Error(`decrypt: iv must be ${IV_LENGTH.toString()} bytes`)
      }
      if (authTag.byteLength !== AUTH_TAG_LENGTH) {
        throw new Error(`decrypt: authTag must be ${AUTH_TAG_LENGTH.toString()} bytes`)
      }
      const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength)
      combined.set(
        new Uint8Array(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength),
        0,
      )
      combined.set(
        new Uint8Array(authTag.buffer, authTag.byteOffset, authTag.byteLength),
        ciphertext.byteLength,
      )
      // Copy IV into a fresh ArrayBuffer to satisfy WebCrypto's stricter
      // BufferSource signature in TS 5.7+ (ArrayBuffer, not ArrayBufferLike).
      const ivView = new Uint8Array(IV_LENGTH)
      ivView.set(new Uint8Array(iv.buffer, iv.byteOffset, IV_LENGTH))
      const key = await getKey()
      const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv: ivView }, key, combined)
      return Buffer.from(decrypted)
    },
  }
}

export const AES_GCM_IV_LENGTH = IV_LENGTH
export const AES_GCM_AUTH_TAG_LENGTH = AUTH_TAG_LENGTH
export const AES_GCM_KEY_LENGTH = KEY_LENGTH_BYTES
