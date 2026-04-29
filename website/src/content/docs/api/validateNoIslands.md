---
title: "validateNoIslands()"
description: "Walk the graph's describe output and report island nodes (zero in + zero out edges)."
---

Walk the graph's describe output and report island nodes (zero in + zero out edges).

## Signature

```ts
function validateNoIslands(graph: Graph): ValidateNoIslandsResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |

## Basic Usage

```ts
const result = validateNoIslands(graph);
if (!result.ok) {
  console.error(result.summary());
  for (const o of result.orphans) console.error(`  - ${o.path} (${o.kind})`);
  process.exit(3);
}
```
