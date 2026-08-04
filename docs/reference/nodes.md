# Node Catalog (30 built-in nodes)

`@Cadence/nodes` ships 30 nodes organised by the 6 pipeline kinds:
**input → input-validate → process → result-validate → post-process → output**.
Every node declares the runtimes it supports (`node` and/or `cloudflare`).

## Input (8)

| type               | description                        |
| ------------------ | ---------------------------------- |
| `curl`             | HTTP GET/POST fetch into the flow  |
| `webhook`          | listen for inbound webhook payload |
| `shell`            | run a local shell command          |
| `schedule-trigger` | cron/interval driven entry point   |
| `manual-trigger`   | manual invocation entry point      |
| `file-watcher`     | watch a path / bucket for changes  |
| `email-inbox`      | poll an IMAP inbox for new mail    |
| `db-poll`          | poll a table/query for new rows    |

## Input Validate (2)

| type              | description                            |
| ----------------- | -------------------------------------- |
| `zod-schema`      | validate the flow against a Zod schema |
| `jsonpath-assert` | assert a JSONPath expression holds     |

## Process (8)

| type                 | description                             |
| -------------------- | --------------------------------------- |
| `http-forward`       | forward the payload to another endpoint |
| `transform-jmespath` | transform with JMESPath                 |
| `transform-jsonata`  | transform with JSONata                  |
| `llm-text`           | LLM text completion call                |
| `llm-vision`         | LLM vision / image understanding        |
| `script-js`          | sandboxed JavaScript transform          |
| `script-python`      | sandboxed Python transform              |
| `data-merge`         | merge multiple flow branches            |

## Result Validate (2)

| type          | description                |
| ------------- | -------------------------- |
| `zod-schema`  | validate the result shape  |
| `http-status` | assert an HTTP status code |

## Post-Process (4)

| type                    | description             |
| ----------------------- | ----------------------- |
| `db-write`              | persist data to storage |
| `log-save`              | write structured logs   |
| `notification-dispatch` | send notifications      |
| `metric-emit`           | emit a metric / counter |

## Output (6)

| type                   | description                |
| ---------------------- | -------------------------- |
| `http-response`        | return an HTTP response    |
| `webhook`              | call an outbound webhook   |
| `email-send`           | send an email              |
| `desktop-notification` | local desktop notification |
| `shell-exec`           | execute a shell command    |
| `file-write`           | write a file / object      |

## Runtime support

Nodes are filtered by runtime:

```ts
import { ALL_NODES, CLOUDFLARE_NODES, NODE_CATALOG } from '@Cadence/nodes'

ALL_NODES.length // 30
CLOUDFLARE_NODES.length // local-only nodes are excluded
```

## Security

`@Cadence/nodes` ships a security layer (`lib/security.ts`):

- `assertCommandSafe` — blocks dangerous shell commands
- `assertScriptSafe` — sandbox guard for `script-js` / `script-python`
- `NodeSSRFError` — blocks outbound SSRF to private ranges
