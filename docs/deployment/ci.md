# CI Secrets Setup

## GitHub Actions — E2E Test Secrets

Playwright e2e tests require two secrets to be set in the repository:

### Required Secrets

| Secret Name          | Purpose                            | How to Generate                                     |
| -------------------- | ---------------------------------- | --------------------------------------------------- |
| `E2E_JWT_SECRET`     | JWT signing key for e2e API server | any string >= 32 chars, e.g. `openssl rand -hex 32` |
| `E2E_ENCRYPTION_KEY` | Encryption key for e2e API server  | `openssl rand -base64 32`                           |

### Set Secrets via GitHub CLI

```bash
gh secret set E2E_JWT_SECRET --body "$(openssl rand -hex 32)"
gh secret set E2E_ENCRYPTION_KEY --body "$(openssl rand -base64 32)"
```

Or via the web UI: **Settings → Secrets and variables → Actions → New repository secret**.

### How It Works

`playwright.config.ts` and `e2e/shutdown.spec.ts` read `PULSEDECK_E2E_JWT_SECRET` and `PULSEDECK_E2E_ENCRYPTION_KEY`.

The CI workflow passes these through:

```yaml
env:
  PULSEDECK_E2E_JWT_SECRET: ${{ secrets.E2E_JWT_SECRET }}
  PULSEDECK_E2E_ENCRYPTION_KEY: ${{ secrets.E2E_ENCRYPTION_KEY }}
```

### Local Development Fallback

When `CI` is not set and `NODE_ENV !== 'production'`, the test config falls back to
dev-only placeholder values prefixed with `dev-only-DO-NOT-USE-IN-PROD`. These are
intentionally different from the real secrets so they cannot accidentally be used
in production.

To use real secrets locally, create `.env.test.local` (gitignored):

```
PULSEDECK_E2E_JWT_SECRET=<real-value>
PULSEDECK_E2E_ENCRYPTION_KEY=<real-value>
```

### CI Must Have Real Secrets

If `CI=true` or `NODE_ENV=production` and the env vars are missing, the test config
**throws at startup** rather than silently using fallbacks. This prevents e2e tests
from running with weak keys in CI.
