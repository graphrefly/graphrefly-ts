---
title: "describeNode()"
description: "Builds a single-node slice of `Graph.describe()` JSON (structure + `meta` snapshot).\nParity with graphrefly-py `describe_node`.\n\n`type` is inferred from factory"
---

Builds a single-node slice of `Graph.describe()` JSON (structure + `meta` snapshot).
Parity with graphrefly-py `describe_node`.

`type` is inferred from factory configuration, optional `describeKind` in node options,
and the last `manualEmitUsed` hint (operator vs derived). effect sets
`describeKind: "effect"`. Nodes not created by node fall back to `type: "state"` and empty `deps`.

## Signature

```ts
function describeNode(node: Node): DescribeNodeOutput
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `Node` | Any `Node` to introspect. |

## Returns

`DescribeNodeOutput` suitable for merging into graph describe maps.

## Basic Usage

```ts
import { describeNode, state } from "@graphrefly/graphrefly-ts";

describeNode(state(0));
```
