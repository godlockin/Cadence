/**
 * @cadence/nodes — desktop notification helper (local-only).
 *
 * Dispatches an OS notification:
 *   - macOS: `osascript` (Notification Center)
 *   - Linux: `notify-send`
 *   - Windows: `msg` / PowerShell toast
 *
 * `dryRun: true` skips the subprocess and returns the command that WOULD have
 * run — this is what the test-suite exercises.
 */

export interface DesktopNotifyConfig {
  readonly title: string
  readonly body: string
  readonly interactive: boolean
  readonly buttons: readonly string[]
  readonly timeoutMs: number
  readonly dryRun?: boolean
}

export interface DesktopNotifyResult {
  readonly platform: 'darwin' | 'linux' | 'win32' | 'other'
  readonly command: string
  readonly args: readonly string[]
  readonly dryRun: boolean
}

function detectPlatform(): DesktopNotifyResult['platform'] {
  const p = process.platform
  if (p === 'darwin') return 'darwin'
  if (p === 'linux') return 'linux'
  if (p === 'win32') return 'win32'
  return 'other'
}

function buildCommand(
  cfg: DesktopNotifyConfig,
  platform: DesktopNotifyResult['platform'],
): {
  command: string
  args: string[]
} {
  if (platform === 'darwin') {
    const script = [
      `display notification "${escapeAppleScript(cfg.body)}" with title "${escapeAppleScript(cfg.title)}"`,
      ...(cfg.interactive ? [` with subtitle "PulseDeck" sound name "default"`] : []),
    ].join('')
    return { command: 'osascript', args: ['-e', script] }
  }
  if (platform === 'linux') {
    const args = ['--expire-time', String(cfg.timeoutMs)]
    for (const b of cfg.buttons) args.push('--action', b)
    args.push(cfg.title, cfg.body)
    return { command: 'notify-send', args }
  }
  if (platform === 'win32') {
    return { command: 'msg', args: ['*', `${cfg.title}: ${cfg.body}`] }
  }
  return { command: 'echo', args: [cfg.title, cfg.body] }
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
}

/** Build the OS command for a notification (does not spawn). */
export function buildDesktopNotification(cfg: DesktopNotifyConfig): DesktopNotifyResult {
  const platform = detectPlatform()
  const { command, args } = buildCommand(cfg, platform)
  return { platform, command, args, dryRun: cfg.dryRun ?? false }
}
