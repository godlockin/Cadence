/**
 * @pulsedeck/auth — Argon2id + JWT (jose) + AES-256-GCM.
 * PHASE 0: signatures only.
 */
import type { Role, User } from '@pulsedeck/domain'

/* ----------------------------- Password ----------------------------- */

export function hashPassword(plain: string): Promise<string>
export function verifyPassword(hash: string, plain: string): Promise<boolean>

/* ------------------------------- JWT -------------------------------- */

export interface JwtSigner {
  sign(payload: JwtPayload, ttlSeconds: number): Promise<string>
  verify(token: string): Promise<JwtPayload | null>
}

export interface JwtPayload {
  readonly sub: string /* userId */
  readonly role: Role
  readonly iat: number
  readonly exp: number
  readonly iss?: string
  readonly aud?: string
}

export function createJwtSigner(secret: Uint8Array, issuer?: string, audience?: string): JwtSigner

/* --------------------------- AES-256-GCM ---------------------------- */

export interface EncryptedBlob {
  readonly ciphertext: string /* base64 */
  readonly iv: string /* base64 */
  readonly authTag: string /* base64 */
}

export function encryptSecret(plain: string, key: Uint8Array): EncryptedBlob
export function decryptSecret(blob: EncryptedBlob, key: Uint8Array): string

/* ------------------------------ RBAC -------------------------------- */

export function canActOn(
  role: Role,
  target: { ownerId: string },
  actor: Pick<User, 'id' | 'role'>,
): boolean

export const VERSION = '0.1.0'
