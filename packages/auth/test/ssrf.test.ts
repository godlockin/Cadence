/**
 * @cadence/auth — SSRF guard unit tests.
 *
 * Covers the IPv4-mapped IPv6 bypass (`::ffff:127.0.0.1`): Node `dns.lookup`
 * returns mapped addresses verbatim, so `isPrivateIP` must evaluate the
 * embedded IPv4. Also covers plain IPv4 / IPv6 literals.
 */
import { describe, expect, it } from 'vitest'
import {
  assertHostResolved,
  isBlockedHost,
  isPrivateIP,
} from '../src/lib/ssrf.js'
import type { LookupFn } from '../src/lib/ssrf.js'

describe('isPrivateIP — IPv4-mapped IPv6', () => {
  it('blocks mapped loopback', () => {
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true)
  })
  it('blocks mapped 10.0.0.0/8', () => {
    expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true)
  })
  it('blocks mapped 192.168.0.0/16', () => {
    expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true)
  })
  it('allows mapped public IPv4', () => {
    expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false)
  })
  it('blocks mapped 172.16.0.0/12', () => {
    expect(isPrivateIP('::ffff:172.16.5.1')).toBe(true)
  })
  it('blocks mapped link-local 169.254.0.0/16', () => {
    expect(isPrivateIP('::ffff:169.254.169.254')).toBe(true)
  })
})

describe('isPrivateIP — plain IPv6', () => {
  it('blocks loopback ::1', () => {
    expect(isPrivateIP('::1')).toBe(true)
  })
  it('blocks unique-local fc00::/7', () => {
    expect(isPrivateIP('fc00::1')).toBe(true)
  })
  it('allows public Google DNS', () => {
    expect(isPrivateIP('2001:4860:4860::8888')).toBe(false)
  })
  it('blocks mapped IPv6 in hex form', () => {
    expect(isPrivateIP('::ffff:7f00:1')).toBe(true)
  })
})

describe('isPrivateIP — plain IPv4 (regression)', () => {
  it('blocks 127.0.0.1', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true)
  })
  it('blocks 169.254.169.254 metadata', () => {
    expect(isPrivateIP('169.254.169.254')).toBe(true)
  })
  it('allows 8.8.8.8', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)
  })
  it('treats hostnames as not-IP (hostname regexes handle them)', () => {
    expect(isPrivateIP('example.com')).toBe(false)
  })
})

describe('isBlockedHost — IPv4-mapped IPv6', () => {
  it('blocks mapped loopback host string', () => {
    expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true)
  })
  it('allows mapped public host string', () => {
    expect(isBlockedHost('::ffff:8.8.8.8')).toBe(false)
  })
})

describe('assertHostResolved — DNS returns IPv4-mapped IPv6', () => {
  const lookup: LookupFn = async () => [{ address: '::ffff:127.0.0.1', family: 6 }]
  const publicLookup: LookupFn = async () => [{ address: '2001:4860:4860::8888', family: 6 }]

  it('rejects a hostname that resolves to mapped loopback', async () => {
    await expect(
      assertHostResolved(new URL('http://attacker.example.com/'), lookup),
    ).rejects.toThrow(/resolves to private address ::ffff:127\.0\.0\.1/)
  })

  it('allows a hostname that resolves to public IPv6', async () => {
    await expect(
      assertHostResolved(new URL('http://public.example.com/'), publicLookup),
    ).resolves.toBeUndefined()
  })
})
