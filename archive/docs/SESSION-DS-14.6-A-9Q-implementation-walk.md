---
SESSION: DS-14.6-A-9Q-implementation-walk
DATE: 2026-05-15
TOPIC: The dedicated DS-14.6.A 9Q implementation walk deferred by SESSION-DS-14.6-A L10. Refines signatures, edge cases, and exact 4-layer slot placement for the 4 Phase-14.5 primitives — taggedContextPool / renderContextView / tierCompress, actorPool, heterogeneousDebate — plus the spawnable-vs-actorPool selection guidance (L8) and the multi-writer worked-example test (delta 4). Greenfield confirmed: none of the 4 primitives exist; substrate they compose over is all shipped.
REPO: graphrefly-ts (presentation: src/presets/* + src/utils/ai/*; substrate untouched — L9/L10 lock "no new substrate primitive")
SUPERSEDES: SESSION-DS-14.6-A PART 3 "SHAPE SKETCHES (NON-NORMATIVE)" — the normative signatures are this doc; PART 3 remains the design-intent record.
---

## CONTEXT

`SESSION-DS-14.6-A-multi-agent-context-architecture.md` locked L1–L10 (2026-05-05) but L10 explicitly deferred the 9Q walk: *"Open DS-14.6.A 9Q walk as a dedicated follow-up session before implementation; this session locks the shape but defers the 9Q."* This is that session.

**Greenfield verified** (lesson carried from DS-14.5 / DS-14-residuals where premises were stale): `taggedContextPool`/`renderContextView`/`tierCompress`/`actorPool`/`heterogeneousDebate`/`ContextEntry`/`ContextView`/`CompressionRule`/`ActorHandle` — **none exist**. Shipped substrate they compose over:

- Message envelope (`schema?`/`expiresAt?`/`correlationId?`) + topic constants (`PROMPTS_TOPIC`/`RESPONSES_TOPIC`/`INJECTIONS_TOPIC`/`DEFERRED_TOPIC`/`SPAWNS_TOPIC`) — [src/utils/messaging/message.ts](../../src/utils/messaging/message.ts)
- `materialize`/`selector` composers — [src/base/composition/materialize.ts](../../src/base/composition/materialize.ts)
- `valve.abortInFlight`, `agent()` ([src/presets/ai/agents.ts:73](../../src/presets/ai/agents.ts:73)), `AgentBundle`/`AgentGraph` ([src/utils/ai/agents/agent.ts:275](../../src/utils/ai/agents/agent.ts:275)), `spawnable()` ([src/presets/harness/spawnable.ts](../../src/presets/harness/spawnable.ts), 385 LOC)
- DS-14 changeset substrate (`mutate`/`BaseChange`/`mutationLog`/`LogChange`) — ~85% shipped per SESSION-DS-14-changeset-residuals

**Source material:** SESSION-DS-14.6-A L1–L10 + PART 3/4/6; CLAUDE.md D200 4-layer table (line 113 lists all 3 presets under `presets/`); SESSION-DS-14-changeset-residuals (D-DS14R1 prune-fidelity dependency).

---

## 9Q WALK

### Unit A — Tagged context substrate

**Q1.** `ContextEntry<T>={payload,tags,importance(0..1),compressible,topic}` — no `tier` field (L3, tier is per-view rendering target). `CompressionRule = evict | truncate{maxChars} | reference | llm-summary{toTier}`. Pool stores immutable tier-0 originals + tag index; `renderContextView` materializes a per-consumer `Node<readonly RenderedEntry<T>[]>` (L4).

**Q2/Q3.** 🟢 Schema is pure data (L10 / Rust §10.17 policy-as-data) — serializable, no closure, invariant-clean. Routing is mechanical tag comparison (zero LLM); only `llm-summary` crosses the LLM boundary (L5). 🟡 `pressure: Node<number>` re-firing the rule set on every tick risks O(n)-per-tick full re-render.

**Q5/Q6/Q7.** Pool backing (L3 "hub topic with retention") was under-specified → locked **append-only `reactiveLog` + derived tag index** (D-A4 below): tier-0 immutability is structural (append-only), `mutationLog` rides DS-14 `LogChange` for free, `poolGC` (L6) = explicit `trimHead`/`maxSize` retention policy, and it **side-steps the DS14R1 TTL/LRU prune-fidelity bug entirely** (no per-key expiry path on an append-only log). Compression cache keyed `(entry-id, target-tier)` (L5) lives **in the pool bundle** (one cache shared across all views; not per-view) — its own bound is an LRU `maxSize` on the cache map (a plain bounded map, not a reactiveMap — the cache is derived/regenerable, desync-irrelevant, so DS14R1 does not apply). Per-view render is **incremental**: the view recomputes only entries whose `(filter-pass, pressure-bucket)` changed since last wave, not the whole slice (closure-mirror over the pool log cursor — COMPOSITION-GUIDE §28 pattern).

**Q8/Q9.** `tierCompress`: **one operator**, non-LLM strategies (truncate/evict/reference — pure data) inline; LLM path gated behind an optional `llmCompressor: NodeInput<LLMAdapter>` (only `llm-*` rules invoke it; absent ⇒ `llm-summary` rules error at construction, not at runtime). Schema types live **presentation, with the preset** (D-A1).

### Unit B — `actorPool()`

**Q1/Q2.** L7: actor = identity + cursor + tool closure, **NOT a subgraph** — contrast `spawnable` which mounts a per-agent `AgentGraph` at `spawn-{req.id}/` ([spawnable.ts:142](../../src/presets/harness/spawnable.ts:142)). Locked **lightweight `ActorHandle`** (D-B1): `{ id: ActorId; context: Node<readonly RenderedEntry<unknown>[]>; todoCursor: Node<Todo | SENTINEL>; publish: (e: ContextEntry<unknown>) => void; enqueueTodo: (t: Todo) => void; status: Node<"idle"|"running"|"blocked"|"done">; release: () => void }`. PART-3 sketch's `cursor: SubscriptionGraph<Todo>` is **demoted to a cursor `Node`** (reconciles the L7 contradiction — no mounted subgraph per actor).

**Q3/Q6/Q7.** 🟢 `active: Node<ReadonlyMap<ActorId, ActorState>>` is **a single reactive-map node**, not N mounted subgraphs — `describe()` shows pool/todo/hub collections only; actor count drifts inside the map node (honors L7). `depthCap` + `spawnNewActor`: depth is carried **in the SpawnRequest envelope** (`{ depth: number }`) and gated reactively at the spawn-handler (a `derived` over depth vs cap), never an imperative counter. Cascade-cancel on parent `release()` is free via subscription teardown (§3i). Reuses `spawnable`'s `depthCap`/`from`/`validate` opt vocabulary for cross-preset consistency.

**Q8/Q9.** File co-located in `src/presets/harness/` (alongside `spawnable.ts`; new `actor-pool.ts`) per L8. Adds two topic-name conventions to `src/utils/messaging/message.ts`: `CONTEXT_TOPIC = "context"`, `TODOS_TOPIC = "todos"` (mirrors the existing `*_TOPIC` constant convention).

### Unit C — `heterogeneousDebate()`

**Q1/Q2.** L9: pure composition over `agent()` + `topic` + `derived` — **no new substrate**. Participants = `{ adapter: NodeInput<LLMAdapter>; role: string; systemPrompt: string }[]` (different adapters + role prompts = Stanford MAD heterogeneity thesis). Closed reasoning loop (no tools/side-effects/persistent state beyond transcript) ⇒ small state space.

**Q3/Q6.** 🟢 Termination `fixedRounds | "until-converge" | { until: Node<boolean> }`. `until-converge` detector locked **pluggable, default = last-N-rounds-stable** (D-C1): `converge?: (transcript: Turn[]) => boolean`; default = no participant changed its stance across the last 2 rounds (structural/string compare on each participant's latest turn) — zero extra LLM cost by default. 🟡 Edge: `output: "synthesizer-final"` with no participant whose `role` is a synthesizer ⇒ **construction-time throw** (not silent fallback).

**Q8/Q9.** Placement `src/presets/ai/debate/` (DS-14.6.A's `patterns/ai/debate/` rebased to the 4-layer model; CLAUDE.md lists `heterogeneousDebate` under `presets/`). `class DebateGraph extends Graph`; returns `{ transcript: Node<readonly Turn[]>; result: Node<unknown>; status: Node<"running"|"converged"|"max-rounds"|"error">; graph: DebateGraph }`.

### Cross-cutting

Delta 4 — multi-writer worked-example **lock-test**: concurrent subgraphs each owning a different pool segment (L2 subgraph-level isolation) + two `renderContextView`s at different tiers over the same entry (L4 per-view) + assert the `(entry-id, target-tier)` cache yields one LLM call shared across both views (L5). Lands with Unit A+B. L8 selection guidance (spawnable static / actorPool dynamic) → one new COMPOSITION-GUIDE-PATTERNS section (doc, not code).

---

## DECISIONS LOCKED (2026-05-15)

### User-locked (high-leverage)

| ID | Decision | Rationale | Affects |
|---|---|---|---|
| **D-A1** | Tagged-context schema types (`ContextEntry`/`ContextView`/`CompressionRule`/`RenderedEntry`/`RuleMatch`) live **presentation, with the preset** (`src/presets/ai/context/` or `src/utils/ai/context/` if shared by actorPool). NOT `@graphrefly/pure-ts`. | D193: substrate = symbols graph/operators consume; none in pure-ts consume these. Matches DS-14.5 binding-side posture. Rust re-declares the data shape on consumer pressure (same as DS-14 BaseChange Rust-alignment note). | new `src/{presets,utils}/ai/context/` |
| **D-A4** | Pool = **append-only `reactiveLog` + derived tag index**. Retention/`poolGC` = `reactiveLog` `maxSize`/`trimHead`. Mutations ride DS-14 `LogChange`. | Append-only = structural tier-0 immutability (L3); free `mutationLog`; **side-steps the DS14R1 prune-fidelity bug entirely** (no per-key TTL/LRU path). | Unit-A impl |
| **D-B1** | actorPool actor = **lightweight `ActorHandle`, no per-actor subgraph**. PART-3 `cursor: SubscriptionGraph` demoted to a cursor `Node`. `active` = one reactive-map node. | Honors L7 ("not a subgraph"; topology = pool/todo/hub only); preserves the actorPool-vs-spawnable distinction (describe() does NOT show N drifting subgraphs). | Unit-B impl |
| **D-C1** | `until-converge` = **pluggable `converge?` fn, default = last-2-rounds-stable** (structural compare, zero extra LLM cost). | Cheap sensible default; users supply embedding/LLM-judge detector when needed. | Unit-C impl |

### Locked by recommendation (flag for veto — non-contentious, best-option)

| ID | Decision |
|---|---|
| **D-A2** | Per-view render is **incremental** (closure-mirror over the pool-log cursor, COMPOSITION-GUIDE §28) — recompute only entries whose `(filter-pass, pressure-bucket)` changed, not the whole slice. Avoids O(n)-per-pressure-tick. |
| **D-A3** | **One `tierCompress` operator**; truncate/evict/reference inline (pure data); LLM path behind optional `llmCompressor: NodeInput<LLMAdapter>`; `llm-summary` rule with no `llmCompressor` ⇒ construction throw. |
| **D-A5** | Compression cache (`(entry-id,target-tier)`) lives **in the pool bundle, one shared cache**, bounded by a plain LRU `maxSize` map (regenerable ⇒ DS14R1 desync-irrelevant). |
| **D-B2** | `depthCap` enforced reactively via depth carried in the SpawnRequest envelope + a `derived` gate; cascade-cancel on `release()` via subscription teardown (§3i). Reuses spawnable's `depthCap`/`from`/`validate` opt vocabulary. |
| **D-B3** | Two new topic constants in `message.ts`: `CONTEXT_TOPIC="context"`, `TODOS_TOPIC="todos"` (existing `*_TOPIC` convention). |
| **D-C2** | `output:"synthesizer-final"` with no synthesizer-role participant ⇒ construction-time throw (no silent fallback). |
| **D-C3** | Placements per CLAUDE.md D200: `src/presets/ai/context/` (taggedContextPool/renderContextView/tierCompress), `src/presets/harness/actor-pool.ts` (co-located w/ spawnable), `src/presets/ai/debate/` (heterogeneousDebate). |
| **D-X1** | L8 spawnable-vs-actorPool selection guidance = one new COMPOSITION-GUIDE-PATTERNS section (doc only). Delta-4 multi-writer lock-test lands with Unit A+B. |

---

## IMPLEMENTATION PHASING (gated on explicit user "implement" — `feedback_no_implement_without_approval`)

Per SESSION-DS-14.6-A PART 4 sequencing `(1)→(2)→(3,4,5) parallel→(6)`; (1) = this doc (done).

1. **DS14.6A-U-A — tagged context (~2.5 days).** Schema types (D-A1); `taggedContextPool` (reactiveLog + tag index, D-A4); `tierCompress` op (D-A3/A5); `renderContextView` (incremental, D-A2); `poolGC`. Tests incl. cross-view cache-hit.
2. **DS14.6A-U-B — actorPool (~2.5 days).** `ActorHandle` (D-B1); `actorPool()` in `presets/harness/actor-pool.ts`; `CONTEXT_TOPIC`/`TODOS_TOPIC` (D-B3); reactive depth gate + cascade-cancel (D-B2). Depends on U-A.
3. **DS14.6A-U-C — heterogeneousDebate (~2 days).** `presets/ai/debate/`; participants/rounds/output; pluggable converge (D-C1); synthesizer-final guard (D-C2). Independent of U-A/U-B (parallelizable).
4. **DS14.6A-X — delta 4 multi-writer lock-test + L8 COMPOSITION-GUIDE-PATTERNS selection section (~1 day).** After U-A+U-B.

Total ~8 days. Wave-2 launch copy (PART-4 delta 6) stays Phase 16, gated on U-A/B/C + lock-test.

## RUST-PORT ALIGNMENT

**Zero new substrate** (L9/L10; D-A1/D-B1 keep everything presentation). The Rust port is unaffected: tagged context is hub+reactiveLog+materialize composition, all of which are existing substrate the M-port already targets. The schema types are pure data — when/if a Rust consumer surfaces they re-declare the shape (same posture as DS-14 BaseChange). L2's "mechanical conflicts impossible by Rust core construction" claim (per-subgraph mutex + atomic version) is the *justification* for D-A4/D-B1 minimalism, not a Rust deliverable here.

## FILES CHANGED (this session — documentation only)

- **New:** `archive/docs/SESSION-DS-14.6-A-9Q-implementation-walk.md` (this file)
- **Edit:** `docs/optimizations.md` — Active-work entry for DS14.6A-U-A/B/C/X
- **Edit:** `archive/docs/design-archive-index.jsonl` — append index entry
- **Deferred to implementation phases:** `src/presets/ai/context/*`, `src/presets/harness/actor-pool.ts`, `src/presets/ai/debate/*`, `src/utils/messaging/message.ts` (+2 topic constants), COMPOSITION-GUIDE-PATTERNS selection section, multi-writer lock-test

### Verification snapshot
- **✅ IMPLEMENTED + QA-passed 2026-05-15.** U-A/B/C/X landed. QA fixes applied: **M1→(b)** — `heterogeneousDebate` redesigned as reactive topology (refineLoop §7 feedback shape: `roundTrigger`→`switchMap` producer→`transcript`→`converged`→`decideEffect` feedback edge; describe-visible; abort-on-deactivate per-round; `_running` re-entrancy guard; `{until}` is a real reactive dep) — supersedes the original PART-4 procedural `run()`. P1 poolGC `topic`=scope (was OR match-to-evict, data-loss). P2 `t_ns`→`wallClockNs()`. P5 per-pool/per-actor counters + nested `(id,tier)` cache. P6 collision-safe default mount names. P7 `actorPool.dispose()` releases outstanding handles. P11 doc-notes. Gates: pure-ts 1172/1172, root presets/ai/composition 654/654, biome-clean.
