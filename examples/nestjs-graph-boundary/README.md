# NestJS Graph Boundary

Clean-slate NestJS integration demo for `@graphrefly/ts/adapters/nestjs`.

The demo uses D478 decorator/provider ergonomics: `POST /echo` and `POST /orders` bind existing graph boundary nodes with `@GraphReq(...)` and `@GraphHttpReply(...)`, while a Nest interceptor provider brackets per-request attach/emit/cleanup internally. It also shows a Nest Logger provider observing the graph-visible `orders.audit` node through `graph.observe(...)`.

The adapter owns only keyed ingress/egress bindings and host-private pending HTTP handles. Admission, policy, audit, and lifecycle semantics are ordinary graph composition.

```bash
pnpm --filter @graphrefly-examples/nestjs-graph-boundary start
```

Endpoints:

- `POST /echo`
- `POST /policy`
- `POST /orders`
- `GET /audit/:requestId`
- `POST /lifecycle/teardown`

Use `x-request-id` for stable request ids; otherwise the demo uses deterministic process-local ids.
