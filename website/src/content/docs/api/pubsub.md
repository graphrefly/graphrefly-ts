---
title: "pubsub()"
description: "Creates an empty PubSubHub for lazy topic nodes."
---

Creates an empty PubSubHub for lazy topic nodes.

## Signature

```ts
function pubsub(): PubSubHub
```

## Returns

A new hub with no topics until PubSubHub.topic or PubSubHub.publish runs.

## Basic Usage

```ts
import { pubsub } from "@graphrefly/graphrefly-ts";

const hub = pubsub();
const t = hub.topic("events");
t.subscribe((msgs) => console.log(msgs));
hub.publish("events", { ok: true });
hub.removeTopic("events"); // tears down the node
```
