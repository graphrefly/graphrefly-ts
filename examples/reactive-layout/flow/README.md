# reactive-layout / flow

Multi-column text wrapping around drifting circular obstacles — entirely
through a reactive graph.

What's wired:

- **`canvasTextMeasurements({...})`** measures `text / font` upstream as
  graph-visible facts.
- **`reactiveFlowLayout({...})`** consumes that `measurements` node plus
  state nodes for `line-height / container / columns / obstacles` and exposes
  `segments` and `flowLines`.
- Two **`effect`** nodes render the current `obstacles` and `flowLines`
  into DOM.
- **`fromRaf()`** is the reactive clock; each frame tick drives
  `bundle.setObstacles(...)` which writes through the graph. It imports from
  `@graphrefly/ts/sources/browser`; reactive-layout does not own animation sources.

This mirrors the `flow` chapter in `demos/reactive-layout` but strips all
the demo-shell / mermaid / code-pane scaffolding — it's the minimum needed
to see the primitives compose.

## Run

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # production bundle
```
