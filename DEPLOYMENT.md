# Cadence — 1.0 Release Checklist

Track the go-live steps for a Cadence 1.0 release. Check each item after it
passes; all items must be complete before tagging `v1.0.0`.

## Local build & tests

- [ ] `pnpm i` installs cleanly from a fresh clone
- [ ] `pnpm type-check` — 0 errors
- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm test` — all unit/integration tests pass
- [ ] `pnpm build` — 12/12 turbo tasks succeed
- [ ] `pnpm e2e` — Playwright E2E all pass (10+ cases)

## Production Node runtime

- [ ] `pnpm --filter @Cadence/api build && node apps/api/dist/node.js` boots
- [ ] `curl localhost:8787/health` returns 200
- [ ] First `register` promotes to super_admin
- [ ] Cron scheduler runs with `PULSEDECK_SCHEDULER_ENABLED=1`

## Docker

- [ ] `docker compose up --build` starts
- [ ] `curl localhost:3000/health` returns 200
- [ ] `./data/Cadence.db` persists across restarts
- [ ] `JWT_SECRET` + `ENCRYPTION_KEY` set (fail-fast if missing)

## Cloudflare Workers

- [ ] `wrangler d1 create Cadence` done → `database_id` filled in `wrangler.toml`
- [ ] KV namespace created → `id` filled in `wrangler.toml`
- [ ] `wrangler secret put JWT_SECRET` + `ENCRYPTION_KEY`
- [ ] D1 migrations applied
- [ ] `wrangler deploy` succeeds
- [ ] `/health` returns 200 on the deployed worker
- [ ] Cron trigger `* * * * *` wired and firing

## Secrets & security

- [ ] No secrets in git (`.env*` ignored)
- [ ] Default JWT/encryption fallbacks never reach production
- [ ] Credential endpoints never leak plaintext secrets

## Docs & legal

- [ ] `README.md` — badges, quick start, requirement→solution mapping
- [ ] `CONTRIBUTING.md` present
- [ ] `LICENSE` — Apache-2.0 present
- [ ] VitePress site builds (`pnpm docs:build`) and is deployed to GitHub Pages
- [ ] `CHANGELOG.md` maintained by Release Please

## Release

- [ ] `release-please-config.json` + `.release-please-manifest.json` committed
- [ ] Release PR merged → tag `v1.0.0` + GitHub Release created
- [ ] Docs + release artifacts verified post-publish
