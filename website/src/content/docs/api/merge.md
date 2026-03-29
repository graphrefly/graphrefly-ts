---
title: "merge()"
description: "Merges **`DATA`** from any source with correct two-phase dirty tracking. **`COMPLETE`** after **all** sources complete (spec §1.3.5)."
---

Merges **`DATA`** from any source with correct two-phase dirty tracking. **`COMPLETE`** after **all** sources complete (spec §1.3.5).

## Signature

```ts
function merge<T>(sources: readonly Node<T>[], opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `readonly Node&lt;T&gt;[]` | Nodes to merge (empty completes immediately). |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Merged stream.

## Basic Usage

```ts
import { merge, state } from "@graphrefly/graphrefly-ts";

const n = merge([state(1), state(2)]);
```

## Behavior Details

- **Ordering:** DIRTY/RESOLVED rules follow multi-source semantics in `GRAPHREFLY-SPEC.md`.
