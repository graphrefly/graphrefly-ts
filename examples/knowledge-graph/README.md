# Knowledge-graph extraction

Pre-parsed documents -> graph-visible `KnowledgeAssertion` facts ->
`knowledgeGraphReducerBundle()` -> deterministic entity/relation/topic
projections.

This is the clean-slate Node-runnable successor for the same concept as the
retired pre-CSP-9 browser demo formerly under `demos/knowledge-graph/`. That
browser demo depended on retired root/pure-ts demo surfaces, so it is no longer
part of the active tree. This example uses pre-parsed documents, so it runs
with no API key, no model download, and no network.

## Run

```bash
pnpm install
pnpm start
```
