/**
 * @cadence/sinker — Webhook handler.
 * A webhook payload exposes an inbound URL. The host app registers the URL
 * with its HTTP layer; inbound requests call SinkerEngine.trigger() with
 * `source: 'webhook'` and the body as the trigger payload.
 *
 * The handler itself validates the URL/path config and emits a "registered"
 * event so the rest of the system knows the URL is live.
 */
import { z } from 'zod'
import type { PayloadHandler } from '../types.js'

const WebhookConfigSchema = z.object({
  /** Path the host app should register (e.g. "/hooks/abc123"). */
  path: z.string().regex(/^\//, 'path must start with /'),
  /** HTTP methods accepted. */
  methods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])).default(['POST']),
  /** Optional HMAC secret for body verification (checked by the host app). */
  secret: z.string().optional(),
})
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>

export class WebhookHandler implements PayloadHandler<WebhookConfig> {
  readonly kind = 'webhook' as const
  private readonly registered = new Set<string>()

  validateConfig(raw: unknown): WebhookConfig {
    return WebhookConfigSchema.parse(raw)
  }

  /**
   * Returns the public URL for the webhook. The host must call
   * `register(path)` on its HTTP router so inbound requests fan out to
   * SinkerEngine.trigger(taskId, { source: 'webhook', payload: body }).
   */
  register(baseUrl: string, config: WebhookConfig): string {
    const url = `${baseUrl.replace(/\/$/, '')}${config.path}`
    this.registered.add(url)
    return url
  }

  registeredUrls(): readonly string[] {
    return [...this.registered]
  }

  async execute(
    config: WebhookConfig,
    ctx: Parameters<PayloadHandler['execute']>[1],
  ): Promise<void> {
    /* Webhook "execution" is mostly a no-op confirmation; the real work
     * happens when the inbound HTTP request fires trigger(). */
    ctx.emit({
      type: 'started',
      ts: Date.now(),
      data: { path: config.path, methods: config.methods },
    })
    ctx.emit({
      type: 'result',
      ts: Date.now(),
      data: { registered: this.registered.size, path: config.path },
    })
    ctx.emit({ type: 'finished', ts: Date.now() })
  }
}
