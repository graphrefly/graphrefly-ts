# Unified Implementation Plan — pre-1.0

**Date:** 2026-04-27 · **Last updated:** 2026-04-27 (post Sessions A + B)
**Sources:** `archive/docs/SESSION-ai-harness-module-review.md`, `archive/docs/SESSION-public-face-blocks-review.md`, `archive/docs/SESSION-patterns-extras-consolidation-plan.md`, `docs/optimizations.md`, this-chat Session A + Session B 9-question design rounds
**Excludes:** eval creation/refactoring, Python parity, explicit post-1.0 items

Items below are sorted **most foundational + most impactful at the top → least foundational + least impactful at the bottom.** "Foundational" = many later items rebase on its outcome.

---

## Design sessions completed

| Session | Scope | Units | Status |
|---|---|---|---|
| A | Three-layer view + changeset stream + extractFn contract | A.1 (describe topology) · A.2 (observe data) · A.3 (functions) · A.4 (tiers filter + LensGraph fate) · A.5 (distill extractFn) | ✅ locked |
| B | GATE / hub topology | B.1 (foreign-node-accept canonical) · B.2 (hub criterion) · B.3 (named-node placement) | ✅ locked |
| C | promptNode switchMap sentinel handling | TBD — small scope (lock path (b) `producer` over `fromAny→derived`) | ⏳ pending |

Full session logs in chat history. Locks summarized inline at each tier they unblock.

---

## Tier 1 — Remaining foundational design

### 1.1 §1.4 spec amendment (INVALIDATE-at-diamond coalescing)
- **Source:** optimizations.md (2026-04-23)
- **What:** Update `~/src/graphrefly/GRAPHREFLY-SPEC.md` §1.4 to formalize the runtime's coalescing guarantee.
- **Why:** Spec is the behavior authority. Pure doc edit.
- **Blocked by:** doc edit only.

### 1.2 Session C — `promptNode` switchMap sentinel handling
- **Source:** AI/harness audit Unit 1 (BLOCKED)
- **What:** Lock path for `promptNode` rewrite. Two viable paths from audit: (a) `filter(v != null) / distinctUntilChanged` guard inside switchMap inner, (b) `producer` instead of `fromAny → derived` so response node emits once per wave. Audit recommends (b) — matches HarnessExecutor's "one emission per wave" contract.
- **Why:** Unblocks Tier 6.6 promptNode rewrite (currently reverted; harness retry/queue-depth tests regress).
- **Blocked by:** small design session — likely 15-min "confirm path (b) and validate against `harness.test.ts`". Should run AFTER Session B's harness reshape lands so the executor boundary is final.

---

## Tier 1.5 — Graph-module API additions (locked via Session A)

These extend the public surface of `Graph`. Land before Tier 5 (Wave B blocks consume them) and ideally before Tier 2 reorg lands so the consolidation diffs cover the new entry points.

### 1.5.1 `describe` topology layer (Session A.1 lock)
- **Add reactive diff variant:** `describe({ reactive: "diff" }): ReactiveDescribeHandle<DescribeChangeset>`. Snapshot variant (`reactive: true`) unchanged.
- **Drop `format` option from `describe`:** describe outputs spec only. Renderers move to `extra/render/` (see 2.1).
- **Diff envelope:**
  ```ts
  type DescribeChangeset = { events: ReadonlyArray<DescribeEvent>; flushedAt_ns: number };
  type DescribeEvent =
    | { type: "node-added";        path: string; node: DescribeNodeOutput }
    | { type: "node-removed";      path: string }
    | { type: "node-meta-changed"; path: string; prevMeta: Meta; nextMeta: Meta }
    | { type: "edge-added";        from: string; to: string }
    | { type: "edge-removed";      from: string; to: string }
    | { type: "subgraph-mounted";  path: string }
    | { type: "subgraph-unmounted"; path: string };
  ```
  No overlap with `ObserveEvent`. Topology-only.
- **Internal helper:** `topologyDiff(prev: GraphDescribeOutput, next: GraphDescribeOutput): DescribeChangeset` — pure function, used by `describe({ reactive: "diff" })` internally; re-exported from `extra/composition/topology-diff.ts` for static-snapshot diffing.

### 1.5.2 `observe` data layer (Session A.2 + A.4 lock)
- **Add reactive variant:** `observe({ reactive: true }): Node<ObserveChangeset>` and the all-paths overload. Coalesced via `registerBatchFlushHook` (same mechanism as `describe({ reactive: true })`).
- **Envelope:**
  ```ts
  type ObserveChangeset = { events: ReadonlyArray<ObserveEvent>; flushedAt_ns: number };
  ```
  Each event already carries `event.path`. One DATA wave per batch flush.
- **Add `tiers` option:** `ObserveOptions.tiers?: readonly ObserveTier[]` (default = all). Applies to both callback and reactive variants.
- **Callback API unchanged.**

### 1.5.3 `GraphSpec ≡ GraphDescribeOutput` unification (Session A.1 lock)
- Spec and describe collapse into a single canonical JSON shape. `GraphSpec` becomes a structural alias of `GraphDescribeOutput`; `decompileSpec(g) === describe(g, { detail: "spec" })`.
- **Factory self-tagging:** factories register `factory + factoryArgs` via meta at construction time (or via a dedicated registration helper). Catalog automation (memory `project_catalog_automation.md`) shapes most of this.
- **`compileSpec` reads** from `meta.factory` + `meta.factoryArgs`, looks up the catalog, recreates.
- **New detail level** `detail: "spec"` projects spec-relevant fields (factory, factoryArgs, name, deps, meta) and strips runtime fields (status, value, lastMutation, guard).
- **Audit C24-2 obsolete** — decompile is no longer approximate.

### 1.5.4 distill `extractFn` reactive form (Session A.5 lock)
- **New signature:** `extractFn: (raw: Node<TRaw>, existing: Node<ReadonlyMap<string, TMem>>) => NodeInput<Extraction<TMem>>`. One-shot wire at distill time; no internal switchMap.
- **No callback overload** — single shape (pre-1.0, no backwards-compat).
- **Migrate consumers:** [agent-memory.ts:228](src/patterns/ai/memory/agent-memory.ts:228) (Wave AM AM.3), upcoming `llmExtractor` / `llmConsolidator` (Wave AM AM.0).
- **COMPOSITION-GUIDE recipe:** "For cancel-on-new-input semantics, wrap with `switchMap` inside `extractFn`."

### 1.5.5 Functions-layer convention (Session A.3 lock)
- Doc-only. COMPOSITION-GUIDE adds: "Functions are non-serializable. Callers wanting fn identity put it in node `meta` (e.g., `meta.fnId('extractor::v1')`). `describe()` surfaces it via `meta`."

---

## Tier 2 — Structural reorganization

### 2.1 Consolidation Phase 1 — `extra/` folder split + renderer extraction
- **From consolidation plan §"Phase 1":** Mechanical codemod splitting `operators.ts`, `sources.ts`, `adapters.ts`, `resilience.ts` into folder structures (`operators/`, `sources/`, `io/`, `resilience/`, `data-structures/`, `storage/`, `composition/`).
- **From Session A.1:** Extract describe formatters into `extra/render/` as pure functions over `GraphDescribeOutput`:
  - `toMermaid`, `toMermaidUrl`, `toAscii`, `toD2`, `toPretty`.
  - Drop `format` option from `describe` API; consumers compose `describe → derived(toMermaid)` for live formatted output.
- No renames, no behavior change. `assertBrowserSafeBundles` guardrail still applies.

### 2.2 Consolidation Phase 2 — promotions to `extra/`
- Promote `lightMutation`, `wrapMutation`, `BaseAuditRecord`, `createAuditLog`, `tryIncrementBounded` → `extra/mutation/`.
- Promote `domainMeta`, `keepalive` → `extra/meta.ts`.
- Promote `decay` → `extra/utils/decay.ts`.
- Promote `budgetGate` → `extra/resilience/`.
- **Blocked by:** Phase 1.

### 2.3 Consolidation Phase 3 — pre-1.0 renames
- `gate` → `approvalGate` (orchestration), `policyEnforcer` → `policyGate`.
- Delete `lightCollection` (fold into `collection({ ranked: false })`), delete `fromLLM` (fold into `promptNode` with options).
- Demote `effectivenessTracker` to harness preset.
- **Blocked by:** Phase 1+2.

---

## Tier 3 — Audit prerequisites for Wave B (D.2 cluster)

All five LOCKED in public-face audit §F. Independently scoped; can run in parallel.

### 3.1 D.2.3a — supervisors cluster (`retry`, `circuitBreaker`, `timeout`, `fallback`)
- Unbounded-retry footgun fix: require explicit `count` when `backoff` set.
- Source/factory-mode dedup: extract shared ~110 LOC closure-state machinery.
- JSDoc on clock injection contract, `Math.max(1, delayNs)` minimum, state telemetry.
- **Unblocks:** Unit 7 `resilientPipeline` rebuild.

### 3.2 D.2.3b — throttles & status cluster (`rateLimiter`, `tokenBucket`, `withStatus`)
- Bounded `maxBuffer` on `rateLimiter` (require explicit value or opt-in `Infinity`).
- RingBuffer for pending queue (cross-shared with D.2.4 budgetGate fix).
- `droppedCount` reactive companion on `rateLimiter`.
- `tokenBucket(capacity, refill)` clock injection for testability.
- JSDoc on `tokenBucket.tokens` float behavior, producer-pattern visibility, lifecycle.
- **Unblocks:** Unit 7 `resilientPipeline` rebuild.

### 3.3 D.2.4 — `budgetGate`
- RingBuffer / head-index queue replacing `buffer.slice(1)` O(N²).
- Terminal force-flush + PAUSE-release ordering audit (already correct → document as invariant).
- JSDoc on `node([], fn)` producer-pattern (source invisible to describe-traversal).
- Empty-deps `RangeError` documented + tested.
- Reference-equality diff for buffer dedup + constraint-array/option-array shapes.
- **Note:** reactive `constraints` is dropped (Architecture-2: compositor-only).
- **Unblocks:** Unit 7 `resilientPipeline` rebuild.

### 3.4 D.2.1 — `policyEnforcer` (renamed `policyGate` per 2.3)
- Reactive `paths: readonly string[] | Node<readonly string[]>` (per F.9 carve-out).
- Drop reactive `violationsLimit` (deferred — needs TopicGraph reactive `retainedLimit`).
- **Unblocks:** Unit 6 `guardedExecution` rebuild.

### 3.5 D.2.2 — `reactiveExplainPath`
- Reactive `from` / `to` / `maxDepth` / `findCycle` opts (inline-pattern → reactive on primitive per F.9).
- File path-scoped observe deferred (whole-graph observe is a perf gap, not a spec violation).
- **Unblocks:** Unit 8 `graphLens` rebuild.

---

## Tier 4 — Wave A + Wave AM memory primitive rebuilds

High-impact: memory is one of the public-face blocks. All LOCKED in public-face audit §F.

### 4.1 Wave A Unit 1 — `decay` utility
Cross-language parity decision (export vs inline). Pure 12-LOC function; lands as `extra/utils/decay.ts` per Tier 2.2.

### 4.2 Wave A Unit 2 — `collection` (folds in old `lightCollection`)
`collection({ ranked: false })` is the "light" mode per consolidation Rule 4. Adopt `lightMutation` + audit log surface.

### 4.3 Wave A Units 3–5 — `vectorIndex`, `knowledgeGraph`, full `collection`
Each adopts `lightMutation` + audit log. Distinct index types stay separate per consolidation Rule 4.

### 4.4 Wave AM Unit 1 — `tiers.ts`
Extract decay constant to `patterns/_internal/decay.ts`. Carry: delete `extractStoreMap` once Unit 5 narrows upstream type.

### 4.5 Wave AM Unit 3 — `retrieval.ts` rename ripple
`pathOf` / `pathWeight` / `query.path` / `entry.path` rename. Unit 6 (`agent-memory.ts`) ripple deferred to natural follow-up.

### 4.6 Wave AM Unit 4 — `llm-memory.ts` → `prompt-call.ts`
Promote `llmJsonCall` → public `promptCall` at `src/patterns/ai/prompts/prompt-call.ts`. Migrate to reactive `extractFn` per Tier 1.5.4.

### 4.7 Wave AM Unit 5 — `memory-composers.ts`
Apply Unit 1/3 carries (type narrowing, renames). Delete `extractStoreMap`. Migrate distill consumers to reactive `extractFn` (Tier 1.5.4).

---

## Tier 5 — Wave B public-face block rebuilds

Three of the six public-face blocks. Each gates a high-visibility README claim.

### 5.1 Unit 6 — `guardedExecution`
Leverage `graph.describe({ reactive: true })` via `actor: Actor | Node<Actor>` core widening (already shipped). `scopedDescribeNode` becomes 3-line delegation.
**Depends on:** Tier 3.4 (D.2.1 policyGate), Tier 2.3 (`policyEnforcer` → `policyGate` rename).

### 5.2 Unit 7 — `resilientPipeline`
Compositor-level reactive options only (switchMap-pattern rebuild per layer). Per-layer companions (status, error, breakerState) already shipped.
**Depends on:** Tier 3.1, 3.2, 3.3.

### 5.3 Unit 8 — graphLens reshape (smaller scope per Session A.4 lock)
- **Delete `LensGraph` class** entirely. It's just describe + observe with a HealthReport aggregation; no protocol-level concept needed.
- **Ship `graphLens(target)` as a thin preset (~30 LOC)** in `patterns/inspect/presets.ts`:
  ```ts
  function graphLens(target: Graph) {
    const topology = target.describe({ reactive: true });
    const failures = target.observe({ reactive: true, tiers: ["error", "complete", "teardown"] });
    const dataFlow = target.observe({ reactive: true, tiers: ["data"] });
    const health = derived([topology, failures], computeHealthReport, { equals: healthReportEqual });
    const flow = derived([dataFlow], updateFlowMap);
    return { topology, health, flow };
  }
  ```
- Update `~/src/graphrefly_github/profile/README.md` "6 vision blocks" — `graphLens` is a preset, not a Graph class.
**Depends on:** Tier 1.5.1 (describe-diff/snapshot), Tier 1.5.2 (observe-reactive + tiers), Tier 3.5 (D.2.2 reactiveExplainPath).

---

## Tier 6 — Harness composition

### 6.1 Unit 16 — Stratify → Hub + TopicBridgeGraph (Session B.1 + B.2 lock)
`HarnessGraph.queues` becomes `MessagingHubGraph` directly; routing is data (topic name), not code. Closes queue-topic islands.
- **Builds on B.1:** foreign-node-accept canonical for gate ↔ hub composition; mount-when-you-own / consume-via-foreign-node-accept rule documented in COMPOSITION-GUIDE.
- **Builds on B.2:** harness qualifies under hub criterion (≥2 TopicGraphs sharing lifecycle + cross-topic routing).

### 6.2 Unit 17 — GATE stage reshape + `gate()` primitive shape (Session B.1 lock)
Solidifies composable gate semantics; unblocks Unit 2 gatedStream's three skipped tests.
- **Builds on B.1:** gate consumes `topic.latest` via foreign-node-accept; no `gateGraph.mount` of foreign topics.

### 6.3 Unit 20 — Named nodes (Session B.3 lock)
Add to [loop.ts:805-813](src/patterns/harness/loop.ts:805) registration block:
```ts
harness.add(triageInput, { name: "triage-input" });
harness.add(routerInput, { name: "router-input" });   // pending Unit 16 confirmation
```
If Unit 16 folds routing into a hub-internal effect, `routerInput` disappears and the effect node gets `{ name: "router" }` instead.
- **Add regression test:** `graph.explain(intake.latest, reflectNode)` returns chain with no `<anonymous>` entries.
- **Verify** `${route}/gate` names already registered via gate factory.

### 6.4 Unit 18b — `fastRetry` extraction + 3 correctness fixes
(a) source/severity on reingestion, (b) null-execRaw guard before assembly, (c) `errorClassifier` outcome handling.
**Depends on:** Tier 6.1, 6.2.

### 6.5 JobFlow claim/ack/nack for EXECUTE
Wire JobFlow operations for EXECUTE stage coordination. Full job lifecycle traceability.
**Depends on:** Tier 6.1.

### 6.6 Unit 1 — `promptNode` rewrite
C+D scope: remove `retries`/`cache` options, use `fromAny` bridge, surface `prompt_node::response` as named intermediate, add `meta.aiMeta("prompt_node::output")`, fix system-prompt double-send, add `abort?: Node<boolean>`.
**Depends on:** Tier 1.2 (Session C — confirm path (b) producer-based).

### 6.7 Unit 2 — `gatedStream` timing (3 skipped tests)
Un-skip and fix.
**Depends on:** Tier 6.2.

---

## Tier 7 — AI module ergonomics

### 7.1 Unit 14 — `firstDataFromNode` migration + Unit 6 `executeReactive`
Ship `executeReactive(name, args) → Node<unknown>` on `ToolRegistry` alongside imperative `execute()`. Migrate `toolExecution` to consume it. `resolveToolHandlerResult` retains `firstDataFromNode` as sanctioned boundary bridge.

### 7.2 C24-7 — Reactive spec/strategy variants
`graphFromSpecReactive(input, adapter) → Node<Graph>` and `suggestStrategyReactive(graph, problem, adapter) → Node<StrategyPlan>`.
**Depends on:** Tier 7.1 (shared boundary shape), Tier 1.5.3 (unified GraphSpec shape).

### 7.3 Unit 12 — Google SDK swap
`@google/generative-ai` → `@google/genai` in `src/patterns/ai/adapters/providers/google.ts`. Shape-difference audit before swap.

### 7.4 C24-1 — `compileSpec` `opts.onMissing` mode
Add `opts.onMissing?: "error" | "warn" | "placeholder"` (default `"placeholder"`) for explicit missing-catalog-entry surface. Composes with Tier 1.5.3 unified shape.

---

## Tier 8 — Wave C cross-pattern mutation framework migration

10–12 sites consuming the now-promoted `extra/mutation/` framework. **Highest-value site flagged: cqrs/dispatch (multi-step + rollback via `wrapMutation`).**

| # | Site | Tool | Notes |
|---|---|---|---|
| 1 | `messaging/Topic.publish` | `lightMutation` | + NEW audit log surface |
| 2 | `messaging/Subscription.ack` | `lightMutation` | + NEW audit log surface |
| 3 | `messaging/Subscription.take` | `lightMutation` | shared audit log |
| 4 | `messaging/Hub.delete` | `lightMutation` | + NEW audit log surface |
| 5 | `cqrs/dispatch` | `wrapMutation` | **HIGHEST VALUE** |
| 6 | `cqrs/saga` | `wrapMutation` | per-event handler |
| 7 | `process/start` | `wrapMutation` | lifecycle |
| 8 | `process/cancel` | `wrapMutation` | |
| 9 | `job-queue/enqueue` | `lightMutation` | |
| 10 | `job-queue/ack` | `lightMutation` | |
| 11 | `job-queue/nack` | `lightMutation` | |
| 12 | `job-queue/removeById` | `lightMutation` | ride-along |

**Depends on:** Tier 2.2 (mutation framework promoted), Tier 4 + 5 (proof-of-concept established).

---

## Tier 9 — Consolidation finishing (Phases 4–5)

### 9.1 Phase 4 — presets split
For each pattern domain create `presets.ts` alongside `index.ts`. Move opinionated compositions per consolidation plan §"Building blocks vs presets inventory":
- `ai`: `agentMemory()`, `agentLoop()`, `resilientPipeline()`
- `harness`: `harnessLoop()`, `refineLoop()`
- `inspect`: `inspect()`, `guardedExecution()`, `graphLens()` (per Tier 5.3)

### 9.2 Phase 5 — `classifyError` (only when caller surfaces)
`classifyError(source, classifierFn) → { routes: Record<string, Node<T>> }` in `extra/resilience/`. Defer until a real consumer needs it.

### 9.3 Topology check as shipped utility
`validateNoIslands(graph)` companion to `validateGraphObservability` for user validation.

---

## Tier 10 — Polish, follow-ups, low-priority

### 10.1 `mapFromSnapshot` / `extractStoreMap` cleanup
Two identical helpers at `memory-composers.ts:42` and `composite.ts:141`. Delete after Tier 1.5.4 (distill reactive extractFn lands).

### 10.2 `diffMap<K, V>` operator extraction
Wait for third consumer; YAGNI today.

### 10.3 Harness executor/verifier dev-mode sanity check
Assert ≤1 DATA per input wave in dev mode.

### 10.4 JSDoc additions
- C23-2: `Evaluator<T>` JSDoc on `candidateIndex` semantics.
- C24-3: `validateSpec` effect-node feedback warning.
- C24-4: `runReduction` sync-settle deferred-unsubscribe ordering invariant.
- (C24-2 obsolete — `decompileGraph` fingerprinting caveat resolved by Tier 1.5.3 spec unification.)

### 10.5 Operator-layer `filter` mixed-batch RESOLVED forwarding
Filter drops RESOLVED for failed batch entries → tier-3 counter drift. Low priority; no current consumer affected.
**Blocked by:** operator-layer-wide review session (deferred).

### 10.6 `restoreSnapshot` rejects `mode: "diff"` records
**Blocked by:** §8.7 WAL replay (prerequisite for diff replay).

### 10.7 Performance follow-ups
- Message-array allocation in hot path (A2 landed; tier-3 DATA/ERROR has further headroom).
- Fan-out scaling — sink notification overhead (profiling harness at `src/__bench__/fanout-profile.ts`); ongoing measurement.

### 10.8 Design follow-ups (deferred — file in optimizations.md when re-opened)
- `graphLens` 50k-node scaling (incremental delta stats vs full describe-per-tick).
- `graphLens.health` V2 (`completed` / `disconnected` flag classes; aggregate metrics).
- `lens.flow` delta companion.
- TopicGraph reactive `retainedLimit` (unblocks reactive `violationsLimit` on `policyGate`).
- `reactiveExplainPath` file-path-scoped observe (composes with Tier 1.5.2 `tiers` filter — natural follow-on for `pathScope` opt).
- End-of-batch `_handleBudgetMessage` boolean-return / forward-unknown audit across producer-pattern factories.
- `withStatus` decomposition (alternative (e)).
- `refineLoop` persistent re-seed / reset surface (awaits real-world demand).

---

## Critical sequencing

```
Tier 1.1 spec amendment ─────────┐ (doc-only, anytime)
Tier 1.2 Session C (small)  ─────┤
                                 ├──→ Tier 1.5 Graph API additions ──→ Tier 5 Wave B blocks
Tier 1.5.4 distill reactive ─────┤                              \
                                 │                               └──→ Tier 7 AI ergonomics
                                 ├──→ Tier 2 reorg ─────→ Tier 3 audits ──→ Tier 5 (cont.)
                                 │
                                 └──→ Tier 4 Wave A/AM memory ──→ Tier 8 Wave C
                                                                  \
Sessions A + B locks ──→ Tier 6 harness composition ──────────────┘

Tier 9 consolidation finishing — after Tiers 4/5/6 prove patterns
Tier 10 — anytime; low priority
```

**Critical path:** Tier 1.5 (graph-module API additions) → Tier 2 (mechanical reorg) → Tier 3 (parallel audits) → Tier 4+5 (parallel) → Tier 6 → Tier 8 → Tier 9.

**Recommended kickoff order:**
1. Land Tier 1.1 spec amendment (doc-only).
2. Run Session C (Tier 1.2) — short, can happen alongside other work.
3. Implement Tier 1.5.1 + 1.5.2 (describe-diff, observe-reactive, tiers filter) — they unblock Tier 5.3 graphLens preset.
4. Implement Tier 1.5.3 (GraphSpec ≡ GraphDescribeOutput) — touches factories; do early so later code writes to the unified shape.
5. Land Tier 2.1 reorg (mechanical split + renderer extraction).
6. Branch off Tier 3 audits in parallel with Tier 2.2 + 2.3.
7. Pick up Tier 4 + 5 once 2.2 is in.
8. Tier 6 harness composition once Sessions A+B locks have implementation room (post Tier 1.5 + Tier 5).
