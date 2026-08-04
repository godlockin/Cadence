# Branch Protection Configuration

This documents the recommended branch protection rules for the `miao` branch
(and any long-lived branches such as `main`).

## Recommended Rules

| Setting                            | Value / Enabled                              |
| ---------------------------------- | -------------------------------------------- |
| Branch name pattern                | `miao`                                       |
| Require pull request reviews       | Enabled, **1 reviewer**                      |
| Dismiss stale reviews              | Enabled                                      |
| Require status checks before merge | Enabled                                      |
| Required checks                    | `type-check`, `lint`, `test`, `build`, `e2e` |
| Require branches to be up to date  | Disabled (avoid merge queue complexity)      |
| Restrict who can push to matching  | Enabled — no direct pushes                   |
| Allow force pushes                 | Disabled                                     |
| Allow deletions                    | Disabled                                     |

## GitHub UI Steps

1. Go to **Settings → Branches** of the repository.
2. Click **Add rule**.
3. Fill **Branch name pattern**: `miao`.
4. Enable the following:
   - [x] Require a pull request before merging
   - [x] Require approvals: `1`
   - [x] Dismiss stale approvals when new commits are pushed
   - [x] Require status checks to pass before merging
   - [x] Require branches to be up to date before merging (optional)
   - [x] Do not allow bypassing the above settings
   - [x] Restrict who can push to matching branches
   - [x] Do not allow force pushes
   - [x] Do not allow branch deletions
5. Search and add required checks: `type-check`, `lint`, `test`, `build`, `e2e`.
6. Save changes.

## Why These Rules

- **4 CI jobs + e2e gate**: Ensures type safety, lint cleanliness, correctness, buildability, and end-to-end behaviour are all verified before any merge.
- **1 review**: Minimum human oversight without creating bottlenecks.
- **No direct push**: Every change goes through the PR pipeline, ensuring CI gates are enforced.
- **No force push**: Prevents history rewriting that could bypass CI.
