---
title: "topicBridge()"
description: "Creates an autonomous cursor-based topic relay graph.\n\nWhen `opts.map` is provided, items where `map` returns `undefined` are\nconsumed from the source cursor bu"
---

Creates an autonomous cursor-based topic relay graph.

When `opts.map` is provided, items where `map` returns `undefined` are
consumed from the source cursor but NOT republished (at-most-once with
silent drop). For filter-with-retry semantics, apply the filter in a
downstream subscription on the bridge's `output` node instead.

## Signature

```ts
function topicBridge<TIn, TOut = TIn>(
	name: string,
	sourceTopic: TopicGraph<TIn>,
	targetTopic: TopicGraph<TOut>,
	opts?: TopicBridgeOptions<TIn, TOut>,
): TopicBridgeGraph<TIn, TOut>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` |  |
| `sourceTopic` | `TopicGraph&lt;TIn&gt;` |  |
| `targetTopic` | `TopicGraph&lt;TOut&gt;` |  |
| `opts` | `TopicBridgeOptions&lt;TIn, TOut&gt;` |  |
