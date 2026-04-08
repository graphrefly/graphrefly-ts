---
title: "metaSnapshot()"
description: "Reads the current cached value of every companion meta field on a node,\nsuitable for merging into `describe()`-style JSON (GRAPHREFLY-SPEC §2.3, §3.6)."
---

Reads the current cached value of every companion meta field on a node,
suitable for merging into `describe()`-style JSON (GRAPHREFLY-SPEC §2.3, §3.6).

## Signature

```ts
function metaSnapshot(node: Node): Record<string, unknown>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `Node` | The node whose meta fields to snapshot. |

## Returns

Plain object of `{ key: value }` pairs (empty if no meta defined).
Keys whose companion node's Node.get throws are omitted.

## Basic Usage

```ts
import { core } from "@graphrefly/graphrefly-ts";

const n = core.node({ initial: 0, meta: { tag: "a" } });
core.metaSnapshot(n); // { tag: "a" }
```

## Behavior Details

- Values come from Node.get, which returns the **last settled** cache.
If a meta field is in `"dirty"` status (DIRTY received, DATA pending), the
snapshot contains the *previous* value — check `node.meta[key].status` when
freshness matters. Avoid calling mid-batch for the same reason.

Meta nodes are **not** terminated when their parent receives COMPLETE or
ERROR — they remain writable so callers can record post-mortem metadata
(e.g. `meta.error`). They *are* torn down when the parent receives TEARDOWN.
