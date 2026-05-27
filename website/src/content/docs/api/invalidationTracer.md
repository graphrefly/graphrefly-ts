---
title: "invalidationTracer()"
description: "Attach a bounded cascade-event tracer to a reactiveFactStore.\nSelf-adds a `describe()`-visible observer Node and returns it; each emission\nis the current trace "
---

Attach a bounded cascade-event tracer to a reactiveFactStore.
Self-adds a `describe()`-visible observer Node and returns it; each emission
is the current trace ring (oldest → newest).

## Signature

```ts
function invalidationTracer<T>(
	mem: ReactiveFactStoreGraph<T>,
	opts: InvalidationTracerOptions = {},
): Node<readonly InvalidationTraceEntry[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>mem</code> | <code>ReactiveFactStoreGraph&lt;T&gt;</code> |  |
| <code>opts</code> | <code>InvalidationTracerOptions</code> |  |
