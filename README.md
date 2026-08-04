```
██████╗ ██╗   ██╗██╗     ███████╗███████╗██████╗ ███████╗ ██████╗██╗  ██╗
██╔══██╗██║   ██║██║     ██╔════╝██╔════╝██╔══██╗██╔════╝██╔════╝██║ ██╔╝
██████╔╝██║   ██║██║     █████╗  ███████╗██║  ██║█████╗  ██║     █████╔╝
██╔═══╝ ██║   ██║██║     ██╔══╝  ╚════██║██║  ██║██╔══╝  ██║     ██╔═██╗
██║     ╚██████╔╝███████╗███████╗███████║██████╔╝███████╗╚██████╗██║  ██╗
╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝
```

# Cadence

> Self-hosted task scheduler & workflow orchestrator.
> TypeScript everywhere. Dual-runtime: Cloudflare Workers **or** your own Mac/Linux.

[![CI](https://github.com/godlockin/Cadence/actions/workflows/ci.yml/badge.svg?branch=miao)](https://github.com/godlockin/Cadence/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](./package.json)
[![Docs](https://img.shields.io/badge/docs-VitePress-3b82f6.svg)](./docs)
[![Stars](https://img.shields.io/github/stars/godlockin/Cadence?style=social)](https://github.com/godlockin/Cadence)

## What is Cadence?

Cadence is a self-hosted scheduling and workflow-automation platform built
entirely in TypeScript. Think of it as **cron + n8n + a token vault**, deployable
as a Cloudflare Worker (serverless, edge) or as a long-lived Node.js process
on your own machine or server.

## Requirement → Solution

| #   | Requirement                                                                 | Solution                                                          |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | 6-node pipeline (trigger → fetch → transform → condition → action → output) | `@cadence/executor-pipeline` enforces strict DAG topology         |
| 2   | 30+ built-in nodes covering common integrations                             | `@cadence/nodes` ships 30 nodes grouped by 6 categories           |
| 3   | Cron + webhook + manual triggers                                            | `@cadence/scheduler` (cron-parser) + Durable Object Alarm adapter |
| 4   | JWT + RBAC + encrypted secrets                                              | `@cadence/auth` (Argon2id, jose JWT, AES-256-GCM)                 |
| 5   | Dual deployment (Cloudflare + Node)                                         | `apps/api` exposes both `worker.ts` and `node.ts` entry points    |

## Architecture

```
+---------------------+        +-------------------------+
|  apps/web (React 19)| <----> |  apps/api (Hono)         |
|                     |        |    ├── src/worker.ts    |  <-- Cloudflare Workers + D1
+---------------------+        |    └── src/node.ts      |  <-- Node.js + better-sqlite3
                                           |
                                           v
                         +--------------------------------+
                         | @cadence/sinker                |  <-- top-level orchestrator
                         |  state machine + queue dispatch|
                         +-------+---------+------+-------+
                                 |         |      |
         +-----------------------+         |      +-------------------------+
         |                                 |                                |
         v                                 v                                v
+------------------+           +-----------------------+       +-----------------------+
| @cadence/scheduler|          | @cadence/queue        |       | @cadence/executor-     |
| cron + DO alarm   |           | CF / Local / Embedded |       | pipeline (6-node DAG)  |
+---------+---------+           +----------+------------+       +----------+-------------+
         |                                            |                       |
         v                                            v                       v
+------------------+                    +---------------------------+  +----------------------+
| @cadence/storage | <----------------   | @cadence/nodes (30)       |  | @cadence/domain      |
| D1 / SQLite adapter|                   +---------------------------+  | Zod schemas (SSoT)   |
+---------+---------+                                                         +----------+-----------+
         |                                                                           |
         v                                                                           |
+------------------+                                                           |
| @cadence/db      |  drizzle schemas + migrations  <-----------------------------+
+------------------+
```

## Repo Layout

```
apps/
  api/        Hono backend, dual runtime (worker + node)
  web/        React 19 + Vite frontend
packages/
  domain/          Zod schemas (single source of truth)
  storage/         StorageAdapter interface (D1 + SQLite implementations)
  executor-pipeline/  6-node DAG executor
  sinker/          Task lifecycle orchestrator
  queue/           QueueAdapter port (Cloudflare / Local / Embedded)
  nodes/           30 built-in nodes
  scheduler/       cron-parser + Durable Object alarm
  auth/            Argon2id + JWT + AES-256-GCM
  db/              drizzle schema + migrations
  ui/              shared React components
docs/              VitePress documentation site
e2e/               Playwright end-to-end tests
```

## Quick Start

```bash
# 1. Install
git clone https://github.com/godlockin/Cadence.git && cd Cadence
pnpm i

# 2. Run (api + web + cron + queue, all concurrently)
pnpm dev

# 3. Verify
curl http://localhost:3000/health
# {"status":"ok","db":true,...}
```

Open http://localhost:3000 and register the first account — it is automatically
promoted to `super_admin` so you can manage the instance.

## Deploy

- **Local (Node.js)**: `pnpm start` → `http://localhost:3000` ([docs](./docs/deployment/local.md))
- **Docker**: `docker compose up --build` → `http://localhost:3000/health` ([docs](./docs/deployment/docker.md))
- **Cloudflare**: `wrangler deploy` ([docs](./docs/deployment/cloudflare.md))
- Full checklist: [`DEPLOYMENT.md`](./DEPLOYMENT.md)

## Develop

```bash
nvm use              # Node 20
pnpm dev             # api + web + cron + queue (concurrent)
pnpm build           # turbo run build
pnpm lint            # ESLint flat config
pnpm type-check      # tsc --noEmit
pnpm test            # Vitest unit + integration
pnpm e2e             # Playwright end-to-end
pnpm docs:dev        # VitePress docs (localhost:5173)
```

## Documentation

Full site at `docs/` (VitePress) — [getting started](./docs/getting-started.md),
[node catalog](./docs/reference/nodes.md), [HTTP API](./docs/api-reference.md),
[architecture](./docs/architecture.md), [changelog](./docs/changelog.md).

## License

Apache-2.0 — see [LICENSE](./LICENSE).

---

Contributions welcome — read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first.

---

## 概述 / Overview (中文)

Cadence 是一个**自托管的任务调度与工作流编排平台**，全部使用 TypeScript 开发。
可以部署在 Cloudflare Workers（无服务器边缘）上，也可以部署在自己的 Mac/Linux 机器上。

### 核心特性

- **30+ 内置节点**：涵盖 HTTP 请求、数据转换、条件分支、输出等 6 大类别
- **Cron + Webhook + 手动触发**：支持幂等 Webhook 去重
- **JWT + RBAC + 密钥加密**：Argon2id 密码哈希、jose JWT、AES-256-GCM 凭证加密
- **双端部署**：一份代码，同时支持 Cloudflare Workers 和 Node.js
- **DAG 流水线执行器**：6 类节点强制有向无环图拓扑
- **621 测试 / ~78% 覆盖率**：Vitest 单元测试 + Playwright E2E

### 快速开始

```bash
pnpm i
pnpm dev
# 访问 http://localhost:3000 注册第一个管理员账号
```

详细文档见 [`docs/`](./docs/)。
