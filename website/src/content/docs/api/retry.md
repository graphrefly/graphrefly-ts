---
title: "retry()"
description: "API reference for retry."
---

## Signature

```ts
function retry<T>(input: Node<T>, opts?: RetryOptions): Node<T>
function retry<T>(input: () => Node<T>, opts?: RetryFactoryOptions<T>): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `Node&lt;T&gt; | (() =&gt; Node&lt;T&gt;)` |  |
| `opts` | `RetryOptions | RetryFactoryOptions&lt;T&gt;` |  |
