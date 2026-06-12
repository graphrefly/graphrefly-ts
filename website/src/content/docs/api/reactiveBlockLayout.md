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
├── node("measured-blocks") — blocks + max-width -> MeasuredBlock[]
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
| <code>opts</code> | <code>ReactiveBlockLayoutOptions</code> | Optional initial blocks, max width, gap, text adapter, block adapters, font, line height, segment adapter, and graph name. |

Images must provide explicit dimensions or an injected `ImageMeasurer`. SVG blocks must provide
explicit dimensions or an injected `SvgMeasurer`. The shipped core does not load images or parse SVG
with the DOM.
