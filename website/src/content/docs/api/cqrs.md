---
title: "cqrs()"
description: "Create a CQRS graph container."
---

Create a CQRS graph container.

## Signature

```ts
function cqrs<EM extends CqrsEventMap = Record<string, unknown>>(
	name: string,
	opts?: CqrsOptions,
): CqrsGraph<EM>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` |  |
| `opts` | `CqrsOptions` |  |

## Basic Usage

```ts
const app = cqrs("orders");
app.event("orderPlaced");
app.command("placeOrder", (payload, { emit }) => {
    emit("orderPlaced", { orderId: payload.id, amount: payload.amount });
  });
const { node: orderCount } = app.projection({
    name: "orderCount",
    events: ["orderPlaced"],
    reducer: (_s, events) => events.length,
    initial: 0,
  });
app.dispatch("placeOrder", { id: "1", amount: 100 });
```
