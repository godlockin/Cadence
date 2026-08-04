/**
 * @cadence/api — audit log read routes.
 *
 *   GET /api/audit/logs — list audit entries (admin / audit:read)
 *
 * Filters: actor_id, action, resource_type, resource_id, from, to.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, requirePermission } from '@cadence/auth'
import type { JwtSigner } from '@cadence/auth'
import type { AuditAction } from '@cadence/domain'
import type { AuditFilter, StorageAdapter } from '@cadence/storage'
import type { AppEnv } from '../app.js'

const Query = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceKind: z
    .enum(['task', 'execution', 'user', 'group', 'credential', 'tag', 'role'])
    .optional(),
  resourceId: z.string().optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(0).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

export interface MountAuditDeps {
  readonly storage: StorageAdapter
  readonly jwt: JwtSigner
}

export function mountAuditRoutes(deps: MountAuditDeps): Hono<AppEnv> {
  const { storage, jwt } = deps
  const r = new Hono<AppEnv>()
  const auth = requireAuth(jwt, storage)

  r.get('/logs', auth, requirePermission('audit:read', undefined, storage), async (c) => {
    const url = new URL(c.req.url)
    const parsed = Query.parse({
      actorId: url.searchParams.get('actorId') ?? undefined,
      action: url.searchParams.get('action') ?? undefined,
      resourceKind: url.searchParams.get('resourceKind') ?? undefined,
      resourceId: url.searchParams.get('resourceId') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      limit: url.searchParams.get('limit') ?? '100',
      offset: url.searchParams.get('offset') ?? '0',
    })
    const filter: AuditFilter = { limit: parsed.limit, offset: parsed.offset }
    if (parsed.actorId !== undefined) filter.actorId = parsed.actorId as never
    if (parsed.action !== undefined) filter.action = parsed.action as AuditAction
    if (parsed.resourceKind !== undefined) filter.resourceKind = parsed.resourceKind
    if (parsed.resourceId !== undefined) filter.resourceId = parsed.resourceId
    if (parsed.from !== undefined) filter.from = parsed.from
    if (parsed.to !== undefined) filter.to = parsed.to
    const logs = await storage.listAuditLogs(filter)
    return c.json({
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        actorId: l.actorId,
        resourceKind: l.resourceKind,
        resourceId: l.resourceId,
        diff: JSON.parse(l.diffJson) as unknown,
        metadata: JSON.parse(l.metadataJson) as unknown,
        createdAt: l.createdAt,
      })),
    })
  })

  return r
}
