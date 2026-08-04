/**
 * @cadence/auth — RBAC permission model.
 *
 * - 4 built-in role names: super_admin, admin, operator, viewer
 * - 29 atomic actions (see `PermissionActionSchema` in @cadence/domain)
 * - 3 scopes: global, group, own
 *
 * The action enum AND the built-in role grants are owned by
 * `@cadence/domain` so storage + auth can refer to the same grants
 * without creating a cycle.
 */
import {
  BUILTIN_ROLE_GRANTS,
  type BuiltinRole,
  type GroupId,
  type PermissionAction,
  type PermissionScope,
} from '@cadence/domain'
import type { ResolvedPermission, ResolvedUserRole } from '@cadence/storage'

export type { BuiltinRole, PermissionAction, PermissionScope }
export type { ResolvedPermission, ResolvedUserRole }

function buildRole(name: BuiltinRole): ResolvedUserRole {
  return {
    id: `role:${name}`,
    name,
    scope: 'global',
    groupId: null,
    permissions: BUILTIN_ROLE_GRANTS[name],
  }
}

export const BUILTIN_ROLE_PERMISSIONS: Readonly<Record<BuiltinRole, ResolvedUserRole>> = {
  super_admin: buildRole('super_admin'),
  admin: buildRole('admin'),
  operator: buildRole('operator'),
  viewer: buildRole('viewer'),
}

export function permissionsForBuiltinRole(role: BuiltinRole): ResolvedPermission[] {
  return BUILTIN_ROLE_PERMISSIONS[role].permissions.map((p) => ({
    action: p.action,
    scope: p.scope,
  }))
}

export function totalActions(): number {
  return BUILTIN_ROLE_GRANTS.super_admin.length
}

export function scopeForRole(role: BuiltinRole): PermissionScope {
  return BUILTIN_ROLE_PERMISSIONS[role].scope
}

export function groupRole(
  name: string,
  groupId: GroupId,
  grants: readonly ResolvedPermission[],
): ResolvedUserRole {
  return {
    id: `group-role:${groupId}:${name}`,
    name,
    scope: 'group',
    groupId,
    permissions: grants,
  }
}
