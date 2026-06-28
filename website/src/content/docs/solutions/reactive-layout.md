---
title: Reactive Layout
description: "D203 reactive-layout solution: DOM-free layout core, graph-visible measurement facts, and focused provider helpers."
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

Measurement is explicit graph input. Providers emit ordered `MeasurementResult` / `DataIssue` facts
into a user-composed `measurements` node. Layout consumes the latest DATA from that node; users own
merge, ordering, fallback, and dedupe policy.

## Imports

```ts
import {
  cellTextMeasurements,
  reactiveLayout,
  type LineBreaksResult,
} from "@graphrefly/ts/solutions/reactive-layout";
import { graph } from "@graphrefly/ts";

const g = graph({ name: "article" });
const text = g.state("GraphReFly text layout as a reactive graph.", { name: "text" });
const font = g.state("14px Fira Code", { name: "font" });
const measurements = cellTextMeasurements({ graph: g, text, font });
const layout = reactiveLayout({
  graph: g,
  measurements,
  lineHeight: 22,
  maxWidth: 480,
});

layout.lineBreaks.subscribe((msg) => {
  const [type, value] = msg;
  if (type === "DATA") render(value as LineBreaksResult);
});

layout.setMaxWidth(320);
text.set("Try typing here.");
```

## Core Subpath

`@graphrefly/ts/solutions/reactive-layout` is DOM-free. It exports the layout types, pure helpers,
and sync provider helpers:

- `injectedTextMeasurements`
- `precomputedTextMeasurements`
- `cellTextMeasurements`
- `capabilityTextMeasurements`
- `readinessTextMeasurements`
- `readinessMeasurements`
- `imageSizeMeasurements`
- `svgBoundsMeasurements`
- `blockAdaptersProvider`
- `blockMeasurementProvider`
- `ImageSizeAdapter`
- `SvgBoundsAdapter`

`SvgBoundsAdapter` is only a minimal width/height or `viewBox` reader. It is not a DOM SVG parser.
`ImageSizeAdapter` uses caller-provided sizes. It does not load images.

Provider helpers are cache-safe across capability identity changes. If a text adapter changes,
provider-local segment caches are cleared before the next measurement. If hyphen-width measurement
fails after segments were measured, the provider still emits the OK segment measurement and adds a
DATA-level issue; layout can continue with `hyphenWidth` omitted. Numeric graph inputs such as
widths, line heights, gaps, columns, and obstacle dimensions are clamped when layout consumes them,
including when callers provide writable `Node<number>` inputs directly.

`capabilityTextMeasurements` is the lightweight D203 shape for caller-injected platform text
capabilities such as NodeCanvas, Skia, or React Native measurement functions. The capability is an
explicit graph dependency; the universal core still imports no native package or platform global.
`readinessTextMeasurements` makes font or resource readiness an explicit graph fact: not-ready emits
a `DataIssue`, ready delegates to the normal text measurement path.

`readinessMeasurements`, `imageSizeMeasurements`, and `svgBoundsMeasurements` are lightweight fact
providers. They emit ordinary `MeasurementResult` / `DataIssue` facts for readiness, caller-registered
image sizes, and caller-injected SVG bounds readers. They do not load fonts or images, parse DOM SVG,
merge provider outputs, or make layout consume image/SVG facts directly.
Target ids are measurement fact keys; duplicate ids and cross-provider precedence are caller-owned
composition policy.

## Browser Subpath

`@graphrefly/ts/solutions/reactive-layout/browser` exports `canvasTextMeasurements`, which lazily
uses `OffscreenCanvas` behind the browser subpath.

Animation-frame sources are separate browser sources:

```ts
import { fromRaf } from "@graphrefly/ts/sources/browser";
```

`fromRaf` is not exported from reactive-layout.

## Focused Platform Subpaths

Focused platform subpaths expose dependency-free API shapes for native text measurement:

- `@graphrefly/ts/solutions/reactive-layout/node-canvas`
  exports `nodeCanvasTextMeasurements` for caller-owned NodeCanvas-style 2D contexts.
- `@graphrefly/ts/solutions/reactive-layout/skia`
  exports `skiaTextMeasurements` for caller-owned synchronous Skia measurement capabilities.
- `@graphrefly/ts/solutions/reactive-layout/react-native`
  exports `reactNativeTextMeasurements` for caller-owned synchronous React Native measurement
  capabilities.

These subpaths do not import `canvas`, Skia, or React Native packages. They keep platform packages
caller-owned while making the measurement capability a graph-visible dependency. Async font or
native layout readiness should still be modeled with explicit readiness or measurement facts.

## Recipes

The example recipes under `examples/reactive-layout/recipes/` show the user-land glue boundaries:

- React Native `onLayout` or native probe callbacks update a graph `state` node, then
  `reactNativeLayoutMeasurements` projects those async host results into measurement facts.
- React Native Skia `useFonts` readiness stays explicit: callers write readiness facts and a ready
  Paragraph capability, then compose `skiaParagraphTextMeasureCapability` with
  `skiaReadyTextMeasurements`.
- Text, readiness, image, and SVG providers are merged upstream with `mergeMeasurements` into the
  single measurements node consumed by layout. `mergeMeasurements` preserves source order; it is not
  a generic priority, fallback, dedupe, or stale-policy API.

These recipes intentionally do not introduce public RN hooks/components, hidden font loading,
optional native dependencies in the universal core, or layout-owned provider policy.

## Deferred

These are intentionally not implemented by D203:

- Required NodeCanvas, React Native, Skia, or other native measurement dependencies.
- Async image loading.
- DOM SVG parsing.
- GraphSpec ownership, storage restore, hydration, or adapter serialization.

Concrete package-bound adapters and async loaders remain caller-owned or future optional-peer
focused subpaths.

## API

- [API: `reactiveLayout()`](/api/reactivelayout)
- [API: `reactiveBlockLayout()`](/api/reactiveblocklayout)
- [API: `fromRaf()`](/api/fromraf)
- [API: `analyzeAndMeasure()`](/api/analyzeandmeasure)
- [API: `computeLineBreaks()`](/api/computelinebreaks)
- [API: `computeCharPositions()`](/api/computecharpositions)

These API pages are a focused Reactive Layout allowlist, not the full `@graphrefly/ts` package
reference.
