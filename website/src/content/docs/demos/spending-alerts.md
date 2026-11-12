---
title: "Spending alerts — structural causal tracing"
description: "A 5-hop reactive pipeline that flags anomalous transactions. Ask 'why was this flagged?' and get a walkable causal chain — structure is the trace."
---

> **Legacy TypeScript website content.** Shared public website, blog, protocol, guide, and
> language-neutral docs ownership now lives in `~/src/graphrefly` under D563.
> This page is retained here only as migration/reference material while the TS
> API generator still lives in `website/`.


Homepage pain point 02 says: _your agent flagged something. Why? Logs are a wall of text; state is a snapshot, not a story._ This demo is the short answer. A small reactive graph flags an unusual transaction; one call — `explainPath(graph.inspect(), "txFeed", "alertMessage")` — returns a step-by-step causal chain from raw input to final conclusion. No log parsing, no ad-hoc tracing code. **The graph topology is the trace.**

[Node-runnable source →](https://github.com/graphrefly/graphrefly-ts/tree/main/examples/spending-alerts) · `pnpm --filter @graphrefly-examples/spending-alerts start`

## The pipeline (5 hops)

```
  txFeed (source)
     │
     ▼
  anomalyScore   (derived — z-score × daily ratio × category familiarity)
     │
     ▼
  thresholdGate  (derived — flagged? + threshold used)
     │
     ▼
  reasonFactors  (derived — decomposed contributing signals)
     │
     ▼
  alertMessage   (derived — human-readable alert)
```

`vendorStats` (running mean/std per vendor) and `userProfile` (daily average + typical categories) are side inputs into `anomalyScore` — they shape the decision but aren't on the conclusion's causal spine, so `explainPath` walks the direct flag-producing chain.

## The output that answers "why?"

Fed a $847 wire transfer to an unknown offshore vendor (the user's daily average is $45, typical categories are `groceries / coffee / utilities`), the graph prints:

```
Transaction tx-003 flagged — severity: medium.
Vendor: UNKNOWN-OFFSHORE-LLC  Amount: $847.00  Category: wire-transfer
Reasoning:
  • Amount is 18.8× the user's daily average.
  • Category is outside the user's typical spend profile.
```

Then `explainPath(graph.inspect(), "txFeed", "alertMessage")` returns a `CausalChain`
whose `text` is the path itself:

```
txFeed -> anomalyScore -> thresholdGate -> reasonFactors -> alertMessage
```

Each of its `steps` carries the node's `id`, `factory`, `status`, its current `value`
(what the node holds when the snapshot is taken), its `hop` from `txFeed`, and the
dependency slot (`depIndex`) through which the next step reads it. Future-you
answering _"why was transaction X flagged?"_ reads the steps top-to-bottom and is done.

> **Note on `zScore: 0`.** The flagged transaction is the first-ever sighting of `UNKNOWN-OFFSHORE-LLC`, so the vendor stats have `count=1, std=0` — there's no history to compute a z-score against. The fallback scale is the mean (so `zScore === 0`), and the flag fires entirely from `dailyRatio` (18.8×) + `categoryFamiliarity` ("unknown"). This is realistic: anomaly z-scores need history, and the causal chain makes the _actual_ reason inspectable rather than hiding behind a single opaque score.

## How you get this in your own code

Three ideas. That's all.

**1. Compose with `graph.derived([dep, dep], fn)` — the deps ARE the causal edges.** The graph doesn't need a separate trace format; the topology you wrote down is exactly what `explainPath` walks.

```ts
const anomalyScore = graph.derived(
  [txFeed, vendorStats, userProfile],
  (txn, stats, prof) => ({ zScore: …, dailyRatio: …, categoryFamiliarity: … }),
  { name: "anomalyScore" },
);
```

**2. Attach the WHY as node metadata.** `meta` is pure annotation; it doesn't affect behavior, and `graph.inspect()` reports it on the node. Future readers (human or LLM) get the rationale alongside the value.

```ts
const anomalyScore = graph.derived([txFeed, vendorStats, userProfile], score, {
  name: "anomalyScore",
  meta: { reason: "z-score vs vendor history + daily-spend ratio + category familiarity." },
});
```

**3. Call `explainPath(graph.inspect(), from, to)` at any point — you get a typed `CausalChain`.** The returned object has `found`, `steps[]`, `text` (the path above), and `toJSON()` for passing into audits or LLM prompts. `graph.inspect({ explain: { from, to } })` gives every node on any path from `from` to `to` as a filtered snapshot, `meta` included.

```ts
import { explainPath } from "@graphrefly/ts";

const chain = explainPath(graph.inspect(), "txFeed", "alertMessage");
console.log(chain.text);
// Or: send chain.toJSON() to Claude / GPT and ask "was this decision reasonable?"
```

That's the full teaching. No special "explainability mode", no after-the-fact log mining — the instrumentation is _that_ there is a graph.

## Try it from your agent

The old zero-install `@graphrefly/cli` GraphSpec shell was retired during CSP-9/B66 cleanup.
Use the `@graphrefly/ts` graph APIs directly while the clean-slate package surface settles.

## Extending to an agent

The demo's `alertMessage` uses a deterministic template on purpose. A future
agent-backed version should be designed against current `@graphrefly/ts`
orchestration/pattern public subpaths and explicit async boundary rules. The old
pre-CSP-9 `promptNode` / AI adapter examples are not current package guidance.

## Source

Runnable Node-only pipeline: [`examples/spending-alerts/`](https://github.com/graphrefly/graphrefly-ts/tree/main/examples/spending-alerts). Related: homepage pain point 02, [`explainPath`](/api/explainpath/), [§9.3e in the roadmap](/roadmap/). This page is a legacy website walkthrough for the package-local example; shared public docs ownership now lives in `~/src/graphrefly` under D563.
