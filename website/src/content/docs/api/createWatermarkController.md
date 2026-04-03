---
title: "createWatermarkController()"
description: "Creates a watermark-based backpressure controller."
---

Creates a watermark-based backpressure controller.

## Signature

```ts
function createWatermarkController(
	sendUp: (messages: Messages) => void,
	opts: WatermarkOptions,
): WatermarkController
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sendUp` | `(messages: Messages) =&gt; void` | Callback that delivers messages upstream (typically `handle.up`). |
| `opts` | `WatermarkOptions` | High/low watermark thresholds (item counts). |

## Returns

A WatermarkController.

## Basic Usage

```ts
const handle = graph.observe("fast-source");
const wm = createWatermarkController(
  (msgs) => handle.up(msgs),
  { highWaterMark: 64, lowWaterMark: 16 },
);

// In sink callback:
handle.subscribe((msgs) => {
    for (const msg of msgs) {
      if (msg[0] === DATA) {
        buffer.push(msg[1]);
        wm.onEnqueue();
      }
  }
});

// When consumer drains:
const item = buffer.shift();
wm.onDequeue();
```
