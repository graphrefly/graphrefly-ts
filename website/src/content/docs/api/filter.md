---
title: "filter()"
description: "Emit values that satisfy `predicate`; when the predicate fails, downstream settles with\n`RESOLVED` (no output) per two-phase semantics."
---

Emit values that satisfy `predicate`; when the predicate fails, downstream settles with
`RESOLVED` (no output) per two-phase semantics.

## Signature

```ts
function filter<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `predicate` | `(value: T) =&gt; boolean` |  |
| `opts` | `ExtraOpts` |  |
