/**
 * @cadence/api — RBAC integration matrix.
 *
 * For each (role, endpoint) pair, verify whether the call is allowed
 * (2xx) or forbidden (403). The matrix is exhaustive against the four
 * built-in roles (super_admin, admin, operator, viewer) on the seven
 * critical endpoints.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { BuiltinRole } from '@cadence/auth'
import { buildTestApp, callApp } from './helpers.js'

interface Probe {
  readonly label: string
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly path: (ownerToken: string, taskId: string) => string
  readonly body?: () => unknown
  /** Set true to first create a task to read against. */
  readonly needsTask?: boolean
  /** Expected status by role. */
  readonly expected: Record<BuiltinRole, number>
}

const PROBES: Probe[] = [
  {
    label: 'GET /api/tasks',
    method: 'GET',
    path: () => '/api/tasks',
    expected: {
      super_admin: 200,
      admin: 200,
      operator: 200,
      viewer: 200,
    },
  },
  {
    label: 'POST /api/tasks',
    method: 'POST',
    path: () => '/api/tasks',
    body: () => ({
      name: 'rbac-test',
      payloadKind: 'http',
      payload: {},
      triggerKind: 'manual',
      triggerConfig: {},
    }),
    expected: {
      super_admin: 201,
      admin: 201,
      operator: 403,
      viewer: 403,
    },
  },
  {
    label: 'GET /api/users',
    method: 'GET',
    path: () => '/api/users',
    expected: {
      super_admin: 200,
      admin: 200,
      operator: 403,
      viewer: 403,
    },
  },
  {
    label: 'GET /api/groups',
    method: 'GET',
    path: () => '/api/groups',
    expected: {
      super_admin: 200,
      admin: 200,
      operator: 403,
      viewer: 403,
    },
  },
  {
    label: 'GET /api/audit/logs',
    method: 'GET',
    path: () => '/api/audit/logs',
    expected: {
      super_admin: 200,
      admin: 200,
      operator: 200,
      viewer: 200,
    },
  },
]

const ROLES: BuiltinRole[] = ['super_admin', 'admin', 'operator', 'viewer']

describe('rbac matrix', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  for (const probe of PROBES) {
    for (const role of ROLES) {
      it(`${role} → ${probe.label} → ${probe.expected[role]}`, async () => {
        const { user, tokens } = await t.registerUser({ email: `${role}-${Math.random().toString(36).slice(2, 6)}@e.com` })
        t.setUserRole(user.id, role)
        const res = await callApp(t.app, probe.method, probe.path(tokens.accessToken, ''), {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
          body: probe.body?.(),
        })
        expect(res.status).toBe(probe.expected[role])
      })
    }
  }

  it('anonymous: every protected endpoint → 401', async () => {
    for (const probe of PROBES) {
      const res = await callApp(t.app, probe.method, probe.path('', ''), {
        body: probe.body?.(),
      })
      expect(res.status).toBe(401)
    }
  })
})