# Edge Case Matrix

Systematic inventory of Cadence edge cases, organized by dimension.

---

## Dimension: Time

| Scenario                                  | Expected Behavior                                                                                    | Test Status                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| DST switch (America/New_York 2AM→3AM Mar) | `cron-parser` uses wall-clock; next slot jumps 1h. Scheduler fires at correct wall time. Documented. | Pending                                                    |
| Year boundary (2026→2027)                 | `parseCron().next()` returns correct Jan 1 2027 timestamp. No overflow.                              | **Covered** (`packages/scheduler/test/edge-cases.test.ts`) |
| Leap second (23:59:60 UTC)                | `Date` in JS does not model leap seconds; next cron slot is correct. Tolerated.                      | Pending                                                    |
| Negative startAt offset                   | `isWithinWindow()` correctly returns false before task is active.                                    | **Covered**                                                |
| endAt in the past                         | `next()` returns `[]`. `triggerTask()` skips via `isWithinWindow`.                                   | **Covered**                                                |

---

## Dimension: Concurrency

| Scenario                                                      | Expected Behavior                                                | Test Status                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Same task triggered 100x simultaneously (skip policy)         | Only 1 fires; 99 skipped via concurrency guard + deduplication.  | **Covered** (`packages/scheduler/test/edge-cases.test.ts`)  |
| Same task triggered 100x simultaneously (parallel policy)     | 100 executions run. No crash.                                    | **Covered**                                                 |
| Same task triggered 100x simultaneously (queue policy)        | 100 'wait' decisions. Queue orders them.                         | **Covered**                                                 |
| 1000 worker_threads enqueuing simultaneously                  | No race on queue index or DB version. Safe with SQLite WAL mode. | Pending                                                     |
| kill_old policy + InMemoryStorageAdapter (no cancelExecution) | `ConcurrencyError` thrown fail-fast. Not silent.                 | **Covered** (`packages/scheduler/test/concurrency.test.ts`) |

---

## Dimension: Data

| Scenario                                         | Expected Behavior                                                                                               | Test Status                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ULID boundary: minimum (all `0` chars)           | `TaskIdSchema` regex allows `0` chars. InMemory and D1 handle it.                                               | **Covered** (`packages/auth/test/edge-cases.test.ts`) |
| ULID boundary: maximum (all `Z` chars)           | `TaskIdSchema` regex allows `Z` chars. Same.                                                                    | **Covered**                                           |
| ULID boundary: invalid char (`I`, `L`, `O`, `U`) | `TaskIdSchema` rejects. `Task.parse()` throws.                                                                  | **Covered**                                           |
| 1MB BLOB payload in DB                           | `Task.payload_json` is TEXT (D1) or TEXT in SQLite. 1MB fits. No enforcement. For large payloads, recommend R2. | Pending                                               |
| Task name: empty string                          | `TaskSchema` `z.string().min(1)` rejects.                                                                       | Pending                                               |
| Task name: 200 chars (max)                       | `TaskSchema` `z.string().max(200)` allows.                                                                      | Pending                                               |
| Task name: 201 chars                             | `TaskSchema` rejects.                                                                                           | Pending                                               |

---

## Dimension: HTTP / Network

| Scenario                                              | Expected Behavior                                                                                                | Test Status                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| HTTPS certificate invalid                             | Node fetch / Cloudflare Workers fail-fast. Not tolerated. Configurable via `allowInsecure: true` (for dev only). | Pending                                                       |
| IPv6-only endpoint                                    | DNS resolves to IPv6. SSRF guard passes public IPs. Works.                                                       | Pending                                                       |
| 302 redirect to private IP (SSRF)                     | `assertHostResolved()` checks resolved IPs, not URL host. Blocked.                                               | **Covered** (`packages/auth/test/ssrf.test.ts`)               |
| Token endpoint resolves to private IP (DNS rebinding) | `fakeDnsLookup('10.0.0.7')` in test. `SSRFError` thrown.                                                         | **Covered** (`packages/auth/test/credential-refresh.test.ts`) |
| Request timeout (AbortSignal)                         | `CredentialRefreshError` wraps AbortError.                                                                       | **Covered** (`packages/auth/test/credential-refresh.test.ts`) |

---

## Dimension: OAuth / Credentials

| Scenario                            | Expected Behavior                                                                          | Test Status                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Provider rotates refresh_token      | New token written to DB. `ciphertext`, `iv`, `authTag`, `keyId` updated. `version` bumped. | **Covered** (`packages/auth/test/credential-refresh.test.ts`) |
| Provider returns same refresh_token | New `access_token` used; existing `refresh_token` kept unchanged.                          | **Covered** (`packages/auth/test/credential-refresh.test.ts`) |
| 0-byte master encryption key        | `createCredentialCipher()` throws `Error(/32 bytes/)` at startup. Fail-fast.               | **Covered** (`packages/auth/test/edge-cases.test.ts`)         |
| 32-byte master key (exact)          | AES-256-GCM works normally.                                                                | **Covered** (`packages/auth/test/credential-crypto.test.ts`)  |
| Wrong key decrypts                  | GCM auth tag fails → `decrypt` throws.                                                     | **Covered**                                                   |
| Cipher keyId mismatch               | `decrypt` throws before crypto runs.                                                       | **Covered**                                                   |

---

## Dimension: Cron Expressions

| Scenario                                | Expected Behavior                                                                        | Test Status                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 6-field (with seconds): `0 */5 * * * *` | `cron-parser` accepts. `next()` returns correct timestamps.                              | **Covered** (`packages/scheduler/test/cron-parser.test.ts`) |
| 5-field standard: `*/5 * * * *`         | Standard 5-field works.                                                                  | **Covered**                                                 |
| `@yearly` / `@monthly` aliases          | `cron-parser` maps to equivalent expression. Works.                                      | **Covered** (`packages/scheduler/test/edge-cases.test.ts`)  |
| `@reboot`                               | Cloudflare Workers don't support `@reboot`. Node local adapter logs warning and ignores. | Pending                                                     |
| Quartz L (last day of month)            | `cron-parser` supports `L` in some positions. Check compatibility.                       | **Covered** (`packages/scheduler/test/edge-cases.test.ts`)  |
| Quartz W (nearest weekday)              | Same as above.                                                                           | **Covered**                                                 |
| 7-field (invalid)                       | `InvalidCronError` thrown. `CronTrigger.tick()` catches and skips.                       | **Covered**                                                 |

---

## Dimension: Trigger / Webhook

| Scenario                                      | Expected Behavior                                                                                                                | Test Status                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Webhook body 100MB                            | Hono `c.req.json()` throws. Route returns 400/413. Not stored.                                                                   | **Covered** (`packages/sinker/test/edge-cases.test.ts`)    |
| Webhook body 1MB                              | Accepted within D1 TEXT limit. No enforcement.                                                                                   | Pending                                                    |
| Webhook 1000 req/s same token                 | Deduplication via in-process Map. First fires; subsequent return cached `executionId` with `replay: true`. No duplicate DB rows. | **Covered** (`packages/sinker/test/edge-cases.test.ts`)    |
| Webhook token not found                       | `NotFoundError` thrown. HTTP 404.                                                                                                | **Covered**                                                |
| Event topic does not exist                    | `publish()` returns `[]`. No error. Silent noop.                                                                                 | **Covered** (`packages/scheduler/test/edge-cases.test.ts`) |
| Event topic matches 100 tasks                 | All 100 fired in parallel via `Promise.all`.                                                                                     | **Covered**                                                |
| Malformed `trigger_config_json` on event task | `parseTopic()` returns `null`. Task not matched. Silent skip.                                                                    | **Covered**                                                |

---

## Dimension: API Payloads

| Scenario                        | Expected Behavior                                                                                 | Test Status |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| 1MB JSON payload in API request | D1 TEXT limit. Hono may accept; D1 write fails with constraint. Recommend 100KB soft limit.       | Pending     |
| 10k task list query             | InMemory: fast. SQLite: fast with index. D1: may need cursor pagination. Virtual scrolling in UI. | Pending     |
| SSE disconnect 30s              | Client re-connects. SSE endpoint re-initializes from last known state.                            | Pending     |

---

## Dimension: Rate / Resource Limits

| Scenario                                     | Expected Behavior                                        | Test Status |
| -------------------------------------------- | -------------------------------------------------------- | ----------- |
| D1 batch 10000 statements in one transaction | D1 per-statement limit. Chunk into batches of 500.       | Pending     |
| 100 concurrent `createExecution` calls       | SQLite WAL mode handles. D1: rate-limited by Cloudflare. | Pending     |

---

## Coverage Summary

| Status      | Count |
| ----------- | ----- |
| **Covered** | 24    |
| **Pending** | 12    |

---

## Test File Map

| Package              | Edge Case File                               |
| -------------------- | -------------------------------------------- |
| `@Cadence/scheduler` | `packages/scheduler/test/edge-cases.test.ts` |
| `@Cadence/auth`      | `packages/auth/test/edge-cases.test.ts`      |
| `@Cadence/sinker`    | `packages/sinker/test/edge-cases.test.ts`    |
| `@Cadence/storage`   | `packages/storage/test/edge-cases.test.ts`   |
