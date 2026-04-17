---
title: "batch()"
description: "Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral\nqueue. If `fn` throws, deferred work for the outer frame is discarded\n(unless a drain "
---

Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral
queue. If `fn` throws, deferred work for the outer frame is discarded
(unless a drain is already in progress — cross-language decision A4).

## Signature

```ts
function batch(fn: () => void): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `() =&gt; void` |  |
