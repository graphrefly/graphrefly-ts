---
title: "Demos"
description: "Interactive demos showing clean-slate GraphReFly compositions."
---

Live demos and runnable walkthroughs that show GraphReFly clean-slate graph
composition, inspection, and host boundaries.

## Reactive layout

Text measurement and line-breaking as a reactive graph — five chapters walk through incremental recomputation, `batch()` coalescing, pluggable measurement backends, and mixed-content block flow. The demo uses the shared clean-slate demo shell, so the topology mermaid and the source code driving each chapter are always visible to the right of the main canvas.

[Read the reactive layout solution →](/solutions/reactive-layout/)

## Spending alerts

Node-runnable causal tracing walkthrough for a deterministic spending-alert
pipeline. It uses current `@graphrefly/ts` graph APIs and keeps the source at
`examples/spending-alerts/`, so it is buildable as part of the clean-slate
examples set.

[Read the spending-alerts walkthrough →](/demos/spending-alerts/)

## Historical browser demo notes

`demos/knowledge-graph/` and `demos/pagerduty-triage/` are retained only as
historical pre-CSP-9 notes. Their browser sources still depend on retired
root/pure-ts demo surfaces such as old AI utilities and `utils/demo-shell`, so
they are no longer active clean-slate demos or workspace packages. Re-activating
either one needs a separate migration/design slice over current `@graphrefly/ts`
public subpaths, not compatibility shims.

[Historical knowledge-graph notes →](/demos/knowledge-graph/) ·
[Historical PagerDuty notes →](/demos/pagerduty-triage/)

## Source

Active demo/walkthrough source lives at `demos/reactive-layout/` and
`examples/spending-alerts/` in the repo. The compat matrix remains a
package-surface showcase, while the knowledge-graph and PagerDuty browser demos
are historical references until migrated.
