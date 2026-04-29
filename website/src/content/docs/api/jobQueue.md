---
title: "jobQueue()"
description: "Creates a Pulsar-inspired job queue graph with claim/ack/nack workflow."
---

Creates a Pulsar-inspired job queue graph with claim/ack/nack workflow.

## Signature

```ts
function jobQueue<T>(name: string, opts?: JobQueueOptions): JobQueueGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` |  |
| `opts` | `JobQueueOptions` |  |
