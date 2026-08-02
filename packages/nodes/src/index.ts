/**
 * @pulsedeck/nodes — 30 built-in nodes, organised by the 6 pipeline kinds.
 * PHASE 0: package skeleton + catalog. Implementations land in PHASE 1+.
 */
export const NODE_CATALOG = [
  // triggers (5)
  { id: 'cron-trigger', kind: 'trigger', name: 'Cron Trigger' },
  { id: 'webhook-trigger', kind: 'trigger', name: 'Webhook Trigger' },
  { id: 'manual-trigger', kind: 'trigger', name: 'Manual Trigger' },
  { id: 'email-trigger', kind: 'trigger', name: 'Email Trigger' },
  { id: 'interval-trigger', kind: 'trigger', name: 'Interval Trigger' },
  // fetch (6)
  { id: 'http-fetch', kind: 'fetch', name: 'HTTP Fetch' },
  { id: 'graphql-fetch', kind: 'fetch', name: 'GraphQL Fetch' },
  { id: 'rss-fetch', kind: 'fetch', name: 'RSS Fetch' },
  { id: 'webhook-fetch', kind: 'fetch', name: 'Webhook Fetch' },
  { id: 'database-fetch', kind: 'fetch', name: 'Database Fetch' },
  { id: 'file-fetch', kind: 'fetch', name: 'File Fetch' },
  // transform (6)
  { id: 'jmespath-transform', kind: 'transform', name: 'JMESPath Transform' },
  { id: 'template-transform', kind: 'transform', name: 'Template Transform' },
  { id: 'jsonata-transform', kind: 'transform', name: 'JSONata Transform' },
  { id: 'code-transform', kind: 'transform', name: 'Code Transform (sandboxed)' },
  { id: 'date-transform', kind: 'transform', name: 'Date Transform' },
  { id: 'filter-transform', kind: 'transform', name: 'Filter Transform' },
  // condition (3)
  { id: 'if-condition', kind: 'condition', name: 'If Condition' },
  { id: 'switch-condition', kind: 'condition', name: 'Switch Condition' },
  { id: 'time-window', kind: 'condition', name: 'Time Window' },
  // action (7)
  { id: 'http-action', kind: 'action', name: 'HTTP Action' },
  { id: 'email-action', kind: 'action', name: 'Email Action' },
  { id: 'slack-action', kind: 'action', name: 'Slack Action' },
  { id: 'discord-action', kind: 'action', name: 'Discord Action' },
  { id: 'webhook-action', kind: 'action', name: 'Webhook Action' },
  { id: 'database-action', kind: 'action', name: 'Database Action' },
  { id: 'ssh-action', kind: 'action', name: 'SSH Action' },
  // output (3)
  { id: 'log-output', kind: 'output', name: 'Log Output' },
  { id: 'store-output', kind: 'output', name: 'Store Output' },
  { id: 'return-output', kind: 'output', name: 'Return Output' },
] as const

export const VERSION = '0.1.0'
