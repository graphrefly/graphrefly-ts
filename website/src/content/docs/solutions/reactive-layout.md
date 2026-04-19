---
title: Reactive Layout
description: "Pretext-class text measurement plus a reactive graph. Multi-column flow, shape obstacles, heterogeneous blocks. Animate obstacles and reflow text every frame without re-measuring."
---

[Pretext](https://github.com/chenglou/pretext) solved text measurement without DOM thrash — it's one of the cleanest pieces of infrastructure to appear on the web in years. Reactive Layout builds on that insight — the same canvas-based measurement, the same cursor-driven line walker — and adds the reactive composition and higher-level primitives a real application needs.

This page is about **when to pick Reactive Layout, when to pick pretext, and what you get when you plug Reactive Layout into the rest of GraphReFly.**

## When to pick Reactive Layout

- **Your layout has changing inputs.** Slider-driven font size, user-typed text, animated obstacles, window resize, streaming LLM output. Pretext gives you measurement; you wire the reactivity. Reactive Layout gives you a graph where only the dependent derived nodes recompute — change `maxWidth` alone and `segments` stays cached across the change.

- **You need more than single-column text.** `reactiveBlockLayout` vertically stacks heterogeneous content (text, SVG, image) with per-block adapters. `reactiveFlowLayout` flows text across columns around circle / rectangle obstacles — editorial magazines, drop caps, text-wrapping-images, pull quotes.

- **You want to inspect and debug the layout.** `graph.describe()` → mermaid. Meta companions report `cache-hit-rate`, `layout-time-ns`, `line-count`, `overflow-segments`. Snapshot + deserialize the whole layout graph with one call.

- **You're composing layout with other reactive behavior.** Streaming LLM output rewrapping in real time. Form validation gating a layout preview. Chat bubbles virtualized with exact predicted heights. Ingestion pipelines that feed document state. This is where GraphReFly's same-protocol composition compounds.

## When to pick pretext instead

- **Size-sensitive embedding.** Pretext is ~15KB min+gz, zero-dep, self-contained. A widget script tag, a landing-page hero — you don't want the GraphReFly core's weight.

- **Text-only, one-shot rendering.** A static blog, a CMS preview, a server-rendered article. Measure once, render. You don't benefit from reactive recomputation — pretext is the direct path with less surface area.

- **Full-fidelity internationalization.** Pretext has bidi, keep-all word-break, emoji-width correction, tab-stop handling, rich-path segment metadata. Our port is a **clean subset** — CJK (per-grapheme breaking), soft-hyphen, break-word, kinsoku, left-sticky punctuation, but **not** the full i18n stack. If you ship to an RTL-heavy market or have serious emoji + CJK mixing requirements, pretext is more battle-tested.

- **You want to own the reactive layer.** Some teams have an opinionated store (Redux, MobX, Signals) and don't want a second protocol. Pretext plugs into whatever you've already built.

## How the primitives line up

| Problem | pretext | Reactive Layout |
|---|---|---|
| Measure text width without DOM reflow | `prepare(text, font)` + `layout(prepared, maxWidth, lineHeight)` | `reactiveLayout({ adapter, text, font, lineHeight, maxWidth })` — same canvas-based measurement, wrapped in a reactive graph |
| Cursor-based single-line layout (multi-slot, multi-column) | `layoutNextLine(prepared, cursor, width)` | `layoutNextLine(segments, cursor, slotWidth)` — same shape, same cursor semantics |
| Carve blocked intervals from a column | Hand-rolled per call site | `carveTextLineSlots(base, blocked, minSlotWidth)` — exported primitive |
| Stacked heterogeneous blocks (text + image + SVG) | Not in core | `reactiveBlockLayout({ adapters, blocks, maxWidth, gap })` |
| Multi-column flow around shape obstacles | Hand-rolled over `layoutNextLine` | `reactiveFlowLayout({ text, container, columns, obstacles })` + `Obstacle = Circle \| Rect` + built-in slot carving |
| Headless / SSR (no DOM / no Canvas) | DOM-dependent | `CliMeasureAdapter` (fixed character width) |
| Observability | None | `graph.describe()` → mermaid; `.meta` companions; snapshot serialization |
| Composable with other reactive work | Bring your own | Native — same protocol as harness, orchestration, messaging, resilience |
| Bidi / tab stops / emoji-width correction | ✓ | Not yet — roadmap |

## Composition stories

Reactive Layout isn't meant to sit alone. The multiplicative value is what happens when it plugs into the rest of GraphReFly:

### Layout × Harness

The agent harness generates an essay with streaming LLM output. `reactiveLayout` rewraps the partial text every frame — but `segments` stays cached until the font changes, so the cost is *just* the re-layout, not re-measurement. The harness gates, verifies, and retries; layout just reacts.

```ts
// harness drives the text; layout reacts
const harness = harnessLoop({ /* 7-stage config */ });
const layout = reactiveLayout({ adapter, font, lineHeight, maxWidth });

// wire the harness's output stream into the layout's text input
harness.outputs.subscribe(([[t, v]]) => {
  if (t === DATA) layout.setText(v.text);
});
```

### Layout × Resilience

The text source is a fragile websocket. Wrap the stream in `circuitBreaker` + `retry`, feed the debounced output into `reactiveFlowLayout`'s text state. When the breaker opens, the layout freezes on the last good text; when it closes, layout picks up seamlessly.

### Layout × Virtualization

`reactiveList` + `reactiveLayout` per item: exact predicted heights before paint. No estimated-height jank, no late corrections, no scroll-anchor drift. Every message in a virtualized chat knows its height before it's positioned.

### Layout × CQRS

Document is an event log. CQRS projection → `reactiveBlockLayout`'s blocks state. Undo/redo snapshots the whole reactive chain — `graph.snapshot()` captures not just the document but the layout downstream of it. Live collaborators mutate blocks; the layout reflows per keystroke without re-measurement.

### Layout × Layout

Two `reactiveFlowLayout` bundles sharing one measurement adapter cache. Change the font on one, the adapter's font-specific cache is warm for the other. The demo's Adapters chapter shows three backends (Canvas, Offscreen, CLI) behind the same adapter shape — swap at mount, no consumer changes.

## Live demos

- **[Reactive layout demo →](/demos/reactive-layout/)** — six chapters:
  - **Playground** — edit text / width / font / line-height, only dependent derived nodes re-run
  - **Recomputes** — reactive fan-out vs. re-run-from-scratch baseline
  - **Batch** — 5 writes, 1 coalesced recompute via `batch()`
  - **Adapters** — same topology, three measurement backends
  - **Blocks** — mixed content (text + SVG + image) reflowing in a vertical stack
  - **Flow** — two columns of essay text wrapping around moving ASCII-rendered obstacles (the pretext editorial-engine idea as a reactive graph)

## 60-second start

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

// Subscribe once; re-renders flow from the graph.
layout.lineBreaks.subscribe(([[type, lb]]) => {
  if (type === DATA) render(lb);
});

// Change any input — only the dependent derived nodes re-run.
layout.setMaxWidth(320);          // segments stays cached
layout.setText("Try typing here."); // segments + line-breaks re-run
layout.setFont("16px serif");     // both re-run (new font key)
```

That's roughly 15 lines. In pretext, add ~50 lines of observer plumbing (a store, a change-detection pass, a subscriber list, a re-layout trigger) to get equivalent reactive recompute behavior.

## Build notes (honest)

- **Measurement fidelity.** Our `analyzeAndMeasure` ports pretext's analysis and measurement subset. CJK, soft-hyphen, break-word, kinsoku, left-sticky punctuation — yes. Full bidi, keep-all word-break, emoji-width correction, tab stops — not yet. If you rely on these, pretext is more battle-tested.
- **Canvas adapter timing.** `CanvasMeasureAdapter` uses `OffscreenCanvas` when available, falls back to DOM `<canvas>`. First measurement on a new font is slower while the font loads; subsequent measurements hit the per-font cache.
- **`fromRaf` semantics.** Our animation-frame source ticks via rAF when the tab is visible and falls back to `setTimeout` when the tab is hidden — so downstream layout state keeps updating. If you need strict rAF semantics (pause in background), wrap or opt out at the source level.

## Where next

- **[API: `reactiveLayout()`](/api/reactivelayout)** — the text-only factory
- **[API: `reactiveBlockLayout()`](/api/reactiveblocklayout)** — heterogeneous blocks
- **[API: `analyzeAndMeasure()`](/api/analyzeandmeasure)** — the pure measurement function
- **[API: `computeLineBreaks()`](/api/computelinebreaks)** — the pure line breaker
- **[Specification](/spec)** — the reactive protocol Reactive Layout is built on
- **[vs RxJS](/comparisons/rxjs)** — how `derived` + `batch` compare to streaming libraries

---

*Credit where it's due: Reactive Layout is deeply indebted to [Cheng Lou's pretext](https://github.com/chenglou/pretext) — the algorithms, the naming, the idea that text measurement can be pure arithmetic over cached widths. We've added the reactive composition layer on top; the foundation is pretext-class.*
