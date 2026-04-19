---
title: Reactive Layout
description: "DOM-free text layout as a reactive graph: pretext-class measurement, cached derived nodes, block and flow layouts, adapters, and hooks into the rest of GraphReFly."
---

## What it is

**Reactive Layout** wraps pretext-class text analysis and canvas-based measurement in a **GraphReFly graph**. You get `state` inputs (text, font, line height, max width) and **derived** nodes (`segments`, line breaks, heights, character positions) that **recompute only when their dependencies change** — with measurement caching and meta companions (`cache-hit-rate`, `layout-time-ns`, …) for debugging.

On top of single-column `reactiveLayout`, the module adds **heterogeneous vertical stacks** (`reactiveBlockLayout`), **multi-column flow around obstacles** (`reactiveFlowLayout`), and **adapters** from browser canvas to CLI fixed-width measurement.

**Choosing vs raw [pretext](https://github.com/chenglou/pretext)?** See **[Reactive Layout vs Pretext](/comparisons/pretext/)** for bundle size, i18n coverage, and primitive-by-primitive tradeoffs.

## Quick start

```ts
import {
  reactiveLayout,
  CanvasMeasureAdapter,
} from "@graphrefly/graphrefly/reactive-layout";
import { DATA } from "@graphrefly/graphrefly/core";

const layout = reactiveLayout({
  adapter: new CanvasMeasureAdapter(),
  text: "GraphReFly — text layout as a reactive graph.",
  font: "14px Fira Code",
  lineHeight: 22,
  maxWidth: 480,
});

layout.lineBreaks.subscribe(([[type, lb]]) => {
  if (type === DATA) render(lb);
});

layout.setMaxWidth(320);           // segments can stay cached
layout.setText("Try typing here.");
layout.setFont("16px serif");      // new font key → segments + line-breaks
```

Change any input — only dependent derived nodes re-run. For batching multiple writes into one recompute, use `batch()` like any other GraphReFly graph.

## Rendering from `layout`

**Reactive Layout does not draw to the screen by itself.** The bundle exposes graph **nodes** (`lineBreaks`, `height`, `segments`, `charPositions`). Implement `render` (or map to JSX) by consuming **`LineBreaksResult`** from `lineBreaks` — `{ lines, lineCount }` where each line has `text`, `width`, and segment bounds (see [`LineBreaksResult`](/api/reactivelayout)). Below: vanilla DOM and React using the same subscription pattern.

### Vanilla: subscribe and paint DOM

```ts
import {
  reactiveLayout,
  CanvasMeasureAdapter,
  type LineBreaksResult,
} from "@graphrefly/graphrefly/reactive-layout";
import { DATA } from "@graphrefly/graphrefly/core";

const lineHeightPx = 22;

const layout = reactiveLayout({
  adapter: new CanvasMeasureAdapter(),
  text: "GraphReFly — text layout as a reactive graph.",
  font: "14px Fira Code",
  lineHeight: lineHeightPx,
  maxWidth: 480,
});

function paint(container: HTMLElement, lb: LineBreaksResult) {
  container.replaceChildren();
  for (const line of lb.lines) {
    const row = document.createElement("div");
    row.style.height = `${lineHeightPx}px`;
    row.style.width = `${line.width}px`;
    row.textContent = line.text || "\u00a0";
    container.append(row);
  }
}

const el = document.getElementById("body")!;
layout.lineBreaks.subscribe(([[type, lb]]) => {
  if (type === DATA) paint(el, lb);
});
const initial = layout.lineBreaks.cache as LineBreaksResult | undefined;
if (initial) paint(el, initial);
```

You can also subscribe with `layout.lineBreaks.subscribe(() => { paint(el, layout.lineBreaks.cache as LineBreaksResult); })` and read **`node.cache`** after each push — the **[reactive-layout demo](/demos/reactive-layout/)** does this from React via a tiny `useNodeValue` helper.

### React: `useSubscribe` on output nodes

**`useSubscribe(node)`** from `@graphrefly/graphrefly/compat/react` bridges any `Node<T>` (including `layout.lineBreaks`) to React via `useSyncExternalStore`. There is no layout-specific hook.

```tsx
import { useMemo } from "react";
import { reactiveLayout, CanvasMeasureAdapter } from "@graphrefly/graphrefly/reactive-layout";
import { useSubscribe } from "@graphrefly/graphrefly/compat/react";

const lineHeightPx = 22;

function Paragraph() {
  const layout = useMemo(
    () =>
      reactiveLayout({
        adapter: new CanvasMeasureAdapter(),
        text: "Hello",
        font: "14px system-ui",
        lineHeight: lineHeightPx,
        maxWidth: 480,
      }),
    [],
  );
  const lb = useSubscribe(layout.lineBreaks);
  const h = useSubscribe(layout.height);
  if (!lb) return null;
  return (
    <div style={{ minHeight: h ?? 0, lineHeight: `${lineHeightPx}px`, font: "14px system-ui" }}>
      {lb.lines.map((line, i) => (
        <div key={i} style={{ height: lineHeightPx, width: line.width }}>
          {line.text || "\u00a0"}
        </div>
      ))}
    </div>
  );
}
```

Create the bundle **once** per logical paragraph (`useMemo`, module scope, or context), not on every render.

## Advanced usage

### Block and flow layouts

- **`reactiveBlockLayout`** — vertically stack heterogeneous blocks (text, SVG, image) with per-block measurement adapters and a shared `maxWidth` / `gap`.
- **`reactiveFlowLayout`** — flow body text across columns with **circle / rectangle obstacles** (editorial-style wraps, pull quotes, images). Uses the same measurement pipeline with slot carving helpers.

Use the **[interactive demo](/demos/reactive-layout/)** Blocks and Flow chapters to see topology and parameters in motion.

### Adapters and headless measurement

- **Browser:** `CanvasMeasureAdapter` (uses `OffscreenCanvas` when available).
- **Terminal / snapshots:** `CliMeasureAdapter` for fixed character width without a DOM.
- **Precomputed / shared cache:** swap adapters without changing consumer code — the demo's **Adapters** chapter runs multiple backends against the same graph shape.

First measurement on a **new font** is slower while the font loads; later calls hit the per-font cache.

### Fidelity and runtime caveats

- **Measurement subset.** CJK (per-grapheme breaking), soft-hyphen, break-word, kinsoku, left-sticky punctuation — yes. Full bidi, keep-all word-break, emoji-width correction, tab stops — **not yet**. If you depend on those, compare with pretext on **[Reactive Layout vs Pretext](/comparisons/pretext/)**.

- **`fromRaf` semantics.** Animation-frame sources tick via `requestAnimationFrame` when the tab is visible and fall back to `setTimeout` when hidden, so downstream layout state keeps updating. If you need strict “pause in background” rAF behavior, wrap or replace at the source.

## With the rest of GraphReFly

Reactive Layout is meant to compose with other primitives on the **same protocol**:

### Layout × Harness

The agent harness streams LLM output; `reactiveLayout` rewraps partial text each tick while `segments` stays cached until the font changes — cost is re-layout, not full re-measurement. Gates, verify, and retry live in the harness; layout only reacts.

```ts
const harness = harnessLoop({ /* … */ });
const layout = reactiveLayout({ adapter, font, lineHeight, maxWidth });

harness.outputs.subscribe(([[t, v]]) => {
  if (t === DATA) layout.setText(v.text);
});
```

### Layout × Resilience

Wrap a fragile websocket in `circuitBreaker` + `retry`, debounce into `reactiveFlowLayout`'s text state: when the breaker opens, layout holds the last good text; when it closes, layout resumes.

### Layout × Virtualization

`reactiveList` + per-item `reactiveLayout`: **exact predicted heights** before paint — less scroll-anchor drift than estimate-then-correct patterns.

### Layout × CQRS

Event-sourced document → projection drives `reactiveBlockLayout`'s blocks. `graph.snapshot()` can capture document + downstream layout; collaborators mutate blocks and layout reflows per keystroke without redundant measurement where caches apply.

### Layout × Layout

Multiple layout bundles can **share warm adapter caches** (for example two flow layouts with the same adapter). The demo's Adapters chapter shows **Canvas, Offscreen, and CLI** behind one interface.

## Live demo

**[Reactive layout demo →](/demos/reactive-layout/)** — six chapters: **Playground**, **Recomputes**, **Batch**, **Adapters**, **Blocks**, **Flow**.

## Where next

- **[Reactive Layout vs Pretext](/comparisons/pretext/)** — when to pick each, primitive mapping, i18n and bundle tradeoffs
- **[API: `reactiveLayout()`](/api/reactivelayout)**
- **[API: `reactiveBlockLayout()`](/api/reactiveblocklayout)**
- **[API: `analyzeAndMeasure()`](/api/analyzeandmeasure)** · **[API: `computeLineBreaks()`](/api/computelinebreaks)**
- **[Specification](/spec)** — the reactive protocol Reactive Layout builds on
- **[vs RxJS](/comparisons/rxjs)** — how `derived` + `batch` compare to streaming libraries

---

*Credit: Reactive Layout stands on [Cheng Lou's pretext](https://github.com/chenglou/pretext) — algorithms, naming, and the insight that text measurement can be pure arithmetic over cached widths. GraphReFly adds the reactive graph on top.*
