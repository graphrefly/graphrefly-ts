---
title: "subscription()"
description: "Creates a cursor-based subscription graph over a topic."
---

Creates a cursor-based subscription graph over a topic.

## Signature

```ts
function subscription<T>(
	name: string,
	topicGraph: TopicGraph<T>,
	opts?: SubscriptionOptions,
): SubscriptionGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` |  |
| `topicGraph` | `TopicGraph&lt;T&gt;` |  |
| `opts` | `SubscriptionOptions` |  |
