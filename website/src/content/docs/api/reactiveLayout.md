---
title: "reactiveLayout()"
description: "Create a DOM-free, graph-visible text layout bundle."
---

Create a DOM-free, graph-visible text layout bundle.

```
Graph("reactive-layout")
├── state("text")
├── state("font")
├── state("line-height")
├── state("max-width")
├── node("segments")       — text + font -> PreparedSegment[]
├── node("line-breaks")    — segments + max-width + font -> LineBreaksResult
├── node("height")         — line-breaks + line-height -> number
└── node("char-positions") — line-breaks + segments + line-height -> CharPosition[]
```

## Signature

```ts
import { reactiveLayout } from "@graphrefly/ts/solutions/reactive-layout";

function reactiveLayout(opts: ReactiveLayoutOptions): ReactiveLayoutBundle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>opts</code> | <code>ReactiveLayoutOptions</code> | Requires a synchronous `MeasurementAdapter`; optional initial `text`, `font`, `lineHeight`, `maxWidth`, `segmentAdapter`, and graph `name`. |

`CanvasMeasureAdapter` is browser-only:

```ts
import { CanvasMeasureAdapter } from "@graphrefly/ts/solutions/reactive-layout/browser";
```

The core subpath does not import DOM globals, storage, GraphSpec, or hydration APIs.
