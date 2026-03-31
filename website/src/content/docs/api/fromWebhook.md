---
title: "fromWebhook()"
description: "Bridge HTTP webhook callbacks into a GraphReFly source."
---

Bridges HTTP webhook callbacks into a GraphReFly source.

## Signature

```ts
function fromWebhook<T = unknown>(
	register: WebhookRegister<T>,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `register` | `WebhookRegister<T>` | Registers `{ emit, error, complete }` handlers and optionally returns cleanup. |
| `opts` | `ExtraOpts` | Optional producer options. |

## Returns

`Node<T>` — webhook payloads as `DATA`.
