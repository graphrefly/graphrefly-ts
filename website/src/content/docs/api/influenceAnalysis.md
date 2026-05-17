---
title: "influenceAnalysis()"
description: "Attach influence/blast-radius analysis to a reactiveFactStore."
---

Attach influence/blast-radius analysis to a reactiveFactStore.

## Signature

```ts
function influenceAnalysis<T>(
	mem: ReactiveFactStoreGraph<T>,
	opts: InfluenceAnalysisOptions = {},
): InfluenceAnalysis
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `mem` | `ReactiveFactStoreGraph&lt;T&gt;` |  |
| `opts` | `InfluenceAnalysisOptions` |  |
