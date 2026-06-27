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
├── node("text-measurements") — text + font -> Measurements
├── node("segments")       — measurements -> PreparedSegment[]
├── node("line-breaks")    — segments + max-width + measurements -> LineBreaksResult
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
| <code>opts</code> | <code>ReactiveLayoutOptions</code> | Requires `graph` and a graph-visible `measurements` node; optional `lineHeight`, `maxWidth`, `segmentAdapter`, `targetId`, and bundle `name`. |

Measurement providers are upstream graph nodes. Browser Canvas measurement is browser-only:

```ts
import { graph } from "@graphrefly/ts";
import { reactiveLayout, cellTextMeasurements } from "@graphrefly/ts/solutions/reactive-layout";

const g = graph({ name: "article" });
const text = g.state("Hello", { name: "text" });
const font = g.state("16px system-ui", { name: "font" });
const measurements = cellTextMeasurements({ graph: g, text, font });

const layout = reactiveLayout({ graph: g, measurements });
```

Missing or failed measurements are `DataIssue` facts inside ordinary `DATA`; the default layout
consumer ignores them for measurement purposes and does not emit protocol `ERROR`.
