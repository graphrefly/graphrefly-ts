---
title: "NestJS Integration"
description: "Build a reactive NestJS backend with GraphReFly — CQRS, scheduled jobs, WebSocket streaming, SSE, and actor-scoped guards."
---

# NestJS Integration

GraphReFly ships a first-class NestJS adapter at `@graphrefly/graphrefly/compat/nestjs`. It gives you a reactive graph inside NestJS's dependency injection, with CQRS event flows, scheduled jobs, real-time streaming, and actor-scoped guards — all wired through the graph protocol.

This recipe walks through a complete order-flow backend. The full runnable example lives at [`examples/nestjs-order-flow.ts`](https://github.com/graphrefly/graphrefly-ts/blob/main/examples/nestjs-order-flow.ts).

## Install

```bash frame="none"
npm install @graphrefly/graphrefly @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata
# For WebSocket support:
npm install @nestjs/platform-ws @nestjs/websockets
```

## Module registration

`GraphReflyModule.forRoot()` creates a global graph singleton. `GraphReflyModule.forCqrs()` mounts a CQRS subgraph that auto-namespaces under the root.

```ts
import { Module } from "@nestjs/common";
import { GraphReflyModule } from "@graphrefly/graphrefly/compat/nestjs";

@Module({
  imports: [
    // Root graph singleton (global)
    GraphReflyModule.forRoot({ name: "app" }),

    // CQRS orders subgraph — auto-mounts as app::orders
    GraphReflyModule.forCqrs({
      name: "orders",
      build: (g) => {
        g.event("orderPlaced");
      },
    }),
  ],
})
class AppModule {}
```

Inject the graph or a named CQRS subgraph anywhere:

```ts
import { Inject } from "@nestjs/common";
import { GRAPHREFLY_ROOT_GRAPH, getGraphToken } from "@graphrefly/graphrefly/compat/nestjs";
import type { Graph } from "@graphrefly/graphrefly/graph";
import type { CqrsGraph } from "@graphrefly/graphrefly/patterns";

class OrderController {
  constructor(
    @Inject(GRAPHREFLY_ROOT_GRAPH) private graph: Graph,
    @Inject(getGraphToken("orders")) private orders: CqrsGraph,
  ) {}
}
```

## CQRS order flow

Wire commands, events, projections, and sagas through the `CqrsGraph` API:

### Command handler

Dispatch a command that emits an event:

```ts
this.orders.command<OrderPayload>("placeOrder", (payload, { emit }) => {
  emit("orderPlaced", {
    orderId: payload.id,
    item: payload.item,
    amount: payload.amount,
  });
});
```

### Projection

Fold events into a read model:

```ts
this.orders.projection<OrderSummary>(
  "orderSummary",
  ["orderPlaced"],
  (current, events) => {
    let summary = { ...current };
    for (const evt of events) {
      const p = evt.payload as { orderId: string; amount: number };
      summary = {
        totalOrders: summary.totalOrders + 1,
        totalRevenue: summary.totalRevenue + p.amount,
        lastOrderId: p.orderId,
      };
    }
    return summary;
  },
  { totalOrders: 0, totalRevenue: 0, lastOrderId: null },
);
```

### Saga

Orchestrate side effects in response to events:

```ts
this.orders.saga("fulfillment", ["orderPlaced"], (event) => {
  const p = event.payload as { orderId: string };
  console.log(`Fulfillment for ${p.orderId} — shipping initiated`);
});
```

### Dispatch and query

```ts
// POST /orders/place
@Post("place")
placeOrder(@Body() body: OrderPayload) {
  this.orders.dispatch("placeOrder", body);
  return { status: "ok", orderId: body.id };
}

// GET /orders/summary
@Get("summary")
getSummary() {
  return this.orders.resolve("orderSummary").get();
}
```

## Actor guard

`GraphReflyGuard` extracts an `Actor` from the request, making it available to graph operations. The guard supports header-based extraction (for development) and JWT payload extraction (for production).

```ts
import { GraphReflyGuard, fromHeader, getActor } from "@graphrefly/graphrefly/compat/nestjs";

// Reads Actor from the `x-actor` header (JSON-parsed)
const actorGuard = GraphReflyGuard(fromHeader());

@Controller("admin")
@UseGuards(actorGuard)
class AdminController {
  constructor(@Inject(GRAPHREFLY_ROOT_GRAPH) private graph: Graph) {}

  @Get("describe")
  describe(@Req() req: unknown) {
    const actor = getActor(req);
    return this.graph.describe({ actor, detail: "standard" });
  }
}
```

```bash frame="none"
# Test with actor context:
curl http://localhost:3000/admin/describe \
  -H 'x-actor: {"type":"human","id":"admin-1"}'
```

For production, swap to JWT extraction:

```ts
import { fromJwtPayload } from "@graphrefly/graphrefly/compat/nestjs";

const actorGuard = GraphReflyGuard(fromJwtPayload());
```

## Scheduled jobs

Use `fromTimer()` and `fromCron()` as reactive graph nodes — no imperative `setInterval` or cron libraries needed.

```ts
import { fromTimer, fromCron } from "@graphrefly/graphrefly/extra";

// Metrics heartbeat every 10s
const timerNode = fromTimer(10_000, { period: 10_000, name: "__schedule__.metrics" });
this.graph.add("__schedule__.metrics", timerNode);

// Daily cleanup at midnight
const cronNode = fromCron("0 0 * * *", { name: "__schedule__.dailyCleanup" });
this.graph.add("__schedule__.dailyCleanup", cronNode);
```

Both are visible in `graph.describe()` and participate in the reactive topology like any other node.

## Real-time streaming

### WebSocket observe

`ObserveGateway` bridges the graph's observe protocol to WebSocket clients:

```ts
import { ObserveGateway } from "@graphrefly/graphrefly/compat/nestjs";

@WebSocketGateway()
class GraphWsGateway implements OnModuleDestroy {
  private gw: ObserveGateway;

  constructor(@Inject(GRAPHREFLY_ROOT_GRAPH) graph: Graph) {
    this.gw = new ObserveGateway(graph);
  }

  handleConnection(client: unknown) { this.gw.handleConnection(client); }
  handleDisconnect(client: unknown) { this.gw.handleDisconnect(client); }

  @SubscribeMessage("observe")
  onObserve(client: unknown, data: unknown) {
    this.gw.handleMessage(client, data);
  }

  onModuleDestroy() { this.gw.destroy(); }
}
```

Clients send `{ event: "observe", data: { node: "orders::orderPlaced" } }` and receive reactive updates as the node changes.

### SSE stream

`observeSSE()` returns a `ReadableStream` for Server-Sent Events:

```ts
import { observeSSE, getActor } from "@graphrefly/graphrefly/compat/nestjs";

@Get("stream")
streamOrders(@Req() req: unknown, @Res() res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.writeHead(200);

  const stream = observeSSE(this.graph, "orders::orderPlaced", {
    actor: getActor(req),
    keepAliveMs: 15_000,
  });

  // Pipe ReadableStream to HTTP response...
}
```

```bash frame="none"
curl -N http://localhost:3000/orders/stream
```

## Admin introspection

Every node in the graph — CQRS events, projections, scheduled jobs, custom nodes — is visible through `graph.describe()`:

```ts
@Get("describe")
describe() {
  return this.graph.describe();
}
```

```bash frame="none"
curl http://localhost:3000/admin/describe | jq .
```

Returns the full topology: node names, types, dependency edges, current values, and metadata.

You can also export diagrams directly from the running graph:

```ts
@Get("mermaid")
mermaid() {
  return this.graph.toMermaid({ direction: "LR" });
}

@Get("d2")
d2() {
  return this.graph.toD2({ direction: "LR" });
}
```

```bash frame="none"
curl http://localhost:3000/admin/mermaid
curl http://localhost:3000/admin/d2
```

## Running the example

The complete, bootable example is at `examples/nestjs-order-flow.ts`:

```bash frame="none"
# Default port (3000)
pnpm exec tsx --tsconfig examples/tsconfig.json examples/nestjs-order-flow.ts

# Or choose a different port if 3000 is already in use
PORT=3001 pnpm exec tsx --tsconfig examples/tsconfig.json examples/nestjs-order-flow.ts
```

Then try:

```bash frame="none"
# Place an order
curl -X POST http://localhost:3000/orders/place \
  -H "Content-Type: application/json" \
  -d '{"id":"order-1","item":"Widget","amount":29.99}'

# Check the projection
curl http://localhost:3000/orders/summary

# Stream events via SSE
curl -N http://localhost:3000/orders/stream

# Inspect the graph topology
curl http://localhost:3000/admin/describe | jq .

# Export diagrams
curl http://localhost:3000/admin/mermaid
curl http://localhost:3000/admin/d2
```

## Key concepts

| Concept | GraphReFly NestJS | Traditional NestJS |
|---|---|---|
| State management | Reactive graph nodes | Services with mutable fields |
| CQRS | `CqrsGraph` — command/event/projection/saga | `@nestjs/cqrs` — separate buses |
| Scheduling | `fromTimer()` / `fromCron()` as graph nodes | `@nestjs/schedule` decorators |
| Real-time | `ObserveGateway` / `observeSSE()` | Manual WebSocket/SSE wiring |
| Introspection | `graph.describe()` — full topology | None built-in |
| Actor context | `GraphReflyGuard` + `getActor()` | Custom guards |

The graph approach means every piece of state — commands, events, projections, timers, custom nodes — lives in a single observable topology. You get introspection, snapshotting, and reactive composition for free.
