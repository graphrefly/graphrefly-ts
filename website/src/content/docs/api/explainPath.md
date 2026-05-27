---
title: "explainPath()"
description: "Walks backward from `to` through `deps` to find the shortest path to `from`,\nthen assembles an ordered, enriched CausalChain."
---

Walks backward from `to` through `deps` to find the shortest path to `from`,
then assembles an ordered, enriched CausalChain.

## Signature

```ts
function explainPath(
	described: GraphDescribeOutput,
	from: string,
	to: string,
	opts: ExplainPathOptions = {},
): CausalChain
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>described</code> | <code>GraphDescribeOutput</code> | `graph.describe()` output (any detail level; richer detail → richer steps). |
| <code>from</code> | <code>string</code> | Path of the upstream node (the cause). |
| <code>to</code> | <code>string</code> | Path of the downstream node (the effect). |
| <code>opts</code> | <code>ExplainPathOptions</code> | Optional `maxDepth` and per-path annotation overlays. |

## Returns

A CausalChain — `found:false` with a `reason` when no path exists.

## Basic Usage

```ts
import { explainPath } from "@graphrefly/pure-ts";
const chain = explainPath(graph.describe({ detail: "standard" }), "input", "result");
console.log(chain.text);
```
