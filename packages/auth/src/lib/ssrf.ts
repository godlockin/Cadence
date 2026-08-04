/**
 * Minimal SSRF guard for @cadence/auth outbound HTTP.
 *
 * copied from @cadence/sinker/src/security.ts for dependency cycle avoidance
 * (plus @cadence/sinker/src/errors.ts for SSRFError). Keep in sync with the
 * source so behaviour does not drift.
 */
import { lookup as dnsLookup } from 'node:dns/promises'

/** HTTP-style status code for a blocked/misdirected request (mirrors sinker). */
export const SSRF_BLOCKED_STATUS = 421

export class SSRFError extends Error {
  public readonly code: number = SSRF_BLOCKED_STATUS
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`SSRF blocked: ${reason} (${url})`)
    this.name = 'SSRFError'
  }
}

/* ----------------- http handler ----------------- */

const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // AWS / GCP / Azure link-local metadata
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\./, // 0.0.0.0
]

/** `dns.lookup` lives in `node:dns`; we accept the lookup fn so tests can
 * inject a fake without booting the network. */
export type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<{ address: string; family: number }[]>

/** Real DNS lookup (node:dns/promises). Used unless a test injects a fake. */
export const defaultDnsLookup: LookupFn = (hostname, options) => dnsLookup(hostname, options)

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6_HOST = /^[0-9a-f:]+$/i
/** IPv4-mapped IPv6 (`::ffff:1.2.3.4`) — Node `dns.lookup` returns these
 * verbatim, so the embedded IPv4 must be evaluated to defeat the SSRF
 * bypass. */
const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map((p) => Number(p))
  if (parts.length !== 4) return true
  const [a, b] = parts
  if (a === undefined || b === undefined) return true
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 0) return true // 0.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a >= 224) return true // multicast / reserved
  return false
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase()
  if (lower === '::1' || lower === '::') return true // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 unique local
  if (lower.startsWith('fe80')) return true // fe80::/10 link-local
  if (lower.startsWith('::ffff:')) return true // mapped IPv6 in hex form
  return false
}

export function isPrivateIP(addr: string): boolean {
  // IPv4-mapped IPv6 → evaluate the embedded IPv4 (fixes SSRF bypass).
  const mapped = addr.match(IPV4_MAPPED_IPV6)
  if (mapped) {
    const embedded = mapped[1]
    if (embedded === undefined) return true
    return isPrivateIPv4(embedded)
  }
  if (IPV4.test(addr)) {
    return isPrivateIPv4(addr)
  }
  if (IPV6_HOST.test(addr)) {
    return isPrivateIPv6(addr)
  }
  /* Not a recognisable IP literal → treat as hostname. Hostname blocking
   * is the regex table above. */
  return false
}

export function isBlockedHost(hostname: string): boolean {
  for (const re of BLOCKED_HOST_PATTERNS) {
    if (re.test(hostname)) return true
  }
  return isPrivateIP(hostname)
}

/**
 * Returns a parsed URL or throws SSRFError. Validates the host at the
 * URL-parsing layer. A separate `assertHostResolved` should be called
 * after DNS lookup to defeat DNS rebinding.
 */
export function parseAndCheckUrl(raw: string, opts: { allowInsecure: boolean }): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch (causeValue) {
    throw new SSRFError(raw, `URL parse failed: ${String(causeValue)}`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SSRFError(raw, `protocol '${url.protocol.replace(':', '')}' is not allowed`)
  }
  if (url.protocol === 'http:' && !opts.allowInsecure) {
    throw new SSRFError(raw, 'plaintext HTTP blocked (set allow_insecure to override)')
  }
  if (isBlockedHost(url.hostname)) {
    throw new SSRFError(raw, `host '${url.hostname}' is on the block list`)
  }
  return url
}

export async function assertHostResolved(
  url: URL,
  lookup: LookupFn = defaultDnsLookup,
): Promise<void> {
  const results = await lookup(url.hostname, { all: true })
  if (results.length === 0) {
    throw new SSRFError(url.toString(), `no DNS records for '${url.hostname}'`)
  }
  for (const r of results) {
    if (isPrivateIP(r.address)) {
      throw new SSRFError(
        url.toString(),
        `hostname '${url.hostname}' resolves to private address ${r.address}`,
      )
    }
  }
}
