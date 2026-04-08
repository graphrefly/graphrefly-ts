---
title: "describeNode()"
description: "Builds a single-node slice for `Graph.describe()`."
---

Builds a single-node slice for `Graph.describe()`.

## Signature

```ts
function describeNode(node: Node, includeFields?: Set<string> | null): DescribeNodeOutput
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `node` | `Node` | Node to introspect. |
| `includeFields` | `Set&lt;string&gt; | null` | Set of fields to include, or `null` for all. When omitted, all fields are included (legacy behavior). |
