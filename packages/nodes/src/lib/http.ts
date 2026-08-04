/**
 * @cadence/nodes — guarded outbound HTTP helper (ported from sinker http.ts).
 *
 * Runs `fetch(url, …)` behind the SSRF guard:
 *   - URL parse + protocol + host blocklist at the parse layer,
 *   - DNS lookup re-checked post-resolution to defeat rebinding,
 *   - manual redirects, each hop re-enters the guard,
 *   - forced timeout (default 30s).
 */
import { z } from 'zod'
import type { LookupFn } from './security.js'
import { assertHostResolved, nodeLookupAdapter, parseAndCheckUrl } from './security.js'

export const HttpRequestConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('POST'),
  headers: z.record(z.string()).default({}),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
  allow_insecure: z.boolean().default(false),
  follow_redirects: z.boolean().default(true),
  max_redirects: z.number().int().min(0).max(10).default(5),
  /** Opt-out of the post-DNS rebinding guard. Only for trusted sandboxes. */
  skip_dns_check: z.boolean().default(false),
})
export type HttpRequestConfig = z.infer<typeof HttpRequestConfigSchema>

export interface HttpRequestResult {
  readonly status: number
  readonly statusText: string
  readonly ok: boolean
  readonly url: string
  readonly body: unknown
  readonly headers: Readonly<Record<string, string>>
}

export interface HttpRunOptions {
  readonly fetch?: typeof fetch
  readonly lookup?: LookupFn
}

const FETCHER: typeof fetch = (...args) => fetch(...args)

export async function runGuardedHttp(
  config: HttpRequestConfig,
  signal: AbortSignal,
  opts: HttpRunOptions = {},
): Promise<HttpRequestResult> {
  const fetcher = opts.fetch ?? FETCHER
  const lookup: LookupFn = opts.lookup ?? nodeLookupAdapter

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(new Error('http-timeout')), config.timeoutMs)
  const onParent = () => ac.abort(signal.reason)
  signal.addEventListener('abort', onParent, { once: true })

  try {
    let url = parseAndCheckUrl(config.url, { allowInsecure: config.allow_insecure })
    if (!config.skip_dns_check) await assertHostResolved(url, lookup)

    const headers = { ...config.headers }
    const init: RequestInit = {
      method: config.method,
      headers,
      signal: ac.signal,
      redirect: 'manual',
    }
    if (config.body !== undefined && config.method !== 'GET' && config.method !== 'HEAD') {
      init.body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body)
    }

    let redirects = 0
    let response = await fetcher(url.toString(), init)
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
      if (!config.skip_dns_check) await assertHostResolved(url, lookup)
      response = await fetcher(url.toString(), { ...init, redirect: 'manual' })
      redirects += 1
    }

    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text) as unknown
    } catch {
      /* keep text */
    }

    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url: url.toString(),
      body,
      headers: Object.fromEntries(response.headers.entries()),
    }
  } finally {
    clearTimeout(t)
    signal.removeEventListener('abort', onParent)
  }
}
