---
title: "distill()"
description: "Budget-constrained reactive memory composition."
---

Budget-constrained reactive memory composition.

## Signature

```ts
function distill<TRaw, TMem>(
	source: NodeInput<TRaw>,
	extractFn: (raw: TRaw, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>,
	opts: DistillOptions<TMem>,
): DistillBundle<TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `NodeInput&lt;TRaw&gt;` |  |
| `extractFn` | `(raw: TRaw, existing: ReadonlyMap&lt;string, TMem&gt;) =&gt; NodeInput&lt;Extraction&lt;TMem&gt;&gt;` |  |
| `opts` | `DistillOptions&lt;TMem&gt;` |  |
