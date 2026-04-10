---
title: "partitionForBatch()"
description: "Splits a message array into three groups by signal tier (see `messages.ts`):\n\n- **immediate** — tier 0–2, 5: START, DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN, "
---

Splits a message array into three groups by signal tier (see `messages.ts`):

- **immediate** — tier 0–2, 5: START, DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN, unknown
- **deferred** — tier 3: DATA, RESOLVED (phase-2, deferred inside `batch()`)
- **terminal** — tier 4: COMPLETE, ERROR (delivered after phase-2)

Order within each group is preserved.

## Signature

```ts
function partitionForBatch(messages: Messages): {
	immediate: Messages;
	deferred: Messages;
	terminal: Messages;
}
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `messages` | `Messages` | — One `down()` payload. |

## Returns

Three groups in canonical delivery order.

## Basic Usage

```ts
import { DATA, DIRTY, COMPLETE, partitionForBatch } from "@graphrefly/graphrefly-ts";

partitionForBatch([[DIRTY], [DATA, 1], [COMPLETE]]);
// { immediate: [[DIRTY]], deferred: [[DATA, 1]], terminal: [[COMPLETE]] }
```
