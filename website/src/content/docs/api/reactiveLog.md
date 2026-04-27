---
title: "reactiveLog()"
description: "Creates an append-only reactive log that emits immutable `readonly T[]` snapshots.\n\nEach structural mutation (`append`, `appendMany`, `clear`, `trimHead`) trigg"
---

Creates an append-only reactive log that emits immutable `readonly T[]` snapshots.

Each structural mutation (`append`, `appendMany`, `clear`, `trimHead`) triggers
a two-phase `[DIRTY, DATA]` emission on the `entries` node so downstream
derived nodes update reactively. Views (`tail`, `slice`, `fromCursor`) are
memoized derived nodes — subscribe once and they stay live.

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
| `initial` | `readonly T[]` | Optional initial entries loaded into the log at construction. |
| `options` | `ReactiveLogOptions&lt;T&gt;` | Optional name, max size (ring buffer), versioning level, guard policy, and custom backend. |

## Returns

`ReactiveLogBundle&lt;T&gt;` with `entries`, `append`, `appendMany`, `clear`, `trimHead`, `view`, `attach`, `attachStorage`, and disposal methods.

## Basic Usage

```ts
import { reactiveLog } from "@graphrefly/graphrefly/extra";

const log = reactiveLog<string>([], { name: "messages" });
log.entries.subscribe((msgs) => {
    for (const m of msgs) {
      if (m[0] === 1) console.log("entries:", m[1]);
    }
});
log.append("hello");
log.append("world");
```

## Behavior Details

- **Ring buffer:** Pass `maxSize` to cap the log length; older entries are evicted on overflow.
**Storage:** Call `attachStorage(tiers)` to wire one or more `AppendLogStorageTier` instances for persistence.
