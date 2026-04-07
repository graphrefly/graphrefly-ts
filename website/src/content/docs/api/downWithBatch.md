---
title: "downWithBatch()"
description: "API reference for downWithBatch."
---

## Signature

```ts
function downWithBatch(
	sink: (messages: Messages) => void,
	messages: Messages,
	phase: 2 | 3 = 2,
	options?: { strategy?: DownStrategy },
): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `(messages: Messages) =&gt; void` |  |
| `messages` | `Messages` |  |
| `phase` | `2 | 3` |  |
| `options` | `{ strategy?: DownStrategy }` |  |
