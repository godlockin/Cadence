/**
 * Task templates - preset configurations for common use cases.
 */

export interface TemplateField {
  key: string
  labelKey: string
  type: 'text' | 'email' | 'url' | 'password' | 'select'
  placeholder?: string
  required?: boolean
  options?: Array<{ value: string; labelKey: string }>
}

export interface TaskTemplate {
  id: string
  nameKey: string
  descriptionKey: string
  icon: string // lucide icon name
  fields: TemplateField[]
  payloadKind: 'http' | 'pipeline' | 'command' | 'webhook'
  cron?: string
  payload?: Record<string, unknown>
  triggerKind?: 'cron' | 'manual' | 'webhook'
  maxRetries?: number
  timeoutMs?: number
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'domain-expiry',
    nameKey: 'templates.domainExpiry.name',
    descriptionKey: 'templates.domainExpiry.desc',
    icon: 'Globe',
    fields: [
      {
        key: 'domain',
        labelKey: 'templates.domainExpiry.domainLabel',
        type: 'text',
        placeholder: 'example.com',
        required: true,
      },
      {
        key: 'notifyEmail',
        labelKey: 'templates.notifyEmail',
        type: 'email',
        required: true,
      },
    ],
    payloadKind: 'pipeline',
    cron: '0 9 * * *',
    triggerKind: 'cron',
    maxRetries: 3,
    timeoutMs: 30000,
    payload: {
      input: {
        nodes: [
          {
            type: 'http',
            enabled: true,
            config: { method: 'GET', url: 'https://${domain}', timeoutMs: 10000 },
          },
        ],
      },
      inputValidate: { nodes: [] },
      process: {
        nodes: [
          { type: 'transform', enabled: true, config: { template: 'Check expiry for ${domain}' } },
        ],
      },
      resultValidate: { nodes: [] },
      postProcess: { nodes: [] },
      output: {
        nodes: [
          {
            type: 'email',
            enabled: true,
            config: { to: '${notifyEmail}', subject: 'Domain Expiry Check' },
          },
        ],
      },
    },
  },
  {
    id: 'rss-summary',
    nameKey: 'templates.rssSummary.name',
    descriptionKey: 'templates.rssSummary.desc',
    icon: 'Rss',
    fields: [
      {
        key: 'feedUrl',
        labelKey: 'templates.feedUrl',
        type: 'url',
        placeholder: 'https://example.com/feed.xml',
        required: true,
      },
      {
        key: 'notifyEmail',
        labelKey: 'templates.notifyEmail',
        type: 'email',
        required: true,
      },
    ],
    payloadKind: 'pipeline',
    cron: '0 */4 * * *',
    triggerKind: 'cron',
    maxRetries: 2,
    timeoutMs: 20000,
    payload: {
      input: {
        nodes: [
          {
            type: 'http',
            enabled: true,
            config: { method: 'GET', url: '${feedUrl}', timeoutMs: 15000 },
          },
        ],
      },
      inputValidate: { nodes: [] },
      process: {
        nodes: [
          { type: 'transform', enabled: true, config: { template: 'Parse RSS and summarize' } },
        ],
      },
      resultValidate: { nodes: [] },
      postProcess: { nodes: [] },
      output: {
        nodes: [
          {
            type: 'email',
            enabled: true,
            config: { to: '${notifyEmail}', subject: 'RSS Summary' },
          },
        ],
      },
    },
  },
  {
    id: 'server-health',
    nameKey: 'templates.serverHealth.name',
    descriptionKey: 'templates.serverHealth.desc',
    icon: 'Activity',
    fields: [
      {
        key: 'url',
        labelKey: 'templates.serverUrl',
        type: 'url',
        placeholder: 'https://api.example.com/health',
        required: true,
      },
      {
        key: 'notifyEmail',
        labelKey: 'templates.notifyEmail',
        type: 'email',
        required: true,
      },
    ],
    payloadKind: 'http',
    cron: '*/5 * * * *',
    triggerKind: 'cron',
    maxRetries: 3,
    timeoutMs: 10000,
    payload: {
      url: '${url}',
      method: 'GET',
      headers: {},
      timeoutMs: 5000,
    },
  },
  {
    id: 'database-backup',
    nameKey: 'templates.databaseBackup.name',
    descriptionKey: 'templates.databaseBackup.desc',
    icon: 'Database',
    fields: [
      {
        key: 'connectionString',
        labelKey: 'templates.connectionString',
        type: 'password',
        placeholder: 'postgresql://user:pass@host:5432/db',
        required: true,
      },
      {
        key: 'backupPath',
        labelKey: 'templates.backupPath',
        type: 'text',
        placeholder: '/backups/db-$DATE.sql',
        required: true,
      },
    ],
    payloadKind: 'command',
    cron: '0 2 * * *',
    triggerKind: 'cron',
    maxRetries: 1,
    timeoutMs: 600000,
    payload: {
      command: 'pg_dump "${connectionString}" > "${backupPath}"',
    },
  },
  {
    id: 'social-post',
    nameKey: 'templates.socialPost.name',
    descriptionKey: 'templates.socialPost.desc',
    icon: 'Share2',
    fields: [
      {
        key: 'platform',
        labelKey: 'templates.platform',
        type: 'select',
        required: true,
        options: [
          { value: 'twitter', labelKey: 'templates.platforms.twitter' },
          { value: 'linkedin', labelKey: 'templates.platforms.linkedin' },
          { value: 'mastodon', labelKey: 'templates.platforms.mastodon' },
        ],
      },
      {
        key: 'accessToken',
        labelKey: 'templates.accessToken',
        type: 'password',
        required: true,
      },
    ],
    payloadKind: 'http',
    cron: '0 10 * * 1-5',
    triggerKind: 'cron',
    maxRetries: 2,
    timeoutMs: 15000,
    payload: {
      method: 'POST',
      headers: { Authorization: 'Bearer ${accessToken}' },
      timeoutMs: 10000,
    },
  },
  {
    id: 'webhook-relay',
    nameKey: 'templates.webhookRelay.name',
    descriptionKey: 'templates.webhookRelay.desc',
    icon: 'Webhook',
    fields: [
      {
        key: 'webhookUrl',
        labelKey: 'templates.webhookUrl',
        type: 'url',
        placeholder: 'https://your-server.com/webhook',
        required: true,
      },
    ],
    payloadKind: 'webhook',
    triggerKind: 'webhook',
    maxRetries: 0,
    timeoutMs: 5000,
    payload: {
      url: '${webhookUrl}',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  },
]

/**
 * Get template by ID.
 */
export function getTemplate(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id)
}

/**
 * Build payload from template and field values.
 */
export function buildTemplatePayload(
  template: TaskTemplate,
  fieldValues: Record<string, string>,
): Record<string, unknown> {
  if (!template.payload) return {}

  // Replace template variables in payload
  const replaceVars = (obj: unknown): unknown => {
    if (typeof obj === 'string') {
      return obj.replace(/\$\{(\w+)\}/g, (_, key) => fieldValues[key] ?? '')
    }
    if (Array.isArray(obj)) {
      return obj.map(replaceVars)
    }
    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj)) {
        result[k] = replaceVars(v)
      }
      return result
    }
    return obj
  }

  return replaceVars(template.payload) as Record<string, unknown>
}
