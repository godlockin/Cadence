/**
 * @cadence/api — audit log writer.
 *
 * Extracted into its own module so `errors.ts` can import it without
 * forming an import cycle with `app.ts` (which needs `mapErrorToResponse`).
 */
import { randomUUID } from 'node:crypto'
import type { AuditAction, AuditLog, UserId } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

export interface AuditWriteInput {
  readonly action: AuditAction
  readonly actorId: UserId | null
  readonly resourceKind: AuditLog['resourceKind']
  readonly resourceId: string
  readonly diff?: Record<string, unknown>
  readonly metadata?: Record<string, unknown>
}

export async function writeAudit(storage: StorageAdapter, input: AuditWriteInput): Promise<void> {
  const entry: AuditLog = {
    id: randomUUID(),
    action: input.action,
    actorId: input.actorId,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    diffJson: JSON.stringify(input.diff ?? {}),
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdAt: Date.now(),
  }
  await storage.appendAudit(entry)
}
