---
title: "NestJS Integration"
description: "Clean-slate NestJS integration with keyed GraphBoundary ingress and egress nodes."
---

# NestJS Integration

The clean-slate NestJS adapter lives at `@graphrefly/ts/adapters/nestjs`. It is an experimental D474 boundary layer: Nest controllers, guards, filters, interceptors, lifecycle hooks, and schedulers lower host events into keyed graph envelopes, and egress envelopes resolve host-private pending handles.

It does not provide `compat/nestjs`, `GraphReflyModule`, `GraphReflyGuard`, `Actor`, `CqrsGraph`, or a hidden event bus. Admission, policy, audit, retry, CQRS, work queues, and human approval remain ordinary graph composition.

## Envelope

```ts
type NestBoundaryEnvelope<T = unknown> = {
  requestId: string;
  bindingId: string;
  version: number;
  payload: T;
};
```

Use stable explicit `bindingId` values for durable APIs. `requestId` correlates one host request/message. Nest request/response objects, sockets, callbacks, provider instances, and transport handles stay host-private.

## HTTP Boundary

```ts
import { graph, depLatest } from "@graphrefly/ts";
import { fromNestReq, toNestHttp, type NestBoundaryEnvelope } from "@graphrefly/ts/adapters/nestjs";

const g = graph({ name: "orders" });

const ordersIn = fromNestReq(g, {
  bindingId: "http.orders.in",
  requestId: (req: { requestId: string }) => req.requestId,
  payload: (req: { body: unknown }) => req.body,
});

const ordersOut = g.node<NestBoundaryEnvelope>(
  [ordersIn.node],
  (ctx) => {
    const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope;
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

const http = toNestHttp(ordersOut, { bindingId: "http.orders.out" });
```

A Nest controller can attach a Promise resolver as the host-private pending handle, emit into `ordersIn`, and let `toNestHttp` resolve only the matching `requestId`.

## Runnable Example

The first slice lives at `examples/nestjs-graph-boundary/`:

```bash
pnpm --filter @graphrefly-examples/nestjs-graph-boundary start
```

It includes:

- `POST /echo`
- `POST /policy`
- `POST /orders`
- `GET /audit/:requestId`
- `POST /lifecycle/teardown`

The guard endpoint emits a guard ingress envelope, while the graph still owns policy/admission and returns accepted or blocked HTTP payloads through `toNestHttp`.
