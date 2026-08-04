/**
 * @cadence/auth — AES-256-GCM credential encryption tests.
 */
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  AES_GCM_AUTH_TAG_LENGTH,
  AES_GCM_IV_LENGTH,
  AES_GCM_KEY_LENGTH,
  createCredentialCipher,
} from '../src/index.js'

function newKey(): Buffer {
  return Buffer.from(randomBytes(AES_GCM_KEY_LENGTH))
}

describe('credential-crypto', () => {
  it('exposes the documented parameters', () => {
    expect(AES_GCM_KEY_LENGTH).toBe(32)
    expect(AES_GCM_IV_LENGTH).toBe(12)
    expect(AES_GCM_AUTH_TAG_LENGTH).toBe(16)
  })

  it('rejects a wrong-length master key', () => {
    expect(() => createCredentialCipher(Buffer.alloc(16))).toThrow(/32 bytes/)
    expect(() => createCredentialCipher(Buffer.alloc(64))).toThrow(/32 bytes/)
  })

  it('round-trips a string plaintext', async () => {
    const cipher = createCredentialCipher(newKey())
    const enc = await cipher.encrypt('super-secret')
    expect(enc.ciphertext.length).toBeGreaterThan(0)
    expect(enc.iv.length).toBe(12)
    expect(enc.authTag.length).toBe(16)
    expect(enc.keyId).toBe('v1')
    const dec = await cipher.decrypt(enc)
    expect(dec.toString('utf8')).toBe('super-secret')
  })

  it('round-trips a binary plaintext', async () => {
    const cipher = createCredentialCipher(newKey())
    const bin = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
    const enc = await cipher.encrypt(bin)
    const dec = await cipher.decrypt(enc)
    expect(dec.equals(bin)).toBe(true)
  })

  it('two encryptions of the same plaintext produce different ciphertexts (random IV)', async () => {
    const cipher = createCredentialCipher(newKey())
    const a = await cipher.encrypt('same-input')
    const b = await cipher.encrypt('same-input')
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false)
    expect(a.iv.equals(b.iv)).toBe(false)
    // But both decrypt to the same plaintext.
    expect((await cipher.decrypt(a)).toString('utf8')).toBe('same-input')
    expect((await cipher.decrypt(b)).toString('utf8')).toBe('same-input')
  })

  it('a 1-byte ciphertext tamper causes decrypt to throw', async () => {
    const cipher = createCredentialCipher(newKey())
    const enc = await cipher.encrypt('do-not-touch')
    enc.ciphertext[0] = enc.ciphertext[0]! ^ 0x01
    await expect(cipher.decrypt(enc)).rejects.toThrow()
  })

  it('a wrong IV causes decrypt to throw', async () => {
    const cipher = createCredentialCipher(newKey())
    const enc = await cipher.encrypt('iv-test')
    enc.iv = Buffer.from(randomBytes(12))
    await expect(cipher.decrypt(enc)).rejects.toThrow()
  })

  it('a wrong key cannot decrypt', async () => {
    const cipherA = createCredentialCipher(newKey())
    const cipherB = createCredentialCipher(newKey())
    const enc = await cipherA.encrypt('key-test')
    await expect(cipherB.decrypt(enc)).rejects.toThrow()
  })

  it('a wrong keyId is rejected before crypto runs', async () => {
    const cipher = createCredentialCipher(newKey(), { keyId: 'v1' })
    const enc = await cipher.encrypt('keyId-test')
    const encWrong = { ...enc, keyId: 'v2' }
    await expect(cipher.decrypt(encWrong)).rejects.toThrow(/keyId mismatch/)
  })

  it('truncated authTag is rejected up front', async () => {
    const cipher = createCredentialCipher(newKey())
    const enc = await cipher.encrypt('trunc')
    const truncated = { ...enc, authTag: enc.authTag.subarray(0, 8) }
    await expect(cipher.decrypt(truncated)).rejects.toThrow(/authTag/)
  })
})
