---
title: "toMessages$()"
description: "Bridge a `Node<T>` to an `Observable<Messages>` — raw message batches.\n\nEach emission is a full `[[Type, Data?], ...]` batch. The Observable\nterminates on ERROR"
---

Bridge a `Node&lt;T&gt;` to an `Observable&lt;Messages&gt;` — raw message batches.

Each emission is a full `[[Type, Data?], ...]` batch. The Observable
terminates on ERROR or COMPLETE (the terminal batch is still emitted
as the final `next()` before the Observable signal).

## Signature

```ts
function toMessages$<T>(node: Node<T>): Observable<Messages>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `Node&lt;T&gt;` |  |
