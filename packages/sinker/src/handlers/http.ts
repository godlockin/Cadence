/**
 * @cadence/sinker — HTTP handler.
 *
 * Runs `fetch(url, …)` inside an SSRF guard:
 *   - URL parse + protocol + host blacklist at the parsing layer.
 *   - DNS lookup of the host re-checked post-resolution to defeat
 *     DNS rebinding.
 *   - redirects are followed manually; each hop re-enters the guard.
 *   - timeout is forced (default 30s).
 *   - HTTPS is the default; `allow_insecure: true` opts in to http://.
 *
 * In Cloudflare Workers the standard `fetch` is already protected by the
 * runtime's outbound allowlist; we still apply the host guard for
 * defence-in-depth and to surface a typed error early.
 */
import { z } from 'zod'
import { lookup as defaultLookup } from 'node:dns/promises'
import type { PayloadHandler } from '../types.js'
import { assertHostResolved, parseAndCheckUrl, type LookupFn } from '../security.js'

const HttpConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('POST'),
  headers: z.record(z.string()).default({}),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
  allow_insecure: z.boolean().default(false),
  follow_redirects: z.boolean().default(true),
  max_redirects: z.number().int().min(0).max(10).default(5),
})
export type HttpConfig = z.infer<typeof HttpConfigSchema>

const dnsLookupAdapter: LookupFn = async (hostname, _options) => {
  const out = await defaultLookup(hostname, { all: true })
  return out.map((a) => ({ address: a.address, family: a.family }))
}

const FETCHER: typeof fetch = (...args) => fetch(...args)

export class HttpHandler implements PayloadHandler<HttpConfig> {
  readonly kind = 'http' as const

  /** Override the DNS lookup function (used by tests). */
  constructor(
    private readonly opts: {
      readonly fetch?: typeof fetch
      readonly lookup?: LookupFn
    } = {},
  ) {
    if (opts.lookup) this.lookup = opts.lookup
    if (opts.fetch) this.fetcher = opts.fetch
  }

  private readonly lookup: LookupFn = dnsLookupAdapter
  private readonly fetcher: typeof fetch = FETCHER

  validateConfig(raw: unknown): HttpConfig {
    return HttpConfigSchema.parse(raw)
  }

  async execute(config: HttpConfig, ctx: Parameters<PayloadHandler['execute']>[1]): Promise<void> {
    ctx.emit({ type: 'started', ts: Date.now() })

    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(new Error('http-timeout')), config.timeoutMs)
    const onParent = () => ac.abort(ctx.signal.reason)
    ctx.signal.addEventListener('abort', onParent, { once: true })

    try {
      const { response, finalUrl } = await this.runGuarded(config, ac.signal)

      const text = await response.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        /* keep text */
      }

      ctx.emit({
        type: 'result',
        ts: Date.now(),
        data: { status: response.status, url: finalUrl, body: parsed },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }
    } finally {
      clearTimeout(t)
      ctx.signal.removeEventListener('abort', onParent)
      ctx.emit({ type: 'finished', ts: Date.now() })
    }
  }

  private async runGuarded(
    config: HttpConfig,
    signal: AbortSignal,
  ): Promise<{ response: Response; finalUrl: string }> {
    let url = parseAndCheckUrl(config.url, { allowInsecure: config.allow_insecure })
    await assertHostResolved(url, this.lookup)

    const headers = { ...config.headers }
    const init: RequestInit = {
      method: config.method,
      headers,
      signal,
      redirect: 'manual',
    }
    if (config.body !== undefined && config.method !== 'GET' && config.method !== 'HEAD') {
      init.body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body)
    }

    let redirects = 0
    let response = await this.fetcher(url.toString(), init)
    while (
      config.follow_redirects &&
      response.status >= 300 &&
      response.status < 400 &&
      redirects < config.max_redirects
    ) {
      const loc = response.headers.get('location')
      if (!loc) break
      const next = new URL(loc, url)
      url = parseAndCheckUrl(next.toString(), { allowInsecure: config.allow_insecure })
      await assertHostResolved(url, this.lookup)
      response = await this.fetcher(url.toString(), { ...init, redirect: 'manual' })
      redirects += 1
    }

    return { response, finalUrl: url.toString() }
  }
}
