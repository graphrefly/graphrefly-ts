---
title: "checkpointNodeValue()"
description: "Minimal JSON-shaped payload for a single node's cached value (custom adapters)."
---

Minimal JSON-shaped payload for a single node's cached value (custom adapters).

## Signature

```ts
function checkpointNodeValue<T>(n: Node<T>): { version: number; value: T | undefined }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `n` | `Node&lt;T&gt;` | Any Node. |

## Returns

`{ version: 1, value }` from Node.get.
