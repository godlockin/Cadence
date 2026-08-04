/**
 * @cadence/auth — runtime permission check (can / assertCan) tests.
 *
 * Covers the full resolution matrix:
 *  - inactive user denied
 *  - superadmin override
 *  - global / own / group scopes
 *  - group membership via storage.isGroupMember
 *  - missing resource + own/group scope denied
 *  - assertCan throws ForbiddenError
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { GroupId, UserId } from '@cadence/domain'
import {
  BUILTIN_ROLE_PERMISSIONS,
  assertCan,
  can,
  ForbiddenError,
  groupRole,
} from '../src/index.js'
import { ulid as makeUlid } from './ulid.js'
import type { CanContext } from '../src/can.js'
import type { User } from '@cadence/domain'
import { UserSchema } from '@cadence/domain'

function makeUser(overrides: Partial<User> = {}): User {
  return UserSchema.parse({
    id: crypto.randomUUID(),
    email: `u${Math.random().toString(36).slice(2, 8)}@example.com`,
    displayName: 'Test User',
    role: 'editor',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$xxx$yyy',
    isActive: true,
    isSuperadmin: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  })
}

async function setupUser(
  storage: InMemoryStorageAdapter,
  overrides: Partial<User> = {},
  roles: import('@cadence/storage').ResolvedUserRole[] = [],
): Promise<User> {
  const u = makeUser(overrides)
  await storage.saveUser(u)
  for (const r of roles) {
    storage.setUserRole(u.id, r)
  }
  return u
}

describe('can / assertCan', () => {
  let storage: InMemoryStorageAdapter
  beforeEach(async () => {
    storage = new InMemoryStorageAdapter()
  })

  function ctx(user: User): CanContext {
    return { user, storage }
  }

  describe('gate: user state', () => {
    it('inactive user is always denied', async () => {
      const u = await setupUser(
        storage,
        { isActive: false },
        [BUILTIN_ROLE_PERMISSIONS.admin],
      )
      expect(await can(ctx(u), 'pipeline:read')).toBe(false)
    })

    it('superadmin bypasses role/permission lookup', async () => {
      const u = await setupUser(storage, { isSuperadmin: true })
      // No roles assigned.
      expect(await can(ctx(u), 'system:config')).toBe(true)
      expect(await can(ctx(u), 'pipeline:delete')).toBe(true)
    })

    it('user with no roles is denied (except superadmin)', async () => {
      const u = await setupUser(storage, { isSuperadmin: false })
      expect(await can(ctx(u), 'pipeline:read')).toBe(false)
    })
  })

  describe('admin role', () => {
    it('admin can do every action except system:config', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.admin])
      for (const action of [
        'pipeline:create', 'pipeline:read', 'pipeline:update', 'pipeline:delete', 'pipeline:trigger',
        'schedule:create', 'schedule:read', 'schedule:update', 'schedule:delete', 'schedule:trigger', 'schedule:pause', 'schedule:resume',
        'credential:create', 'credential:read', 'credential:update', 'credential:delete', 'credential:refresh',
        'user:invite', 'user:read', 'user:update', 'user:delete', 'user:assign_role',
        'group:create', 'group:read', 'group:update', 'group:delete', 'group:manage_members',
        'audit:read',
      ] as const) {
        expect(await can(ctx(u), action)).toBe(true)
      }
      expect(await can(ctx(u), 'system:config')).toBe(false)
    })
  })

  describe('operator role', () => {
    it('operator can read + trigger pipelines', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.operator])
      expect(await can(ctx(u), 'pipeline:read')).toBe(true)
      expect(await can(ctx(u), 'pipeline:trigger')).toBe(true)
    })

    it('operator cannot delete or modify pipelines', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.operator])
      expect(await can(ctx(u), 'pipeline:create')).toBe(false)
      expect(await can(ctx(u), 'pipeline:update')).toBe(false)
      expect(await can(ctx(u), 'pipeline:delete')).toBe(false)
    })

    it('operator cannot manage schedules (except trigger/pause/resume)', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.operator])
      expect(await can(ctx(u), 'schedule:trigger')).toBe(true)
      expect(await can(ctx(u), 'schedule:pause')).toBe(true)
      expect(await can(ctx(u), 'schedule:resume')).toBe(true)
      expect(await can(ctx(u), 'schedule:create')).toBe(false)
      expect(await can(ctx(u), 'schedule:update')).toBe(false)
      expect(await can(ctx(u), 'schedule:delete')).toBe(false)
    })

    it('operator can read credentials but cannot create them', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.operator])
      expect(await can(ctx(u), 'credential:read')).toBe(true)
      expect(await can(ctx(u), 'credential:create')).toBe(false)
    })

    it('operator cannot manage users, groups, or system config', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.operator])
      for (const a of ['user:invite', 'group:create', 'system:config'] as const) {
        expect(await can(ctx(u), a)).toBe(false)
      }
    })
  })

  describe('viewer role', () => {
    it('viewer can read pipelines, schedules, credentials, audit', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.viewer])
      expect(await can(ctx(u), 'pipeline:read')).toBe(true)
      expect(await can(ctx(u), 'schedule:read')).toBe(true)
      expect(await can(ctx(u), 'credential:read')).toBe(true)
      expect(await can(ctx(u), 'audit:read')).toBe(true)
    })

    it('viewer cannot trigger or modify', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.viewer])
      expect(await can(ctx(u), 'pipeline:trigger')).toBe(false)
      expect(await can(ctx(u), 'schedule:trigger')).toBe(false)
      expect(await can(ctx(u), 'credential:create')).toBe(false)
    })
  })

  describe('own scope', () => {
    it('own-scope grants access to a resource owned by the user', async () => {
      const u = await setupUser(storage, {}, [
        groupRole('own-pipelines', makeUlid() as unknown as GroupId, []),
      ])
      // Use a manually-built role that has only the 'own' pipeline:read grant
      const ownRole = {
        id: 'own-read',
        name: 'own-read',
        scope: 'own' as const,
        groupId: null,
        permissions: [{ action: 'pipeline:read' as const, scope: 'own' as const }],
      }
      storage.setUserRole(u.id, ownRole)
      const resource = { ownerId: u.id, groupId: null }
      expect(await can(ctx(u), 'pipeline:read', resource)).toBe(true)
    })

    it('own-scope denies access to someone else\'s resource', async () => {
      const u = await setupUser(storage, {}, [])
      const ownRole = {
        id: 'own-read',
        name: 'own-read',
        scope: 'own' as const,
        groupId: null,
        permissions: [{ action: 'pipeline:read' as const, scope: 'own' as const }],
      }
      storage.setUserRole(u.id, ownRole)
      const otherId = makeUlid() as unknown as UserId
      expect(await can(ctx(u), 'pipeline:read', { ownerId: otherId, groupId: null })).toBe(false)
    })

    it('own-scope denies when no resource is supplied', async () => {
      const u = await setupUser(storage, {}, [])
      const ownRole = {
        id: 'own-write',
        name: 'own-write',
        scope: 'own' as const,
        groupId: null,
        permissions: [{ action: 'pipeline:update' as const, scope: 'own' as const }],
      }
      storage.setUserRole(u.id, ownRole)
      expect(await can(ctx(u), 'pipeline:update')).toBe(false)
    })
  })

  describe('group scope', () => {
    it('group-scope grants access to a resource in a joined group', async () => {
      const groupId = makeUlid() as unknown as GroupId
      await storage.saveGroup({
        id: groupId,
        name: 'team',
        description: '',
        ownerId: makeUlid() as unknown as UserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      const u = await setupUser(storage, {}, [])
      const grpRole = groupRole('grp', groupId, [
        { action: 'pipeline:read', scope: 'group' },
      ])
      storage.setUserRole(u.id, grpRole)
      const resource = { ownerId: makeUlid() as unknown as UserId, groupId }
      expect(await can(ctx(u), 'pipeline:read', resource)).toBe(true)
    })

    it('group-scope denies non-members (no role, not the owner)', async () => {
      const groupId = makeUlid() as unknown as GroupId
      await storage.saveGroup({
        id: groupId,
        name: 'team',
        description: '',
        ownerId: makeUlid() as unknown as UserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      // A user with no group-scoped role at all.
      const u = await setupUser(storage, {}, [])
      const resource = { ownerId: makeUlid() as unknown as UserId, groupId }
      expect(await can(ctx(u), 'pipeline:read', resource)).toBe(false)
    })

    it('group-scope denies when resource has no groupId', async () => {
      const u = await setupUser(storage, {}, [])
      const grpRole = groupRole('grp', makeUlid() as unknown as GroupId, [
        { action: 'pipeline:read', scope: 'group' },
      ])
      storage.setUserRole(u.id, grpRole)
      expect(await can(ctx(u), 'pipeline:read', { ownerId: u.id, groupId: null })).toBe(false)
    })
  })

  describe('assertCan', () => {
    it('throws ForbiddenError when can returns false', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.viewer])
      await expect(assertCan(ctx(u), 'pipeline:delete')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('resolves when can returns true', async () => {
      const u = await setupUser(storage, {}, [BUILTIN_ROLE_PERMISSIONS.viewer])
      await expect(assertCan(ctx(u), 'pipeline:read')).resolves.toBeUndefined()
    })

    it('superadmin path does not call storage (no roles needed)', async () => {
      const u = await setupUser(storage, { isSuperadmin: true })
      await expect(assertCan(ctx(u), 'system:config')).resolves.toBeUndefined()
    })

    it('inactive superadmin is still denied (gate fires first)', async () => {
      const u = await setupUser(storage, { isSuperadmin: true, isActive: false })
      await expect(assertCan(ctx(u), 'pipeline:read')).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe('multi-role aggregation', () => {
    it('union of permissions from multiple roles', async () => {
      const u = await setupUser(storage, {}, [
        BUILTIN_ROLE_PERMISSIONS.viewer,
        BUILTIN_ROLE_PERMISSIONS.operator,
      ])
      // Operator adds trigger/pause rights on top of viewer reads.
      expect(await can(ctx(u), 'pipeline:read')).toBe(true) // viewer
      expect(await can(ctx(u), 'pipeline:trigger')).toBe(true) // operator
      expect(await can(ctx(u), 'schedule:pause')).toBe(true) // operator
      expect(await can(ctx(u), 'pipeline:create')).toBe(false) // neither
    })
  })
})
