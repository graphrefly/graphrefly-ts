# NestJS Graph Boundary

Clean-slate NestJS integration demo for `@graphrefly/ts/adapters/nestjs`.

The demo uses the D494/D495 provider bundle helpers over D486/D488 phase bridges: `POST /echo` and `POST /orders` bind existing graph boundary nodes with `@GraphReq(...)` and `@GraphHttpReply(...)`, the WebSocket gateway binds `@GraphWs(...)` with `@GraphWsAck(...)` and `@GraphWsReply(...)`, and the message-pattern controller binds `@GraphMessage(...)` with `@GraphMessageReply(...)`. Standard GraphReFly Nest providers consume the metadata for interceptor, guard, filter, cron, lifecycle, WebSocket, and message phases. `POST /orders` also shows guard denial response headers through the targeted GraphReFly guard-denial filter. It also shows a Nest Logger provider observing the graph-visible `orders.audit` node through `graph.observe(...)` and an explicit diagnostics boundary for sanitized adapter diagnostics.

The adapter owns only keyed ingress/egress bindings and host-private pending handles. Admission, policy, audit, and lifecycle semantics are ordinary graph composition. Provider bundles reduce Nest module boilerplate, but they do not scan the container, create graphs, own business graphs, hide route registries, hide event buses, or own retry/session/transport lifecycle policy.

```bash
pnpm --filter @graphrefly-examples/nestjs-graph-boundary start
```

Endpoints:

- `POST /echo`
- `POST /policy`
- `POST /orders`
- `POST /handled-error`
- `POST /cron/tick`
- `POST /cron/check`
- `GET /audit/:requestId`
- `POST /lifecycle/teardown`
- WebSocket `orders.reserve` on `/graphrefly`
- TCP microservice pattern `orders.reserve` on `MICRO_HOST:MICRO_PORT` (default `127.0.0.1:3001`)

Use `x-request-id` for stable request ids; otherwise the demo uses deterministic process-local ids.

`POST /cron/check` runs the deterministic manual cron controller for an optional JSON body such as `{ "iso": "2026-01-05T08:30:00.000Z" }`.

Cron missed ticks while the host is unavailable are skipped by default; restart or resume continues from the current time and does not synthesize missed-status or catch-up DATA. Cron remains five-field and minute-granularity; no seconds grammar or scheduledAt/actualAt/missedCount envelope is added.

WebSocket sockets, ack callbacks, and microservice contexts stay host-private. Graph-visible DATA carries only the selected payload envelope and reply correlation uses `requestId` plus `bindingId`. Adapter diagnostics are host-side snapshots by default; graph-visible diagnostics require the explicit diagnostics boundary and contain only sanitized data fields. There is no diagnostics callback, logging API, hidden event bus, or transport retry/session/reconnect policy in the example.
