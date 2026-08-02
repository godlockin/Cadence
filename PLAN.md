# PulseDeck Implementation Plan

PulseDeck is built in **9 sequential PHASES**. Each phase ships behind a
verification gate (lint / type-check / build / test).

| #   | Phase                                  | Deliverable                                        | Gate                                    |
| --- | -------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| 0   | **Monorepo skeleton + toolchain**      | pnpm workspace, turbo, eslint, prettier, husky, ci | clone + `pnpm i` + `pnpm build` succeed |
| 1   | Domain models + Zod contracts          | `@pulsedeck/domain` complete entities + schemas    | `pnpm type-check`                       |
| 2   | Storage adapters (D1 + better-sqlite3) | `@pulsedeck/storage` impl, migrations              | vitest tests pass                       |
| 3   | Auth (Argon2id + JWT + AES)            | `@pulsedeck/auth` impl + tests                     | vitest tests pass                       |
| 4   | 6-node pipeline executor               | `@pulsedeck/pipeline` impl + DAG validator         | vitest tests pass                       |
| 5   | 30 built-in nodes                      | `@pulsedeck/nodes` impl, grouped by 6 kinds        | vitest tests pass                       |
| 6   | Scheduler (cron + DO alarm)            | `@pulsedeck/scheduler` impl                        | vitest tests pass                       |
| 7   | API (Hono, dual entry)                 | `apps/api` routes + auth middleware                | build + manual smoke                    |
| 8   | Web (React 19 + Vite)                  | `apps/web` editor + dashboard                      | playwright e2e                          |
| 9   | Release hardening                      | docs, deploy guides, security audit                | all gates green                         |

## Current Status

**PHASE 0** — skeleton only. Repository bootstrapped with:

- pnpm workspace + turbo orchestration
- ESM, TypeScript strict mode, noImplicitAny, noUncheckedIndexedAccess
- ESLint flat config + Prettier + Husky + lint-staged + commitlint
- 8 packages with type-contract skeletons
- 2 apps (`web`, `api`) with placeholder entries
- GitHub Actions CI (lint / type-check / test / build, parallel)

**Next**: PHASE 1 — flesh out `@pulsedeck/domain` and lock the schema contracts.
