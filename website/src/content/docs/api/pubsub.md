---
title: "pubsub()"
description: "Creates an empty  for lazy topic nodes."
---

Creates an empty  for lazy topic nodes.

## Signature

```ts
function pubsub(): PubSubHub
```

## Returns

A new hub with no topics until  or  runs.

## Basic Usage

```ts
import { pubsub } from "@graphrefly/graphrefly-ts";

const hub = pubsub();
const t = hub.topic("events");
t.subscribe((msgs) => console.log(msgs));
hub.publish("events", { ok: true });
```
