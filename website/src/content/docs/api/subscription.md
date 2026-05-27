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
| <code>name</code> | <code>string</code> |  |
| <code>topicGraph</code> | <code>TopicGraph&lt;T&gt;</code> |  |
| <code>opts</code> | <code>SubscriptionOptions</code> |  |
