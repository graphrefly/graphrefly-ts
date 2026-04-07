---
title: "decompileGraph()"
description: "Extract a GraphSpec from a running graph.\n\nUses `describe({ detail: \"standard\" })` as a starting point, then enriches:\n- Feedback edges recovered from counter n"
---

Extract a GraphSpec from a running graph.

Uses `describe({ detail: "standard" })` as a starting point, then enriches:
- Feedback edges recovered from counter node meta (`feedbackFrom`/`feedbackTo`)
- Template refs recovered from output node meta (`_templateName`/`_templateBind`)
- Structural fingerprinting as fallback for 2+ identical mounted subgraphs

## Signature

```ts
function decompileGraph(graph: Graph): GraphSpec
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Running graph to decompile. |

## Returns

A GraphSpec representation.
