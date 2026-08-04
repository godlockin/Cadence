---
layout: home

hero:
  name: Cadence
  text: Self-hosted Task Scheduler & Workflow Orchestrator
  tagline: TypeScript everywhere. Deploy to Cloudflare Workers (edge) or your own Mac/Linux — without rewriting the app.
  image:
    src: /logo.svg
    alt: Cadence
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: HTTP API
      link: /api-reference
    - theme: alt
      text: View on GitHub
      link: https://github.com/godlockin/Cadence

features:
  - icon: ⚙️
    title: 6-node pipeline
    details: trigger → fetch → transform → condition → action → output, validated as a DAG by the executor.
  - icon: 🧩
    title: 30 built-in nodes
    details: curl, webhook, shell, JMESPath/JSONata transform, LLM, DB writes, notifications and more.
  - icon: ⏰
    title: Cron + webhook + manual
    details: Every-minute cron triggers, webhook endpoints with idempotent dedup, and manual triggers.
  - icon: 🔐
    title: Auth + RBAC + encrypted secrets
    details: Argon2id password hashing, JWT sessions, 5 built-in roles, AES-256-GCM credential encryption.
  - icon: 🚀
    title: Dual runtime
    details: One Hono codebase, two deployments — Cloudflare Workers + D1, or Node.js + better-sqlite3.
  - icon: 🐳
    title: Docker & release automation
    details: Multi-stage Dockerfile, docker-compose, GitHub Actions CI, Release Please, VitePress docs.
---
