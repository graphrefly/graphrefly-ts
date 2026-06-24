# NestJS Graph Boundary

Clean-slate NestJS integration demo for `@graphrefly/ts/adapters/nestjs`.

The demo uses the D486/D488 provider bridges: `POST /echo` and `POST /orders` bind existing graph boundary nodes with `@GraphReq(...)` and `@GraphHttpReply(...)`, the WebSocket gateway binds `@GraphWs(...)` with `@GraphWsAck(...)` and `@GraphWsReply(...)`, and the message-pattern controller binds `@GraphMessage(...)` with `@GraphMessageReply(...)`. Standard GraphReFly Nest providers consume the metadata for interceptor, guard, filter, cron, lifecycle, WebSocket, and message phases. `POST /orders` also shows guard denial response headers through the targeted GraphReFly guard-denial filter. It also shows a Nest Logger provider observing the graph-visible `orders.audit` node through `graph.observe(...)`.

The adapter owns only keyed ingress/egress bindings and host-private pending HTTP handles. Admission, policy, audit, and lifecycle semantics are ordinary graph composition.

```bash
pnpm --filter @graphrefly-examples/nestjs-graph-boundary start
```

Endpoints:

- `POST /echo`
- `POST /policy`
- `POST /orders`
- `POST /handled-error`
- `POST /cron/tick`
- `GET /audit/:requestId`
- `POST /lifecycle/teardown`
- WebSocket `orders.reserve` on `/graphrefly`
- TCP microservice pattern `orders.reserve` on `MICRO_HOST:MICRO_PORT` (default `127.0.0.1:3001`)

Use `x-request-id` for stable request ids; otherwise the demo uses deterministic process-local ids.

Cron missed ticks while the host is unavailable are skipped by default; restart or resume continues from the current time and does not synthesize missed-status or catch-up DATA.

WebSocket sockets, ack callbacks, and microservice contexts stay host-private. Graph-visible DATA carries only the selected payload envelope and reply correlation uses `requestId` plus `bindingId`.
