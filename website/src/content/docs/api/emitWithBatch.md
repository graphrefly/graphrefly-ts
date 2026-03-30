---
title: "emitWithBatch()"
description: "Delivers messages through `emit`, applying batch semantics and canonical\ntier-based ordering (see `messages.ts`):\n\n1. **Immediate** (tier 0–1, 4): DIRTY, INVALI"
---

Delivers messages through `emit`, applying batch semantics and canonical
tier-based ordering (see `messages.ts`):

1. **Immediate** (tier 0–1, 4): DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN,
   unknown — emitted synchronously.
2. **Phase-2** (tier 2): DATA, RESOLVED — deferred while `isBatching()`.
3. **Terminal** (tier 3): COMPLETE, ERROR — always delivered after phase-2.
   When batching, terminal is queued after deferred phase-2 in the pending list.
   When not batching, terminal is emitted after phase-2 synchronously.

This ordering prevents the "COMPLETE-before-DATA" class of bugs: terminal
signals never make a node terminal before phase-2 values reach sinks,
regardless of how the source assembled the message array.

## Signature

```ts
function emitWithBatch(emit: (messages: Messages) => void, messages: Messages): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `emit` | `(messages: Messages) =&gt; void` | — Sink callback. May be called up to three times per invocation
(immediate, deferred, terminal) when not batching. |
| `messages` | `Messages` | — Full `[[Type, Data?], ...]` array for one emission. |

## Returns

`void` — delivery is performed through `emit` callbacks, synchronously
or deferred into the active batch queue.

## Basic Usage

```ts
import { core } from "@graphrefly/graphrefly-ts";

core.emitWithBatch((msgs) => console.log(msgs), [[core.DIRTY], [core.DATA, 42]]);
```
