# 6-Node Pipeline

Every Cadence pipeline is a DAG composed of **six node kinds**, executed in
order with parallel branches where the DAG allows.

```
trigger → fetch → transform → condition → action → output
   │         │         │           │           │         │
   ▼         ▼         ▼           ▼           ▼         ▼
```

## Kinds

| Kind          | Count | Purpose                                                                            |
| ------------- | ----: | ---------------------------------------------------------------------------------- |
| **trigger**   |     5 | Initiate a run (cron, webhook, manual, email, interval). Exactly one per pipeline. |
| **fetch**     |     6 | Pull data from external systems (HTTP, GraphQL, RSS, webhook, DB, file).           |
| **transform** |     6 | Shape data (JMESPath, template, JSONata, sandboxed code, date, filter).            |
| **condition** |     3 | Branch flow (if, switch, time-window). Pure functions on inputs.                   |
| **action**    |     7 | Side-effectful operations (HTTP, email, Slack, Discord, webhook, DB, SSH).         |
| **output**    |     3 | Finalise (log, store, return). Always last in a linear run.                        |

**Total**: 30 nodes.

## Executor Contract

`@Cadence/pipeline.PipelineNode<TInput, TOutput>` requires:

```ts
validateConfig(config: unknown): { ok: true } | { ok: false; error: string }
execute(input: TInput, config: unknown, ctx: PipelineContext): Promise<TOutput>
```

The executor records a `PipelineSpan` per node (start/finish/status/error) and
propagates failures through the DAG with deterministic retries.
