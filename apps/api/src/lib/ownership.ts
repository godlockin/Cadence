/**
 * @cadence/api — resource ownership / IDOR guard helpers.
 *
 * Centralizes the "load resource + verify caller can act on it" pattern
 * so every endpoint enforces ownership in the same way.
 *
 * Design:
 *  - `loadAndAuthorize` does the full happy path: load → 404 if missing
 *    → 403 if the user lacks the action on the resource.
 *  - `authorizeResource` is for the case where the caller already has
 *    the resource in hand and just needs a permission check.
 *
 * Default-deny: any unexpected condition throws ForbiddenError rather
 * than silently allowing.
 */
import type { Context } from 'hono'
import type { GroupId, PermissionAction, UserId } from '@cadence/domain'
import { ForbiddenError, can, type CanResource } from '@cadence/auth'
import { NotFoundError } from '@cadence/storage'
import type { AppEnv } from '../app.js'

/**
 * Run a permission check against the current user. The user and
 * storage are pulled from the Hono context (set by `requireAuth`).
 *
 * Throws `ForbiddenError` on deny; the global error handler turns it
 * into a 403 JSON envelope.
 */
export async function authorizeResource(
  c: Context<AppEnv>,
  action: PermissionAction,
  resource: CanResource,
): Promise<void> {
  const user = c.get('user')
  const storage = c.get('storage')
  const allowed = await can({ user, storage }, action, resource)
  if (!allowed) {
    throw new ForbiddenError(`User ${user.id} cannot ${action} this resource`)
  }
}

/**
 * Convenience wrapper: load a resource by id, then authorize the
 * current user against the action + extracted ownership tuple.
 *
 * Throws:
 *  - `NotFoundError` when the resource is missing
 *  - `ForbiddenError` when the caller lacks the action
 *
 * Returns the loaded resource so the route handler can keep using it.
 */
export async function loadAndAuthorize<T>(
  c: Context<AppEnv>,
  resourceId: string,
  loader: (id: string) => Promise<T | null>,
  action: PermissionAction,
  extractOwner: (resource: T) => { ownerId: UserId; groupId?: GroupId | null },
): Promise<T> {
  const resource = await loader(resourceId)
  if (resource === null) {
    throw new NotFoundError(action.split(':')[0] ?? 'Resource', resourceId)
  }
  await authorizeResource(c, action, extractOwner(resource))
  return resource
}
