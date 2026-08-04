# HTTP API Reference

Base URL: the API root. All endpoints return JSON. Errors use a typed
envelope handled by the global error handler:

```
{ "error": "error_code", "message": "human readable", "requestId": "..." }
```

## Health

| method | path          | description                     |
| ------ | ------------- | ------------------------------- |
| GET    | `/health`     | liveness + db probe             |
| GET    | `/api/health` | status incl. scheduler snapshot |

## Auth

| method | path                   | auth | description                          |
| ------ | ---------------------- | ---- | ------------------------------------ |
| POST   | `/api/auth/register`   | no   | create account (first = super_admin) |
| POST   | `/api/auth/login`      | no   | exchange credentials for tokens      |
| POST   | `/api/auth/refresh`    | no   | rotate a refresh token               |
| POST   | `/api/auth/logout`     | no   | revoke a refresh token               |
| POST   | `/api/auth/logout-all` | yes  | revoke all sessions                  |
| GET    | `/api/auth/me`         | yes  | current user profile                 |

## Tasks

| method | path                     | auth | description                      |
| ------ | ------------------------ | ---- | -------------------------------- |
| GET    | `/api/tasks`             | yes  | list with filters                |
| POST   | `/api/tasks`             | yes  | create (pipeline:create)         |
| GET    | `/api/tasks/:id`         | yes  | read                             |
| PATCH  | `/api/tasks/:id`         | yes  | update (optimistic lock)         |
| DELETE | `/api/tasks/:id`         | yes  | soft delete                      |
| POST   | `/api/tasks/:id/trigger` | yes  | manual trigger (202 → execution) |
| POST   | `/api/tasks/:id/suspend` | yes  | suspend                          |
| POST   | `/api/tasks/:id/resume`  | yes  | resume                           |
| POST   | `/api/tasks/:id/cancel`  | yes  | cancel active executions         |

### Task create body (selected fields)

```jsonc
{
  "name": "sync-db",
  "description": "Every minute",
  "payloadKind": "command",
  "payload": { "action": "sync" },
  "triggerKind": "cron",
  "triggerConfig": {},
  "cron": "* * * * *",
  "timezone": "UTC",
  "maxRetries": 2,
  "concurrencyPolicy": "skip",
  "tags": ["ops"],
}
```

## Executions

| method | path                         | auth | description         |
| ------ | ---------------------------- | ---- | ------------------- |
| GET    | `/api/executions`            | yes  | list with filters   |
| GET    | `/api/executions/:id`        | yes  | read                |
| GET    | `/api/executions/:id/stream` | yes  | SSE snapshot stream |

## Credentials

| method | path                           | auth | description                  |
| ------ | ------------------------------ | ---- | ---------------------------- |
| GET    | `/api/credentials`             | yes  | list own credentials         |
| POST   | `/api/credentials`             | yes  | create (encrypts secret)     |
| GET    | `/api/credentials/:id`         | yes  | metadata only (no plaintext) |
| PATCH  | `/api/credentials/:id`         | yes  | update metadata              |
| DELETE | `/api/credentials/:id`         | yes  | delete                       |
| POST   | `/api/credentials/:id/refresh` | yes  | OAuth token refresh          |
| POST   | `/api/credentials/:id/rotate`  | yes  | force rotate                 |

## Webhooks

| method | path                           | auth | description                      |
| ------ | ------------------------------ | ---- | -------------------------------- |
| POST   | `/api/webhooks/:token/trigger` | no   | fire a webhook task (idempotent) |

Send an optional `Idempotency-Key` header — a replay within the dedup window
returns the SAME `executionId` with `replay: true`.

## Scheduler

| method | path                    | auth | description                 |
| ------ | ----------------------- | ---- | --------------------------- |
| GET    | `/api/scheduler/status` | yes  | cron/webhook/cache snapshot |

## Admin

| method | path                | auth | description               |
| ------ | ------------------- | ---- | ------------------------- |
| GET    | `/api/users`        | yes  | list users (user:read)    |
| POST   | `/api/users/invite` | yes  | invite user (user:invite) |
| GET    | `/api/groups`       | yes  | list groups               |
| GET    | `/api/roles`        | yes  | list roles                |
| GET    | `/api/audit`        | yes  | audit trail (audit:read)  |

## Authentication

Attach the access token to protected routes:

```
Authorization: Bearer <accessToken>
```
