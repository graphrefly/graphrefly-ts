---
title: "NestJS Integration"
description: "Clean-slate NestJS integration with D495 focused provider ergonomics and explicit diagnostics."
---

# NestJS Integration

Install GraphReFly plus the Nest peers for the phases you use:

```bash
pnpm add @graphrefly/ts @nestjs/common @nestjs/core rxjs
pnpm add @nestjs/websockets @nestjs/platform-ws      # only for the WebSocket bridge
pnpm add @nestjs/microservices                       # only for the message bridge
```

The clean-slate NestJS adapter has focused subpaths:

| Import path | Use |
|---|---|
| `@graphrefly/ts/adapters/nestjs` | Dependency-light structural metadata: boundary factories, binding decorators, envelopes, and lowering types. |
| `@graphrefly/ts/adapters/nestjs/native` | Nest/RxJS native phase bridges for HTTP interceptor, guard, filter, cron, and lifecycle phases. |
| `@graphrefly/ts/adapters/nestjs/websockets` | Focused optional-peer native bridge for `@nestjs/websockets` gateway ingress plus ack/reply egress. |
| `@graphrefly/ts/adapters/nestjs/microservices` | Focused optional-peer native bridge for `@nestjs/microservices` message-pattern ingress plus reply egress. |

HTTP/native imports do not pull `@nestjs/websockets` or `@nestjs/microservices`. The WebSocket and message subpaths import only their matching optional peer.

Decorators are binding metadata. Providers are Nest phase bridges. Graph nodes are ordinary topology. D494/D495 are ergonomics and testability slices. NestJS provider bundle helpers and explicit target helpers reduce module boilerplate, but they never scan the Nest container, create graphs, own business graphs, add hidden route registries, introduce hidden event buses, or own retry/session/transport lifecycle policy.

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

For common native wiring, use the explicit provider bundles:

```ts
import {
  graphCronTarget,
  graphLifecycleTarget,
  provideGraphNativeProviders,
} from "@graphrefly/ts/adapters/nestjs/native";

const cronTargets = [
  graphCronTarget(OrdersController, "cronTick", {
    expr: "* * * * *",
    timezone: "UTC",
  }),
];

@Module({
  providers: [
    ...provideGraphNativeProviders({
      http: {
        boundaryInterceptor: {
          host: (context) => context.switchToHttp().getRequest(),
        },
        guard: {},
      },
      cronScheduler: { targets: cronTargets },
      lifecycleHooks: {
        targets: [
          graphLifecycleTarget(OrdersController, "teardown", {
            event: "module-destroy",
          }),
        ],
      },
    }),
  ],
})
class AppModule {}
```

The bundle returns ordinary `Provider[]`. It is not a module, does not create a graph, and does not discover targets. Targets remain explicit data supplied by the host app.

## WebSocket and Message Bridges

D495 extends the NestJS ergonomics slice to focused transport subpaths. WebSocket modules may use `provideGraphWsProviders(...)` from `@graphrefly/ts/adapters/nestjs/websockets`, and message-pattern modules may use `provideGraphMessageProviders(...)` from `@graphrefly/ts/adapters/nestjs/microservices`. Each helper returns an ordinary explicit Nest provider array over existing bridge options. These helpers are not modules, do not create graphs, do not scan the container, do not discover routes or handlers, and do not own retry, session, or transport lifecycle policy.

Use `GraphWs(...)` with `GraphWsAck(...)` or `GraphWsReply(...)` through `provideGraphWsProviders(...)` or the primitive `provideGraphWsBridge(...)` from `@graphrefly/ts/adapters/nestjs/websockets`. Use `GraphMessage(...)` with `GraphMessageReply(...)` through `provideGraphMessageProviders(...)` or the primitive `provideGraphMessageBridge(...)` from `@graphrefly/ts/adapters/nestjs/microservices`.

```ts
import { provideGraphMessageProviders } from "@graphrefly/ts/adapters/nestjs/microservices";
import { provideGraphWsProviders } from "@graphrefly/ts/adapters/nestjs/websockets";

@Module({
  providers: [
    ...provideGraphWsProviders({
      bridge: {
        ack: (host: WsHost) => host.ack,
        client: (host: WsHost) => host.client,
        diagnosticBoundary: nestDiagnostics,
      },
    }),
    ...provideGraphMessageProviders({
      bridge: { diagnosticBoundary: nestDiagnostics },
    }),
  ],
})
class AppModule {}
```

These native phase bridges read only the metadata for the current gateway/controller method, require explicit payload selectors, and correlate reply-capable egress by both `requestId` and `bindingId`. Sockets, clients, ack callbacks, message contexts, transport clients, Observables, Promises, and reply handles stay host-private pending handles; graph-visible DATA carries only the selected payload envelope. Wrong-binding, stale, malformed, terminal, timeout, disconnect, and dispose cases are adapter diagnostics and cleanup paths, not protocol `ERROR`.

The optional-peer boundary remains strict: `@nestjs/websockets` is imported only by the WebSocket subpath, and `@nestjs/microservices` is imported only by the microservice/message subpath. The structural `@graphrefly/ts/adapters/nestjs` surface and HTTP/native `@graphrefly/ts/adapters/nestjs/native` surface do not pull those transport peers.

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

The deterministic controller is for manual checks and tests:

```ts
import { createGraphCronController, graphCronTarget } from "@graphrefly/ts/adapters/nestjs/native";

const controller = createGraphCronController({
  targets: [
    graphCronTarget(OrdersController, "cronTick", {
      expr: "30 8 * * 1",
      timezone: "UTC",
    }),
  ],
});

controller.check(new Date("2026-01-05T08:30:00.000Z"));
```

Cron remains five-field, minute-granularity, skip/current-time-only, and deduped per matched wall-clock minute. The deterministic cron controller does not add seconds grammar, missed-status DATA, catch-up replay DATA, scheduledAt/actualAt/missedCount payloads, or a graph-core scheduler.

## Inspection and Logging

Adapter diagnostics are host-side snapshots by default. `diagnostics()` on reply/bridge objects remains a host diagnostic snapshot and does not emit graph DATA by itself. Adapter diagnostics are not a stable logging callback and are not graph inspection. Use graph-visible audit/status/issues nodes and observe them:

```ts
const stop = g.observe("orders.audit").subscribe((event) => {
  if (event.msg[0] === "DATA") {
    nestLogger.log(JSON.stringify(event.msg[1]));
  }
});
```

`graph.describe()` and `graph.observe()` remain the inspection path. Ordinary business HTTP failures are DATA payloads such as `{ status, body }`, not protocol `ERROR`.

Graph-visible adapter diagnostics require an explicitly wired diagnostic ingress boundary:

```ts
import { fromNestDiagnostics } from "@graphrefly/ts/adapters/nestjs";
import { provideGraphNativeProviders } from "@graphrefly/ts/adapters/nestjs/native";

const nestDiagnostics = fromNestDiagnostics(g, {
  bindingId: "node.nest.diagnostics",
});

@Module({
  providers: [
    ...provideGraphNativeProviders({
      http: {
        boundaryInterceptor: { diagnosticBoundary: nestDiagnostics },
        guard: { diagnosticBoundary: nestDiagnostics },
      },
    }),
  ],
})
class AppModule {}
```

Graph-visible diagnostics emit only sanitized data-only payloads: `kind`, `phase`, `requestId`, `bindingId`, `expectedBindingId`, `message`, and optional `{ name, message }` error summary. Raw sockets, clients, contexts, callbacks, transport handles, Promises, Observables, and raw Error objects never enter graph DATA.

There is no `onDiagnostic` callback or logging API. Log or audit diagnostics by composing explicit graph nodes and subscribing with `graph.observe(...)`, the same as other graph-visible status.

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
- `POST /cron/check`
- `GET /audit/:requestId`
- `POST /lifecycle/teardown`
- `GET /graph`
- WebSocket `orders.reserve` on `/graphrefly`
- TCP microservice pattern `orders.reserve` on `MICRO_HOST:MICRO_PORT` (default `127.0.0.1:3001`)

`POST /echo` and `POST /orders` use the D494 native provider bundle. The WebSocket and message-pattern methods use the D495 focused optional-peer provider bundles with `requestId` plus `bindingId` correlation. `POST /orders` shows guard denial response headers through `GraphGuardDeniedFilter`. `POST /handled-error` uses the targeted exception helper with Nest `@UseFilters(...)`. `POST /cron/check` demonstrates the deterministic manual cron controller. The example also includes a Nest Logger provider that subscribes to the graph-visible `orders.audit` node with `graph.observe(...)` and an explicit diagnostic boundary for sanitized adapter diagnostics.

WebSocket and microservice helpers stay in their focused optional-peer subpaths. Live WebSocket and TCP tests are acceptance coverage over the existing public APIs; they do not define new public transport policy.
