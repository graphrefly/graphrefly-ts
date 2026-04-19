# reactive-layout / flow

Multi-column text wrapping around drifting circular obstacles — entirely
through a reactive graph.

What's wired:

- **`reactiveFlowLayout({...})`** builds a graph with state nodes for
  `text / font / line-height / container / columns / obstacles` and two
  derived nodes — `segments` (recomputes only when text/font change) and
  `flowLines` (recomputes whenever any dep changes).
- Two **`effect`** nodes render the current `obstacles` and `flowLines`
  into DOM.
- **`fromRaf()`** is the reactive clock; each frame tick drives
  `bundle.setObstacles(...)` which writes through the graph.

This mirrors the `flow` chapter in `demos/reactive-layout` but strips all
the demo-shell / mermaid / code-pane scaffolding — it's the minimum needed
to see the primitives compose.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
