---
title: "node()"
description: "API reference for node."
---

## Signature

```ts
function node<T = unknown>(
	depsOrFn?: readonly Node[] | NodeFn<T> | NodeOptions,
	fnOrOpts?: NodeFn<T> | NodeOptions,
	optsArg?: NodeOptions,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `depsOrFn` | `readonly Node[] | NodeFn&lt;T&gt; | NodeOptions` |  |
| `fnOrOpts` | `NodeFn&lt;T&gt; | NodeOptions` |  |
| `optsArg` | `NodeOptions` |  |
