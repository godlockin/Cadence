# Docker Deploy

Cadence ships a multi-stage Dockerfile (repo root) that builds and runs the
Node.js runtime (Hono + better-sqlite3) with the cron scheduler enabled. The
React frontend is built in an earlier stage and copied into the runtime image,
so the container serves the full app (API + UI) on `:3000`.

## Quick start

```bash
# 1. Provide required secrets
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env

# 2. Validate the compose file
docker compose config          # should print the merged config (exit 0)

# 3. Build and start
docker compose up -d --build

# 4. Verify
curl http://localhost:3000/health
# {"status":"ok","db":true,"scheduler":{...}}
```

The API listens on `http://localhost:3000`. SQLite data is persisted to
`./data/Cadence.db` (bind-mounted to `/data`).

## Environment variables

| variable                      | required | description                                   |
| ----------------------------- | -------- | --------------------------------------------- |
| `JWT_SECRET`                  | yes      | HS256 signing key (>= 16 chars)               |
| `ENCRYPTION_KEY`              | yes      | base64 AES-256-GCM master key (32 raw bytes)  |
| `PULSEDECK_SCHEDULER_ENABLED` | no       | set `1` to start the cron loop                |
| `PULSEDECK_DB_PATH`           | no       | sqlite file path (default `/data/Cadence.db`) |
| `PORT`                        | no       | HTTP port (default `3000`)                    |

`docker-compose.yml` uses `${JWT_SECRET:-...}` defaults so `docker compose config`
succeeds without a `.env`; set real values in `.env` for any real deployment.

Generate a valid encryption key:

```bash
openssl rand -base64 32   # 32 raw bytes → base64 (44 chars)
```

## Manual build

```bash
docker build -t Cadence .
docker run -p 3000:3000 \
  -e JWT_SECRET=... \
  -e ENCRYPTION_KEY=... \
  -e PULSEDECK_SCHEDULER_ENABLED=1 \
  -v "$PWD/data:/data" \
  Cadence
```

## Build notes

- The `deps` stage installs all workspace dependencies with
  `pnpm i --frozen-lockfile`, so the pnpm store is cached across rebuilds
  (manifests-only COPY layers first).
- Native module `better-sqlite3` is compiled against the alpine/musl base
  image; build tools (`python3 make g++`) are installed only in the `deps`
  stage.
- The runtime image copies only the built api dist (with web static) + the
  pnpm `node_modules` virtual store + workspace packages — no source, no dev
  tools.
- Build time stays under ~5 min because the dependency layer is cached.

## Prune after tests

```bash
docker compose down          # stop
docker image prune -f        # optional: free space
```
