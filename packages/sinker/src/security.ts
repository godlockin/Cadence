/**
 * @cadence/sinker — security helpers shared by command/http/script handlers.
 *
 * Two responsibilities:
 *   1. Whitelists / blacklists (binaries, env keys, hosts, shell metachars).
 *   2. Pure predicates (isPrivateIPv4, hasShellMetachar, isSafeArg, etc.)
 *      so they can be unit-tested without involving the handlers.
 */
import { z } from 'zod'
import { CommandInjectionError, SSRFError, ScriptSandboxError } from './errors.js'

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
  /* curl */
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
  /* git */
  '--no-pager',
  '--git-dir',
  '--work-tree',
  /* node */
  '-e',
  '-p',
  '-r',
  '--require',
  /* grep / find */
  '-n',
  '-E',
  '-F',
  '-P',
  '-i',
  '-r',
  '-R',
  '-l',
  '-c',
  /* wget */
  '-q',
  '--quiet',
  '--server-response',
  /* generic: when paired with a whitelisted -X<value> it is consumed as one token */
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

/* Metacharacters that turn a single argv token into a shell pipeline. We
 * block them per-arg so users cannot smuggle `;`, `&&`, redirection, or
 * command substitution.
 *
 * Conservative set: anything that has a SPECIAL meaning in a POSIX shell
 * when interpreted as part of an unquoted word. We deliberately exclude
 * `.`, `,`, `(`, `)`, `/`, `=`, `'` and `"` so that common JS, URL, and
 * JSON literals pass. The child is spawned without a shell, so quote
 * characters in argv are NOT interpreted. */
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
  /* Reject path-based commands ("/bin/sh", "./foo") — only bare names
   * from the whitelist are accepted. This stops shell escapes via PATH. */
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

/** Throws CommandInjectionError if any layer of the command config is unsafe. */
export function assertCommandSafe(config: CommandSecurityConfig): void {
  if (!isSafeBinary(config.cmd)) {
    throw new CommandInjectionError('command', `binary '${config.cmd}' is not in the whitelist`)
  }
  for (let i = 0; i < config.args.length; i += 1) {
    const a = config.args[i]
    if (a === undefined) continue
    if (!isSafeArg(a)) {
      throw new CommandInjectionError(
        'command',
        `arg[${i}]='${a}' rejected (shell metachar or unknown flag)`,
      )
    }
  }
  for (const key of Object.keys(config.env)) {
    if (!isSafeEnvKey(key)) {
      throw new CommandInjectionError('command', `env key '${key}' is not in the whitelist`)
    }
  }
  if (config.cwd !== undefined && config.cwd !== '' && !isSafeCwd(config.cwd)) {
    throw new CommandInjectionError('command', `cwd '${config.cwd}' is not in the allowed paths`)
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
  /^169\.254\./, // AWS / GCP / Azure link-local metadata
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\./, // 0.0.0.0
]

/* `dns.lookup` lives in `node:dns`; we accept the lookup fn so tests can
 * inject a fake without booting the network. */
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

export async function assertHostResolved(url: URL, lookup: LookupFn): Promise<void> {
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

/* ----------------- script handler ----------------- */

export const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000
export const MAX_SCRIPT_TIMEOUT_MS = 300_000
export const SCRIPT_MEMORY_LIMIT_MB = 128

/** Keywords that indicate the script is trying to escape the sandbox. */
const DANGEROUS_SCRIPT_PATTERNS: readonly RegExp[] = [
  /* eval-style code generation backdoors. `Function('return process')()`
   * reaches the host realm and defeats every other layer. */
  /\bFunction\b/,
  /\beval\b/,
  /\bnew\s+Function\b/,
  /* Dynamic import pulls module-loader internals. */
  /\bimport\s*\(/,
  /* CommonJS require. The bare identifier (no parens) is also blocked
   * because it's an obvious smuggling attempt — if it shows up in user
   * code it almost certainly means an escape attempt. */
  /\brequire\b/,
  /* Host process access (both `process.env` and bare `process`). */
  /\bprocess\b/,
  /* Global object handles — give access to the entire realm. */
  /\bglobalThis\b/,
  /\bglobal\b/,
  /* CommonJS module system. */
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bmodule\b/,
  /\bexports\b/,
  /* Node Buffer handle. */
  /\bBuffer\b/,
  /* Child process / worker spawning. */
  /\bchild_process\b/,
  /\bnew\s+Worker\s*\(/,
  /* Specific dangerous process methods that even bare `process` may leak. */
  /\bprocess\s*\.\s*(?:exit|binding|env|argv|stdout|stderr|cwd|chdir|kill)\b/,
  /* Catch indexed access into globals: `global['pro'+'cess']`. */
  /\bglobal\b\s*\[/,
  /* Prototype-poison gadgets. `Reflect`, `Proxy`, `Symbol` open
   * escape paths when combined with `Function`/`eval`. Block only
   * the constructor-shape usage (`new Proxy(...)`, `new Reflect(...)`)
   * and bare `Reflect` to avoid false positives on user variables
   * named `proxy`/`symbol`. */
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
  source: z.string().min(1).max(64_000), // 64 KB upper bound
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
    throw new ScriptSandboxError(`disallowed identifier: ${hits[0]}`)
  }
}
