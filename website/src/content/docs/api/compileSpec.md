---
title: "compileSpec()"
description: "Instantiate a Graph from a GraphSpec.\n\nHandles template expansion (mounted subgraphs), feedback wiring via §8.1\nfeedback(), node factory lookup from the catalog"
---

Instantiate a Graph from a GraphSpec.

Handles template expansion (mounted subgraphs), feedback wiring via §8.1
feedback(), node factory lookup from the catalog, and topology validation.

## Signature

```ts
function compileSpec(spec: GraphSpec, opts?: CompileSpecOptions): Graph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>spec</code> | <code>GraphSpec</code> | Declarative graph topology. |
| <code>opts</code> | <code>CompileSpecOptions</code> | Catalog and compile options. |

## Returns

A running Graph.
