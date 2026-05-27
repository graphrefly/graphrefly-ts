---
title: "bitemporalQuery()"
description: "Build a standing bi-temporal historical view over a reactiveFactStore.\nEmits the fragments valid at the latest `asOf` (sorted confidence desc, then\n`t_ns` desc "
---

Build a standing bi-temporal historical view over a reactiveFactStore.
Emits the fragments valid at the latest `asOf` (sorted confidence desc, then
`t_ns` desc — same order as the built-in `answer`).

## Signature

```ts
function bitemporalQuery<T>(
	mem: ReactiveFactStoreGraph<T>,
	asOf: Node<bigint>,
	opts: BitemporalQueryOptions = {},
): Node<readonly MemoryFragment<T>[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>mem</code> | <code>ReactiveFactStoreGraph&lt;T&gt;</code> |  |
| <code>asOf</code> | <code>Node&lt;bigint&gt;</code> |  |
| <code>opts</code> | <code>BitemporalQueryOptions</code> |  |
