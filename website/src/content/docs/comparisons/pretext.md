---
title: "Reactive Layout vs Pretext"
description: "When to use GraphReFly's reactive layout graph vs Cheng Lou's pretext — bundle size, i18n fidelity, primitive mapping, and how each fits your stack."
---

[Pretext](https://github.com/chenglou/pretext) solved text measurement without DOM thrash — canvas-based width cache and a cursor-driven line walker. **Reactive Layout** ports that class of measurement into a **GraphReFly graph**: `state` → `derived` pipelines, heterogeneous blocks, multi-column flow around obstacles, and first-class observability.

This page is the **consideration-stage** comparison. For setup, APIs, and composition with the rest of GraphReFly, see **[Reactive Layout](/solutions/reactive-layout/)**.

## At a Glance

| | Pretext | Reactive Layout |
|---|---------|-----------------|
| **Role** | Standalone text measurement + layout | Same measurement *subset*, embedded in a reactive DAG |
| **Bundle** | ~15 KB min+gz, zero-dep | GraphReFly core + `reactive-layout` (tree-shakeable) |
| **Reactivity** | Bring your own (store, observers, manual) | Native — only dependent nodes recompute |
| **Beyond single-column text** | You compose by hand | `reactiveBlockLayout`, `reactiveFlowLayout`, exported slot primitives |
| **Headless / SSR** | DOM-oriented measurement path | `CliMeasureAdapter`, `PrecomputedAdapter`, etc. |
| **Observability** | None built-in | `graph.describe()` → mermaid; meta companions; snapshots |
| **Full i18n (bidi, tab stops, emoji width)** | Strong | **Subset** — see below |

## Key Difference

Pretext is a **focused library**: measure and break lines with minimal surface area. Reactive Layout is **measurement + orchestration**: the same *kind* of pipeline (analyze → segments → line breaks → height / positions) lives inside GraphReFly's protocol, so layout participates in streaming, batching, resilience, and tooling like everything else in your graph.

## How the Primitives Line Up

| Problem | Pretext | Reactive Layout |
|---|---|---|
| Measure text width without DOM reflow | `prepare(text, font)` + `layout(prepared, maxWidth, lineHeight)` | `reactiveLayout({ adapter, text, font, lineHeight, maxWidth })` — canvas-based measurement in a reactive graph |
| Cursor-based single-line layout (multi-slot, multi-column) | `layoutNextLine(prepared, cursor, width)` | `layoutNextLine(segments, cursor, slotWidth)` — same shape, same cursor semantics |
| Carve blocked intervals from a column | Hand-rolled per call site | `carveTextLineSlots(base, blocked, minSlotWidth)` — exported primitive |
| Stacked heterogeneous blocks (text + image + SVG) | Not in core | `reactiveBlockLayout({ adapters, blocks, maxWidth, gap })` |
| Multi-column flow around shape obstacles | Hand-rolled over `layoutNextLine` | `reactiveFlowLayout({ text, container, columns, obstacles })` + `Obstacle = Circle \| Rect` + built-in slot carving |
| Observability | None | `graph.describe()` → mermaid; `.meta` companions; snapshot serialization |
| Composable with other reactive work | Bring your own | Native — same protocol as harness, orchestration, messaging, resilience |

## When to Choose Reactive Layout

- **Your layout has changing inputs.** Slider-driven font size, user-typed text, animated obstacles, window resize, streaming LLM output. Change `maxWidth` alone and `segments` can stay cached across the change — only dependent derived nodes recompute.

- **You need more than single-column text.** `reactiveBlockLayout` for mixed content; `reactiveFlowLayout` for columns with obstacles.

- **You want inspectability.** Meta companions (`cache-hit-rate`, `layout-time-ns`, `line-count`, …) and one-call graph snapshots for tests and debugging.

- **You're already composing GraphReFly.** Streaming harness output into `setText`, resilience around sources, virtualization with exact heights — layout stays on the same protocol.

## When to Choose Pretext

- **Size-sensitive embedding.** A widget script tag or a landing-page hero where every kilobyte counts.

- **Text-only, one-shot rendering.** Static blog, CMS preview, SSR article: measure once, render. You do not benefit from reactive recomputation.

- **Full-fidelity internationalization.** Pretext includes bidi, keep-all word-break, emoji-width correction, tab-stop handling, and rich segment metadata. Reactive Layout ports a **clean subset** (CJK per-grapheme breaking, soft-hyphen, break-word, kinsoku, left-sticky punctuation, …) but **not** the full i18n stack. For RTL-heavy markets or serious emoji + CJK mixing, pretext is more battle-tested.

- **You want to own the reactive layer.** Redux, MobX, Signals — pretext plugs into whatever you already use without a second abstraction.

## What Pretext Offers That Reactive Layout Does Not Yet

- **Broader i18n:** bidi, tab stops, emoji-width correction, keep-all word-break, and richer segment metadata.

- **Smaller, self-contained package** for measurement-only use cases.

- **Battle-tested** edge cases in complex multilingual text.

## What Reactive Layout Adds

- **Incremental, cached recomputation** in a dependency graph — no hand-rolled observer lists for the layout pipeline.

- **Higher-level layout primitives** (`reactiveBlockLayout`, `reactiveFlowLayout`, `carveTextLineSlots`) beyond single-column body text.

- **Runtime inspection** via `graph.describe()` and meta companions — no separate devtools extension.

- **Same-protocol composition** with harnesses, operators, circuit breakers, lists, and CQRS-style document graphs.

## Ergonomics: Reactive Rewrap

Roughly **15 lines** subscribe to `lineBreaks` and drive inputs on `reactiveLayout`. To get **equivalent** reactive recompute behavior on top of pretext alone, you typically add observer plumbing (a store, change detection, subscribers, re-layout triggers) — on the order of **tens of lines**, depending on your stack. That is not a knock on pretext; it is the tradeoff for staying minimal and framework-agnostic.

## See Also

- **[Reactive Layout solution guide](/solutions/reactive-layout/)** — quick start, advanced notes, composition recipes, demo links
- **[Live demo →](/demos/reactive-layout/)** — playground, adapters, blocks, flow, batching
- **[API: `reactiveLayout()`](/api/reactivelayout)** · **[API: `reactiveBlockLayout()`](/api/reactiveblocklayout)** · **[API: `analyzeAndMeasure()`](/api/analyzeandmeasure)** · **[API: `computeLineBreaks()`](/api/computelinebreaks)**

---

*Reactive Layout is deeply indebted to [Cheng Lou's pretext](https://github.com/chenglou/pretext) — the algorithms, the naming, and the idea that text measurement can be pure arithmetic over cached widths. GraphReFly adds the reactive composition layer on top.*
