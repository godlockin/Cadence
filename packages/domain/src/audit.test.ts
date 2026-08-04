/**
 * @cadence/domain — AuditAction enum coverage tests.
 *
 * Guards the `task.triggered_via_*` / `task.concurrency_skipped` audit
 * actions referenced by @cadence/scheduler's trigger pipeline so they
 * never drift out of the Zod union again (PHASE 3B debt).
 */
import { describe, expect, it } from 'vitest'

import { AuditActionSchema, AuditLogSchema } from './audit.js'

/** Every audit action @cadence/scheduler emits when triggering a task. */
const TRIGGER_ACTIONS = [
  'task.triggered_via_cron',
  'task.triggered_via_webhook',
  'task.triggered_via_event',
  'task.triggered_manually',
  'task.concurrency_skipped',
] as const

describe('AuditActionSchema — trigger-sourced actions', () => {
  for (const action of TRIGGER_ACTIONS) {
    it(`accepts '${action}'`, () => {
      expect(AuditActionSchema.parse(action)).toBe(action)
    })
  }

  it('accepts the full AuditLog round-trip for every trigger action', () => {
    for (const action of TRIGGER_ACTIONS) {
      const parsed = AuditLogSchema.parse({
        id: '9b2c8c70-7b2f-4e00-b0c4-8a2d5e6f1a2b',
        action,
        actorId: null,
        resourceKind: 'task',
        resourceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        diffJson: '{}',
        metadataJson: '{}',
        createdAt: 1_720_000_000_000,
      })
      expect(parsed.action).toBe(action)
    }
  })

  it('rejects a non-registered action literal', () => {
    expect(() => AuditActionSchema.parse('task.triggered_via_slack')).toThrow()
  })
})
