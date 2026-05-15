---
title: "pubsub()"
description: "Creates a lazy per-topic state hub."
---

Creates a lazy per-topic state hub.

## Signature

```ts
function pubsub(options: PubSubHubOptions = {}): PubSubHub
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `PubSubHubOptions` | Optional pluggable `backend` (defaults to `NativePubSubBackend`). |

## Returns

Hub with lazy `topic()` / `publish()` / `publishMany()` / `removeTopic()` /
`has()` / `size` / `topicNames()`.

## Basic Usage

```ts
import { pubsub } from "@graphrefly/graphrefly";

const hub = pubsub();
const t = hub.topic("events");
t.subscribe((msgs) => console.log(msgs));
hub.publish("events", { ok: true });
hub.publishMany([["events", 1], ["status", "ready"]]);
```

## Behavior Details

- **Scope:** Each topic is a sentinel node — retains only the last published
value (no push-on-subscribe before the first publish). For Pulsar-inspired
retention + cursor reading, use `messagingHub()` in `utils/messaging`.

**`removeTopic`:** Sends `TEARDOWN` to the topic node; all subscribers receive
the TEARDOWN message. Subsequent `publish(name, value)` silently recreates the
topic with a fresh node — existing subscribers to the old node do NOT reconnect.
