---
title: "NestJS Integration"
description: "Clean-slate NestJS integration with D478 decorator/provider boundary ergonomics."
---

# NestJS Integration

The clean-slate NestJS adapter lives at `@graphrefly/ts/adapters/nestjs`. It binds ordinary Nest controller methods to existing graph boundary nodes; it does not create business graphs, rewrite Nest routing, provide `compat/nestjs`, revive `Actor` or `CqrsGraph`, or hide a message bus.

## Envelope

```ts
type NestBoundaryEnvelope<T = unknown> = {
  bindingId: string;
  version: 1;
  payload: T;
  requestId?: string;
};

type NestReplyEnvelope<T = unknown> =
  NestBoundaryEnvelope<T> & { requestId: string };
```

`requestId` is optional on the base envelope so lifecycle, cron, and other non-request ingress do not need fake request identity. HTTP replies and other reply-capable egress use `NestReplyEnvelope` and require a present `requestId`.

`bindingId` belongs to the Nest binding, usually supplied on `GraphReq(...)` or `GraphHttpReply(...)`. The graph node remains ordinary topology; its node name is not the durable Nest binding identity. Envelope `version` is the adapter envelope schema version, and v1 is the only accepted default.

## Decorator Path

```ts
import { graph, depLatest } from "@graphrefly/ts";
import {
  fromNestReq,
  GraphReq,
  GraphHttpReply,
  type NestBoundaryEnvelope,
  type NestReplyEnvelope,
} from "@graphrefly/ts/adapters/nestjs";

const g = graph({ name: "orders" });

const ordersIn = fromNestReq(g, {
  bindingId: "node.orders.in",
  requestId: (req: { requestId: string }) => req.requestId,
  payload: (req: { body: unknown }) => req.body,
});

const ordersOut = g.node<NestReplyEnvelope>(
  [ordersIn.node],
  (ctx) => {
    const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope;
    if (envelope.requestId === undefined) return;
    ctx.down([[
      "DATA",
      {
        requestId: envelope.requestId,
        bindingId: "http.orders.out",
        version: 1,
        payload: { status: 202, body: { accepted: true } },
      },
    ]]);
  },
  { name: "http.orders.out" },
);

class OrdersController {
  @GraphReq(ordersIn, { bindingId: "http.orders.in" })
  @GraphHttpReply(ordersOut, { bindingId: "http.orders.out" })
  createOrder() {}
}
```

A Nest provider/interceptor calls the adapter runner, reads the decorator metadata for the current `ExecutionContext`, attaches a host-private pending reply handle, emits ingress DATA, and cleans up the pending handle. Controller users do not call `attach` on the decorator path. Low-level `toNestHttp(...)` remains available for custom hosts.

## Inspection and Logging

Adapter diagnostics are not a stable logging callback and are not graph inspection. Use graph-visible audit/status/issues nodes and observe them:

```ts
const stop = g.observe("orders.audit").subscribe((event) => {
  if (event.msg[0] === "DATA") {
    nestLogger.log(JSON.stringify(event.msg[1]));
  }
});
```

`graph.describe()` and `graph.observe()` remain the inspection path. Ordinary business HTTP failures are DATA payloads such as `{ status, body }`, not protocol `ERROR`.

## Runnable Example

The example lives at `examples/nestjs-graph-boundary/`:

```bash
pnpm --filter @graphrefly-examples/nestjs-graph-boundary start
```

It includes:

- `POST /echo`
- `POST /policy`
- `POST /orders`
- `GET /audit/:requestId`
- `POST /lifecycle/teardown`
- `GET /graph`

`POST /echo` and `POST /orders` use the D478 decorator/provider path. The example also includes a Nest Logger provider that subscribes to the graph-visible `orders.audit` node with `graph.observe(...)`.
