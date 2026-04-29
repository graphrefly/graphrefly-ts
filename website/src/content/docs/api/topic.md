---
title: "topic()"
description: "Creates a Pulsar-inspired topic graph (append-only retained stream + latest value)."
---

Creates a Pulsar-inspired topic graph (append-only retained stream + latest value).

## Signature

```ts
function topic<T>(name: string, opts?: TopicOptions): TopicGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` |  |
| `opts` | `TopicOptions` |  |
