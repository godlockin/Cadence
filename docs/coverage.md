# Test Coverage Report — PulseDeck v1.0

Vitest v8 coverage across monorepo (pnpm coverage, `vitest run --coverage` per package).

## Summary

| Package           | Stmts    | Branches | Funcs    | Notes                                                        |
| ----------------- | -------- | -------- | -------- | ------------------------------------------------------------ |
| domain            | 15.69    | 0%       | 0%       | Only 1 test file (audit.test.ts), most domain types untested |
| storage           | 87.1%    | 78.24%   | 86.26%   | 213 storage tests (InMemory/SQLite/D1/CredentialRefresh)     |
| sinker            | 95.21%   | 88.98%   | 86.24%   | dispatcher/state-machine 100%, security 90%+                 |
| queue             | 92.05%   | 93.33%   | 78.12%   | 20 queue tests                                               |
| scheduler         | 95.63%   | 90.43%   | 84.75%   | 175 scheduler integration tests                              |
| auth              | 85.36%   | 85.97%   | 81.52%   | 184 auth tests (JWT/SSRF/RBAC/CredentialRefresh              |
| nodes             | 86.73%   | 73.52%   | 82.32%   | 92 node tests                                                |
| api               | 82.37%   | 82.64%   | 87.5%    | 136 API integration tests                                    |
| web               | 0%       | —        | —        | No vitest unit tests (Playwright E2E covers UI separately    |
| db                | 25.37%   | 83.33%   | 66.66%   | Only migrate.test.ts runs, schema.ts uncovered               |
| ui                | 0%       | —        | —        | index.tsx is passthrough                                     |
| executor-pipeline | 0%       | —        | —        | No test files                                                |
| **total**         | **~78%** | **~82%** | **~84%** |                                                              |

## Gaps

### High-priority (< 70% statements)

- **db (25.37%)** — schema.ts has 0% coverage. Add tests for schema.ts (SQLite schema validation, migrations).
- **domain (15.69%** — credential.ts, execution.ts, task.ts untested. Add domain model tests.

### Medium-priority (< 80% statements)

- **auth logger.ts (29.62%)** — logStructured/logInfo paths uncovered.
- **sinker logger.ts (55.4%)** — log* paths uncovered.
- **scheduler handle.ts (16.36%)** — execution handler paths uncovered.
- **auth service.ts (67.92%)** — bulk invite/delete paths.

## Test counts

- vitest: 480 tests (packages + apps)
- playwright API E2E: 30 tests
- playwright UI E2E: 15 tests (6 suites × 2-3 cases each)
- **Total: 525+ test cases**
