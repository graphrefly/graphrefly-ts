---
title: "logProjector()"
description: "Creates a cursor-driven log/topic projector with a typed poison-failure\npolicy and an observable dead-letter topic."
---

Creates a cursor-driven log/topic projector with a typed poison-failure
policy and an observable dead-letter topic.

## Signature

```ts
function logProjector<T>(
	name: string,
	source: TopicGraph<T> | ReactiveLogBundle<T>,
	opts: LogProjectorOptions<T>,
): LogProjectorGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>name</code> | <code>string</code> |  |
| <code>source</code> | <code>TopicGraph&lt;T&gt; | ReactiveLogBundle&lt;T&gt;</code> |  |
| <code>opts</code> | <code>LogProjectorOptions&lt;T&gt;</code> |  |

## Basic Usage

```ts
import { logProjector, topic } from "@graphrefly/graphrefly";

const events = topic<Doc>("docs");
const proj = logProjector("indexer", events, {
    sink: async (doc) => { await index(doc); },   // throw ⇒ poison
    onPoison: "deadLetter",
  });
proj.deadLetter.events.subscribe(/* observe poison *​/);
```

## Behavior Details

- **Use an UNBOUNDED source for durable / long-lived projection.** The cursor
is an absolute index; the underlying `fromCursor` view slices the source's
*current* entries array. A `TopicGraph` with a `retainedLimit` (or a
`ReactiveLogBundle` with `maxSize`) trims its head, so an absolute cursor
past the retained window reads the wrong offset (skips entries or stalls).
This is inherited `subscription()` / `fromCursor` behaviour, not specific to
`logProjector` — but it matters here because projection is typically
long-lived. For unbounded projection pass a source with NO `retainedLimit` /
`maxSize` (memo:Re's `changesetLog` is unbounded ✓).
