---
title: Reactive Layout
description: "D181 reactive-layout solution: DOM-free layout core, graph-visible bundles, and browser-only Canvas measurement."
---

## What it is

Reactive Layout is a clean-slate `@graphrefly/ts` solution kit for text and simple document layout.
The universal core lives at `@graphrefly/ts/solutions/reactive-layout`; browser measurement lives at
`@graphrefly/ts/solutions/reactive-layout/browser`.

The core exposes pure layout helpers plus graph-visible bundles:

- `reactiveLayout` for single-column text layout.
- `reactiveBlockLayout` for vertical text/image/SVG block flows.
- `reactiveFlowLayout` for columns and rectangle/circle obstacles.

The bundles return ordinary graph nodes such as `segments`, `lineBreaks`, `height`,
`charPositions`, `measuredBlocks`, and `flowLines`. React, Canvas, DOM, CLI, or native renderers
consume those nodes through their own binding layer; layout itself does not draw.

## Imports

```ts
import {
  reactiveLayout,
  type LineBreaksResult,
} from "@graphrefly/ts/solutions/reactive-layout";
import { CanvasMeasureAdapter } from "@graphrefly/ts/solutions/reactive-layout/browser";

const layout = reactiveLayout({
  adapter: new CanvasMeasureAdapter(),
  text: "GraphReFly text layout as a reactive graph.",
  font: "14px Fira Code",
  lineHeight: 22,
  maxWidth: 480,
});

layout.lineBreaks.subscribe((msg) => {
  const [type, value] = msg;
  if (type === "DATA") render(value as LineBreaksResult);
});

layout.setMaxWidth(320);
layout.setText("Try typing here.");
```

## Core Subpath

`@graphrefly/ts/solutions/reactive-layout` is DOM-free. It exports the layout types, pure helpers,
and sync injected adapters:

- `InjectedMeasureAdapter`
- `PrecomputedMeasureAdapter`
- `CellMeasureAdapter`
- `ImageSizeAdapter`
- `SvgBoundsAdapter`

`SvgBoundsAdapter` is only a minimal width/height or `viewBox` reader. It is not a DOM SVG parser.
`ImageSizeAdapter` uses caller-provided sizes. It does not load images.

## Browser Subpath

`@graphrefly/ts/solutions/reactive-layout/browser` exports `CanvasMeasureAdapter`, which lazily uses
`OffscreenCanvas`. This is the only shipped platform adapter for D181.

Animation-frame sources are separate browser sources:

```ts
import { fromRaf } from "@graphrefly/ts/sources/browser";
```

`fromRaf` is not exported from reactive-layout.

## Deferred

These are intentionally not implemented by D181:

- NodeCanvas, React Native, Skia, or other native measurement adapters.
- Async image loading.
- DOM SVG parsing.
- GraphSpec ownership, storage restore, hydration, or adapter serialization.

Those need a future design-review/backlog item before they become public API.

## API

- [API: `reactiveLayout()`](/api/reactivelayout)
- [API: `reactiveBlockLayout()`](/api/reactiveblocklayout)
- [API: `fromRaf()`](/api/fromraf)
