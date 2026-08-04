# Credentials & Secrets

Credentials hold provider secrets (API keys, OAuth tokens, webhook secrets).
Cadence encrypts every secret at rest with **AES-256-GCM** before it
reaches storage; the API never returns plaintext.

## Master key

The `ENCRYPTION_KEY` must be 32 raw bytes, base64-encoded:

```bash
openssl rand -base64 32
```

- **Node runtime**: set `ENCRYPTION_KEY` env var.
- **Cloudflare**: `wrangler secret put ENCRYPTION_KEY`.

> The Node adapter falls back to 32 zero bytes in development. Never run
> production with the fallback — credentials would be decryptable by anyone
> with the database.

## Credential kinds

| kind             | description                       |
| ---------------- | --------------------------------- |
| `api-key`        | static API key                    |
| `oauth2`         | OAuth2 client credentials + token |
| `basic`          | HTTP basic auth                   |
| `bearer`         | bearer token                      |
| `webhook-secret` | outbound webhook signing secret   |

## Create

```http
POST /api/credentials
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "github",
  "kind": "api-key",
  "secret": "ghp_xxxx"
}
```

The response contains metadata only — no `secret`, `ciphertext`, `iv` or
`authTag` fields.

## Refresh / rotate (PHASE 6)

For `oauth2` credentials you can wire a `CredentialRefresher`:

- `POST /api/credentials/:id/refresh` — hit the provider token endpoint and
  persist the new access token.
- `POST /api/credentials/:id/rotate` — force rotate.

A periodic sweep (`PendingCredentialRefresh`, every 60s) refreshes expiring
tokens when the scheduler is enabled.

## Security properties

- Secrets are encrypted with a per-record random 96-bit IV + AES-256-GCM.
- The route layer decrypts only inside the cipher, never in HTTP responses.
- Audit rows record every create/update/refresh/rotate with actor + diff.
- RBAC gates access: `credential:create/read/update/delete/refresh`.
