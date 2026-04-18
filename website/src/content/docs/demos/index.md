---
title: "Demos"
description: "Interactive demos showing GraphReFly compat layers across frameworks and state libraries."
---

Live demos that show GraphReFly working alongside popular state libraries inside every major UI framework.

## Compat matrix

**4 state libraries × 4 frameworks** — all on one page per framework.

| Framework | State libraries shown |
|-----------|----------------------|
| React | GraphReFly, Jotai, Nanostores, Zustand |
| Vue | GraphReFly, Jotai, Nanostores, Zustand |
| SolidJS | GraphReFly, Jotai, Nanostores, Zustand |
| Svelte | GraphReFly, Jotai, Nanostores, Zustand |

Each page exercises all three framework binding APIs: `useStore`, `useSubscribe`, and `useSubscribeRecord`.

[Run the compat matrix demo →](/demos/compat-matrix/)

## Reactive layout

Text measurement and line-breaking as a reactive graph — five chapters walk through incremental recomputation, `batch()` coalescing, pluggable measurement backends, and mixed-content block flow. The demo is hosted inside the same `demo-shell` used by compat matrix, so the topology mermaid and the source code driving each chapter are always visible to the right of the main canvas.

[Run the reactive layout demo →](/demos/reactive-layout/)

## Source

Demo source lives at `demos/compat-matrix/` and `demos/reactive-layout/` in the repo.
