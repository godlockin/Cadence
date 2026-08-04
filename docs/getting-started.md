# Getting Started

Cadence is a self-hosted scheduled-task orchestration platform built in
TypeScript. It combines the ergonomics of n8n / Zapier-style pipelines with
the determinism of cron and queue systems, deployable to either a serverless
edge (Cloudflare Workers) or a long-lived Node.js process.

## Prerequisites

- Node.js >= 20
- pnpm >= 10
- (optional) Docker for containerized runs
- (optional) Wrangler + a Cloudflare account for edge deployment

## 1. Install

```bash
git clone https://github.com/your-org/Cadence.git
cd Cadence
nvm use                # or: node -v (>= 20)
pnpm i                 # install workspace deps
```

## 2. Run in development

```bash
pnpm dev
```

This starts four processes concurrently:

| process | port | description                        |
| ------- | ---- | ---------------------------------- |
| api     | 3000 | Hono API (tsx watch, Node runtime) |
| web     | 5173 | React 19 + Vite dev server         |
| cron    | —    | scheduler cron loop (dev-cron)     |
| queue   | —    | queue consumer (dev-queue, no-op)  |

The API listens on `http://localhost:3000` (health: `curl http://localhost:3000/health`).
The web dev server proxies `/api` to it. The cron + queue processes share the
same SQLite file (`.Cadence/dev.db`) so tasks created through the API are
picked up.

The first account you register via `POST /api/auth/register` becomes the
`super_admin` (bootstrap), so you can create tasks, credentials and users.

> Cloudflare-flavored local dev is available separately:
> `pnpm --filter @Cadence/api dev:cf` (wrangler dev, port 8787).

## 3. Production run (Node)

```bash
pnpm start            # builds web + api, copies static, serves on :3000
# or step-by-step:
pnpm --filter @Cadence/api build:static
pnpm --filter @Cadence/api build
node apps/api/dist/node.js
```

`node.ts` serves the built React frontend with SPA fallback when the web
`dist` is present (see [Local deploy](./deployment/local.md)).

## 4. Run tests and checks

```bash
pnpm type-check        # tsc --noEmit across the workspace
pnpm lint              # ESLint flat config
pnpm test              # Vitest unit + integration
pnpm e2e               # Playwright end-to-end (starts the Node API server)
pnpm build             # turbo run build
```

## Next steps

- [Deploy to Cloudflare Workers](./deployment/cloudflare.md)
- [Deploy with Docker](./deployment/docker.md)
- [Run the Node.js runtime locally](./deployment/local.md)
- [Node catalog — 30 built-in nodes](./reference/nodes.md)
- [HTTP API reference](./api-reference.md)
