---
title: "NestJS Integration"
description: "Clean-slate NestJS integration with D486 Nest-native provider bridge ergonomics."
---

# NestJS Integration

The clean-slate NestJS adapter has two focused subpaths:

- `@graphrefly/ts/adapters/nestjs` is dependency-light structural metadata: boundary factories, binding decorators, envelopes, and lowering types.
- `@graphrefly/ts/adapters/nestjs/native` imports Nest/RxJS and provides standard Nest phase bridges.
- `@graphrefly/ts/adapters/nestjs/websockets` and `@graphrefly/ts/adapters/nestjs/microservices` are focused future bridge boundaries. Today they re-export only dependency-light structural factories; HTTP native imports do not pull `@nestjs/websockets` or `@nestjs/microservices`.

Decorators are binding metadata. Providers are Nest phase bridges. Graph nodes are ordinary topology. The adapter does not create business graphs, rewrite Nest routing, provide `compat/nestjs`, revive `Actor` or `CqrsGraph`, scan the container by default, or hide a message bus.

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

const ordersIn = fromNestReq(g, { bindingId: "node.orders.in" });

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
  @GraphReq(ordersIn, {
    bindingId: "http.orders.in",
    requestId: (req: { requestId: string }) => req.requestId,
    payload: (req: { body: unknown }) => req.body,
  })
  @GraphHttpReply(ordersOut, { bindingId: "http.orders.out" })
  createOrder() {}
}
```

Register the native phase bridge with Nest providers:

```ts
import { provideGraphBoundaryInterceptor } from "@graphrefly/ts/adapters/nestjs/native";

@Module({
  providers: [
    provideGraphBoundaryInterceptor({
      host: (context) => context.switchToHttp().getRequest(),
    }),
  ],
})
class AppModule {}
```

The provider reads metadata for the current class/handler only, attaches host-private pending reply handles, emits ingress DATA, lowers HTTP DATA replies, and cleans up. Controller users do not call `attach` on the decorator path. Low-level `emit(...)` and `toNestHttp(...)` remain available for custom hosts.

## Guards, Filters, and Issues

Use `GraphGuard(...)` with `GraphGuardDecision(...)` for guard phase decisions. Missing, malformed, rejected, or requestId-less decisions fail closed. Guard denial is graph-visible DATA, not protocol `ERROR`; response status/body/headers are written by the targeted GraphReFly guard-denial filter.

```ts
import { UseFilters } from "@nestjs/common";
import { GraphGuardDeniedFilter } from "@graphrefly/ts/adapters/nestjs/native";

class OrdersController {
  @UseFilters(GraphGuardDeniedFilter)
  @GraphGuard(ordersGuardIn, { bindingId: "guard.orders.in" })
  @GraphGuardDecision(ordersGuardOut, { bindingId: "guard.orders.out" })
  createOrder() {}
}

// A deny payload can carry status/body/headers directly:
const denied = {
  kind: "deny",
  status: 403,
  body: { accepted: false },
  headers: { "x-graphrefly-guard": "orders.denied" },
} satisfies GraphGuardDecision;
```

`createGraphGuardDeniedFilter()` returns the same narrow helper as an instance, and `provideGraphGuardDeniedFilter()` registers the class-token provider used by `@UseFilters(GraphGuardDeniedFilter)`. The helper catches only the GraphReFly-owned guard denial exception; it is not a catch-all `APP_FILTER` and does not own ordinary Nest exceptions.

`GraphGuardDecision(...)` supports binding-level `issueResponse` for deny issues and binding-level `protocolError` for reply-node `ERROR`, with binding options taking precedence over provider defaults.

Use `GraphFilter(...)` for generic filter bindings; `GraphError(...)` is exception-oriented sugar. Filter/error bindings default to handle mode and can opt into observe mode.

For exception handling, prefer the targeted helper:

```ts
import { UseFilters } from "@nestjs/common";
import { createGraphExceptionFilter } from "@graphrefly/ts/adapters/nestjs/native";

const graphErrorFilter = createGraphExceptionFilter({
  target: () => ({ target: OrdersController, methodKey: "handledError" }),
});

class OrdersController {
  @UseFilters(graphErrorFilter)
  @GraphError(errorIn, { bindingId: "error.orders.in" })
  @GraphHttpReply(errorOut, { bindingId: "http.error.out" })
  handledError() {}
}
```

`provideGraphExceptionFilter(...)` exposes the same helper through a GraphReFly token for explicit Nest DI wiring. It is not registered as a catch-all `APP_FILTER`: Nest's global `ArgumentsHost` does not reliably expose the current route class/handler, and GraphReFly does not scan the container or own pass-through routing between unrelated filters.

HTTP business failures are DATA payloads, either `{ status, body, headers? }` or `HttpDataIssue`:

```ts
const issue = {
  kind: "issue",
  code: "orders.not_admitted",
  message: "Order was not admitted.",
  status: 403,
  body: { accepted: false },
} satisfies HttpDataIssue;
```

Plain `DataIssue` values lower through `issueResponse(issue, host)`. Protocol `ERROR` from a reply node is graph/reply pipeline failure, not a business error path; it lowers through `protocolError(errorPayload, host)` with binding override before provider override before the safe 500 fallback.

## Cron

`GraphCron(...)` is consumed by `provideGraphCronScheduler(...)`; it does not require `@nestjs/schedule`. The scheduler is a Nest/source boundary that starts and stops host-private timers on module lifecycle hooks and emits ordinary cron ingress DATA.

`fromCron(...)` and `GraphCron` support IANA timezone strings through runtime `Intl` support. Defaults are explicit: nonexistent DST wall-clock minutes are skipped, repeated wall-clock minutes fire at most once, and missed ticks while the host app/provider/event loop is unavailable are skipped by default. Restart or resume continues from the current time only; no missed-status or catch-up DATA is synthesized.

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
- `POST /handled-error`
- `POST /cron/tick`
- `GET /audit/:requestId`
- `POST /lifecycle/teardown`
- `GET /graph`

`POST /echo` and `POST /orders` use the D486 native provider bridge. `POST /orders` shows guard denial response headers through `GraphGuardDeniedFilter`. `POST /handled-error` uses the targeted exception helper with Nest `@UseFilters(...)`. The example also includes a Nest Logger provider that subscribes to the graph-visible `orders.audit` node with `graph.observe(...)`.
