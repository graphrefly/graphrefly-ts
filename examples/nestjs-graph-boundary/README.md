# NestJS Graph Boundary

Clean-slate NestJS integration demo for `@graphrefly/ts/adapters/nestjs`.

The demo uses the D486 provider bridge: `POST /echo` and `POST /orders` bind existing graph boundary nodes with `@GraphReq(...)` and `@GraphHttpReply(...)`, while standard GraphReFly Nest providers consume the metadata for interceptor, guard, filter, cron, and lifecycle phases. `POST /orders` also shows guard denial response headers through the targeted GraphReFly guard-denial filter. It also shows a Nest Logger provider observing the graph-visible `orders.audit` node through `graph.observe(...)`.

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

Use `x-request-id` for stable request ids; otherwise the demo uses deterministic process-local ids.

Cron missed ticks while the host is unavailable are skipped by default; restart or resume continues from the current time and does not synthesize missed-status or catch-up DATA.
