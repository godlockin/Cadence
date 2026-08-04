/**
 * @cadence/domain — Tag entity (free-form task labels).
 * PHASE 1: schema only.
 */
import { z } from 'zod'

export const TagIdSchema = z.string().uuid()
export type TagId = z.infer<typeof TagIdSchema>

export const TagSchema = z.object({
  id: TagIdSchema,
  name: z.string().min(1).max(64),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  createdAt: z.string().datetime(),
})
export type Tag = z.infer<typeof TagSchema>
