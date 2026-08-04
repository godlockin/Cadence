# Local Deploy (Node.js)

Run Cadence as a plain Node.js process — no Docker, no Cloudflare. This is
the same runtime the Docker image uses, minus the container.

## Production start

From the repo root:

```bash
# one-shot: builds web static + api dist, then serves on :3000
pnpm start

# or step-by-step:
pnpm --filter @Cadence/api build:static   # build web → copy to apps/api/dist/static
pnpm --filter @Cadence/api build           # tsc → apps/api/dist
node apps/api/dist/node.js                    # serve
```

`node apps/api/dist/node.js` runs migrations idempotently at startup, then
serves:

- the Hono API on `0.0.0.0:3000` (override with `PORT` / `HOST`)
- the built React frontend (`apps/web/dist`) with SPA fallback, when present

## Environment variables

| variable                      | required | description                                                       |
| ----------------------------- | -------- | ----------------------------------------------------------------- |
| `JWT_SECRET`                  | yes      | HS256 signing key (>= 16 chars)                                   |
| `ENCRYPTION_KEY`              | yes      | base64 AES-256-GCM master key (32 raw bytes)                      |
| `PORT`                        | no       | HTTP port (default `3000`)                                        |
| `HOST`                        | no       | bind address (default `0.0.0.0`)                                  |
| `PULSEDECK_DB_PATH`           | no       | sqlite file path (default `:memory:`; use a file for persistence) |
| `PULSEDECK_SCHEDULER_ENABLED` | no       | set `1` to start the cron loop inside the API process             |
| `PULSEDECK_STATIC_DIR`        | no       | override frontend dist dir (default auto-resolved)                |

Example:

```bash
export JWT_SECRET=my-32-char-min-signing-secret
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export PULSEDECK_DB_PATH=./data/Cadence.db
export PULSEDECK_SCHEDULER_ENABLED=1
pnpm start
```

## How the scheduler runs

When `PULSEDECK_SCHEDULER_ENABLED=1`, `apps/api/src/adapters/node.ts` boots a
`SchedulerHandle` (cron poller) plus the credential-refresh sweep inside the
API process — no separate process needed. For dev, `pnpm dev` runs the cron
loop and queue consumer as separate processes against a shared
`.Cadence/dev.db` file.

## Verify

```bash
curl http://localhost:3000/health      # {"status":"ok","db":true,...}
curl http://localhost:3000/            # HTML (served by the API)
```
