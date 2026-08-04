# Cloudflare Workers Deployment

Cadence's API runs on Cloudflare Workers with D1 for storage. The worker
entry point is `apps/api/src/worker.ts` (`main` in `apps/api/wrangler.toml`).

## Prerequisites

- Node.js 20+
- `wrangler` CLI (`pnpm add -D wrangler`)
- Cloudflare account

## Step-by-Step Deployment

### 1. Login to Cloudflare

```bash
wrangler login
# Opens browser for OAuth. Authorize the CLI.
```

### 2. Create infrastructure

```bash
cd apps/api

# D1 database
wrangler d1 create Cadence
# Output: { "database_id": "abc-123..." }
# Copy the id.

# KV namespace (credential refresh cache)
wrangler kv namespace create CREDS_CACHE
# Output: { "id": "xyz-789..." }
# Copy the id.

# Queue (task dispatch)
wrangler queues create Cadence-tasks
```

### 3. Configure wrangler.toml

```bash
cp apps/api/wrangler.toml.template apps/api/wrangler.toml
# Edit apps/api/wrangler.toml:
#   - database_id = "<REPLACE_WITH_D1_UUID>"   # from step 2
#   - id = "<REPLACE_WITH_KV_UUID>"            # from step 2
```

### 4. Set secrets

```bash
# JWT signing key (>= 32 chars, base64-encoded)
wrangler secret put JWT_SECRET
# Enter: base64-encoded string >= 32 bytes
# Example: openssl rand -base64 48

# AES-256-GCM master encryption key (32 raw bytes, base64-encoded)
wrangler secret put ENCRYPTION_KEY
# Enter: openssl rand -base64 32
```

### 5. Apply D1 migrations

```bash
pnpm --filter @Cadence/api exec wrangler d1 migrations apply PULSEDECK_DB --remote
```

### 6. Dry-run (verify config)

```bash
pnpm --filter @Cadence/api exec wrangler deploy --dry-run
# Exit 0 = config valid. Check output for warnings.
```

### 7. Deploy

```bash
pnpm --filter @Cadence/api exec wrangler deploy
```

### 8. Verify

```bash
curl https://<your-worker-subdomain>.workers.dev/api/health
# Expected: {"status":"ok","db":true}
```

Find your worker URL in the Cloudflare dashboard or the deploy output.

## Bindings Summary

| binding          | type   | purpose                  | creation command                           |
| ---------------- | ------ | ------------------------ | ------------------------------------------ |
| `PULSEDECK_DB`   | D1     | primary datastore        | `wrangler d1 create Cadence`               |
| `CREDS_CACHE`    | KV     | credential refresh cache | `wrangler kv namespace create CREDS_CACHE` |
| `TASK_QUEUE`     | Queue  | task dispatch            | `wrangler queues create Cadence-tasks`     |
| `JWT_SECRET`     | Secret | HS256 signing key        | `wrangler secret put JWT_SECRET`           |
| `ENCRYPTION_KEY` | Secret | AES-256-GCM master key   | `wrangler secret put ENCRYPTION_KEY`       |

## Cron Trigger

`wrangler.toml` declares `[triggers] crons = ["* * * * *"]`. Cloudflare calls
the worker `scheduled()` handler every minute. The scheduler adapter queries D1
for tasks whose cron slot has passed and dispatches them. Change the expression
to e.g. `["*/5 * * * *"]` for every 5 minutes.

## Environment Variables (vars)

Set via `[vars]` in `wrangler.toml`:

```toml
[vars]
NODE_ENV = "production"
LOG_LEVEL = "info"   # debug | info | warn | error
API_VERSION = "0.4.0"
```

## Rollback

```bash
# Deploy a specific version
wrangler deployments list
wrangler deployments rollback <deployment-id>
```

## Secrets Rotation

To rotate `ENCRYPTION_KEY`:

1. Deploy new key: `wrangler secret put ENCRYPTION_KEY` with new value
2. The new key encrypts new credentials. Old credentials encrypted with the old
   key require a one-time re-encryption migration.
3. The `cipher.keyId` field tracks which key version encrypted each credential.
