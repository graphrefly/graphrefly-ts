# NestJS Graph Boundary

Clean-slate NestJS integration demo for `@graphrefly/ts/adapters/nestjs`.

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
