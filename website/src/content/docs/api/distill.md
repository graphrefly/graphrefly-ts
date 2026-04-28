---
title: "distill()"
description: "Budget-constrained reactive memory composition.\n\n**Tier 1.5.4 (Session A.5 lock, 2026-04-27):** `extractFn` receives the\nsource and existing-store as `Node`s. D"
---

Budget-constrained reactive memory composition.

**Tier 1.5.4 (Session A.5 lock, 2026-04-27):** `extractFn` receives the
source and existing-store as `Node`s. Distill calls `extractFn` ONCE at
wiring time and consumes the returned stream of extractions. The user
controls reactive composition — wrap with `switchMap` for cancel-on-new-input,
`mergeMap` for parallel, `derived` for sync transforms. See COMPOSITION-GUIDE
§40 for the recipe.

## Signature

```ts
function distill<TRaw, TMem>(
	source: NodeInput<TRaw>,
	extractFn: (
		raw: Node<TRaw>,
		existing: Node<ReadonlyMap<string, TMem>>,
	) => NodeInput<Extraction<TMem>>,
	opts: DistillOptions<TMem>,
): DistillBundle<TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `NodeInput&lt;TRaw&gt;` |  |
| `extractFn` | `(
		raw: Node&lt;TRaw&gt;,
		existing: Node&lt;ReadonlyMap&lt;string, TMem&gt;&gt;,
	) =&gt; NodeInput&lt;Extraction&lt;TMem&gt;&gt;` |  |
| `opts` | `DistillOptions&lt;TMem&gt;` |  |
