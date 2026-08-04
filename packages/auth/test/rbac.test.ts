/**
 * @cadence/auth — RBAC permission model tests.
 *
 * Validates the canonical built-in role grants. The matrix is also
 * exposed by `permissionsForBuiltinRole` for callers (e.g. seeder).
 */
import { describe, it, expect } from 'vitest'
import {
  BUILTIN_ROLE_PERMISSIONS,
  permissionsForBuiltinRole,
  totalActions,
} from '../src/rbac.js'
import type { PermissionAction } from '@cadence/domain'

const PIPELINE_ACTIONS: PermissionAction[] = [
  'pipeline:create', 'pipeline:read', 'pipeline:update', 'pipeline:delete', 'pipeline:trigger',
]

const SCHEDULE_ACTIONS: PermissionAction[] = [
  'schedule:create', 'schedule:read', 'schedule:update', 'schedule:delete',
  'schedule:trigger', 'schedule:pause', 'schedule:resume',
]

const CREDENTIAL_ACTIONS: PermissionAction[] = [
  'credential:create', 'credential:read', 'credential:update',
  'credential:delete', 'credential:refresh',
]

const USER_ACTIONS: PermissionAction[] = [
  'user:invite', 'user:read', 'user:update', 'user:delete', 'user:assign_role',
]

const GROUP_ACTIONS: PermissionAction[] = [
  'group:create', 'group:read', 'group:update', 'group:delete', 'group:manage_members',
]

const ALL_ACTIONS: PermissionAction[] = [
  ...PIPELINE_ACTIONS, ...SCHEDULE_ACTIONS, ...CREDENTIAL_ACTIONS, ...USER_ACTIONS, ...GROUP_ACTIONS,
  'audit:read', 'system:config',
]

function actionsOf(role: keyof typeof BUILTIN_ROLE_PERMISSIONS): Set<PermissionAction> {
  return new Set(permissionsForBuiltinRole(role).map((p) => p.action))
}

describe('rbac built-in roles', () => {
  it('exports 29 atomic actions', () => {
    expect(totalActions()).toBe(ALL_ACTIONS.length)
  })

  it('super_admin has every action globally', () => {
    const set = actionsOf('super_admin')
    for (const a of ALL_ACTIONS) expect(set.has(a)).toBe(true)
    const perms = permissionsForBuiltinRole('super_admin')
    for (const p of perms) expect(p.scope).toBe('global')
  })

  it('admin can manage pipelines fully (CRUD + trigger) globally', () => {
    const set = actionsOf('admin')
    for (const a of PIPELINE_ACTIONS) expect(set.has(a)).toBe(true)
    for (const a of SCHEDULE_ACTIONS) expect(set.has(a)).toBe(true)
    for (const a of CREDENTIAL_ACTIONS) expect(set.has(a)).toBe(true)
    for (const a of USER_ACTIONS) expect(set.has(a)).toBe(true)
    for (const a of GROUP_ACTIONS) expect(set.has(a)).toBe(true)
    expect(set.has('audit:read')).toBe(true)
  })

  it('admin cannot do system:config', () => {
    expect(actionsOf('admin').has('system:config')).toBe(false)
  })

  it('operator can read + trigger pipelines/schedules but not modify', () => {
    const set = actionsOf('operator')
    expect(set.has('pipeline:read')).toBe(true)
    expect(set.has('pipeline:trigger')).toBe(true)
    expect(set.has('pipeline:create')).toBe(false)
    expect(set.has('pipeline:update')).toBe(false)
    expect(set.has('pipeline:delete')).toBe(false)
    expect(set.has('schedule:trigger')).toBe(true)
    expect(set.has('schedule:pause')).toBe(true)
    expect(set.has('schedule:resume')).toBe(true)
    expect(set.has('schedule:create')).toBe(false)
  })

  it('operator can read credentials but not modify', () => {
    const set = actionsOf('operator')
    expect(set.has('credential:read')).toBe(true)
    expect(set.has('credential:create')).toBe(false)
    expect(set.has('credential:update')).toBe(false)
    expect(set.has('credential:delete')).toBe(false)
  })

  it('operator cannot manage users, groups, or system config', () => {
    const set = actionsOf('operator')
    for (const a of USER_ACTIONS) expect(set.has(a)).toBe(false)
    for (const a of GROUP_ACTIONS) expect(set.has(a)).toBe(false)
    expect(set.has('system:config')).toBe(false)
  })

  it('viewer is read-only across the board', () => {
    const set = actionsOf('viewer')
    expect(set.has('pipeline:read')).toBe(true)
    expect(set.has('schedule:read')).toBe(true)
    expect(set.has('credential:read')).toBe(true)
    expect(set.has('audit:read')).toBe(true)
    // and nothing destructive:
    expect(set.has('pipeline:create')).toBe(false)
    expect(set.has('pipeline:trigger')).toBe(false)
    expect(set.has('schedule:trigger')).toBe(false)
    expect(set.has('credential:create')).toBe(false)
    for (const a of USER_ACTIONS) expect(set.has(a)).toBe(false)
    for (const a of GROUP_ACTIONS) expect(set.has(a)).toBe(false)
  })

  it('every built-in role uses global scope', () => {
    for (const role of ['super_admin', 'admin', 'operator', 'viewer'] as const) {
      const perms = permissionsForBuiltinRole(role)
      for (const p of perms) expect(p.scope).toBe('global')
    }
  })

  it('all role ids are stable and namespaced', () => {
    expect(BUILTIN_ROLE_PERMISSIONS.super_admin.id).toBe('role:super_admin')
    expect(BUILTIN_ROLE_PERMISSIONS.admin.id).toBe('role:admin')
    expect(BUILTIN_ROLE_PERMISSIONS.operator.id).toBe('role:operator')
    expect(BUILTIN_ROLE_PERMISSIONS.viewer.id).toBe('role:viewer')
  })

  it('no permission duplication within a role', () => {
    for (const role of ['super_admin', 'admin', 'operator', 'viewer'] as const) {
      const seen = new Set<PermissionAction>()
      for (const p of permissionsForBuiltinRole(role)) {
        expect(seen.has(p.action)).toBe(false)
        seen.add(p.action)
      }
    }
  })
})
