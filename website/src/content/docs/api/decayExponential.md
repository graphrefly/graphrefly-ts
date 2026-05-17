---
title: "decayExponential()"
description: "Wire an exponential-decay forgetting loop onto a reactiveFactStore.\nSelf-adds a driver Node to the store's graph (`describe()`-visible) and\nreturns it; each emi"
---

Wire an exponential-decay forgetting loop onto a reactiveFactStore.
Self-adds a driver Node to the store's graph (`describe()`-visible) and
returns it; each emission is the batch of fragments decayed that tick (also
fed back through `ingest`).

## Signature

```ts
function decayExponential<T>(
	mem: ReactiveFactStoreGraph<T>,
	ingest: Node<MemoryFragment<T>>,
	opts: DecayExponentialOptions,
): Node<readonly MemoryFragment<T>[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `mem` | `ReactiveFactStoreGraph&lt;T&gt;` |  |
| `ingest` | `Node&lt;MemoryFragment&lt;T&gt;&gt;` |  |
| `opts` | `DecayExponentialOptions` |  |
