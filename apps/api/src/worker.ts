/**
 * Cloudflare Workers entry — `apps/api/src/worker.ts`.
 *
 * Wraps the Cloudflare adapter's app into the default export. The
 * `env` binding is declared by `wrangler.toml`; the type comes from
 * `./adapters/cloudflare.js`.
 *
 * Also exports `scheduled` — the Cron Trigger controller. Cloudflare
 * calls this once per cron expression that matches `wrangler.toml`'s
 * `triggers.crons` array. We re-emit the work through the scheduler
 * adapter so tasks registered via the API get picked up.
 */
import { buildCloudflareApp, type CloudflareEnv } from './adapters/cloudflare.js'

export { buildCloudflareApp }
export type { CloudflareEnv }

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const { app } = buildCloudflareApp(env)
    return app.fetch(request)
  },
  async scheduled(
    controller: { readonly cron: string; readonly scheduledTime: number },
    env: CloudflareEnv,
  ): Promise<void> {
    const built = buildCloudflareApp(env)
    await built.onScheduled({
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    })
  },
}
