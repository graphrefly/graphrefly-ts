---
title: "reactiveMap()"
description: "Creates a reactive `Map` with optional per-key TTL and optional LRU max size."
---

Creates a reactive `Map` with optional per-key TTL and optional LRU max size.

## Signature

```ts
function reactiveMap<K, V>(options: ReactiveMapOptions = {}): ReactiveMapBundle<K, V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `ReactiveMapOptions` | Node options plus `maxSize` / `defaultTtlMs`. |

## Returns

`ReactiveMapBundle` — imperative `get` / `set` / `delete` / `clear` / `pruneExpired` and a `node` emitting versioned readonly map snapshots.

## Basic Usage

```ts
import { reactiveMap } from "@graphrefly/graphrefly-ts";

const m = reactiveMap<string, number>({ name: "cache", maxSize: 100, defaultTtlMs: 60_000 });
m.set("x", 1);
m.node.subscribe((msgs) => {
    console.log(msgs);
  });
```

## Behavior Details

- **TTL:** Expiry is checked on `get`, `has`, `size`, `pruneExpired`, and before each
snapshot emission (expired keys are pruned first). There is no
background timer; monotonic-clock–expired keys may still appear in the last-emitted
snapshot on `node` until a read or `pruneExpired` removes them.
Uses `performance.now()` (monotonic in Node.js) — immune to wall-clock adjustments.

**LRU:** Uses native `Map` insertion order — `get` / `has` refreshes position; under
`maxSize` pressure the first key in iteration order is evicted. When `maxSize` is
omitted or is less than 1, no size-based eviction runs.
