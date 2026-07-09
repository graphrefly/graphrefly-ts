---
title: "Demos"
description: "Interactive demos showing GraphReFly compositions."
---

> **Legacy TypeScript website content.** Shared public website, blog, protocol, guide, and
> language-neutral docs ownership now lives in `~/src/graphrefly` under D563.
> This page is retained here only as migration/reference material while the TS
> API generator still lives in `website/`.


Live demos and runnable walkthroughs that show GraphReFly graph composition,
inspection, and host boundaries.

## Reactive layout

Text measurement and line-breaking as a reactive graph — five chapters walk through incremental recomputation, `batch()` coalescing, pluggable measurement backends, and mixed-content block flow. The demo uses the shared demo shell, so the topology mermaid and the source code driving each chapter are always visible to the right of the main canvas.

[Read the reactive layout solution →](/solutions/reactive-layout/)

## Spending alerts

Node-runnable causal tracing walkthrough for a deterministic spending-alert
pipeline. It uses current `@graphrefly/ts` graph APIs and keeps the source at
`examples/spending-alerts/`, so it is buildable as part of the current examples
set.

[Read the spending-alerts walkthrough →](/demos/spending-alerts/)

## Historical browser demo notes

`demos/knowledge-graph/` and `demos/pagerduty-triage/` were retired from the
active tree during CSP-9/B66 closeout. The notes remain as historical
pre-CSP-9 context because those browser demos depended on retired root/pure-ts
surfaces such as old AI utilities and `utils/demo-shell`. Re-activating either
concept needs a separate migration/design slice over current `@graphrefly/ts`
public subpaths, not compatibility shims.

[Historical knowledge-graph notes →](/demos/knowledge-graph/) ·
[Historical PagerDuty notes →](/demos/pagerduty-triage/)

## Source

Active demo/walkthrough source lives at `demos/reactive-layout/` and
`examples/spending-alerts/` in the repo. The compat matrix remains a
package-surface showcase, while the knowledge-graph and PagerDuty browser demo
concepts are historical references until redesigned over current package
surfaces.
