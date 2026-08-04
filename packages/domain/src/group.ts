/**
 * @cadence/domain — Group entity (RBAC scope).
 * PHASE 1: schema only. PHASE 1A+ validates against this.
 */
import { z } from 'zod'

export const GroupIdSchema = z.string().uuid()
export type GroupId = z.infer<typeof GroupIdSchema>

export const GroupSchema = z.object({
  id: GroupIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  ownerId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Group = z.infer<typeof GroupSchema>
