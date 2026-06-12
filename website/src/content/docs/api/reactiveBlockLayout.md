---
title: "reactiveBlockLayout()"
description: "Create a DOM-free reactive block layout bundle for text, image, and SVG blocks."
---

Create a DOM-free reactive block layout bundle for mixed content.

```
Graph("reactive-block-layout")
├── state("blocks")       — ContentBlock[] input
├── state("max-width")    — container constraint
├── state("gap")          — vertical gap
├── node("blocks-measurements") — blocks + max-width -> Measurements
├── node("measured-blocks") — measurements -> MeasuredBlock[]
├── node("block-flow")      — measured-blocks + gap -> PositionedBlock[]
└── node("total-height")    — block-flow -> number
```

## Signature

```ts
import { reactiveBlockLayout } from "@graphrefly/ts/solutions/reactive-layout";

function reactiveBlockLayout(opts: ReactiveBlockLayoutOptions): ReactiveBlockLayoutBundle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>opts</code> | <code>ReactiveBlockLayoutOptions</code> | Requires `graph` and a graph-visible `measurements` node; optional gap, target id, and bundle name. Blocks and max width belong to the upstream provider composition. |

Use `blockMeasurementProvider` upstream when you want GraphReFly to build the block measurement
facts from sync text/image/SVG capabilities. Missing image/SVG/text measurement is emitted by the
provider as DATA-level `DataIssue`; layout defaults to no-op for issue-only facts.
