---
title: "reactiveFactStore()"
description: "Build a static-topology reactive fact store (DS-14.7 architecture C).\n\nTopology (~12 fixed nodes — never grows with fact count):\n - `shards[0..N]` — `state<Fact"
---

Build a static-topology reactive fact store (DS-14.7 architecture C).

Topology (~12 fixed nodes — never grows with fact count):
 - `shards[0..N]` — `state&lt;FactStore&lt;T&gt;&gt;` columnar stores (default 4 shards).
 - `factStore` — derived union read view across shards.
 - `dependentsIndex` — `state&lt;DependentsIndex&gt;` reverse-dep map, unsharded,
   updated synchronously + atomically with each commit (Q9-open-2).
 - `extractOp` — derived: ingest → admission-filtered fragment + dep edges.
 - `invalidationDetector` — derived: scans committed store for `validTo`-set
   / low-confidence facts, resolves dependents via `dependentsIndex`, emits
   cascade messages.
 - `cascade` — topic node carrying `CascadeEvent[]`.
 - `cascadeProcessor` — derived, **synchronous**, `meta.cycle:"cascade"`:
   dedupes by factId, writes invalidations back to shards, recurses until
   fixpoint OR `cascadeMaxIterations` → `cascadeOverflow`.
 - `cascadeOverflow` — per-batch overflow summary node.
 - `queryOp` / `answer` — structured `MemoryQuery` → results (SENTINEL-safe).
 - `outcomeProcessor` — outcome signal → confidence write-back.
 - `consolidated` — cron-tick → summarized fragments on the
   `consolidated` topic,
   default-wired back into the ingest path.
 - `review` — low-confidence proactive-verification requests.

The cascade cycle (`invalidationDetector → cascade → cascadeProcessor →
shards → invalidationDetector`) is a real, bounded reactive cycle. Both
`invalidationDetector` and `cascadeProcessor` are tagged
`meta.cycle:"cascade"` and every cascade message carries `causalReason`, so
`describe()` / `explain()` surface the otherwise-invisible
`dependentsIndex` lookup (COMPOSITION-GUIDE §24).

## Signature

```ts
function reactiveFactStore<T>(
	config: ReactiveFactStoreConfig<T>,
): ReactiveFactStoreGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `ReactiveFactStoreConfig&lt;T&gt;` |  |
