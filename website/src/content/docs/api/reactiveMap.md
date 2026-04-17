---
title: "reactiveMap()"
description: "Creates a reactive `Map` with optional per-key TTL and optional LRU max size."
---

Creates a reactive `Map` with optional per-key TTL and optional LRU max size.

## Signature

```ts
function reactiveMap<K, V>(options: ReactiveMapOptions<K, V> = {}): ReactiveMapBundle<K, V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `ReactiveMapOptions&lt;K, V&gt;` | `name`, `maxSize`, `defaultTtl` (seconds), or custom `backend`. |

## Returns

`ReactiveMapBundle` — imperative methods (`has`/`get`/`set`/`setMany`/`delete`/
`deleteMany`/`clear`/`pruneExpired`), reactive `entries` node, and O(1)-ish `size`.

## Basic Usage

```ts
import { reactiveMap } from "@graphrefly/graphrefly-ts";

const m = reactiveMap<string, number>({ name: "cache", maxSize: 100, defaultTtl: 60 });
m.set("x", 1);
m.setMany([["y", 2], ["z", 3]]);
m.entries.subscribe((msgs) => { console.log(msgs); });
```

## Behavior Details

- **TTL:** Expiry is checked on `get`, `has`, `size`, `pruneExpired`, and before each
snapshot emission (expired keys are pruned first). Reads that discover expired keys
emit a snapshot so subscribers see state consistent with the read's return value.
There is no background timer; monotonic-clock expiry is immune to wall-clock changes.

**LRU:** Uses native `Map` insertion order — `get` / `has` refreshes position via
delete-then-reinsert; under `maxSize` pressure the first key in iteration order is
evicted. LRU touching does NOT trigger emission (internal optimization).

**Backend:** The default NativeMapBackend owns LRU/TTL. For persistent /
HAMT / shared-state semantics plug in a custom MapBackend. `maxSize` and
`defaultTtl` on the options object are only applied to the default backend — if
you supply `backend`, configure those on your backend directly.
