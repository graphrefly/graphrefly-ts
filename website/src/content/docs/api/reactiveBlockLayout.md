---
title: "reactiveBlockLayout()"
description: "Create a reactive block layout graph for mixed content (text + image + SVG).\n\n```\nGraph(\"reactive-block-layout\")\n├── node([], { initial: \"blocks\" })            "
---

Create a reactive block layout graph for mixed content (text + image + SVG).

```
Graph("reactive-block-layout")
├── node([], { initial: "blocks" })              — ContentBlock[] input
├── node([], { initial: "max-width" })           — container constraint
├── node([], { initial: "gap" })                 — vertical gap (px)
├── derived("measured-blocks")   — blocks + max-width → MeasuredBlock[]
├── derived("block-flow")        — measured-blocks + gap → PositionedBlock[]
├── derived("total-height")      — block-flow → number
└── meta: { block-count, layout-time-ns }
```

## Signature

```ts
function reactiveBlockLayout(opts: ReactiveBlockLayoutOptions): ReactiveBlockLayoutBundle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ReactiveBlockLayoutOptions` |  |
