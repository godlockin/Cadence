/**
 * @cadence/auth — runtime permission check.
 *
 * Resolution order (short-circuits on first match):
 *   1. `user.isActive === false` → deny
 *   2. `user.isSuperadmin === true` → allow (master override)
 *   3. Lookup roles via `storage.listUserRoles(userId)`
 *   4. Iterate every role's permissions, match (action, scope):
 *      - `global` → allow unconditionally
 *      - `own`    → allow if `resource.ownerId === user.id`
 *      - `group`  → allow if `resource.groupId !== null` and the user
 *                    is a member of that group (via `storage.isGroupMember`)
 *   5. No match → deny.
 */
import type { GroupId, PermissionAction, User, UserId } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import { ForbiddenError } from './errors.js'

export interface CanContext {
  user: User
  storage: StorageAdapter
}

export interface CanResource {
  ownerId: UserId
  groupId?: GroupId | null
}

export async function can(
  ctx: CanContext,
  action: PermissionAction,
  resource?: CanResource,
): Promise<boolean> {
  if (!ctx.user.isActive) return false
  if (ctx.user.isSuperadmin) return true

  const roles = await ctx.storage.listUserRoles(ctx.user.id)
  for (const role of roles) {
    for (const perm of role.permissions) {
      if (perm.action !== action) continue
      if (perm.scope === 'global') return true
      if (resource === undefined) continue
      if (perm.scope === 'own') {
        if (resource.ownerId === ctx.user.id) return true
      } else if (perm.scope === 'group') {
        if (resource.groupId !== undefined && resource.groupId !== null) {
          const member = await ctx.storage.isGroupMember(resource.groupId, ctx.user.id)
          if (member) return true
        }
      }
    }
  }
  return false
}

export async function assertCan(
  ctx: CanContext,
  action: PermissionAction,
  resource?: CanResource,
): Promise<void> {
  const allowed = await can(ctx, action, resource)
  if (!allowed) {
    throw new ForbiddenError(`User ${ctx.user.id} cannot ${action}`)
  }
}
