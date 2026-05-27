---
title: "messagingHub()"
description: "Creates a lazy Pulsar-inspired messaging hub. Topics are created on first access\nvia `hub.topic(name)`; `hub.publish(name, value)` shortcuts through the registr"
---

Creates a lazy Pulsar-inspired messaging hub. Topics are created on first access
via `hub.topic(name)`; `hub.publish(name, value)` shortcuts through the registry.

## Signature

```ts
function messagingHub(name: string, opts?: MessagingHubOptions): MessagingHubGraph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>name</code> | <code>string</code> |  |
| <code>opts</code> | <code>MessagingHubOptions</code> |  |

## Basic Usage

```ts
import { messagingHub } from "@graphrefly/graphrefly";

const hub = messagingHub("main", { defaultTopicOptions: { retainedLimit: 256 } });
hub.publish("orders", { id: 1 });
hub.publishMany([["shipments", { id: 1 }], ["orders", { id: 2 }]]);
const sub = hub.subscribe("orders-worker", "orders", { cursor: 0 });
```
