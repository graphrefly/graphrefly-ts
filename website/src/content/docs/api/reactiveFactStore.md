---
title: "reactiveFactStore()"
description: "Build a static-topology reactive fact store (DS-14.7 architecture C).\n\nThin factory over ReactiveFactStoreGraph — see that class for the\nfull topology / locked-"
---

Build a static-topology reactive fact store (DS-14.7 architecture C).

Thin factory over ReactiveFactStoreGraph — see that class for the
full topology / locked-decision docs and the `instanceof`-narrowable type.

## Signature

```ts
function reactiveFactStore<T>(
	config: ReactiveFactStoreConfig<T>,
): ReactiveFactStoreGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `ReactiveFactStoreConfig&lt;T&gt;` |  |
