---
title: "retry()"
description: "API reference for retry."
---

## Signature

```ts
function retry<T>(input: Node<T>, opts?: NodeOrValue<RetryOptions>): RetryBundle<T>
function retry<T>(
	input: () => Node<T>,
	opts?: NodeOrValue<RetryFactoryOptions<T>>,
): RetryBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `Node&lt;T&gt; | (() =&gt; Node&lt;T&gt;)` |  |
| `opts` | `NodeOrValue&lt;RetryOptions | RetryFactoryOptions&lt;T&gt;&gt;` |  |
