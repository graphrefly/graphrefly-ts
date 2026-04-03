---
title: "verifiable()"
description: "Composes a value node with a reactive verification companion.\n\nUses `switchMap` so newer triggers cancel stale in-flight verification work."
---

Composes a value node with a reactive verification companion.

Uses `switchMap` so newer triggers cancel stale in-flight verification work.

## Signature

```ts
function verifiable<T, TVerify = VerifyValue>(
	source: NodeInput<T>,
	verifyFn: (value: T) => NodeInput<TVerify>,
	opts?: VerifiableOptions<TVerify>,
): VerifiableBundle<T, TVerify>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `NodeInput&lt;T&gt;` |  |
| `verifyFn` | `(value: T) =&gt; NodeInput&lt;TVerify&gt;` |  |
| `opts` | `VerifiableOptions&lt;TVerify&gt;` |  |
