/**
 * @cadence/nodes — security helpers shared by shell/script/http-family nodes.
 *
 * Ported from @cadence/sinker/src/security.ts (PHASE 0-4 work) so the node
 * package is self-contained. Three responsibilities:
 *   1. command whitelist / argv token safety / env whitelist / cwd allow-list,
 *   2. SSRF guards (URL parse + host block + DNS rebinding defence),
 *   3. script sandbox static scan (dangerous identifier patterns).
 */
import { z } from 'zod'

/* ---------------- typed errors ---------------- */

export class NodeCommandError extends Error {
  public readonly code = 422
  constructor(public readonly reason: string) {
    super(`Command rejected: ${reason}`)
    this.name = 'NodeCommandError'
  }
}

export class NodeSSRFError extends Error {
  public readonly code = 421
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`SSRF blocked: ${reason} (${url})`)
    this.name = 'NodeSSRFError'
  }
}

export class NodeScriptSandboxError extends Error {
  public readonly code = 422
  constructor(public readonly reason: string) {
    super(`Script sandbox rejected: ${reason}`)
    this.name = 'NodeScriptSandboxError'
  }
}

/* ----------------- command handler ----------------- */

export const ALLOWED_BINARIES: ReadonlySet<string> = new Set([
  /* network */
  'curl',
  'wget',
  'ssh',
  'scp',
  'rsync',
  /* version control */
  'git',
  /* runtimes */
  'node',
  'npm',
  'pnpm',
  'python3',
  'ruby',
  'go',
  /* text processing */
  'echo',
  'cat',
  'head',
  'tail',
  'grep',
  'jq',
  'sed',
  'awk',
  'sort',
  /* archives */
  'tar',
  'gzip',
  'gunzip',
  'zip',
  'unzip',
  /* file management */
  'cp',
  'mv',
  'mkdir',
  'ls',
  'find',
  'xargs',
  /* desktop / OS */
  'open',
  'xdg-open',
  'start',
  'osascript',
  'notify-send',
  'msg',
])

/** Flags that are SAFE to pass through even when args are sandboxed. */
export const SAFE_FLAGS: ReadonlySet<string> = new Set([
  '-X',
  '-H',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--header',
  '-u',
  '--user',
  '-L',
  '--location',
  '-k',
  '--insecure',
  '-o',
  '--output',
  '-O',
  '--remote-name',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-sS',
  '-Ss',
  '-f',
  '--fail',
  '-i',
  '--include',
  '-v',
  '--verbose',
  '--max-time',
  '--no-pager',
  '--git-dir',
  '--work-tree',
  '-e',
  '-p',
  '-r',
  '--require',
  '-n',
  '-E',
  '-F',
  '-P',
  '-i',
  '-r',
  '-R',
  '-l',
  '-c',
  '-q',
  '--quiet',
  '--server-response',
  /* notify-send */
  '--expire-time',
  '--urgency',
  '--action',
  '--icon',
  '--hint',
  '--category',
  '-a',
  '--app-name',
])

/** Env vars we are willing to forward to a child process. */
export const SAFE_ENV_KEYS: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'SHELL',
])

const SHELL_METACHARS = /[;`|&$<>{}\n\r\\]/

export function hasShellMetachar(s: string): boolean {
  return SHELL_METACHARS.test(s)
}

export function isSafeArg(arg: string, allowFlags: ReadonlySet<string> = SAFE_FLAGS): boolean {
  if (arg === '') return false
  if (hasShellMetachar(arg)) return false
  if (arg.startsWith('-')) return allowFlags.has(arg)
  return true
}

export function isSafeBinary(cmd: string): boolean {
  if (cmd === '') return false
  if (cmd.includes('/') || cmd.includes('\\')) return false
  return ALLOWED_BINARIES.has(cmd)
}

export function isSafeEnvKey(key: string): boolean {
  return SAFE_ENV_KEYS.has(key)
}

export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
export const MAX_COMMAND_TIMEOUT_MS = 300_000

export const CommandSecurityConfigSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).default({}),
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(MAX_COMMAND_TIMEOUT_MS)
    .default(DEFAULT_COMMAND_TIMEOUT_MS),
})
export type CommandSecurityConfig = z.infer<typeof CommandSecurityConfigSchema>

/** Throws NodeCommandError if any layer of the command config is unsafe. */
export function assertCommandSafe(config: CommandSecurityConfig): void {
  if (!isSafeBinary(config.cmd)) {
    throw new NodeCommandError(`binary '${config.cmd}' is not in the whitelist`)
  }
  for (let i = 0; i < config.args.length; i += 1) {
    const a = config.args[i]
    if (a === undefined) continue
    if (!isSafeArg(a)) {
      throw new NodeCommandError(`arg[${i}]='${a}' rejected (shell metachar or unknown flag)`)
    }
  }
  for (const key of Object.keys(config.env)) {
    if (!isSafeEnvKey(key)) {
      throw new NodeCommandError(`env key '${key}' is not in the whitelist`)
    }
  }
  if (config.cwd !== undefined && config.cwd !== '' && !isSafeCwd(config.cwd)) {
    throw new NodeCommandError(`cwd '${config.cwd}' is not in the allowed paths`)
  }
}

/** Allowed working directories. Only /tmp, os.tmpdir(), and user $HOME pass. */
export function isSafeCwd(cwd: string): boolean {
  if (cwd.startsWith('/tmp/') || cwd === '/tmp') return true
  const home = process.env['HOME']
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) return true
  return false
}

/* ----------------- http handler ----------------- */

const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\./,
]

export type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<{ address: string; family: number }[]>

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
 * Returns a parsed URL or throws NodeSSRFError. Validates at the URL-parsing
 * layer; call `assertHostResolved` after DNS to defeat rebinding.
 */
export function parseAndCheckUrl(raw: string, opts: { allowInsecure: boolean }): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch (causeValue) {
    throw new NodeSSRFError(raw, `URL parse failed: ${String(causeValue)}`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new NodeSSRFError(raw, `protocol '${url.protocol.replace(':', '')}' is not allowed`)
  }
  if (url.protocol === 'http:' && !opts.allowInsecure) {
    throw new NodeSSRFError(raw, 'plaintext HTTP blocked (set allow_insecure to override)')
  }
  if (isBlockedHost(url.hostname)) {
    throw new NodeSSRFError(raw, `host '${url.hostname}' is on the block list`)
  }
  return url
}

export async function assertHostResolved(url: URL, lookup: LookupFn): Promise<void> {
  const results = await lookup(url.hostname, { all: true })
  if (results.length === 0) {
    throw new NodeSSRFError(url.toString(), `no DNS records for '${url.hostname}'`)
  }
  for (const r of results) {
    if (isPrivateIP(r.address)) {
      throw new NodeSSRFError(
        url.toString(),
        `hostname '${url.hostname}' resolves to private address ${r.address}`,
      )
    }
  }
}

/** Node `dns.lookup` adapted to the LookupFn contract. */
export function nodeLookupAdapter(
  hostname: string,
  _options: { all: true },
): Promise<{ address: string; family: number }[]> {
  return import('node:dns/promises')
    .then((dns) =>
      dns
        .lookup(hostname, { all: true })
        .then((out) => out.map((a) => ({ address: a.address, family: a.family }))),
    )
    .catch(() => [])
}

/* ----------------- script handler ----------------- */

export const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000
export const MAX_SCRIPT_TIMEOUT_MS = 300_000
export const SCRIPT_MEMORY_LIMIT_MB = 128

const DANGEROUS_SCRIPT_PATTERNS: readonly RegExp[] = [
  /\bFunction\b/,
  /\beval\b/,
  /\bnew\s+Function\b/,
  /\bimport\s*\(/,
  /\brequire\b/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bmodule\b/,
  /\bexports\b/,
  /\bBuffer\b/,
  /\bchild_process\b/,
  /\bnew\s+Worker\s*\(/,
  /\bprocess\s*\.\s*(?:exit|binding|env|argv|stdout|stderr|cwd|chdir|kill)\b/,
  /\bglobal\b\s*\[/,
  /\bnew\s+Proxy\b/,
  /\bnew\s+Reflect\b/,
  /\bReflect\b/,
]

export function findDangerousScriptPatterns(source: string): readonly string[] {
  const out: string[] = []
  for (const re of DANGEROUS_SCRIPT_PATTERNS) {
    const m = re.exec(source)
    if (m) out.push(m[0])
  }
  return out
}

export const ScriptSecurityConfigSchema = z.object({
  source: z.string().min(1).max(64_000),
  filename: z.string().min(1).default('inline-script.js'),
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(MAX_SCRIPT_TIMEOUT_MS)
    .default(DEFAULT_SCRIPT_TIMEOUT_MS),
})
export type ScriptSecurityConfig = z.infer<typeof ScriptSecurityConfigSchema>

export function assertScriptSafe(config: ScriptSecurityConfig): void {
  const hits = findDangerousScriptPatterns(config.source)
  if (hits.length > 0) {
    throw new NodeScriptSandboxError(`disallowed identifier: ${hits[0]}`)
  }
}
