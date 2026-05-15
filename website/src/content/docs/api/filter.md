---
title: "filter()"
description: "Forwards values that satisfy `predicate`; otherwise emits `RESOLVED` with no `DATA` (two-phase semantics).\n\n**Wave-exclusivity contract** (COMPOSITION-GUIDE §41"
---

Forwards values that satisfy `predicate`; otherwise emits `RESOLVED` with no `DATA` (two-phase semantics).

**Wave-exclusivity contract** (COMPOSITION-GUIDE §41 / spec §1.3.3): the
`RESOLVED` is emitted only when the entire wave produces zero passing
values — never per-dropped-item, never trailing a wave that already
emitted `DATA`. Mixed-batch inputs like `[v_pass, v_fail, v_pass2]`
forward `[DATA, v_pass]` and `[DATA, v_pass2]` with no `RESOLVED` for
the dropped middle entry. Consumers needing per-input drain accounting
count upstream of `filter`, not on its output.

## Signature

```ts
function filter<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `predicate` | `(value: T) =&gt; boolean` | Inclusion test. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Filtered node.

## Basic Usage

```ts
import { filter, state } from "@graphrefly/graphrefly-ts";

const n = filter(state(1), (x) => x > 0);
```
