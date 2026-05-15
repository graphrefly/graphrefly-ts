---
SESSION: DS-14.7-reactive-fact-store
DATE: 2026-05-13
TOPIC: Reactive Fact Store / Live Knowledge Graph pattern. Static-topology architecture for agent memory that satisfies MEME L2/L3 (cascade + obsolescence) and Hassabis's "filter + consolidate + continual-learning" frame without per-fact node materialization.
REPO: graphrefly-ts
STATUS: **LOCKED 2026-05-13** — 9Q walk complete (PART 6). Architecture, invariants, MemoryFragment shape, and all 9 open items resolved. Awaiting implementation invocation. Spec + DS-14 envelope: zero shape change.
---

## CONTEXT

This session crystallizes a memory-system design that emerged from three back-to-back research threads on 2026-05-13:

1. **Hassabis YC × DeepMind Startup School talk (2026-04-29)** — named continual learning, long-term memory, long-term reasoning, consistency as the unsolved pieces blocking AGI ~2030. Called today's "shove it all in the context window" approach "duct tape". REM-replay framing for filter+consolidate.
2. **MEME paper ([arXiv:2605.12477](https://arxiv.org/abs/2605.12477), 2026-05-12)** — first benchmark for multi-entity & evolving memory. Default-config results across 6 systems: **Cascade L2 = 3% accuracy, Absence L3 = 1%**. File-based agent + Claude Opus 4.7 partially closes the gap at ~70× cost. Three new evaluation dimensions (Cascade / Absence / Deletion) map cleanly onto the three-layer memory-update model the user surfaced from a Chinese recap video.
3. **Live-KG framing** — user's insight that GraphReFly's reactive protocol can be read as a "live knowledge graph with built-in chain reactions". Memory fragment + timestamp + confidence + tags + sources = reactive levers.

The architecture below is the **static-topology** version of that framing — arrived at after rejecting two intermediate designs:
- **v1 (rejected): every fact = a reactive node.** Doesn't scale. Reactive contract costs ~100–200B/node permanently (subscriber set + dirty bits + diamond counter + cached value); 10M facts = absurd RAM. Even with Rust handle IDs this is the protocol's inherent tax, not an implementation issue.
- **v2 (rejected): materialize/collapse via `graphRewire`.** Better — cold store + on-demand expansion — but adds substantial complexity (Phase 13.7 dependency, lifecycle bookkeeping, expansion bounds).
- **v3 (locked direction): static topology + message-flow reactivity.** ~12 fixed operator nodes; facts live as DATA inside indexed `state` nodes; cascade implemented as recursive message emission with `batch()` dedupe replicating diamond-merge semantics at message granularity. Topology never grows. Scale lives in data structures and message volume.

**Cross-references:**
- [archive/docs/SESSION-agentic-memory-research.md](SESSION-agentic-memory-research.md) — prior SOTA landscape + four advanced write strategies (3D filter funnel, GraphRAG, dynamic reflection, hot/cold tiers); Part 6 "Second Half" thesis on outcome-feedback gap. This DS supersedes Part 6 §"opportunity #1" as the formal substrate.
- [archive/docs/SESSION-DS-14-changesets-design.md](SESSION-DS-14-changesets-design.md) — `BaseChange<T>` envelope; this DS extends with `kind: "invalidate"` payload for cascade events. **No envelope shape change required.**
- [archive/docs/SESSION-learned-memory-scoring.md](SESSION-learned-memory-scoring.md) — prior scoring-as-policy thinking; folded into §5 extension faces.
- [docs/optimizations.md](../../docs/optimizations.md) — adaptive `agentMemory()` feedback entry will land here (TBD).
- [~/src/graphrefly/GRAPHREFLY-SPEC.md §1.4](file:///Users/davidchenallio/src/graphrefly/GRAPHREFLY-SPEC.md) — INVALIDATE-at-diamond is the protocol-level answer to MEME L2; this DS shows how to leverage it without per-fact materialization.

---

## PART 1: PROBLEM STATEMENT (what we are solving)

### 1.1 The 3% / 1% gap

MEME shows that **all** major agent memory systems (Mem0, Letta, MemGPT, Zep+Graphiti, file-based, full-context) fail on the same two tasks because they share an architectural property: **writes and reads have no reactive channel between them**. A fact stored is a fact frozen, even when its preconditions change.

Three update layers (from the user-surfaced video, mapped to MEME dimensions):

| Layer | Example | MEME accuracy (default config) | Architectural requirement |
|---|---|---|---|
| L1 Direct replace | "lives in Beijing" → "Shanghai" | high across systems | mutable store |
| L2 Cascade invalidation | move → "15-min bike commute" must re-verify | **3%** | **fact-level dependency graph + reactive invalidation** |
| L3 Obsolescence reasoning | colleague leaves → "we are colleagues" → "we **were** colleagues" | **1%** | **bi-temporal (valid_time + transaction_time) + currentness derivation** |

### 1.2 Hassabis's parallel frame

The same architecture must also serve Hassabis's named gaps:

- **Filter + consolidate (REM-replay analogue)** — periodic worker that compresses high-signal episodes into durable summaries.
- **Continual learning** — outcome signal flows back into memory policies (decay, admission, scoring); the agent's memory system *learns* what's worth keeping over time.
- **Generalized model orchestrating specialized tools** — per-node adapter swap (cloud-frontier planner + on-device small/diffusion-LM extractors).

### 1.3 What we are NOT solving

- Open-world / public KG at Wikidata scale (10⁹+ nodes). Our operating point is **agent-personal memory** at 10⁴–10⁷ facts.
- Replacing world models. We host the loop around them (observation intake, plan-tree inspection, rollback) — see DS-14.5.A on substrate framing.
- RL training of memory policies. We provide the trajectory log (Phase 14 changesets) that external trainers (Memory-R1, InftyThink+ style) can consume.

---

## PART 2: ARCHITECTURE (static topology + message-flow reactivity)

### 2.1 The fixed graph

~12 operator nodes, never grows regardless of how many facts the system stores:

```
                                      ┌───────────────────┐
   ingest topic ──────────┐           │ dependentsIndex   │
   (new fact / update)    ▼           │ state<Map<id,id[]>>│◄──┐
                    ┌─────────┐       └─────────┬─────────┘   │
                    │ extract │ write            │ lookup       │ write
                    │ sources │──────────┐      │             │
                    └────┬────┘          ▼      ▼             │
                         │         ┌──────────────────┐       │
                         └────────►│ factStore        │       │
                                   │ state<FactStore> │       │
                                   └────────┬─────────┘       │
                                            │ commit          │
                                            ▼                 │
                                ┌──────────────────────┐      │
                                │ invalidationDetector │      │
                                │ (validTo / conf<θ)   │      │
                                └──────────┬───────────┘      │
                                           │ emit             │
                                           ▼                  │
                                ┌──────────────────────┐      │
              ┌────────────────►│ cascade topic        │──┐   │
              │ self-recursion  └──────────────────────┘  │   │
              │  (bounded)                 │              │   │
              │                            ▼              │   │
              │              ┌──────────────────────┐     │   │
              └──────────────│ cascadeProcessor     │─────┘   │
                             │ batch()+dedupe       │─────────┘
                             └──────────────────────┘ write-back invalidations

   query topic ──────► queryOp ──► factStore.read ──► answer topic
   outcome topic ────► outcomeProcessor ──► confidence/policy ──► factStore
   cron(REM) ────────► consolidator ──► summarized fragments ──► ingest topic
                                                              (self-feeding)
```

### 2.2 Why this satisfies spec §1.4 reactive semantics

Topology has **near-zero diamonds at the node level** (~linear pipeline). Spec §1.4 INVALIDATE-at-diamond is trivially satisfied. The "reactive" work happens at **message granularity** inside `cascadeProcessor`:

1. Fact F's `validTo` is set → factStore commits → invalidationDetector emits.
2. invalidationDetector looks up F in `dependentsIndex` → emits N cascade messages onto cascade topic.
3. cascadeProcessor subscribes to cascade topic, uses **`batch()` to collect all cascade messages in one wave**, then dedupes by fact_id.
4. Dedupe + commit writes back invalidations → triggers invalidationDetector again (recursive wave) → fixpoint when no new cascades emerge.

**`batch()` at message level reproduces diamond-merge at fact level.** This is the architectural pivot — we get MEME L2 semantics without paying per-fact reactive overhead.

### 2.3 MemoryFragment shape

`MemoryFragment<T>` is a **pattern convention**, not a spec primitive. It lives inside `FactStore` as columnar data, not as nodes:

```ts
interface MemoryFragment<T> {
  id: FactId;
  payload: T;
  t_ns: bigint;              // when learned (transaction time)
  validFrom?: bigint;        // when fact starts being true (valid time) — DRAFT field
  validTo?: bigint;          // when fact stops being true — MEME L3 key
  confidence: number;        // 0..1
  tags: readonly string[];
  sources: readonly FactId[]; // dependency edges feeding dependentsIndex
}
```

Each field is a **reactive lever**:

| Field | Reaction triggered | Maps to |
|---|---|---|
| `payload` write | downstream `derived` recompute | MEME L2 (spec gives free) |
| `validTo` set | currentness derivations flip; cascade fires | MEME L3 |
| `confidence < θ` | `reviewTopic` emit → harness INTAKE | MEME proactive verification |
| `t_ns` + `decay` | confidence drift over time | Hassabis forgetting curve |
| `tags` grouping | `fromCron` scoped consolidation pass | Hassabis REM replay |
| `sources` edge | invalidationDetector → cascade | MEME L2 cascade actual mechanism |
| outcome (external) → `confidence` | RL signal write-back | Hassabis continual learning |

### 2.4 FactStore as columnar in-memory store

Single `state<FactStore>` (or sharded N — see §3) holds all facts as columnar arrays. ~1M facts ≈ few tens of MB. The bottleneck is **write churn** (every commit fires the subscriber set), not capacity — addressed by sharding.

```ts
interface FactStore {
  ids:        Uint32Array;
  payloads:   readonly unknown[];   // or typed buffer per T
  t_ns:       BigInt64Array;
  validFrom:  BigInt64Array;        // 0n sentinel = unbounded
  validTo:    BigInt64Array;
  confidence: Float32Array;
  tagBitmap:  Uint32Array;          // tag dictionary + bitmap

  // Reverse index — makes cascade O(affected) not O(N)
  dependents: Map<FactId, readonly FactId[]>;
}
```

---

## PART 3: INVARIANTS (the two locked decisions)

### 3.1 `cascade.maxIterations` — cycle/depth guard

**Locked 2026-05-13:** cascade recursion is bounded by `cascade.maxIterations` (default **8**). When exceeded, remaining cascade messages emit to `cascadeOverflow` topic (not silently dropped). Callers can subscribe `cascadeOverflow` for alerting.

Naming precedent: [`refineLoop` in `patterns/harness/presets/refine-loop.ts:166`](../../packages/pure-ts/src/patterns/harness/presets/refine-loop.ts) uses `maxIterations` with JSDoc "Always set a finite bound in production." DS-14.7 mirrors this convention.

Rationale: pathological dependency graphs (A→B→A cycle from LLM-extracted dependencies) must not livelock the runtime. Diamond fixpoint typically reached in 2–3 iterations; 8 leaves slack.

### 3.2 `shardBy` — pattern-default with caller override

**Locked 2026-05-13:** pattern ships a default `shardBy: (f) => hashFactId(f.id) % 4` (hash-mod, 4 shards). Caller can override with any `(f) => ShardKey`. Sharding is **optional** — single-shard is the simplest configuration and serves up to ~100K facts comfortably.

Rationale: reactive systems pay subscription fan-out cost per `state` write. Sharding reduces subscriber-set size per write (writers of shard A don't disturb subscribers of shard B). This is the dominant scaling lever for in-memory reactive stores — different from DB sharding where IO is the bottleneck.

---

## PART 4: PATTERN SURFACE

### 4.1 The single factory

```ts
function reactiveFactStore<T>(config: {
  // ① Function hooks (no reactive policy needed)
  extractDependencies: (f: MemoryFragment<T>) => readonly FactId[];
  shardBy?: (f: MemoryFragment<T>) => ShardKey;       // default: hash-mod 4

  // ② Node<Policy> hooks (reactive — policy itself can evolve)
  scoring?:         Node<ScoringPolicy<T>>;
  decay?:           Node<DecayPolicy>;
  admissionFilter?: Node<AdmissionFilter<T>>;

  // ③ Topic inputs (caller wires upstream sources)
  ingest:   Node<MemoryFragment<T>>;
  outcome?: Node<OutcomeSignal>;
  query?:   Node<MemoryQuery>;

  // Invariants
  cascadeMaxIterations?: number;      // default: 8
  consolidateSchedule?:  CronSpec;
}): {
  // ④ Topic outputs (caller subscribes for any custom processing)
  factStore:       Node<FactStore<T>>;
  dependentsIndex: Node<DependentsIndex>;
  answer:          Node<MemoryAnswer<T>>;
  scored:          Node<ScoredFact<T>>;
  cascade:         Node<CascadeEvent>;
  cascadeOverflow: Node<CascadeOverflow>;
  review:          Node<ReviewRequest>;
};
```

### 4.2 The four extension faces

| Face | Use when | Example |
|---|---|---|
| ① Plain fn | knob doesn't need to change reactively | `extractDependencies: myLLMExtractor` |
| ② `Node<Policy>` | policy itself must evolve (continual learning) | `scoring: derived([outcomes], o => buildScorer(o))` |
| ③ Topic input | external stream feeds the system | `ingest: enrichedIngestNode` |
| ④ Topic output subscribe | observe / log / route internal events | `derived([memory.cascade], evt => sentryLog(evt))` |

Four faces together = strictly more powerful than registry-style hooks (LangChain pattern). Trade-off: steeper learning curve. **Compensated by recipe library**, not by adding registry layer.

### 4.3 Recipe library (planned)

```
patterns/ai/memory/recipes/
  ├── scoring-by-outcome.ts       # self-evolving scoring policy (continual learning)
  ├── decay-exponential.ts        # standard forgetting curve
  ├── consolidation-rem.ts        # REM replay over high-access × recent-outcome
  ├── admission-llm-judge.ts      # LLM gatekeeper
  ├── shard-by-tenant.ts          # multi-tenant isolation
  ├── invalidation-tracer.ts      # cascade event subscriber for debugging
  ├── bitemporal-query.ts         # "as of t" historical view (MEME L3)
  └── influence-analysis.ts       # write-time `reachable` exposure (MEME write-time analysis)
```

Each recipe is a documented composition that callers copy-paste-modify rather than register-as-hook. Pedagogically clearer; loses some "framework feel" — acceptable trade.

---

## PART 5: SPEC + ENVELOPE IMPACT

- **Spec: zero change.** This pattern leverages §1.4 DIRTY propagation on the static topology; `batch()` semantics replicate fact-level diamond merge at message granularity. No new protocol invariants. No primitive layer changes.
- **DS-14 `BaseChange<T>` envelope: zero shape change.** New payload `kind: "invalidate"` (with `reason: "cascade" | "obsolete" | "manual"`, `rootFactId`) is a `change: T` value, not an envelope-level field. Backwards-compatible extension of `structure: "factstore"` variant.
- **Phase 14.6 storage WAL replay: compatible.** FactStore is a single `state` node (or sharded N) — already serializable through existing storage substrate. `dependentsIndex` is a separate `state` node, also serializable.
- **Phase 13.7 rewire (`graphRewire` / `node.setDeps`): NOT required.** This was a v2 dependency that the static-topology design removes.

---

## PART 6: 9Q WALK (2026-05-13)

Format mirrors [SESSION-ai-harness-module-review.md](SESSION-ai-harness-module-review.md). Subject under design: the proposed `reactiveFactStore<T>()` pattern + accompanying `MemoryFragment<T>` shape + 8 recipes.

### Q1 — Semantics, purpose, proposed implementation

- **`reactiveFactStore<T>(config)`** — a static-topology pattern that maintains an indexed, reactive store of `MemoryFragment<T>` records with cascade-on-dependency-change and bi-temporal validity. Replaces "per-fact reactive node" mental model with "fixed pipeline of operators + columnar data + message-flow recursion."
- **Topology shape:** ~12 fixed nodes (see PART 2.1 diagram). `ingest` / `outcome` / `query` are caller-supplied `Node` inputs; `factStore` / `dependentsIndex` / `answer` / `scored` / `cascade` / `cascadeOverflow` / `review` are pattern-owned `Node` outputs. Internal flow: `ingest → extract → factStore.commit + dependentsIndex.update → invalidationDetector → cascade topic → cascadeProcessor.batch+dedupe → write-back → (re-trigger invalidationDetector until fixpoint OR maxIterations cap → cascadeOverflow)`.
- **Storage shape:** `state<FactStore>` holds columnar arrays per field (`ids`, `payloads`, `t_ns`, `validFrom`, `validTo`, `confidence`, `tagBitmap`) + `Map<FactId, readonly FactId[]>` reverse-dependency index. Optional `shardBy: (f) => ShardKey` partitions storage into N sibling `state<FactStore>` nodes; pattern default is hash-mod 4.
- **Cascade mechanism:** `batch()` at message granularity replicates spec §1.4 diamond-merge at fact granularity — when fact F's `validTo` is set, dependentsIndex resolves dependents `[D1, D2, …]` and emits N cascade messages; `cascadeProcessor` collects messages within the wave, dedupes by `fact_id`, commits invalidations in one batch. Recursive cascades repeat the cycle up to `cascadeMaxIterations` (default 8); excess emits to `cascadeOverflow` for caller alerting.
- **`MemoryFragment<T>`** is a TS type convention (not a spec primitive). Fields = `{id, payload, t_ns, validFrom?, validTo?, confidence, tags, sources}`. Each field is a "reactive lever" — see PART 2.3 mapping table.
- **Four extension faces:** (i) plain fn hooks (`extractDependencies`, `shardBy`); (ii) `Node<Policy>` hooks (`scoring`, `decay`, `admissionFilter`) for live-evolving policies; (iii) topic inputs (`ingest`, `outcome`, `query`) caller wires upstream; (iv) topic output subscription for any custom observer. Strictly more powerful than registry-hook style (LangChain pattern) because policy itself is a reactive node.
- **Recipe library:** 8 documented compositions (PART 4.3) — callers copy-modify rather than register.

### Q2 — Semantically correct?

- ✅ **MEME L2 cascade.** `dependentsIndex` + `cascadeProcessor.batch+dedupe` reproduces diamond-merge at message granularity. Bounded recursion guarantees termination at fixpoint OR overflow signal. Reverse-index makes cascade O(affected) per round, not O(|FactStore|).
- ✅ **MEME L3 obsolescence.** `validFrom/validTo` fields + `currentlyValid(asOf)` derivation handle "was vs is" reasoning. `bitemporal-query` recipe answers historical queries against any past timestamp using `t_ns` transaction time. Graphiti/Zep parity at pattern layer, without committing the spec.
- ✅ **MEME write-time influence analysis.** `reachable`-style influence query collapses to `dependentsIndex.get(factId)` — O(1) versus open-problem in MEME paper.
- ✅ **Hassabis REM-replay / filter+consolidate.** `consolidator` (cron-fed) reads from `factStore` keyed by tags / high-access × recent-outcome, emits summarized fragments back to `ingest`. Self-feeding loop is explicit, inspectable via `describe()`.
- ✅ **Hassabis continual learning.** `outcome` topic → updates `scoring: Node<ScoringPolicy>` (or `decay: Node<DecayPolicy>`) → `admissionFilter` / `decay` operators read updated policy via spec §1.4 push-on-update. No callback registry; closed-loop is reactive composition.
- ⚠️ **Cascade depth ceiling.** `maxIterations=8` may under-cover deep dependency chains (medical/legal causation can span 20+ hops). Caller-tunable; mitigation = monitor `cascadeOverflow` topic. Document loudly in JSDoc.
- ⚠️ **`batch()` dedupe assumes same-wave landing.** If the cascade pipeline includes an async-derive step (e.g., LLM extractor on cascade events), cascade messages for the same `fact_id` may straddle waves; dedupe degrades to "duplicate invalidation write" — semantically idempotent (writing `invalidated` twice is harmless) but inflates depth counter against `maxIterations`. Mitigation: keep `cascadeProcessor` synchronous; LLM-driven cascade extraction belongs upstream of `cascade topic`, not inside the recursion.
- ⚠️ **Cross-shard cascade.** With sharding, if A∈shard1 depends on B∈shard2, cascade message must reference shard-tagged `fact_id`. `dependentsIndex` must either stay unsharded (single source of truth) or carry shard-aware lookups. Open in Q9.
- ⚠️ **Correctness depends on `extractDependencies` correctness.** If LLM hallucinates a dependency, spurious cascade; if LLM omits one, missed invalidation. Pattern cannot validate — caller's responsibility. Document loudly.

### Q3 — Design-invariant violations?

- ✅ **§5.8 No polling.** Cascade is message-driven via reactive subscription; consolidator uses `fromCron` (a reactive timer source per spec), not `setInterval`. `decay` recipe uses `fromTimer` for periodic confidence drift, also spec-compliant.
- ✅ **§5.9 No imperative triggers.** All coordination through `Node<T>` inputs/outputs. `outcome` is an input topic — caller emits to it via standard reactive sources (e.g., `fromEvent` adapter or `state.set()` at boundary).
- ✅ **§5.10 No raw async in reactive layer.** Cron source / extract step / consolidator may invoke LLM; pattern wraps these via `switchMap` + `fromAny` per `promptNode` convention. No bare `Promise` constructors inside reactive fn bodies.
- ✅ **§5.11 Central timer.** All timestamps (`t_ns`, `validFrom`, `validTo`) use `bigint` via `monotonicNs()` for ordering and `wallClockNs()` for attribution per `core/clock.ts`. Resolves prior Q9 (units): bigint-only, no `Date` union.
- ✅ **§5.12 Phase 4+ developer-friendliness — partial.** 4 extension faces is more powerful but steeper learning curve than `agentMemory()`. Mitigation = recipe library + a thin `simpleFactStore()` wrapper for the 80% case (DEFER to v1.1; tracked as Q9 open item).
- ✅ **messageTier-based auto-checkpoint.** `factStore` and `dependentsIndex` commit emissions are DATA-tier; auto-checkpoint gates at `messageTier >= 3` correctly persists post-cascade state. Spec gate is unchanged.
- ✅ **COMPOSITION-GUIDE §3/§8 null guards.** `query` operator emits `null` while `factStore` is at SENTINEL; downstream `answer` consumer per guide §3 uses `=== null` test. Documented in recipe.
- ⚠️ **COMPOSITION-GUIDE §24 explainability.** The cascade-recursion edge (cascadeProcessor → factStore → invalidationDetector → cascade topic → cascadeProcessor) is a real reactive cycle in the topology. `describe()` renders all 4 named nodes; `explain(ingest → answer)` for a cascade-affected query traces through the cycle. ✅ no islands. **But:** `dependentsIndex.get(factId)` happens inside `invalidationDetector`'s fn body — not a reactive edge — so `explain` shows "F changed → dependents D1, D2 invalidated" without the index-lookup step being visible. Mitigation = `invalidationDetector` emits a `causalReason` field on each cascade message so the lookup is visible in output data, even if not in topology.
- ⚠️ **Spec invariant: bounded recursion.** Cascade self-recursion is a named reactive cycle. Spec doesn't forbid cycles when bounded (refineLoop precedent), but cycles deserve explicit JSDoc — flag every reactive cycle in the pattern's `describe()` output via meta-tag (`meta.cycle: "cascade"`).

### Q4 — Open items (roadmap / optimizations.md)

- **[optimizations.md "outcome-feedback adaptive agentMemory()"](../../docs/optimizations.md) — superseded by DS-14.7.** This DS folds the prior Part 6 "Second Half" §opportunity #1 (SESSION-agentic-memory-research.md) into a formal pattern. Post-lock: update the optimizations entry to "DS-14.7 reactiveFactStore — substrate" with a back-reference.
- **DS-14 `BaseChange<T>` envelope: extension only, no shape change.** New payload `kind: "invalidate"` (`reason: "cascade" | "obsolete" | "manual"`, `rootFactId`) lands as a `change: T` value inside `structure: "factstore"`. Backwards-compatible; no envelope-level deferral.
- **Phase 14.6 storage WAL replay: compatible.** `factStore` and `dependentsIndex` are serializable `state` nodes; lifecycle-aware `restoreSnapshot mode:"diff"` replays factstore changes correctly. Cross-reference both ways.
- **Phase 13.7 rewire (`graphRewire` / `node.setDeps`): NOT required.** This was a v2 dependency; static-topology v3 removes it. **Insight:** rewire's use-case shrinks to legitimate live-topology-mutation cases (e.g., multi-agent subgraph hot-swap); memory storage drops out.
- **Phase 15 eval scorecard candidates:** (1) MEME 100-episode parity (target ≥40% L2 cascade vs. 3% market baseline); (2) continual-learning microbench (static-score vs. `scoring-by-outcome` recipe).
- **New optimizations.md candidates (post-lock):**
  - `simpleFactStore()` ergonomic wrapper for the 80% case.
  - `dependentsIndex` async-indexer mode (eventual-consistency variant).
  - Cascade overflow per-message vs per-batch emission policy.
  - Bi-temporal as envelope-level field (deferred to v2 of DS-14.7).
  - Sharding rebalance recipe.
  - Cross-shard cascade `dependentsIndex` strategy.
- **roadmap §9.0 / SESSION-agentic-memory-research.md Part 6:** "Second Half" thesis (outcome-feedback gap) formally closed by this DS.

### Q5 — Right abstraction? More generic possible?

- **Purpose is right.** "Indexed reactive table with cascade-on-source-change + bi-temporal validity" is the natural level between `state<KGSnapshot>` (raw KG, no cascade) and `agentMemory()` (composed wrapper). It exists at the same layer as `reactiveMap` / `reactiveLog` / `reactiveIndex` — domain-specific but bundled-by-default.
- **More generic possible?** Yes — this generalizes to a `reactiveIndexedTable<TRow, TKey>(config)` primitive with:
  - row schema (any T)
  - dependency-extractor (any `TRow → readonly TKey[]`)
  - cascade-on-key-invalidation
  - reverse-index maintenance
  - sharding
  
  Use cases beyond memory: reactive ORM (FK cascade), rule engine (facts + dependents), Salsa-style incremental computation. **But: premature.** Until a second concrete use case shows up, extracting the generic primitive is speculation. Park as a "post-v1 extraction candidate" — the `MemoryFragment<T>` row shape is concrete enough to validate the design; if a second use case emerges, the generic primitive becomes obvious.
- **Scope creep risk.** `reactiveFactStore` owns 9 concerns: ingest, store, index, cascade, query, consolidate, scoring, outcome, shard. Can any be unbundled?
  - **Consolidate** is most easily separable — it's an external producer that feeds `ingest`. But bundling gives REM-replay out-of-box, which is the differentiating story.
  - **Scoring + outcome** are tightly coupled (outcome updates scoring policy reactively); keep bundled.
  - **Sharding** is internal — caller specifies `shardBy`, doesn't see shards externally.
  - **Query** could in principle be omitted — caller writes their own `derived` over `factStore`. But shipping a default query op with `asOf` support handles MEME L3 ergonomically; keep bundled.
- **Conclusion:** scope is right. Recipes carry the variability; factory carries the invariants.

### Q6 — Right long-term solution? Caveats / maintenance burden?

- **Long-term shape is right.** Static topology = stable surface area; only `FactStore` row shape evolves, and DS-14 envelope-versioning (T2 `version: number | string`) handles that.
- **Caveats (kept-as-is for v1):**
  - **`extractDependencies` correctness is caller responsibility.** Pattern cannot validate LLM-hallucinated edges. Documented; recipe `invalidation-tracer.ts` exposes cascade events for debugging.
  - **Cascade overflow under dense KGs.** Scientific/legal domains may have rich dependency webs. `maxIterations=8` is a knob; cap-hits emit to `cascadeOverflow` for caller to handle (escalate to LLM-driven repair, alert, or batch-defer).
  - **Sharding rebalance is a one-time decision.** Changing `shardBy` mid-run requires rehash of all facts. Same limitation as DB sharding. Document loudly.
  - **In-memory ceiling.** ~10⁷ facts × ~200B columnar ≈ 2GB. Beyond this, needs persistent backing with page-in/out — out of scope for v1; flag for v2 / Phase 14.6 collaboration.
  - **No cross-process replication in v1.** Multi-agent shared memory is Phase 8.5 territory; this DS targets per-agent local memory only.
- **Maintenance burden estimate:** ~12 fixed operator nodes with stable contracts. Code surface estimated 800–1200 LOC (factory) + 400–600 LOC (8 recipes) + ~200 LOC (FactStore columnar ops). Total ~1500–2000 LOC — comparable to `agentMemory()` + `harnessLoop()` combined.
- **Special cases that grow maintenance burden:**
  - Cross-shard cascade — if Q9 resolves "unsharded dependentsIndex", that single index node may become a write-contention hotspot at scale. v2 problem.
  - `consolidator` LLM call may fail/timeout — currently the recipe uses standard retry middleware; documented but adds one config knob.
  - Bi-temporal queries with sub-second `validFrom/validTo` precision risk clock-skew issues if `validTo` is set by a different process than `validFrom`. v1 mitigation = single-process; v2 needs distributed-clock thinking.

### Q7 — Simplify / reactive / composable + topology check

**Topology check on a minimal composition:**

```ts
const ingest = state<MemoryFragment<string>>(null);
const outcome = state<OutcomeSignal>(null);

const memory = reactiveFactStore<string>({
  ingest,
  outcome,
  extractDependencies: f => f.sources,
  scoring: derived([outcome], o =>
    (f: MemoryFragment<string>) => baseScore(f) + outcomeBonus(f, o)),
  consolidateSchedule: "0 */6 * * *",
});

memory.answer.subscribe(() => {});
memory.cascadeOverflow.subscribe(evt => alertOps(evt));
```

`describe()` (sketch):

```
ingest                       (state)
outcome                      (state)
factStore[shard0..3]         (state<FactStore>, meta.factstore)
dependentsIndex              (state<Map>, meta.factstore)
extractOp                    (derived)
invalidationDetector         (derived, meta.cycle="cascade")
cascade                      (pubsub topic)
cascadeProcessor             (derived, meta.cycle="cascade")
cascadeOverflow              (pubsub topic)
queryOp                      (derived)
answer                       (derived, meta.factstore::output)
outcomeProcessor             (derived)
consolidator                 (derived <- fromCron)
scoringPolicy                (derived <- outcome) [user-supplied]
```

`explain(ingest → answer)`: traces `ingest → extractOp → factStore[shardN] → queryOp → answer`. ✅ chain closes; no islands.

`explain(ingest_of_root_fact → answer_about_dependent)`: traces through cascade cycle — `ingest → factStore → invalidationDetector → cascade → cascadeProcessor → factStore → queryOp → answer`. ✅ cycle visible; bounded by `maxIterations` meta tag.

**Performance & memory:**
- Topology: 12 nodes constant. Subscriber fan-out per `factStore[shardN]` commit = O(direct downstream of that shard).
- Cascade per wave: O(affected facts) per recursion round, bounded by `maxIterations`. Total per cascade event: O(transitive-closure-size capped at iteration limit).
- Memory: `FactStore` columnar at ~50B/fact (compact) + `dependentsIndex` at ~24B/edge. 10⁶ facts × 5 sources/fact ≈ 50MB + 120MB = ~170MB. Well within practical limits.
- Sharding amortizes write churn: with 4 shards, average commit fan-out per write drops 4×.

**Composability:** All 4 extension faces preserve graph-reactive composition. Caller's `scoring: Node<Policy>` is a real edge; `describe()` shows it. No registry, no order ambiguity, no hidden state.

### Q8 — Alternative implementations (A/B/C/D)

- **(A) Per-fact materialization — rejected in conversation.** Every fact = a reactive node. Pros: fact-level diamond-merge at protocol layer; subscribing to specific fact is trivial. Cons: 10⁷ facts × ~150B reactive metadata = 1.5GB minimum; scheduler overload on bulk writes; spec's reactive contract pays the full per-node tax permanently. Doesn't scale to MEME's target operating point.
- **(B) Materialize / collapse via `graphRewire` — rejected in conversation.** Cold `state<FactStore>` + ephemeral subgraph expansion on query / cron. Pros: reactive cost paid only on active slice; reuses spec primitives directly. Cons: depends on Phase 13.7 M1 rewire substrate (not yet shipped TS-side); subgraph lifecycle bookkeeping is complex; expansion bounds tunable but tricky; debugging "what subgraph is currently materialized" adds inspection surface.
- **(C) Static topology + message-flow reactivity — RECOMMENDED.** 12 fixed operator nodes + columnar `state<FactStore>` + cascade via bounded message recursion + `batch()`-dedupe. Pros: no new spec dependency; no Phase 13.7 dependency; full reactive composition at all 4 extension faces; clean `describe`/`explain`; minimum maintenance surface. Cons: fact-level diamond-merge replicated at message-batch granularity (semantic equivalence, not protocol equivalence); subscribing to a specific fact requires `derived([factStore], fs => fs.get(id))` — one node per active subscription, not per stored fact.
- **(D) Pure pubsub bus + external dependency tracker — not recommended.** Flatten everything to a message bus; rely on a side-car index service. Pros: simplest mental model. Cons: loses reactive composability (downstream caller cannot `derived` over a specific fact); `describe`/`explain` coverage degrades to "events flowed through bus"; no edge-level causation tracing. Loses the differentiator that motivates the whole DS.

**Recommendation: (C).** Locked in conversation 2026-05-13.

### Q9 — Does the recommendation cover the concerns?

| Concern (from Q2/Q3/Q6) | Covered by |
|---|---|
| MEME L2 cascade accuracy | (C) — `dependentsIndex` + `cascadeProcessor.batch+dedupe` with bounded recursion |
| MEME L3 obsolescence | (C) — `validFrom/validTo` fields + `currentlyValid(asOf)` derived + `bitemporal-query` recipe |
| MEME write-time influence analysis | (C) — `dependentsIndex.get(id)` is O(1); recipe `influence-analysis.ts` exposes it |
| Hassabis REM-replay / consolidate | (C) — `consolidator` cron-fed node + self-feeding ingest loop |
| Hassabis continual learning | (C) — `scoring: Node<Policy>` driven by `outcome` topic via §1.4 push-on-update |
| Hassabis specialized-tool orchestration | (C) — per-node adapter swap (cloud planner + on-device extractor) at any pattern boundary |
| Cascade unbounded recursion | (C) — `cascadeMaxIterations=8` default + `cascadeOverflow` topic for caller alert |
| `batch()` cross-wave dedupe risk | (C) — keep cascadeProcessor synchronous; LLM steps live upstream of cascade topic; documented |
| `extractDependencies` correctness | Caller responsibility + `invalidation-tracer.ts` recipe for debugging |
| In-memory 10⁷-fact ceiling | (C) — flagged as v2 / Phase 14.6 collaboration; out of scope for v1 |
| Steeper learning curve vs. `agentMemory()` | Recipe library (8 recipes) + planned `simpleFactStore()` wrapper |
| Spec `cycle` explainability | (C) — `meta.cycle: "cascade"` on cycle nodes; `describe()` flags them |
| Sharding rebalance pain | Documented one-time decision; recipe `shard-by-tenant.ts` exemplifies |
| Cross-shard cascade lookup | Open — see Q9-open-1 below |

**Open questions requiring user call (folded from prior PART 6 Q1–Q9 list):**

| # | Question | Suggested resolution |
|---|---|---|
| Q9-open-1 | `dependentsIndex` sharding — unsharded (single source, write-contention risk) or shard-aware (multi-node, lookup-path complexity)? | **Unsharded** for v1. dependentsIndex is metadata; size ≪ factStore. Revisit if 10⁶+ edges show contention. |
| Q9-open-2 | `dependentsIndex` maintenance — synchronous (commit transaction includes index update) or asynchronous (eventual consistency)? | **Synchronous** for v1. Atomic write of `(fact, dependents)` pair. Async indexer is a v2 optimization if write throughput becomes the bottleneck. |
| Q9-open-3 | `MemoryFragment` field set — add `embedding`, `parent_fragment_id` (version chain), `provenance: string`? | **embedding YES** (recipes need it for retrieval). **parent_fragment_id YES** (consolidator emits successor fragments). **provenance string YES** (audit). Add to PART 2.3 shape. |
| Q9-open-4 | `cascadeOverflow` emission — per-message (every dropped cascade) or per-batch (one summary at cap)? | **Per-batch summary** with `{droppedCount, sample: FactId[], rootFactId}`. Per-message floods the topic in pathological cases. |
| Q9-open-5 | `scoring` policy contract — `(fragment) => number` (pure) or `(fragment, store) => number` (peer-aware)? | **`(fragment, storeReadHandle) => number`** where `storeReadHandle` is a read-only projection — enables relative scoring (e.g., "most-recent-conflicting-fact wins") without exposing mutability. |
| Q9-open-6 | Consolidator output — write to `ingest` (self-feeding) or dedicated `consolidated` topic (caller routes)? | **Dedicated `consolidated` topic** that the pattern internally wires back to `ingest` by default. Caller can intercept via `consolidated` for gating/auditing. Best of both. |
| Q9-open-7 | Query language — structured `MemoryQuery` object or function `(store) => result`? | **Both.** `query: Node<MemoryQuery>` for structured (serializable / inspectable, the default); function-shaped via caller's own `derived([factStore], fs => fs.filter(...))` — composable, no extra API. |
| Q9-open-8 | `simpleFactStore()` ergonomic wrapper — v1 or v2? | **v1.1.** Land `reactiveFactStore()` first, observe the most common configuration shape from cognitive-buddy + MEME parity spike, then back-derive the wrapper. |
| Q9-open-9 | Bi-temporal as envelope field — v1 pattern-only, or eventually `BaseChange.validFrom/validTo`? | **Pattern-only for v1.** Envelope commitment is irreversible; revisit at v2 if multiple pattern users converge on identical field shape. |

**Open questions deferred to implementation session (not lock blockers):**
- Naming: `reactiveFactStore` vs `liveKnowledgeGraph` vs `factGraph`. Prefer `reactiveFactStore` (matches `reactiveMap` / `reactiveLog` / `reactiveIndex` family).
- File placement: `patterns/ai/memory/fact-store.ts` (new) vs extending `memory-composers.ts`. Recommend new file; recipes go in `patterns/ai/memory/recipes/`.
- Initial test scope: 100-episode MEME parity harness lands in `packages/parity-tests/scenarios/`.

### Decisions locked (2026-05-13, post-9Q)

- **Architecture (Q8 alt C):** static 12-node topology + columnar `state<FactStore>` + cascade-via-message-recursion + 4 extension faces.
- **Cascade bound (§3.1):** `cascadeMaxIterations=8` default; overflow per-batch summary to `cascadeOverflow` topic (Q9-open-4).
- **Sharding (§3.2):** hash-mod 4 default; caller `shardBy` override; `dependentsIndex` unsharded for v1 (Q9-open-1).
- **MemoryFragment shape:** `{id, payload, t_ns, validFrom?, validTo?, confidence, tags, sources, embedding?, parent_fragment_id?, provenance?}` — extends PART 2.3 with the three Q9-open-3 additions. Pattern-layer only; not in spec or DS-14 envelope.
- **`dependentsIndex` updates:** synchronous, atomic with `factStore` commit (Q9-open-2).
- **Scoring contract:** `(fragment, storeReadHandle) => number` (Q9-open-5).
- **Consolidator wiring:** dedicated `consolidated` topic + default internal wire-back to `ingest`; caller can intercept (Q9-open-6).
- **Query surface:** structured `MemoryQuery` via `query` topic; function-shaped via caller-side `derived` (Q9-open-7).
- **Bi-temporal in envelope:** **DEFER to v2** (Q9-open-9). Pattern-layer only for v1.
- **`simpleFactStore()` wrapper:** **DEFER to v1.1** (Q9-open-8). Land core factory first.
- **Spec impact:** zero change. DS-14 envelope impact: extension only (`structure: "factstore"` + payload `kind: "invalidate"`), no shape change.

---

## PART 7: PROGRAM IMPACT

### 7.1 Implementation-plan placement

DS-14.7 lands in **Phase 14.5 (Roadmap residuals)** as a new subsection 14.5.x — between DS-14 changesets and Phase 15 eval. Justification: the eval program (Phase 15) needs a memory substrate to evaluate against; running MEME's 100-episode benchmark on `reactiveFactStore` is a prime Phase 15 scorecard candidate.

Estimated implementation effort post-lock: **2–3 weeks**.
- Week 1: factStore + dependentsIndex + cascade pipeline; single-shard
- Week 2: 4 extension faces wired; 3 of 8 recipes (scoring-by-outcome, consolidation-rem, bitemporal-query)
- Week 3: sharding, remaining recipes, MEME parity-test harness

### 7.2 Eval impact (Phase 15)

DS-14.7 unlocks two Phase 15 scorecard tasks:
- **MEME parity:** run all 100 episodes through `reactiveFactStore` baseline. Target: ≥40% L2 cascade accuracy (vs. 3% market baseline) without LLM-judge-at-read (i.e., without paying the 70× Claude Opus tax). If achieved, this is Wave 2's main public claim.
- **Continual-learning microbench:** measure outcome-feedback closed-loop effect on scoring policy across 10 episodes. Compare static-scoring baseline vs. `scoring-by-outcome` recipe.

### 7.3 Marketing / Wave 2 narrative

Per [SESSION-DS-14.5-A-narrative-reframe.md](SESSION-DS-14.5-A-narrative-reframe.md), Wave 2 is pain-point-first. DS-14.7 supplies the pain-point: "MEME proves no major memory system handles cascade or obsolescence — GraphReFly's reactive protocol makes this a 12-node static pattern." Blog draft target: post-lock + post-spike (gated on MEME parity number).

### 7.4 cognitive-buddy unblock

`~/src/cognitive-buddy` (Expo + on-device ExecutorChain) is the natural first consumer outside graphrefly-ts. `reactiveFactStore` + on-device LLM adapter = the substrate for a personal cognitive-augmentation app per the 2026-05-13 Hassabis-research conversation. Not on critical path; flag for after DS-14.7 v1 ships.

---

## STATUS / NEXT STEPS

**LOCKED 2026-05-13.** Architecture, invariants, MemoryFragment shape, and all Q9-open items resolved. To advance:

1. ✅ Add DS-14.7 row to [docs/implementation-plan.md](../../docs/implementation-plan.md) "Open design sessions to schedule" table.
2. ✅ Add cross-reference from [archive/docs/SESSION-agentic-memory-research.md](SESSION-agentic-memory-research.md) (Part 6 "Second Half" supersession note).
3. File `optimizations.md` entry: "DS-14.7 reactiveFactStore — substrate for MEME L2/L3 + continual learning" with back-reference to this session.
4. Spike: prototype the static topology against MEME's open-sourced episode set to validate the 3% → ≥40% claim before any public commitment. Lands in `packages/parity-tests/scenarios/meme-parity/`.
5. Await user invocation (`/dev-dispatch` or explicit "implement DS-14.7") to begin implementation.

**Originating conversation:** 2026-05-13 dialogue spanning (a) Hassabis YC research, (b) MEME paper research, (c) live-KG framing, (d) topic-bus collapse to static topology, (e) sharding + cascade-bound + extension-face decisions, (f) 9Q walk + Q9-open resolution.
