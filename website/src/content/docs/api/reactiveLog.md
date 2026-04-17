---
title: "reactiveLog()"
description: "Creates an append-only reactive log with immutable array snapshots."
---

Creates an append-only reactive log with immutable array snapshots.

## Signature

```ts
function reactiveLog<T>(
	initial?: readonly T[],
	options: ReactiveLogOptions<T> = {},
): ReactiveLogBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `readonly T[]` | Optional seed entries (copied; pre-trimmed to `maxSize` if set). |
| `options` | `ReactiveLogOptions&lt;T&gt;` | `name`, `maxSize`, and optional pluggable `backend`. |

## Returns

Bundle with `entries` (state node), `append`/`appendMany`/`clear`/`trimHead`,
`size` / `at`, and memoized derived views `tail(n)` / `slice(start, stop?)`.

## Basic Usage

```ts
import { reactiveLog } from "@graphrefly/graphrefly-ts";

const lg = reactiveLog<number>([1, 2], { name: "audit", maxSize: 100 });
lg.append(3);
lg.entries.subscribe((msgs) => console.log(msgs));
const last5 = lg.tail(5);          // derived node
const window = lg.slice(10, 20);   // derived node
```

## Behavior Details

- **Backend:** The default NativeLogBackend uses a ring buffer when `maxSize`
is set (O(1) append + trim) and a flat array otherwise. For persistent/structural-
sharing semantics plug in a custom LogBackend.

**`initial` + custom `backend` (F5):** When you supply `options.backend`, the
`initial` argument is IGNORED — seed the backend yourself before passing it in.
The `initial` seed only applies to the default `NativeLogBackend`.

**Memoized views:** ReactiveLogBundle.tail and ReactiveLogBundle.slicecache derived nodes per-argument. Repeat calls with the same `n` / `(start, stop)`
return the same node, bounding keepalive-subscription count to one per unique argument.
