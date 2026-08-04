/**
 * @cadence/api — scheduler routes.
 *
 *   GET /api/health
 *     Reports overall status. Delegates to healthCheck() in ./health.ts.
 *
 *   GET /api/scheduler/status
 *     Scheduler snapshot (cron enabled, webhook registrations, cache size).
 */
import { Hono } from 'hono'
import type { SchedulerHandle } from '@cadence/scheduler'

import type { AppEnv } from '../app.js'

export interface MountSchedulerDeps {
  readonly scheduler?: SchedulerHandle
}

export function mountSchedulerRoutes(deps: MountSchedulerDeps): Hono<AppEnv> {
  const { scheduler } = deps
  const r = new Hono<AppEnv>()

  /* GET /api/scheduler/status — introspection */
  r.get('/status', async (c) => {
    if (scheduler === undefined) {
      return c.json({
        running: false,
        cron: false,
        webhookRegistrations: 0,
        webhookCacheSize: 0,
        uptimeSeconds: 0,
        message: 'scheduler not installed in this app instance',
      })
    }
    return c.json(scheduler.status())
  })

  return r
}
