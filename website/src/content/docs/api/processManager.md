---
title: "processManager()"
description: "Create a process manager that coordinates long-running reactive workflows\nover a CqrsGraph.\n\nProcess instances are identified by `correlationId`. Events from th"
---

Create a process manager that coordinates long-running reactive workflows
over a CqrsGraph.

Process instances are identified by `correlationId`. Events from the watched
event types are routed to per-instance step handlers when the event's
`correlationId` matches a running instance.

```ts
const app = cqrs&lt;{ orderPlaced: { orderId: string }; paymentReceived: { amount: number } }&gt;("orders");

const pm = processManager(app, "fulfillment", {
  initial: { step: "awaiting-payment", total: 0 },
  watching: ["orderPlaced", "paymentReceived"],
  steps: {
    orderPlaced(state, event) {
      return { outcome: "success", state: { ...state, orderId: event.payload.orderId } };
    },
    paymentReceived(state, event) {
      return { outcome: "terminate", state: { ...state, total: event.payload.amount } };
    },
  },
  compensate(state, _error) {
    // undo reservation, issue refund, etc.
  },
  retryMax: 2,
  backoffMs: [100, 500],
});

pm.start("order-123");
app.dispatch("orderPlaced", { orderId: "order-123" }, { correlationId: "order-123" });
```

## Signature

```ts
function processManager<TState, EM extends CqrsEventMap = Record<string, unknown>>(
	cqrsGraph: CqrsGraph<EM>,
	name: string,
	opts: ProcessManagerOpts<TState, EM>,
): ProcessManagerResult<TState>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `cqrsGraph` | `CqrsGraph&lt;EM&gt;` | The CQRS graph whose event streams the manager watches. |
| `name` | `string` | Stable identifier for this process type; used for the
synthetic event-type prefix `_process_&lt;name&gt;_*`. Currently emits
`_process_&lt;name&gt;_started` per `start()`; the prefix is reserved for
future `_state` / `_timer` channels. |
| `opts` | `ProcessManagerOpts&lt;TState, EM&gt;` | Configuration: initial state, watched events, steps, retry,
compensation, and optional persistence. |
