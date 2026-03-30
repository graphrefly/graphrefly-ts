---
title: "reactiveLog()"
description: "Creates an append-only reactive log with versioned tuple snapshots."
---

Creates an append-only reactive log with versioned tuple snapshots.

## Signature

```ts
function reactiveLog<T>(
	initial?: readonly T[],
	options: ReactiveLogOptions = {},
): ReactiveLogBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `readonly T[]` | Optional seed entries (copied). |
| `options` | `ReactiveLogOptions` | Optional `name` for `describe()` / debugging. |

## Returns

Bundle with `entries` (state node), `append`, `clear`, and ReactiveLogBundle.tail.

## Basic Usage

```ts
import { reactiveLog } from "@graphrefly/graphrefly-ts";

const lg = reactiveLog<number>([1, 2], { name: "audit" });
lg.append(3);
lg.entries.subscribe((msgs) => console.log(msgs));
```

## Behavior Details

- **Derived views:** tail and logSlice install an internal noop subscription so
`get()` stays wired without an external sink; creating very many disposable derived nodes can
retain subscriptions until the log bundle is unreachable.
