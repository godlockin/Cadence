# Contributing to Cadence

> Cadence 贡献指南 | Contributing to Cadence

By participating you agree to abide by the
[Contributor Covenant](./CODE_OF_CONDUCT.md).

---

## 开发环境 / Development Setup

```bash
nvm use          # Node 20
pnpm i           # install workspace deps
pnpm dev         # api + web + cron + queue (concurrent)
```

## 命令速查 / Commands

| Command           | Description                         |
| ----------------- | ----------------------------------- |
| `pnpm type-check` | `tsc --noEmit` across the workspace |
| `pnpm lint`       | ESLint flat config, 0 warnings      |
| `pnpm test`       | Vitest unit + integration           |
| `pnpm e2e`        | Playwright end-to-end (builds web)  |
| `pnpm build`      | turbo run build                     |
| `pnpm docs:dev`   | VitePress dev server                |
| `pnpm docs:build` | build the docs site                 |

## 提交规范 / Commit Conventions

Conventional Commits enforced by commitlint + husky:

```
feat(api): add manual trigger endpoint
fix(scheduler): keep cron poller alive for long-running processes
security(auth): rotate credential master key
docs: add docker deploy guide
chore(deps): bump wrangler
```

Type prefixes feed the Release Please changelog sections
(`feat` → Features, `fix` → Bug Fixes, `perf` → Performance,
`security` → Security, `docs` → Documentation).

## TypeScript 规则 / TypeScript Rules

Hard requirements — PRs violating these are blocked by CI:

- **No `any`** — use `unknown` + type guards.
- **No `@ts-ignore`** — fix the root cause.
- **Strict casting** via `x as unknown as T` for incompatible types.
- **`const` by default** — no mutation of params or shared state.
- **Fail fast** — validate config/env at startup, not mid-request.
- **Dependency injection over mocking** — constructors accept dependencies.

## 测试要求 / Test Requirements

- Minimum coverage threshold: **75% line coverage**.
- Every node added must have a unit test (happy path + error path).
- Run `pnpm test` before opening a PR; CI runs type-check + lint + test + build + e2e.

## 安全漏洞上报 / Security Vulnerability Reporting

Do **not** open a public issue for security vulnerabilities.
Email the maintainer directly or report via GitHub's
**Security** tab (Advisories).

## Pull Request 工作流 / PR Workflow

1. Branch from `miao` (`feat/*`, `fix/*`, `docs/*`, `security/*`).
2. Run `pnpm type-check && pnpm lint && pnpm test` before pushing.
3. Open the PR. CI runs `type-check` + `lint` + `test` + `build` + `e2e`.
4. Squash-merge with a Conventional Commit message.

### PR 模板 / PR Template

```markdown
## What

<one-paragraph summary of the change>

## Why

<motivation / problem being solved>

## How to verify

- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm e2e` passes (if UI / API behaviour changed)
- [ ] docs updated if behaviour is user-visible

## Notes

<edge cases, follow-ups, related issues>
```

## 发布流程 / Release Process

Pushes to `main` trigger [Release Please](https://github.com/googleapis/release-please-action)
which opens a release PR. Merging it tags the next version and publishes the
GitHub Release + changelog.
