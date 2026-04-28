# Unified Implementation Plan — pre-1.0

**Date:** 2026-04-27 · **Last updated:** 2026-04-28 (post Tier 9.1 /qa retrospective)
**Sources:** `archive/docs/SESSION-ai-harness-module-review.md`, `archive/docs/SESSION-public-face-blocks-review.md`, `archive/docs/SESSION-patterns-extras-consolidation-plan.md`, `docs/optimizations.md`, this-chat Session A + Session B 9-question design rounds
**Excludes:** eval creation/refactoring, Python parity, explicit post-1.0 items

Items below are sorted **most foundational + most impactful at the top → least foundational + least impactful at the bottom.** "Foundational" = many later items rebase on its outcome.

---

## Deviations from plan (recorded 2026-04-28)

The Tier 8 and Tier 9.1 batches departed from the original plan text in several places. Each is recorded below for posterity. The categories follow the format the /qa retrospective uses (A = approved during planning, B = implementation slip caught by /qa, C = forced collision-resolution).

### A — Approved during planning via 9-question lock
- **A1 — γ-0 framework change (`MutationOpts.audit?` optional).** Plan §Tier 8 originally required new audit log surfaces on Cluster II messaging sites. γ-0 collapsed that requirement. Final: messaging sites route through `lightMutation` with `audit` omitted. ✅ Legitimate (cognitive-load reduction, two-layer separation preserved).
- **A2 — `cqrs.saga` uses `lightMutation`, not `wrapMutation`.** Plan §Tier 8 row 6 said `wrapMutation`. Final: `lightMutation`. Rationale: per-event batch frames would change saga's wave timing; `errorPolicy: "advance"` is the canonical rollback model already.
- **A3 — `process/start` + `process/cancel` deferred entirely.** Plan §Tier 8 rows 7–8 said `wrapMutation`. Final: γ-7-B (lightMutation-wrap `appendRecord` only; full `wrapMutation` migration deferred to optimizations.md). Rationale: wrapMutation would silently change failure semantics (synthetic-event-emit error → "failed start"); pre-1.0 break warrants a deliberate consumer-driven decision.
- **A4 — `resilientPipeline` lives in `extra/resilience/`, not `ai/presets/`.** Consolidation plan classified it as ai preset; final γ-R-2 places it semantically with the resilience family. Reach via `@graphrefly/graphrefly/extra`. Rationale: not AI-specific; foreshadows Tier 9.2 `classifyError` neighbor.
- **A5 — `inspect()` Q5-6 medium scope.** Consolidation plan said `inspect()` composes `explainPath + auditTrail + health + flow + why + policyGate`. Final ships medium: `lens + auditTrail + explainTarget + complianceSnapshot()`, no `policyGate`. Rationale: `policyGate` is control-plane (denies/audits writes), conceptually distinct from observation; bundling would conflate inspection with enforcement.

(A had 6 entries in an earlier draft of this section — the `EvalResult` → `EvalRunResult` rename was mistakenly listed as A6. It was discovered mid-implementation via a DTS build error, NOT during planning, so it belongs solely in C. Removed from A; recorded only as C1 below.)

### B — Implementation slips caught and corrected by /qa (2026-04-28 Tier 9.1 pass)
- **B1 — Lens nodes initially `add()`ed directly to InspectGraph** (TEARDOWN broadcast through `_nodes` invalidated externally-held lens subscriptions); JSDoc claimed otherwise. **Corrected** via D1: lens lives in a child `LensSubgraph` mounted at `lens::*`. TEARDOWN cascades via `_destroyClearOnly` (no broadcast).
- **B2 — `mapFromSnapshot` defensive helper deleted in Tier 10.1.** Live emit path is always a `Map`, but `JsonGraphCodec` round-trips `Map` as plain `{}` on snapshot-restore. Without the helper, downstream `.entries()` / `.size` accesses silently fail. **Corrected** via D2: helper restored at `extra/composite.ts` and parallel `instanceof Map` check added at `ai/adapters/core/capabilities.ts`. Cleanup-tier safety checklist added to [docs/docs-guidance.md](docs/docs-guidance.md) so future Tier 10.x cleanups verify both live-emit AND snapshot-restore paths.
- **B3 — `process/start` initial γ-7-B used `freeze: false`.** Copied from memory-primitive precedent (where 768-dim vector freeze is a real tax). Process state objects are tiny — `freeze: false` opened a post-record state-mutation hazard. **Corrected** via D4: `freeze: true`. Migration shape-preservation rule added to docs-guidance.
- **B4 — Saga `aggregateId` conditional spread.** Initial migration "tightened" `{ aggregateId: ev.aggregateId }` (always-present, possibly undefined) to `...(ev.aggregateId !== undefined ? ... : {})` (key absent when undefined). Silently changes `Object.hasOwn` semantics + JSON serialization shape. **Corrected** via D5: restored always-include-key.
- **B5 — `processManager` lacked pre-flight name-collision detection** (γ-7-B added a `registerCursor` mount on top of the existing audit-log mount; second-construction throws cryptic `Graph.add` "node already exists"). **Corrected** via D3: pre-flight `cqrsGraph.tryResolve` check throws a process-manager-specific error message.

### C — Forced collision resolution
- **C1 — `bridge.ts` `EvalResult` → `EvalRunResult` rename.** Tier 9.1 reorg merged audit/lens/guarded-execution into `inspect/`; refine-loop moved into `harness/presets/`. After both moves, `harness/index.ts` re-exported both `bridge.ts.EvalResult` (eval-runner shape: `{run_id, model, tasks}`) AND refine-loop's `EvalResult` (per-task scoring shape: `{taskId, score, candidateIndex}`) under the same name, causing a DTS-time collision. Bridge's variant had narrower blast radius (5 file-local references vs 30+ for refine-loop's), so it was renamed. The two types are domain-distinct and shouldn't have shared the name pre-merge either; the reorg just surfaced the latent collision.

### Systemic improvements landed alongside the /qa fixes
- [docs/docs-guidance.md](docs/docs-guidance.md) gained two new sections: "Cleanup-tier safety checklist" (verify both live-emit and snapshot-restore paths before deleting defensive runtime guards) and "Migration shape preservation" (record/object-shape changes during behavior-preserving migrations require explicit user lock).
- Memory `feedback_no_autonomous_decisions.md` updated with shape-preservation guidance and concrete examples (saga aggregateId, process freeze).

---

## Design sessions completed

| Session | Scope | Units | Status |
|---|---|---|---|
| A | Three-layer view + changeset stream + extractFn contract | A.1 (describe topology) · A.2 (observe data) · A.3 (functions) · A.4 (tiers filter + LensGraph fate) · A.5 (distill extractFn) | ✅ locked |
| B | GATE / hub topology | B.1 (foreign-node-accept canonical) · B.2 (hub criterion) · B.3 (named-node placement) | ✅ locked |
| C | promptNode switchMap sentinel handling | C.1 (path (b) lock) · C.2 (`::call` naming) · C.3 (`state(null)` empty branch) · C.4 (init/mid-flow distinction) · C.5 (forward-unknown) · C.6 (consumer-side state-mirror) · C.7 (ERROR on JSON-parse fail) · C.8 (isolated unit-test gate) · C.9 (Tier 6.6 reduced scope) | ✅ locked |

Full session logs in chat history. Locks summarized inline at each tier they unblock.

---

## Tier 1 — Remaining foundational design

### 1.1 §1.4 spec amendment (INVALIDATE-at-diamond coalescing) ✅ landed (verified 2026-04-27)
- **Source:** optimizations.md (2026-04-23)
- **Status:** Already in spec at [GRAPHREFLY-SPEC.md §1.4 lines 185–207](~/src/graphrefly/GRAPHREFLY-SPEC.md). Two paragraphs cover the rule:
  - "INVALIDATE delivery is idempotent within a wave" — fan-in coalescing.
  - "Never-populated case" — first-time INVALIDATE at unsettled mid-chain derived is a no-op.
- **Action:** mark optimizations.md entry resolved.

### 1.2 Session C — `promptNode` switchMap sentinel handling ✅ locked 2026-04-27
- **Source:** AI/harness audit Unit 1 ([SESSION-ai-harness-module-review.md:223](archive/docs/SESSION-ai-harness-module-review.md:223)) + reverted-rewrite root cause ([line 3654](archive/docs/SESSION-ai-harness-module-review.md:3654)).
- **Lock summary:** Path (b) producer-based confirmed. Topology: `prompt_node::messages` (derived) → `prompt_node::output` (switchMap product, `meta.ai = "prompt_node::output"`). Per-wave inner: `prompt_node::call` (producer wrapping `fromAny(adapter.invoke(msgs)).subscribe(...)`, `meta.ai = "prompt_node::call"`). Empty-msgs branch dispatches `state<T|null>(null)`. Abort via `nodeSignal(opts.abort)` + `AbortController`.
- **Decisions locked (L1–L9):**
  - **L1** — Path (b) producer-based is the official design. Path (a) `derived + filter/distinctUntilChanged` rejected: derived's first-run gate leaks transient nulls; filter doesn't address the secondary 20-retry race observed in the reverted attempt.
  - **L2** — Inner-node naming `::call` (not `::response`). `meta.ai.kind = "prompt_node::call"` already shipped; "call" describes the action, `::output` already covers the produced node.
  - **L3** — Empty-msgs branch keeps `state<T|null>(null)`. Push-on-subscribe semantics emit the mid-flow drop-out signal exactly once.
  - **L4** — Initial-no-input (SENTINEL, no emission) vs mid-flow no-input (emits `null`) distinction is load-bearing for `withLatestFrom`-paired triggers; keep.
  - **L5** — Forward-unknown for non-DATA/ERROR/COMPLETE messages via `actions.down([msg as never])` per spec §1.3.6.
  - **L6** — Cross-wave cache stickiness (§32) is a consumer concern. `promptNode` stays primitive; JSDoc cross-link to §32 required in Tier 6.6.
  - **L7** — JSON-parse failure emits `[ERROR, wrapped]` + terminates inner. "Retry on invalid JSON" is downstream (verifier stage or `withRetry` policy on adapter).
  - **L8** — Acceptance gate: `harness.test.ts` retry/reingestion/queue-depth stay green AND add isolated unit test ("N upstream dep waves → exactly N DATAs on `prompt_node::output`, zero transient nulls, zero coalesce loss") to `phase5-llm-composition.test.ts` or new `prompt-node.test.ts`.
  - **L9** — Tier 6.6 reduced scope: JSDoc additions (§32 cross-link + middleware recipe), L8 unit test, resolution of the open `prompt_node::call`-in-`describe()` visibility question. No topology change.
- **Unblocks:** Tier 6.6.

---

## Tier 1.5 — Graph-module API additions (locked via Session A)

These extend the public surface of `Graph`. Land before Tier 5 (Wave B blocks consume them) and ideally before Tier 2 reorg lands so the consolidation diffs cover the new entry points.

### 1.5.1 `describe` topology layer (Session A.1 lock)
- **✅ Reactive diff variant landed (2026-04-27):** `describe({ reactive: "diff" }): ReactiveDescribeHandle<DescribeChangeset>` — wired in [graph.ts](src/graph/graph.ts), backed by `_describeReactiveDiff` which wraps the existing snapshot stream and emits diffs via `topologyDiff` from [extra/composition/topology-diff.ts](src/extra/composition/topology-diff.ts). Initial cache is a synthetic full-add diff. Empty changesets suppressed. Snapshot variant (`reactive: true`) unchanged.
- **✅ `format` option removal landed (2026-04-27, Tier 2.1 A2):** `describe({ format })` dropped; consumers compose `derived([describe({ reactive: true })], ([g]) => toMermaid(g))` using the new pure renderers in `extra/render/`.
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
- **✅ Reactive variant landed (2026-04-27):** `observe({ reactive: true }): Node<ObserveChangeset>` — both single-path and all-paths overloads. Wired via `_observeReactive` in [graph.ts](src/graph/graph.ts) using a producer-bound structured observer + `registerBatchFlushHook` coalescer. Cleanup is producer-lifecycle bound (last unsubscribe tears down the inner observer).
- **Envelope landed:**
  ```ts
  type ObserveChangeset = { events: ReadonlyArray<ObserveEvent>; flushedAt_ns: number };
  ```
  Each event carries `event.path`.
- **✅ `tiers` option (reactive variant) landed:** `ObserveOptions.tiers?: readonly ObserveTier[]` filters before accumulation. `ObserveTier = ObserveEvent["type"]` exported. Default = all.
- **✅ `tiers` for the structured-callback variant landed (2026-04-27):** filter applied at the central `recordEvent` funnel in `_createObserveResult` — out-of-scope events are dropped before they hit the events buffer, the listener fan-out (onEvent), the async iterable, and the format logger. One insertion point covers all surfaces.
- **Callback API unchanged.**

### 1.5.3 `GraphSpec ≡ GraphDescribeOutput` unification (Session A.1 lock) — Phase 1 ✅ landed (2026-04-27)

**Three-phase plan** (D1–D5 picks: phase 1 2 3 / d2 a / d3 b / d4 go / d5 renames).

#### Phase 1 ✅ — substrate (landed 2026-04-27)
- **`detail: "spec"` projection** — added in [core/meta.ts](src/core/meta.ts) `resolveDescribeFields`; projects `type` / `deps` / `meta` (which carries `factory` / `factoryArgs`) and strips `status` / `value` / `lastMutation` / `guard`.
- **`factoryTag(name, args?)` helper** — exported from [core/meta.ts](src/core/meta.ts) and re-exported from [core/index.ts](src/core/index.ts). Returns `{ factory, factoryArgs? }` — factories spread it into their `meta` option at construction time.
- **`compileSpec` dual-read** — [graphspec/index.ts](src/patterns/graphspec/index.ts) `normalizeSpec` runs at the top of `compileSpec`. Nodes with `meta.factory` get normalized into the legacy `fn` / `source` / `config` field-form so the rest of the compile pipeline works unchanged. Legacy fields take precedence when both forms set (explicit specs win).
- **`decompileSpec` rename (D5)** — [graphspec/index.ts](src/patterns/graphspec/index.ts) exports `decompileSpec` as a thin alias for `decompileGraph`. Phase 3 will retire the old name.
- **Tests** — new [spec-roundtrip.test.ts](src/__tests__/graphspec/spec-roundtrip.test.ts) covers projection, helper, dual-read, legacy precedence, and a full decompile→compile round-trip on a factoryTag-stamped graph. 10/10 green.
- **D2 (a)** locked: catalog stays `{ fns, sources }` — `meta.factory` populates whichever side fits the node type (producer → source; else fn).
- **State node `initial` gap noted** — `detail: "spec"` strips `value`, but state nodes need `initial` for re-creation. Phase 1 path: `decompileSpec` (delegating to `decompileGraph`) preserves `initial` from `value`. Phase 3 will resolve more cleanly via state factories tagging themselves with `factoryTag("state", { initial })`, OR retaining `value` in the spec projection for state-typed nodes.

#### Phase 2 — factory self-tagging migration (in progress)

Tag load-bearing factories so their constructed nodes carry `meta.factory` + `meta.factoryArgs`. Mechanical: each factory that produces a user-facing named node spreads `factoryTag(name, opts)` into its `meta` option.

**Tagged so far (✅ landed 2026-04-27):**
- [resilience.ts](src/extra/resilience.ts): `rateLimiter`, `timeout`, `retry` (sanitized factoryArgs — preset name only, function form omitted via `retryFactoryArgs` helper).
- [operators.ts](src/extra/operators.ts): `scan` (tagged with `{ initial }`), `distinctUntilChanged`, `merge` (both empty-source and N-source branches), `switchMap`, `debounce` (`{ ms }`), `throttle` (`{ ms, leading, trailing }`), `bufferTime` (`{ ms }`). Function-typed args (project, equality, predicate) intentionally omitted.
- [frozen-context.ts](src/patterns/ai/prompts/frozen-context.ts): `frozenContext` (both single-shot and refresh-trigger branches; `factoryArgs: { name }` only when caller supplies one — non-serializable `refreshTrigger` omitted, merged into existing `aiMeta(...)`).
- All verified via 12 new `it()` blocks in [spec-roundtrip.test.ts](src/__tests__/graphspec/spec-roundtrip.test.ts) Phase 2 suite (22 total). 2390 tests passing.

**Phase 2 single-node operator mop-up ✅ landed (2026-04-27, parallel batch):**
- [operators.ts](src/extra/operators.ts): `map`, `filter`, `reduce` (with `{ initial: seed }`), `take` (both `count <= 0` and normal branches, with `{ count }`), `tap` (both function and observer forms), `withLatestFrom`. Function-typed args (project, predicate, reducer, observer) intentionally omitted from factoryArgs.
- 6 new regression tests appended to [spec-roundtrip.test.ts](src/__tests__/graphspec/spec-roundtrip.test.ts) "Phase 2 operator mop-up" suite.
- Skipped: `takeWhile`, `takeUntil`, `buffer` (function/Node args, lower priority — defer).

*Bundle factories — primary-node-tag pattern decision needed (DG3):*
- `verifiable` ([composite.ts:56](src/extra/composite.ts:56)) — tag the `verified` companion or wrap the source coercion node
- `withStatus` ([resilience.ts:807](src/extra/resilience.ts:807)) — tag `out` (the wrapping node)
- `withBreaker` ([resilience.ts:511](src/extra/resilience.ts:511)) — same pattern

*Skip (non-node return / non-serializable args):*
- `circuitBreaker` (line 393) — returns object, not node
- `fallback` (line 941) — `fb` can be Node/Promise/AsyncIterable (non-JSON)
- `tokenBucket` (line 598) — returns TokenBucket object

**Phase 2.5 — Graph-factory tagging (DG1=B, DG2=ii, DG3=no, DG4=now) — substrate ✅ landed (2026-04-27)**

Substrate:
- [GraphOptions](src/graph/graph.ts) — added `factory?: string` + `factoryArgs?: unknown` (constructor stores them).
- [GraphDescribeOutput](src/graph/graph.ts) — added top-level `factory?` + `factoryArgs?` so `describe()` surfaces provenance.
- [Graph.prototype.tagFactory](src/graph/graph.ts) — fluent mutator for post-construction tagging from inside Graph-returning factories.
- [placeholderArgs](src/core/meta.ts) helper — recursive walker substitutes `"<function>"` / `"<Node>"` / `"<unserializable>"` for non-JSON fields per DG2=ii. Re-exported from [core/index.ts](src/core/index.ts).
- [GraphSpec.factory](src/patterns/graphspec/index.ts) + [GraphSpecCatalog.graphFactories](src/patterns/graphspec/index.ts) — new `GraphFactory = (factoryArgs: unknown) => Graph` type. `compileSpec` early-dispatches when `spec.factory` matches a `catalog.graphFactories` entry; otherwise falls through to per-node compile (graceful fallback).

Flagship migration:
- [pipelineGraph](src/patterns/orchestration/pipeline-graph.ts) tagged via `g.tagFactory("pipelineGraph", tagArgs)` (constructor opts spread, with `factory`/`factoryArgs` keys excluded from the recursive nesting).

Tests (7 new in spec-roundtrip.test.ts):
- `tagFactory()` surfaces in `describe()` (default detail) and `describe({ detail: "spec" })`.
- `GraphOptions.factory` constructor seeding.
- `placeholderArgs` recursive walker (function → `"<function>"`, Node → `"<Node>"`, primitives kept).
- `compileSpec` delegates to `catalog.graphFactories[name]` when matched.
- `compileSpec` falls back to per-node compile when no match.
- `pipelineGraph` self-tags correctly.

**Phase 2.5 mop-up ✅ landed (2026-04-27, parallel batch + agents):**
- [agent-memory.ts:173](src/patterns/ai/memory/agent-memory.ts:173) `agentMemory` — tags inner Graph; `placeholderArgs` over opts (adapter / extractFn / score / cost / embedFn / entityFn / callbacks).
- [harness/loop.ts:838](src/patterns/harness/loop.ts:838) `harnessLoop` — tags `HarnessGraph`; `placeholderArgs`.
- [agents/agent-loop.ts:750](src/patterns/ai/agents/agent-loop.ts:750) `agentLoop` — tags `AgentLoopGraph`; `placeholderArgs`.
- [cqrs/index.ts](src/patterns/cqrs/index.ts) `cqrs` — tags `CqrsGraph`; `placeholderArgs` (note: public factory is `cqrs`, not `cqrsGraph`).
- [job-queue/index.ts:562](src/patterns/job-queue/index.ts:562) `jobFlow` — tags `JobFlowGraph`; `placeholderArgs` over `{ stages: [{ work: "<function>", ... }], ... }`.
- [orchestration/pipeline-graph.ts:583](src/patterns/orchestration/pipeline-graph.ts:583) `pipelineGraph` (flagship) — already landed substrate-side.
- 7 new regression tests across `factory-tags-memory-harness.test.ts` (3) + `factory-tags-orchestration.test.ts` (3) + the existing flagship test in `spec-roundtrip.test.ts`.

**QA pass landed (2026-04-27, post-Phase-2.5 mop-up):** 14 of 25 reviewer findings patched in-batch (F1 decompile preserves top-level factory; F2 `_observeReactive` drains push-on-subscribe events; F3 tier filter applies to counters; F4 `compileSpec` validates before early-dispatch; F5 strip runtime sibling keys at decompile; F6 `placeholderArgs` cycle guard via WeakSet; F7 `placeholderArgs` getter-side-effect safety via try/catch; F8 `tagFactory` always-resets factoryArgs; F9 agent-memory closure-mirror unsub registered via `graph.addDisposer`; F10 `_describeReactiveDiff` settles `diffNode` with TEARDOWN on dispose; F11 `topologyDiff` actually shallow-copies node entries; F12 `_observeReactive` redundant tier filter dropped; F13 `pipelineGraph` routes opts through `placeholderArgs`; F14 `normalizeSpecNode` strips `meta.factory` when legacy fields took precedence). 11 deferred items tracked in `docs/optimizations.md`. 2417 tests passing.

**Skipped at Graph-level + bundle-tagging design session (DT1–DT5 — locked 2026-04-27):**

*Bundle factories — DT1=B (tag primary node), DT2=table-picks (landed alongside this batch):*
- `verifiable` → tag `bundle.verified` (the verification-result node, not the source coercion).
- `withStatus` → tag the wrapping output node.
- `withBreaker` → tag the wrapping output node.
- `distill` → tag `bundle.compact` (the user-facing budgeted memory view).
- `gatedStream` → tag `bundle.output` (the gate-released stream).
- `streamingPromptNode` → tag `bundle.output` (the accumulated text).
- `handoff`, `toolSelector` → tag the returned Node.

*Plain-object factories — DT3=A (skip + JSDoc note as "library helper, not in graph topology"):*
- `processManager` ([process/index.ts](src/patterns/process/index.ts)) — returns `ProcessManagerResult<TState>` (object with `instances`/`start`/`cancel`/`getState`); not in graph topology.
- `circuitBreaker`, `tokenBucket` ([extra/resilience.ts](src/extra/resilience.ts)) — return non-Node objects; their consumers (e.g., adapter stacks) carry provenance via their own factoryTag.

*Other:*
- `fallback` — DT4 = tag with name only (no factoryArgs since `fb` arg is non-JSON).
- `harnessGraph` — no separate factory; class is constructed only via `harnessLoop` (already tagged).
- `policyEnforcer` — DT5 (revised) = **defer tagging to Tier 2.3**, where the rename to `policyGate` lands. Tagging with the soon-to-be-deprecated name would create rename churn (every `meta.factory === "policyEnforcer"` matcher breaks at rename).
- `reactiveExplainPath` — `@deprecated`, will be removed pre-1.0; do not tag.

#### Phase 3 ✅ landed (2026-04-27)
- **Type collapse:** `GraphSpec = Omit<GraphDescribeOutput, "nodes" | "expand"> & { nodes: Record<string, DescribeNodeOutput | GraphSpecTemplateRef>; templates?; feedback? }`. `GraphSpecNode = DescribeNodeOutput`. The legacy field-form (`fn` / `source` / `config` / `initial`) is gone from the type — every node carries factory provenance in `meta.factory` / `meta.factoryArgs`. Top-level `factory?` / `factoryArgs?` ride through from `GraphDescribeOutput` for Graph-level tags.
- **`normalizeSpec` deleted.** `compileSpec` reads `meta.factory` / `meta.factoryArgs` directly via two helpers (`readFactory`, `readFactoryArgs`). The graphFactories early-dispatch is now a typed read on `spec.factory`. Catalog-aware validation (`validateSpecAgainstCatalog`) and `specDiff` were updated to read the meta-form instead of legacy fields.
- **`decompileSpec`** is a thin projection over `graph.describe({ detail: "spec" })`. Strips meta-companion paths, bridge / feedback-effect internals, and known runtime-state sibling keys (`status`, `breakerState`, `sourceVersion`). Adds a small feedback-edge recovery scan over `meta.feedbackFrom` / `meta.feedbackTo` (≈10 lines, the only post-process sugar). **Removed:** template fingerprinting / `_templateName` recovery — mounted subgraphs now appear as nested `subname::*` paths in the spec; round-tripping templates via `decompileSpec` is no longer in scope (file follow-up if a consumer needs it).
- **`decompileGraph` removed** as a public export. `decompileSpec` is the only name.
- **State `initial` resolution — path (b) lock:** `describe({ detail: "spec" })` retains `value` for state nodes only (gated by a new `specMode` parameter on `describeNode`). Derived/effect/producer values are still stripped. `compileSpec` reads state initial from `meta.factoryArgs.initial` first (for users who explicitly tag) then falls back to `node.value`. Path (a) was attempted (state self-tag via `factoryTag("state", { initial })`) but reverted because it spawned `<name>::__meta__::factory` + `<name>::__meta__::factoryArgs` companion nodes on every state, which broke `graphLens`-style nodeCount tests across the suite.
- **Consumer migrations:** [src/__tests__/patterns/graphspec.test.ts](src/__tests__/patterns/graphspec.test.ts) (full rewrite), [src/__tests__/patterns/surface/surface.test.ts](src/__tests__/patterns/surface/surface.test.ts), [src/__tests__/patterns/ai.test.ts](src/__tests__/patterns/ai.test.ts), [src/__tests__/evals/portable-catalog.test.ts](src/__tests__/evals/portable-catalog.test.ts), [src/__tests__/evals/prompt-template-validity.test.ts](src/__tests__/evals/prompt-template-validity.test.ts), [src/__tests__/graphspec/spec-roundtrip.test.ts](src/__tests__/graphspec/spec-roundtrip.test.ts) (Phase 3 suite expanded), [evals/lib/portable-templates.ts](evals/lib/portable-templates.ts), [evals/portable-eval-prompts.md](evals/portable-eval-prompts.md) (LLM-facing schema description + 3 example specs), [src/patterns/surface/index.ts](src/patterns/surface/index.ts) (decompileGraph reference removed).
- **LLM prompt:** `LLM_COMPOSE_SYSTEM_PROMPT` in [src/patterns/graphspec/index.ts](src/patterns/graphspec/index.ts) now teaches the unified shape (`meta.factory` / `meta.factoryArgs` instead of `fn` / `source` / `config`). State seed via `value` field (or `meta.factoryArgs.initial`).
- **Tests/lint/build:** 2419 tests passing, lint clean (no new warnings on touched files), build green.
- **Audit C24-2 (Tier 10.4) obsolete** — decompile is no longer approximate.

### 1.5.4 distill `extractFn` reactive form (Session A.5 lock) ✅ landed (2026-04-27)
- **New signature landed:** `extractFn: (raw: Node<TRaw>, existing: Node<ReadonlyMap<string, TMem>>) => NodeInput<Extraction<TMem>>` in [composite.ts:166](src/extra/composite.ts:166). Distill calls extractFn ONCE at wiring time and consumes the returned reactive stream. Internal `switchMap` removed; user controls cancellation / queueing semantics.
- **Single shape**, no callback overload (pre-1.0, breaking).
- **Consumer migrated:** [agent-memory.ts](src/patterns/ai/memory/agent-memory.ts) — `rawExtractFn` (still callback-style at the public API surface) wrapped in a closure-mirror + `switchMap` adapter that conforms to the new distill shape. Existing callback API on `AgentMemoryOptions.extractFn` preserved for downstream consumers; only the internal hand-off changed.
- **Test sites migrated:** [composite.test.ts](src/__tests__/extra/composite.test.ts) — 6 distill call sites updated to `(rawNode) => derived([rawNode], ([raw]) => ({ ... }))` for sync transforms. 10/10 tests green.
- **COMPOSITION-GUIDE §40 added:** [~/src/graphrefly/COMPOSITION-GUIDE.md](~/src/graphrefly/COMPOSITION-GUIDE.md) — cancel-on-new-input recipe, operator comparison table (switchMap / concat / mergeMap / derived), closure-mirror rationale (avoids `withLatestFrom` push-on-subscribe hazard per §32), sync-transform shortcut.
- **Note:** `consolidate` callback still callback-style; lock did not migrate it. Closure-mirror for `latestStore` retained inside distill solely for consolidate.
- **`llmExtractor` / `llmConsolidator`** (Wave AM AM.0) are unchanged — they return `(raw, existing) => NodeInput` callbacks that consumers wrap. Their internal shape doesn't need migration.

### 1.5.5 Functions-layer convention (Session A.3 lock) ✅ landed (2026-04-27)
- COMPOSITION-GUIDE §39 "Function identity via meta — fn-id convention" added in [~/src/graphrefly/COMPOSITION-GUIDE.md](~/src/graphrefly/COMPOSITION-GUIDE.md). Documents caller-stamped `meta.fnId("extractor::v1")` convention, naming format, why factory-implicit IDs aren't viable (closure state breaks naive hashing), and pairing with §37 handler-version audit (per-record vs per-node identity).

---

## Tier 1.6 — Naming + outcome conventions (locked 2026-04-27)

Doc + light-migration locks for path-separator naming and data-level outcome/status enums. Naming is observation-of-existing-practice (no code migration); enum migrations ride along with Tier 2.3.

### 1.6.1 Path-separator convention
- **`::`** — compound-factory internals: one factory ships multiple sub-nodes that operate as a unit; `meta.ai.kind` matchers and `describe()` pretty-rendering use the prefix. Examples: [prompt-node.ts:142](src/patterns/ai/prompts/prompt-node.ts:142) `prompt_node::messages` / `::call` / `::output`; [reduction/index.ts:118](src/patterns/reduction/index.ts:118) `${stage}::input` / `::output`; [suggest-strategy.ts:209](src/patterns/ai/graph-integration/suggest-strategy.ts:209) `suggestStrategy::call`.
- **`/`** — namespace / domain grouping for independent nodes. Examples: [demo-shell/index.ts:120](src/patterns/demo-shell/index.ts:120) `pane/main-ratio`, `viewport/width`, `graph/mermaid`, `hover/target`.
- **Doc target:** new §38 "Naming conventions" in `~/src/graphrefly/COMPOSITION-GUIDE.md`. No code migration — current usage already conforms.

### 1.6.2 Outcome enum (action result, data-level — distinct from protocol COMPLETE/ERROR)
- **Canonical:** `outcome: "success" | "failure" | "partial"`.
- **Already canonical:** `harness/types.ts`, `harness/actuator-executor.ts`, `harness/refine-executor.ts`, `harness/loop.ts`.
- **Migrate:**
  - [cqrs/index.ts:130, 148](src/patterns/cqrs/index.ts:130) — `status: "success" | "failed"` → `outcome: "success" | "failure"` (rename field; `"partial"` n/a)
  - [process/index.ts:63](src/patterns/process/index.ts:63) — step `kind: "ok" | "fail"` → `outcome: "success" | "failure"`
- **Lands with:** Tier 2.3 pre-1.0 renames.

### 1.6.3 Status enum (lifecycle — long-running things)
- **Canonical:** `status: "running" | "completed" | "errored" | "cancelled"`. Past-participle `errored` pairs with `completed`.
- **Migrate:**
  - [pipeline-graph.ts:96](src/patterns/orchestration/pipeline-graph.ts:96) terminal cause: `kind: "complete" | "error"` → `kind: "completed" | "errored"; error?: unknown`
  - [resilient-pipeline/index.ts:80](src/patterns/resilient-pipeline/index.ts:80) — `"active"` → `"running"`; `"pending"` retained (distinct from running).
  - [process/index.ts:110](src/patterns/process/index.ts:110) — `"failed"` → `"errored"`; `"terminated"` and `"compensated"` retained as documented domain-specific extensions.
  - [core/config.ts:185](src/core/config.ts:185) and [_invariants.ts:3298](src/__tests__/properties/_invariants.ts:3298) — already aligned ✓.
- **Lands with:** Tier 2.3 pre-1.0 renames.

---

## Tier 2 — Structural reorganization

### 2.1 Consolidation Phase 1 — `extra/` folder split + renderer extraction ✅ landed (2026-04-27, parallel agent batch)

**A1 — extra/ folder split** (commit `fd2734a`, 52 files): four mega-files (`operators.ts` 2,664 LOC, `sources.ts` 1,327 LOC, `adapters.ts` 4,594 LOC, `resilience.ts` 1,091 LOC) physically moved into category folders (`operators/`, `sources/`, `io/`, `resilience/`, `data-structures/`, `storage/`, `composition/`). Top-level paths kept as thin re-export shims so consumer imports keep working. **Note (deviation from plan):** physical mega-file relocation only — the further per-category sub-file split inside each folder (e.g. `operators/{transform,take,combine,...}.ts`) is **deferred to a follow-up batch**. Sub-files exist as discoverable barrels but the canonical body still lives in `<folder>/index.ts`. This preserves zero-risk semantics for all internal cross-references and lets the per-protocol split (esp. `io/` which contains ~25 protocol adapters: Kafka/Redis/NATS/RabbitMQ/Pulsar/MCP/OTel/Syslog/StatsD/Prometheus/ClickHouse/S3/Postgres/MongoDB/Loki/Tempo/SQLite/Prisma/Drizzle/Kysely/CSV/NDJSON/file-sinks) happen as a separate, easier-to-review batch.

**A2 — Renderer extraction + `format` drop** (commit `f3b9b63`, 20 files): pure renderers `toMermaid` / `toMermaidUrl` / `toAscii` / `toD2` / `toPretty` / `toJson` extracted to new `src/extra/render/*` (dedicated subpath `@graphrefly/graphrefly/extra/render` — large strings shouldn't pull the full extra surface). `Graph.describe({ format })` overloads + dispatch removed; consumers compose `describe → derived(toMermaid)` for live formatted output. `_layout-sugiyama.ts` / `_ascii-grid.ts` / `_ascii-width.ts` moved alongside `to-ascii.ts`. 5 in-tree consumers migrated.

`assertBrowserSafeBundles` green. 2419 tests passing.

### 2.2 Consolidation Phase 2 — promotions to `extra/` ✅ landed (2026-04-27, Wave 2A)

Mutation framework (`lightMutation` / `wrapMutation` / `BaseAuditRecord` / `createAuditLog` / `tryIncrementBounded` and supporting `bumpCursor` / `appendAudit` / `registerCursor*`) relocated from `patterns/_internal/imperative-audit.ts` to `src/extra/mutation/index.ts`; `domainMeta` to `src/extra/meta.ts` (re-exported through the main `extra/` barrel); `decay` to `src/extra/utils/decay.ts` (re-exported on the barrel, no longer surfaced on `patterns.memory`); `budgetGate` (+ `BudgetConstraint` / `BudgetGateOptions`) to `src/extra/resilience/budget-gate.ts` joining the rest of the resilience family. `keepalive` consumers now import directly from its canonical home (`extra/sources.js`); the prior `_internal` re-export was dropped. `patterns/_internal/` retains only `emitToMeta` + `trackingKey` per consolidation plan §1. Test file moved from `__tests__/patterns/_internal/imperative-audit.test.ts` to `__tests__/extra/mutation/mutation.test.ts`. `assertBrowserSafeBundles` green; 2419 tests pass.

### 2.3 Consolidation Phase 3 — pre-1.0 renames + enum migrations ✅ landed (2026-04-27, Wave 2A)

Renames: `pipeline.gate(...)` → `pipeline.approvalGate(...)` (orchestration; `meta.orchestration_type` is now `approval_gate`); `policyEnforcer` / `PolicyEnforcerGraph` / `PolicyEnforcerOptions` → `policyGate` / `PolicyGateGraph` / `PolicyGateOptions` (audit). `policyGate` self-tags via `g.tagFactory("policyGate", placeholderArgs(opts))` per the Phase 2.5 DT5 ride-along; regression covered by new `__tests__/graphspec/factory-tags-audit.test.ts` (2 tests, mirrors the `factory-tags-orchestration.test.ts` shape).

Deletions: `lightCollection` folded into `collection({ ranked: false })` — `CollectionOptions` gains a `ranked?: boolean` flag (default `true`); when `false`, the timer / scoring / `ranked` derived are skipped (`ranked` becomes a static empty-array node) and the entries are pure LRU + audit. `LightCollection*` types removed; `CollectionGraph` gains `hasNode(id)` for parity. `fromLLM` (+ `FromLLMOptions`) deleted; `promptNode` gained `format: "raw"` (emits the full `LLMResponse`) plus a `tools` option to subsume the prior shape. `effectivenessTracker` (+ entry/snapshot/bundle types) demoted from `patterns/reduction` to `patterns/harness/effectiveness-tracker.ts` — its only consumer was the harness strategy model.

Enum migrations: `DispatchRecord.status` / `SagaInvocation.status` (`"success" | "failed"`) → `outcome` (`"success" | "failure"`) in `patterns/cqrs`. `ProcessStepResult` `kind: "fail"` → `kind: "failure"` in `patterns/process`. `TerminalCause.kind` and `CatchOptions.on` (`"complete" | "error"`) → `"completed" | "errored"` in `patterns/orchestration/pipeline-graph` (variant structure preserved — `errored` carries `error: unknown`). `extra/resilience` `StatusValue`: `"active"` → `"running"`. `ProcessInstance.status`: `"failed"` → `"errored"` (`"terminated"` and `"compensated"` retained as documented domain-specific extensions).

Test sites updated: `cqrs.test.ts` (3 assertions on `outcome`), `process.test.ts` (2 `kind: "failure"` returns + 1 `status === "errored"` assertion), `orchestration.test.ts` (2 `cause.kind === "errored"` assertions), `resilient-pipeline.test.ts` + `extra/resilience.test.ts` + `sources.http.test.ts` (`"running"` status assertions). `memory.test.ts` rewritten to drive the `lightCollection` block through `collection({ranked:false})`; `exports.test.ts` updated to drop `lightCollection` from the memory namespace check; `ai.test.ts` `fromLLM` block rewritten to use `promptNode({format: "raw"})`.

`assertBrowserSafeBundles` green; 2421 tests pass (added 2 from `factory-tags-audit.test.ts`); lint stays at the 9-warning baseline.

---

## Tier 3 — Audit prerequisites for Wave B (D.2 cluster) ✅ landed (2026-04-27, Wave 2B parallel-agent batch)

All five units landed via 3 parallel agents (A: 3.1+3.2 bundled, B: 3.3, C: 3.4+3.5 bundled). Each agent's worktree branched from main (pre-Tier-2.1) so changes were ported onto current branch state with file-path migration (`extra/resilience.ts` → `extra/resilience/index.ts`, `patterns/reduction/index.ts::budgetGate` → `extra/resilience/budget-gate.ts`) and symbol-name reconciliation (`policyEnforcer` → `policyGate`, `StatusValue: "active"` → `"running"`).

### 3.1 D.2.3a — supervisors cluster (`retry`, `circuitBreaker`, `timeout`, `fallback`) ✅ landed
- ✅ `retry({ backoff })` without explicit `count` throws `RangeError`.
- ✅ Source/factory-mode dedup via shared `_runRetryStateMachine` helper (~94 LOC saved; close to ~110 audit estimate).
- ✅ Centralized `resolveRetryConfig` for footgun-guard parity across both modes.
- ✅ JSDoc on clock injection contract.
- **Unblocks:** Unit 7 `resilientPipeline` rebuild.

### 3.2 D.2.3b — throttles & status cluster (`rateLimiter`, `tokenBucket`, `withStatus`) ✅ landed
- ✅ `rateLimiter` without explicit `maxBuffer` throws `RangeError`; `Infinity` opts in to unbounded.
- ✅ `RingBuffer` from `extra/utils/ring-buffer.js` backs the pending queue.
- ✅ `rateLimiter` return widened from `Node<T>` to `{ node: Node<T>, droppedCount: Node<number> }` companion bundle.
- ✅ `tokenBucket(capacity, refill, opts?)` accepts `clock?` for deterministic testability.
- ✅ JSDoc on `tokenBucket.tokens` float behavior, `withStatus` producer-pattern visibility, lifecycle (`"pending" | "running" | "completed" | "errored"` post-Wave-2A `StatusValue`).
- **Consumer update:** `resilient-pipeline` defaults `maxBuffer: Infinity` to preserve historical behavior.
- **Unblocks:** Unit 7 `resilientPipeline` rebuild.

### 3.3 D.2.4 — `budgetGate` ✅ landed
- ✅ Private `HeadIndexQueue<T>` (O(1) push, O(1) shift, opportunistic compaction) replaces `buffer.slice(1)` O(N²) drain. **Note:** chose `HeadIndexQueue` over `RingBuffer` because RingBuffer's drop-oldest eviction would silently lose buffered DATA between PAUSE and RESUME — that breaks budgetGate's backpressure contract. Documented in JSDoc.
- ✅ Terminal force-flush + PAUSE-release ordering: confirmed correct, documented as 4 explicit invariants in JSDoc with cross-links to COMPOSITION-GUIDE §19, §9/§9a, §24.
- ✅ JSDoc on `node([], fn)` producer-pattern (source invisible to describe-traversal).
- ✅ `@throws RangeError` on empty constraints; regression test asserts `instanceof RangeError`.
- ✅ Reference-equality semantics on `constraints` array documented (captured at construction; Architecture-2: compositor-only).
- 5 new tests in `reduction.test.ts` (terminal flush before COMPLETE/ERROR; PAUSE→RESUME FIFO ordering; 5000-item scaling regression; deferred RESOLVED).
- **Unblocks:** Unit 7 `resilientPipeline` rebuild.

### 3.4 D.2.1 — `policyGate` (renamed per Wave 2A 2.3) ✅ landed
- ✅ Reactive `paths: readonly string[] | Node<readonly string[]>` via closure-mirror + Set-diff rebind (mirrors the existing `policies: ... | Node<...>` pattern in same constructor).
- ✅ Reactive `violationsLimit` explicitly NOT added — deferral noted in JSDoc pointing to Tier 10.8 (TopicGraph reactive `retainedLimit`).
- ✅ 4 new reactive-paths test cases + 1 `placeholderArgs(Node<readonly string[]>) → "<Node>"` regression in `spec-roundtrip.test.ts`.
- **Unblocks:** Unit 6 `guardedExecution` rebuild.

### 3.5 D.2.2 — `Graph.explain` reactive opts + delete deprecated `reactiveExplainPath` ✅ landed
- ✅ `Graph.explain(from, to, opts)` widened: `from: string | Node<string>`, `to: string | Node<string>`, `opts.maxDepth?: number | Node<number>`, `opts.findCycle?: boolean | Node<boolean>`. Resolution helpers `isExplainArgNode` + `resolveExplainPath/Number/Boolean` mirror `isActorNode`. `_explainReactive` subscribes to reactive args via the existing `bump()` coalescer.
- ✅ Deprecated `reactiveExplainPath` deleted from `patterns/audit`. 6 call-site migrations: `patterns/lens.why`, audit test, `examples/knowledge-graph`, `demos/.../inspect.ts`, README, website demo pages, roadmap entry. Generated API doc removed (moved to `TRASH/`).
- ✅ Deletion regression test in `audit.test.ts` asserts `auditModule.reactiveExplainPath === undefined`.
- ✅ Patterns/lens `LensGraph.why` migrated to `target.explain(from, to, { reactive: true, ...opts })`.
- File path-scoped observe deferred (Tier 10.8 design follow-up — whole-graph observe is a perf gap, not a spec violation).
- **Unblocks:** Unit 8 `graphLens` rebuild.

---

## Tier 4 — Wave A + Wave AM memory primitive rebuilds ✅ landed (Wave A in Tier 2A; Wave AM closed 2026-04-27; markup reconciled 2026-04-28 in Tier 9.1 batch)

High-impact: memory is one of the public-face blocks. All LOCKED in public-face audit §F.

### 4.1 Wave A Unit 1 — `decay` utility ✅ landed
Pure 12-LOC function lives at [extra/utils/decay.ts](src/extra/utils/decay.ts) (Tier 2.2 promotion). Re-exported through `extra/index.ts`.

### 4.2 Wave A Unit 2 — `collection` (folds in old `lightCollection`) ✅ landed
`collection({ ranked: false })` is the "light" mode per consolidation Rule 4. `LightCollection*` types deleted in Wave 2A 2.3; `CollectionGraph` gained `hasNode(id)` for parity. `lightMutation` + `events` audit log adopted at [memory/index.ts](src/patterns/memory/index.ts).

### 4.3 Wave A Units 3–5 — `vectorIndex`, `knowledgeGraph`, full `collection` ✅ landed
All three primitives in [memory/index.ts](src/patterns/memory/index.ts) adopt `lightMutation` + per-primitive `events` audit logs. Distinct index types stay separate per consolidation Rule 4. `searchNode` / `relatedNode` reactive read APIs exposed; no imperative reads on Phase-4 primitives.

### 4.4 Wave AM Unit 1 — `tiers.ts` ✅ landed (2026-04-27)
`DEFAULT_DECAY_RATE` (`Math.LN2 / (7 × 86_400)` — 7-day half-life) extracted from [patterns/ai/memory/tiers.ts](src/patterns/ai/memory/tiers.ts) to [extra/utils/decay.ts](src/extra/utils/decay.ts) so any consumer (memory primitives, harness strategy decay, future routing-weight decay) can share the canonical default without reaching across domains. `tiers.ts` re-exports the const for backward-compat with existing `patterns/ai/memory/` consumers. Promoted alongside the existing `decay()` helper (already in `extra/utils/decay.ts` per Tier 2.2). `extractStoreMap` carry: handled separately in Tier 4.7.

### 4.5 Wave AM Unit 3 — `retrieval.ts` rename ripple ✅ landed
`pathOf` / `pathWeight` / `query.path` / `entry.path` renamed to `contextOf` / `contextWeight` / `query.context` / `entry.context` at [ai/memory/retrieval.ts:39](src/patterns/ai/memory/retrieval.ts:39). Unit 6 (`agent-memory.ts`) ripple folded into the same migration.

### 4.6 Wave AM Unit 4 — `llm-memory.ts` → `prompt-call.ts` ✅ landed (2026-04-27)
Public `promptCall<TIn, TOut>(systemPrompt, buildUserContent, opts, defaultName)` shipped at [src/patterns/ai/prompts/prompt-call.ts](src/patterns/ai/prompts/prompt-call.ts), promoted from the previously-private `llmJsonCall` in `patterns/ai/memory/llm-memory.ts`. `PromptCallOptions` exported (was `LLMExtractorOptions`'s shared core). `llmExtractor` / `llmConsolidator` now thin wrappers over `promptCall` (logic unchanged). Internal consumer ([agent-memory.ts](src/patterns/ai/memory/agent-memory.ts)) migrated to import from `../prompts/prompt-call.js`. Top-level `patterns/ai/index.ts` now re-exports from `./prompts/prompt-call.js` directly. New `promptCall.md` API doc generated. **`patterns/ai/memory/llm-memory.ts` was retained as a re-export shim during the initial Tier 4.6 land but moved to `TRASH/` immediately after** (per `feedback_no_backward_compat` — pre-1.0 we don't keep legacy shims; all in-tree consumers were already migrated). See [TRASH-FILES.md](TRASH-FILES.md) for the canonical record. The "migrate to reactive `extractFn` per Tier 1.5.4" lock was already satisfied at Tier 1.5.4 land — `llmExtractor`/`llmConsolidator` produce callbacks consumed by distill, and Tier 1.5.4 wrapped that callback in a closure-mirror + switchMap adapter.

### 4.7 Wave AM Unit 5 — `memory-composers.ts` ✅ landed (2026-04-27)
Private `extractStoreMap<TMem>(snapshot: unknown): ReadonlyMap<string, TMem>` helper deleted from [memory-composers.ts](src/patterns/ai/memory/memory-composers.ts). Replaced with inline typed cast `((snapshot as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>())` at the 6 call sites — the runtime `instanceof Map` check was paranoid (post-Tier-1.5.4 the upstream `ReactiveMapBundle` always emits a Map). Empty map remains the canonical "no entries yet" fallback so deriveds/effects clear their first-run gate cleanly. Distill-consumer migration to reactive `extractFn` already landed in Tier 1.5.4 — `agent-memory.ts`'s closure-mirror + switchMap adapter wraps the callback-style extractor under the new `extractFn(rawNode, existingNode) => NodeInput<Extraction<TMem>>` shape; `memory-composers.ts` itself doesn't call `distill()` directly (it consumes an existing `DistillBundle`), so no migration needed at this site. **Carry NOT done in this batch:** the plan's "narrow upstream type" lock (eliminate the inline casts via a typed-derived variant) is filed in [docs/optimizations.md](docs/optimizations.md) "Tier 4.7 follow-up — narrow `ReactiveMapBundle.entries` callback typing" and deferred until a second pattern-layer surface needs the same shape.

---

## Tier 5 — Wave B public-face block rebuilds

Three of the six public-face blocks. Each gates a high-visibility README claim.

### 5.1 Unit 6 — `guardedExecution` ✅ landed (2026-04-27, qa-revised 2026-04-28)
Rewrite of [guarded-execution/index.ts](src/patterns/guarded-execution/index.ts):
- `actor: Actor | Node<Actor>` (Tier 5.1 B.1 revision — pre-1.0 breaking; widened from static `Actor`). Caller-supplied `Node<Actor>` is bridged through a `derived([actorOpt], ([a]) => a ?? null, { initial: null })` adapter (qa G1B / EC2 fix) so the internal `_actorNode: Node<Actor | null>` always carries non-sentinel cache and downstream `derived`s (like `scope`) never stall on the SENTINEL first-run gate.
- **Canonical `wrapper.scopedDescribe: Node<GraphDescribeOutput>` mounted property** (qa G1A "same concept" / EC1 fix) — single reactive describe handle bound at construction to the configured actor, lifecycle owned by the wrapper. No per-call leak. Mounted under `scopedDescribe` in `describe()`.
- **Per-call escape hatch `scopedDescribeNode(actorOverride?, opts?): {node, dispose}`** — retained for the rare per-call-override case. Each call instantiates a fresh `target.describe({reactive: true})` handle; caller manages `dispose()`. Wrapper still tracks the dispose as a safety net for `wrapper.destroy()`.
- Imperative `scopedDescribe(opts)` (the pre-rewrite imperative method) dropped per the no-imperative-reads policy.
- Constructor throws `RangeError` on `mode:"enforce"` + static empty `policies` (deny-by-default misconfig).
- `lints: TopicGraph<GuardedExecutionLint>` mounted as `${name}::lints`. Each lint kind (`"empty-policies"` / `"audit-no-effect"` / `"no-actor"`) fires at most once per instance via `_firedLintKinds` guard. Reactive callers see `empty-policies` on the first DATA emit of an empty `policies` Node in enforce mode; `audit-no-effect` on construction when `mode:"audit"` + target has no per-node guards (one-shot — late-mounted guards leave the lint stale; reactive-recompute follow-up filed); `no-actor` on construction when no default actor configured.
- `scope: Node<{actor: Actor | null, mode, policiesCount}>` mounted at `scope` for dashboards. Re-emits when policies update or the actor Node swaps. `actor: null` for the no-actor case (state-of-`null` was used over `state(undefined)` to keep the derived's first-run gate satisfied — undefined is the v5 SENTINEL and would never push DATA).
- `domainMeta("guarded", "scope")` tagging on the scope derived.
- Tests (`__tests__/patterns/guarded-execution.test.ts`): 26 cases covering write enforcement / audit mode / `wrapper.scopedDescribe` (mounted property) / `scopedDescribeNode` (per-call escape hatch) / SENTINEL-bridge for caller-supplied Node<Actor> / per-call actor override / detail pass-through / RangeError on static empty / one-time `empty-policies` lint / `audit` tolerates empty / `audit-no-effect` / `no-actor` / `scope` reactivity / `domainMeta` describe assertion / dispose-idempotent. All green.
**Depends on:** Tier 3.4 (D.2.1 policyGate), Tier 2.3 (`policyEnforcer` → `policyGate` rename), Tier 1.5.1 (describe-reactive + actor-Node widening).

### 5.2 Unit 7 — `resilientPipeline` ✅ landed (2026-04-27)
Rewrite of [resilient-pipeline/index.ts](src/patterns/resilient-pipeline/index.ts):
- `resilientPipeline(...)` returns a `ResilientPipelineGraph<T>` (Graph subclass) instead of a bundle. Mounted intermediates (`rateLimited`, `budgetGated`, `breakerWrapped`, `timeoutWrapped`, `retryWrapped`, `fallbackWrapped`) appear in `pipeline.describe()` so the resilience chain shows up in topology snapshots, mermaid renders, and `lens.health` aggregations.
- Bundle properties → readonly graph properties: `output: Node<T>`, `status: Node<StatusValue>`, `lastError: Node<unknown | null>`, `breakerState: Node<CircuitState> | undefined`, `droppedCount: Node<number> | undefined`, `rateLimitState: Node<RateLimiterState> | undefined`. **Naming deviation from audit Wave-B Unit 7 §A:** the audit named the first two `node` / `error`, but `Graph.node(name)` and `Graph.error(name, err)` already name methods on the base class — readonly fields with those names would shadow the base methods. `output` / `lastError` are the smallest name change that preserves the underlying companion semantics.
- `NodeOrValue<T> = T | Node<T>` — `rateLimit` / `budget` / `breaker` / `retry` / `timeoutMs` accept either shape (precedent-aligned with `FallbackInput<T>`). **qa G1C-prime (2026-04-28):** the original implementation read `node.cache` synchronously at construction (graceful-degrade), which violated §5.8 / §5.10 — long-lived structures shouldn't capture cache values once. Replaced with **switchMap-pattern rebuild**: when the caller supplies a `Node<T>`, the pipeline subscribes via `switchMap(optsNode, opts => primitive(...))` and rebuilds the layer on every option emission. Each rebuild creates a fresh primitive instance — internal state is lost (rate-limiter pending buffer, breaker failure count, retry attempt count, in-flight timeout). Per-layer **companion Nodes** (`droppedCount`, `rateLimitState`, `breakerState`) are exposed ONLY for the static-options path; reactive-options leaves them `undefined` (each rebuild creates new companion instances; switchMap-mirroring would track only the latest bundle). Primitive-side widening (filed in [docs/optimizations.md](docs/optimizations.md) "Tier 5.2 follow-up — primitive-side reactive-options widening") will preserve internal state once it lands and the pipeline will trivially forward Node-form options to the primitive — at which point reactive-options + companions become available together with no call-site change.
- **D7 — `rateLimitState` companion landed.** `extra/resilience/rateLimiter` now ships `RateLimiterBundle.rateLimitState: Node<RateLimiterState>` alongside the existing `droppedCount`. `RateLimiterState = {droppedCount, pendingCount, paused}` with structural-equality dedup at the emit boundary so steady-state pass-through doesn't generate one DATA per source DATA. Pipeline exposes it as `pipeline.rateLimitState` and mounts it under `rateLimitState` in `describe()`.
- **D8 — caller `meta` option on each resilience primitive landed.** `rateLimiter`, `withStatus`, `withBreaker`, `timeout`, `retry`, `fallback` each accept an `meta?: Record<string, unknown>` option that merges into the produced node's `meta` (caller keys first; primitive's companion seeds + `factoryTag` win the merge so the audit trail can't be silently overwritten). `budgetGate` already supported `meta` (Tier 3.3 carry-through). The pipeline stamps `domainMeta("resilient", "<kind>")` on each layer's intermediate node so `describe()` / mermaid grouping surfaces the canonical resilience-domain tag the audit Wave-B Unit 7 §A required.
- Per-layer companions exposed today: `breakerState` (when `breaker` configured), `droppedCount` + `rateLimitState` (when `rateLimit` configured). `budgetState` / `retryAttempts` / `lastTimeout` still deferred — each requires the underlying primitive to ship the corresponding Node first. Tickets filed alongside the reactive-options entry in [docs/optimizations.md](docs/optimizations.md) "Tier 5.2 follow-up — primitive-side reactive-options widening".
- `breakerOnOpen` + `retry` interaction documented in module JSDoc: with `"error"` + `retry`, retry sees `CircuitOpenError` and resubscribes against an open circuit, burning its budget; default `"skip"` emits `RESOLVED` (downstream drops the beat without retry firing).
- `timeoutMs` upper bound (9_000_000 ms ≈ 2.5h) preserves safe ns arithmetic; same `RangeError` as before plus an explicit overflow guard.
- Self-tags via `g.tagFactory("resilientPipeline", placeholderArgs(opts))` so `describe().factory === "resilientPipeline"` and `describe().factoryArgs` substitutes Node-typed and function-typed fields with `"<Node>"` / `"<function>"` placeholders.
- `resilientFetch` migration audit: only `resilientFetchTemplate` (a graphspec template in [evals/lib/portable-templates.ts](evals/lib/portable-templates.ts)) carries the `resilientFetch` name. It's a `GraphSpec`, not a wrapper around `resilientPipeline`. No call sites to migrate; the JSDoc reference in `resilient-pipeline/index.ts` remains as a pointer to the portable counterpart.
- Tests (`__tests__/patterns/resilient-pipeline.test.ts` rewritten): 17 cases covering Graph-subclass shape / per-layer presence / describe surface / reactive options / Node-form `undefined` cache fallthrough / `tagFactory` provenance / primitive factory-tag preservation / `rateLimitState` shape / `domainMeta` per-layer assertions across all 7 layers (rate-limit / budget / breaker / timeout / retry / fallback / status). 17/17 green.
**Depends on:** Tier 3.1 (retry / breaker / timeout / fallback supervisors), Tier 3.2 (rateLimiter / tokenBucket throttles + `withStatus`), Tier 3.3 (`budgetGate`), Tier 1.5.3 (graphspec factory tagging).

### 5.3 Unit 8 — graphLens reshape ✅ landed (2026-04-27, smaller scope per Session A.4 lock)
- **`LensGraph` class deleted** along with `TopologyStats` / `computeTopologyStats` / `topologyStatsEqual` / `pathFilter` / `maxFlowPaths` / `why` / `flowEntryNode` / `whyCacheSize` (the audit's J+K lock surface — superseded by this reshape). Callers needing causal chains use `target.explain(from, to, { reactive: true })` directly; topology stats are a one-line `derived([topology], computeStats)` over the new preset's `topology` Node.
- **Shipped `graphLens(target)`** in [patterns/lens/index.ts](src/patterns/lens/index.ts) (~80 LOC including JSDoc, ~50 LOC of code). Wires the preset over the already-shipped `describe({reactive:true})` + `observe({reactive:true, tiers:["data"]})`:
  - `topology: Node<GraphDescribeOutput>` — `target.describe({reactive: true, detail: "standard"})`. Re-emits on structural change AND status transitions (`_describeReactive` already listens to data/error/complete/teardown observe events; we don't need a separate `failures` dep).
  - `health: Node<HealthReport>` — `derived([topology], computeHealthReport, {equals: healthReportEqual, meta: domainMeta("lens", "health")})`. Equality-deduped.
  - `flow: Node<ReadonlyMap<string, FlowEntry>>` — `derived([dataFlow, topology], …, {meta: domainMeta("lens", "flow")})`. Closure-mirror map (COMPOSITION-GUIDE §28). Each emit applies new changeset events FIRST then reconciles against topology so removed nodes drop entries cleanly. `lastAppliedChangeset` reference guards against double-applying when topology re-emits without a new changeset.
  - `dispose()` — tears down `topologyHandle.dispose()` + `keepalive(health)` + `keepalive(flow)`. Idempotent.
- `HealthProblem` / `HealthReport` / `FlowEntry` / `GraphLensView` types exported. `computeHealthReport` + `healthReportEqual` exported as pure helpers for composition. `watchTopologyTree` re-export retained.
- Tests (`__tests__/patterns/lens.test.ts` rewritten): 11 cases covering topology live re-emit / structural change / transitive subgraph coverage / health ok / health error transition / upstreamCause / flow per-path counter / qualified-path keys / removal reconciliation / fresh-snapshot-per-emit / domain-meta tagging via `describeNode` / lifecycle dispose. 11/11 green.
- README "6 vision blocks" line: `graphLens()` row now describes "topology / health / flow data + use `graph.explain({ reactive: true })` for causal chains" — pending follow-up edit (out-of-scope for this pass).
**Depends on:** Tier 1.5.1 (describe-reactive), Tier 1.5.2 (observe-reactive + tiers), Tier 3.5 (D.2.2 `reactiveExplainPath` deletion).

---

## Tier 6 — Harness composition ✅ landed (2026-04-28, Wave 2C)

All seven sub-units landed across earlier feature waves and the Tier 6.5 C2 batch. Status reconciliation captured below; code citations point to the current `loop.ts`.

### 6.1 Unit 16 — Stratify → Hub + TopicBridgeGraph (Session B.1 + B.2 lock) ✅ landed
`HarnessGraph.queues` IS `MessagingHubGraph` directly ([loop.ts:251](src/patterns/harness/loop.ts:251)). Routing is data (topic name) — `triageOutput` published by router effect, `topicBridge`s fan out by `map: (item) => item.route === route ? item : undefined` per-route + `__unrouted` dead-letter ([loop.ts:466–479](src/patterns/harness/loop.ts:466)). Foreign-node-accept canonical: gate consumes `topic.latest` directly, no `gateGraph.mount` of foreign topics ([loop.ts:539–553](src/patterns/harness/loop.ts:539)).

### 6.2 Unit 17 — GATE stage reshape + `gate()` primitive shape (Session B.1 lock) ✅ landed
Per-route `gateGraph.approvalGate(route, topic.latest, opts)` between hub topic and the merge-into-executeFlow bridge ([loop.ts:539–553](src/patterns/harness/loop.ts:539)). Foreign-node-accept eliminated the `gateGraph.add(...)` ceremony.

### 6.3 Unit 20 — Named nodes (Session B.3 lock) ✅ landed (2026-04-28)
Tier 6.5 C2 reshape registered all pre-1.0 anonymous intermediates with descriptive names: `triage-input`, `triage`, `router-input`, `execute-input`, `execute-enqueue`, `verify-dispatch`, `reflect`, `strategy` ([loop.ts:792–800](src/patterns/harness/loop.ts:792)). The `executeFlow` JobFlow exposes per-stage queues + pumps via standard mount paths (`executeFlow::execute::*`, `executeFlow::verify::*`).
- **✅ Regression test landed:** [harness.test.ts](src/__tests__/patterns/harness.test.ts) "explain(intake.latest, reflect) returns a chain with no `<anonymous>` steps" — walks the causal chain end-to-end and asserts no step path contains `<anonymous>`.

### 6.4 Unit 18b — `fastRetry` extraction + 3 correctness fixes ✅ landed
The pre-Tier-6.5 fastRetry effect carried all three Unit 18b fixes (Unit 18b C: source/severity preserved on reingestion; D: null-execRaw guard; E: errorClassifier consumes the executor's real outcome). The Tier 6.5 C2 reshape replaced the fastRetry effect with a **post-completed dispatch effect** at [loop.ts:684–747](src/patterns/harness/loop.ts:684). All three correctness invariants survive: source/severity preserved at the structural-failure reingest path, null-payload guards (`if (execution == null || verify == null) ackJob(item); continue;`), and the error classifier consumes `execution.outcome` for the self-correctable / structural decision. Helper extraction (`assembleResult` / `handleVerified` / `handleRetry` / `handleStructural`) carried forward into the dispatch-effect body.

### 6.5 JobFlow claim/ack/nack for EXECUTE ✅ landed (2026-04-28, C2 lock — Tier 6.5)
**EXECUTE → VERIFY now runs through an internal `executeFlow` JobFlow** with two stages (`execute`, `verify`) ([loop.ts:582–602](src/patterns/harness/loop.ts:582)). The Q1–Q6 design lock (2026-04-28) shaped the implementation:
- **Q1 — C2 partial JobFlow:** pre-flow (intake / triage / queues / gates / retry topic) unchanged; only EXECUTE → VERIFY moved into JobFlow.
- **Q2 — Verify outcome encoding (b1):** verify work fn always emits a `HarnessJobPayload<A>` with `verify: VerifyOutput` populated; JobFlow's binary pump auto-advances to `flow.completed`; the post-completed dispatch effect routes the 3-way verdict.
- **Q3 — Reingest:** stays imperative `intake.publish(...)` from inside the dispatch effect (§32 / §35 sanctioned terminal side-effect with audit trail).
- **Q4 — Gates:** stay pre-JobFlow (per-route `gateGraph.approvalGate(...)`).
- **Q5 — Parallelism:** `executeMaxPerPump` / `verifyMaxPerPump` opt-in caps in `HarnessLoopOptions`; default `Number.MAX_SAFE_INTEGER` (matches today's unbounded `merge()` parallelism). **D1 follow-up landed (2026-04-28):** `JobFlow.StageDef.maxPerPump` per-stage override added; harness now passes `executeMaxPerPump` and `verifyMaxPerPump` as independent per-stage caps (no more `Math.min` collapse). `optimizations.md` "Per-stage `maxPerPump` on JobFlow" entry resolved.
- **Q6 — Executor / verifier interface:** breaking change pre-1.0. Old `(input: Node<TriagedItem | null>) => Node<ExecuteOutput<A> | null>` shape replaced with work-fn shape `(job: JobEnvelope<HarnessJobPayload<A>>) => NodeInput<HarnessJobPayload<A>>` ([types.ts:HarnessExecutor / HarnessVerifier](src/patterns/harness/types.ts)). `defaultLlmExecutor` / `defaultLlmVerifier` migrated to direct `adapter.invoke()` calls via the shared `_oneShotLlmCall` helper ([patterns/ai/_internal.ts](src/patterns/ai/_internal.ts), D2 extraction) — the helper owns subscription / abort / first-DATA capture / COMPLETE-without-DATA arm; call sites own JSON parse + payload mapping. `refineExecutor` / `actuatorExecutor` / `evalVerifier` migrated to per-claim work-fn shape (no internal switchMap — pump owns per-claim lifecycle).
  - **Bridge-layer error classification (Q2 extension via qa F3, 2026-04-28):** parse / adapter throw / ERROR / COMPLETE-without-DATA paths classify as `errorClass: "self-correctable"` so the dispatch effect routes via the retry budget; only the defensive "no prior execution" guard stays `structural`. Symmetric on executor side via the `defaultErrorClassifier` regex matching `parse|json|config|validation|syntax` keywords in the failure detail.
  - **Q6 scope clarification (D2):** "no `promptNode` internally" applies to EXECUTE/VERIFY default work fns. TRIAGE retains `promptNode` because it legitimately needs cross-wave switchMap supersede (one node watches all intake items); per-claim work-fn shape doesn't fit. Documented in `archive/optimizations/resolved-decisions.jsonl`.

**Per-route `jobQueue` audit mirrors retained** as a parallel ledger ([loop.ts:497–530](src/patterns/harness/loop.ts:497)). Two complementary observability axes:
- **Per-route depth/pending** (this ledger) — "how backed up is auto-fix?"
- **Per-stage depth/pending** (executeFlow's stage queues) — "how many items are mid-execute?"

**`harnessTrace` / `harnessProfile` updated** via `HarnessGraph.stageNodes()` ([loop.ts:339–360](src/patterns/harness/loop.ts:339)): EXECUTE label points at `executeFlow::execute::events`, VERIFY at `executeFlow::verify::events`. Inspection-tools decoupling held — no edits to `trace.ts` or `profile.ts` were needed.

**D3 — Stage trace path semantics changed pre-1.0.** Pre-Tier-6.5 the EXECUTE / VERIFY observable paths emitted `ExecuteOutput<A>` / `VerifyOutput` payloads (the `executeNode` / `verifyNode` Nodes). Post-Tier-6.5 they emit `JobEvent` audit-stream records (`{action: "enqueue"|"claim"|"ack"|"nack"|"remove", id, attempts, t_ns, seq, payload?}`). Anyone calling `harness.observe("execute")` directly (rather than via the labeled stage paths) gets path-not-found; anyone observing the labeled stages gets a different message shape. For verdict payloads, observe `harness.executeFlow.completed` (`Node<readonly JobEnvelope<HarnessJobPayload<A>>[]>`) instead. Pre-1.0 break documented; no migration shim shipped.

**FIFO-mismatch hazard resolved by design.** The pre-Tier-6.5 inline comment defending `removeById` against decoupled `claim`/`ack` across reactive waves is now obsolete: JobFlow's pump owns the entire `claim → work → ack` lifecycle in one closure ([job-queue/index.ts](src/patterns/job-queue/index.ts) pump body), so the cross-wave decoupling that motivated the hazard never arises. The audit-side jq ledger keeps `enqueue + removeById` semantics by design (purely an audit log of route entries; ack-by-id via `trackingKey` lookup).

**Tests:** all 2470 tests passing (1 new explain regression for Tier 6.3, full executor-variant test migration to work-fn shape covering happy path / failure modes / one-DATA-per-claim contract / dispatchActuator route resolution / actuator+evalVerifier end-to-end / refine+evalVerifier convergence). Build green; lint at the 9-warning baseline.

**Out-of-scope deviations from the C2 lock:**
- `promptNode` no longer used internally by the harness (the work-fn shape doesn't benefit from cross-wave switchMap). `promptNode` stays the canonical primitive for **persistent reactive LLM transforms** (agentLoop, user code, the harness's TRIAGE stage which still uses it).
- `executeContextNode` pairing eliminated — payloads carry `item` through stages, removing the cross-wave `withLatestFrom` pairing that was load-bearing pre-C2.

### 6.6 Unit 1 — `promptNode` JSDoc + test gate (Session C lock, reduced scope) ✅ landed
- **✅ JSDoc cross-link to COMPOSITION-GUIDE §32 landed:** [prompt-node.ts:31–38](src/patterns/ai/prompts/prompt-node.ts:31) — cross-wave cache stickiness pattern.
- **✅ Middleware recipe landed:** [prompt-node.ts:16–29](src/patterns/ai/prompts/prompt-node.ts:16) and [:129–131](src/patterns/ai/prompts/prompt-node.ts:129) — `withRetry` / `withReplayCache` adapter stack.
- **✅ Isolated unit test (Session C L8) landed (2026-04-27):** [phase5-llm-composition.test.ts](src/__tests__/phase5-llm-composition.test.ts) — "N upstream dep waves → exactly N DATAs on `prompt_node::output`, zero transient nulls, zero coalesce loss" covering 3 waves with synchronous `mockAdapter`. Locks the contract independent of harness entanglement.
- **✅ Open Q (Session C L9) resolved (2026-04-27):** `prompt_node::call` is **transient by design** — it activates inside switchMap during a wave and tears down on supersede / COMPLETE. With a synchronous adapter the producer activates and completes within the same wave, so steady-state `describe()` only shows `::messages` + `::output`. Mid-wave `describe()` (real async adapter, observed during in-flight call) WOULD see `::call` via `meta.ai = "prompt_node::call"`. Regression test landed in `phase5-llm-composition.test.ts`.

### 6.7 Unit 2 — `gatedStream` timing (3 skipped tests) ✅ landed
The 4 previously-skipped tests un-skipped at [ai.test.ts:894–1034](src/__tests__/patterns/ai.test.ts:894). Inline comment confirms the keepalive fix on the gate's output node, which closed the activation gap that left streamed values reaching the gate's input but never entering the pending queue.

---

## Tier 7 — AI module ergonomics ✅ landed (reconciled 2026-04-28; units shipped earlier across Waves A/2A/AM, plan markup caught up here)

### 7.1 Unit 14 — `firstDataFromNode` migration + Unit 6 `executeReactive` ✅ landed (Wave A Unit 4 trio, 2026-04-24)
`executeReactive(name, args) → Node<unknown>` shipped at [tool-registry.ts:98](src/patterns/ai/agents/tool-registry.ts:98); `toolExecution` consumes it at [tool-execution.ts:151](src/patterns/ai/agents/tool-execution.ts:151); imperative `execute()` was removed in the QA pass (2026-04-24). `firstDataFromNode` retained as sanctioned boundary bridge in [_internal.ts:53](src/patterns/ai/_internal.ts:53).

### 7.2 C24-7 — Reactive spec/strategy variants ✅ landed
`graphFromSpecReactive(input, adapter) → Node<Graph>` shipped at [graph-from-spec.ts:144](src/patterns/ai/graph-integration/graph-from-spec.ts:144); `suggestStrategyReactive(graph, problem, adapter) → Node<StrategyPlan>` at [suggest-strategy.ts:167](src/patterns/ai/graph-integration/suggest-strategy.ts:167).

### 7.3 Unit 12 — Google SDK swap ✅ landed (DONE 2026-04-24, AI/harness review tail)
`@google/generative-ai` → `@google/genai` in [src/patterns/ai/adapters/providers/google.ts](src/patterns/ai/adapters/providers/google.ts) — `GoogleSdkLike` tightened to single-param `generateContent({ model, contents, config })` shape, `abortSignal` under `config`. `package.json` already on `@google/genai ^1.48.0`.

### 7.4 C24-1 — `compileSpec` `opts.onMissing` mode ✅ landed
`onMissing?: "error" | "warn" | "placeholder"` (default `"placeholder"`) shipped at [graphspec/index.ts:709](src/patterns/graphspec/index.ts:709) with `MissingCatalogEntry` aggregation across compile passes.

### 7.5 DF12 — `promptNode.tools` reactive widening ✅ landed (2026-04-28, Tier 7+8 batch)
`tools?: Node<readonly ToolDefinition[]>` — pure reactive declared edge (no static-array path; internal-only API, no callers needed preservation). Tools Node is appended to `messagesNode`'s declared deps in [prompt-node.ts](src/patterns/ai/prompts/prompt-node.ts), so tools changes re-invoke the LLM and the tools edge appears in `describe()` / `explain()`. `messagesNode` emits an envelope `{ messages, tools }` consumed by the per-wave switchMap inner. Activation note in JSDoc: caller passes `state<ToolDefinition[]>([])` for immediate activation with no tools. Regression test in `ai.test.ts` `patterns.ai.promptNode > "reactive tools: tools Node feeds the adapter and re-invokes on tools change"`.

---

## Tier 8 — Wave C cross-pattern mutation framework migration ✅ landed (2026-04-28, with two deferrals)

**γ-0 (framework change):** `MutationOpts.audit?` made optional. `lightMutation` / `wrapMutation` now provide freeze + rollback + seq-advance + re-throw semantics independent of audit-record emission. Cluster II sites adopt the framework without introducing new audit log Node surfaces. `MutationOpts<TArgs, R>` widened to `MutationOpts<TArgs, TResult, R>` so `onSuccess` builders see the typed result rather than `unknown`. See [extra/mutation/index.ts:149](src/extra/mutation/index.ts:149).

| # | Site | Tool | Status |
|---|---|---|---|
| 1 | `messaging/Topic.publish` | `lightMutation` | ✅ landed (no audit; route through framework for centralized re-throw — `events` log already records publishes) |
| 2 | `messaging/Subscription.ack` | `lightMutation` | ✅ landed (no audit; cursor's emission stream already records advances) |
| 3 | `messaging/Subscription.pullAndAck` | `lightMutation` | ✅ landed (corrected from plan's `Subscription.take`; `pull` skipped — read-only) |
| 4 | `messaging/Hub.delete` (i.e. `removeTopic`) | `lightMutation` | ✅ landed (no audit; γ-4 closure-state JSDoc caveat added) |
| 5 | `cqrs/dispatch` | `wrapMutation` | ✅ landed (highest-value: replaces ~110 LOC inline impl with framework call; M5 / C4 invariants preserved; `cmdNode.meta.error` only stamped when user handler throws via `actionThrew` flag) |
| 6 | `cqrs/saga` | `lightMutation` | ✅ landed (per-event handler invocation hoisted as `auditedHandler` wrapper; outer try/catch retained for `errorPolicy` advance/hold semantics; downgraded from `wrapMutation` because per-event batch frames would change saga's wave timing) |
| 7 | `process/start` | `wrapMutation` | **DEFERRED** — wrapping would change failure semantics: today swallows synthetic-event-emit errors and still records "running"; `wrapMutation` rollback would convert that into "failed dispatch". Surface for design call before migrating. |
| 8 | `process/cancel` | `wrapMutation` | **DEFERRED** — fire-and-forget async compensate; `wrapMutation` is sync-only. Wrapping the synchronous prelude alone adds noise without value. Same design call as #7. |
| 9 | `job-queue/enqueue` | `lightMutation` | ✅ landed (private `_enqueueImpl` instance field; lightMutation bumps seq before action runs, action body reads `_seqCursor.cache` for auto-id generation) |
| 10 | `job-queue/ack` | `lightMutation` | ✅ landed (private `_ackImpl`) |
| 11 | `job-queue/nack` | `lightMutation` | ✅ landed (private `_nackImpl`) |
| 12 | `job-queue/removeById` | `lightMutation` | ✅ landed (private `_removeByIdImpl`) |

**`job-queue/claim` retained inline** — multi-record loop emits one record per claimed job; `lightMutation`'s single-call → single-record contract doesn't fit. `claim` now uses the framework's `bumpCursor(this._seqCursor)` helper directly per iteration.

**Plan deviations from γ-1..6 confirmation:**
- γ-1 collapsed by γ-0: no `attachAudit()` lazy-attach method shipped; messaging sites simply route through framework with `audit` omitted. Future audit consumers can later add a `MessagingHubMutation` / `TopicMutation` / `SubscriptionAckMutation` record schema and pass `audit` through if a real consumer surfaces.
- γ-2 cqrs cursor: `_dispatchSeqCursor` was already promoted via `registerCursor` pre-Tier-8 (Wave 2C). γ-2 closure-counter promotion confirmed already in place across cqrs/job-queue.
- γ-5 / γ-6 deferred to Tier 10 follow-up (audit-record schemas + `keyOf` exports for messaging primitives — only meaningful when a real audit consumer surfaces).

**Tests added:** 3 regression tests (`extra/mutation/mutation.test.ts` × 2 — `lightMutation` and `wrapMutation` audit-omitted opt-in; `patterns/ai.test.ts` × 1 — DF12 reactive tools re-invoke).

**Verification:** 2491 tests passing (+3 new), build green (ESM + CJS + DTS), lint clean at 9-warning baseline.

**Depends on:** Tier 2.2 (mutation framework promoted), Tier 4 + 5 (proof-of-concept established).

---

## Tier 9 — Consolidation finishing (Phases 4–5)

### 9.1 Phase 4 — presets split ✅ landed (2026-04-28, γ-form γ-β / γ-ii / γ-II / γ-R-2)

Folder reorg locks: γ-β (sub-folder per preset), γ-ii (`inspect/` sub-files mirror old folders), γ-II (`inspect()` is a `Graph` subclass), γ-R-2 (`resilientPipeline` lives in `extra/resilience/`, not `ai/`), Q5-5 (i) (`agentMemory` / `agentLoop` physically moved), Q5-6 medium (`inspect()` composes lens + auditTrail + explainTarget facade + `complianceSnapshot()` method; `policyGate` stays separate).

**Physical moves landed:**
- `patterns/resilient-pipeline/` → [extra/resilience/resilient-pipeline.ts](src/extra/resilience/resilient-pipeline.ts) (γ-R-2). Re-exported through `extra/resilience/index.ts`. Old folder moved to `TRASH/`.
- `patterns/refine-loop/` → [patterns/harness/presets/refine-loop.ts](src/patterns/harness/presets/refine-loop.ts) (γ-β). Re-exported through `patterns/harness/index.ts`. Old folder moved to `TRASH/`.
- `patterns/harness/loop.ts` → [patterns/harness/presets/harness-loop.ts](src/patterns/harness/presets/harness-loop.ts) (γ-β).
- `patterns/ai/memory/agent-memory.ts` → [patterns/ai/presets/agent-memory.ts](src/patterns/ai/presets/agent-memory.ts) (Q5-5 (i)).
- `patterns/ai/agents/agent-loop.ts` → [patterns/ai/presets/agent-loop.ts](src/patterns/ai/presets/agent-loop.ts) (Q5-5 (i)).
- `patterns/audit/index.ts` + `patterns/lens/index.ts` + `patterns/guarded-execution/index.ts` merged into [patterns/inspect/](src/patterns/inspect/) as sub-files (γ-ii). Old folders moved to `TRASH/`.

**New `inspect()` preset** (Q5-6 medium scope) at [patterns/inspect/presets/inspect.ts](src/patterns/inspect/presets/inspect.ts) — `class InspectGraph extends Graph` mounts `graphLens(target)` + `auditTrail(target)` and exposes `explainTarget(...)` (delegates to `target.explain`) + `complianceSnapshot()` method. Mounts `lensTopology` / `health` / `flow` (lens nodes) and `audit::*` (auditTrail subgraph) under stable describable paths. `policyGate` intentionally NOT bundled — control-plane primitive, conceptually distinct from inspection.

**Pre-1.0 break inventory** (no shims):
- `patterns/index.ts`: dropped `accountability` / `lens` / `guarded` / `resilientPipeline` / `refine` namespaces. New `inspect` namespace replaces audit + lens + guarded-execution. `resilientPipeline` ships through `@graphrefly/graphrefly/extra`. `refineLoop` / `harnessLoop` ship through `harness.refineLoop` / `harness.harnessLoop`.
- `package.json` exports: dropped `./patterns/audit`, `./patterns/lens`, `./patterns/guarded-execution`, `./patterns/refine-loop`, `./patterns/resilient-pipeline`. Added `./patterns/inspect`.
- `tsup.config.ts` ENTRY_POINTS updated.
- Symbol rename: `bridge.ts` `EvalResult` → `EvalRunResult` (collision with `refine-loop.ts` `EvalResult`; bridge's shape was `{run_id, model, tasks}` — distinct from refineLoop's `{taskId, score, candidateIndex}` per-task scoring shape; bridge had narrower blast radius).

**Tests added:** `src/__tests__/patterns/inspect-preset.test.ts` — 6 cases covering subclass shape, mounted lens node names, target-ref + lens + audit access, `explainTarget(static)`, `complianceSnapshot()`, audit subgraph mount.

**Test import migrations:** ~10+ test files updated (audit / lens / guarded-execution → inspect/*; refine-loop → harness/presets/refine-loop; resilient-pipeline → extra/resilience; agent-memory + agent-loop → ai/presets/*; harness loop.ts → harness/presets/harness-loop).

### 9.2 Phase 5 — `classifyError` (only when caller surfaces) — DEFERRED
`classifyError(source, classifierFn) → { routes: Record<string, Node<T>> }` in `extra/resilience/`. Defer until a real consumer needs it.

### 9.3 Topology check as shipped utility ✅ landed (2026-04-28)
[`validateNoIslands(graph)`](src/graph/validate-no-islands.ts) companion to `validateGraphObservability`. Returns `{ orphans: readonly string[]; ok: boolean; summary() }`. Reports nodes with zero in-edges AND zero out-edges (true islands); sources (≥1 out, 0 in) and sinks (≥1 in, 0 out) are not flagged. Re-exported from `src/graph/index.ts`. 5 regression tests in [src/__tests__/graph/validate-no-islands.test.ts](src/__tests__/graph/validate-no-islands.test.ts).

---

## Tier 10 — Polish, follow-ups, low-priority

### 10.1 `mapFromSnapshot` / `extractStoreMap` cleanup ✅ landed (2026-04-28)
The sibling helper `extractStoreMap` was deleted in Wave AM Unit 5 (Tier 4.7). The `mapFromSnapshot` helper at `composite.ts` was deleted in this batch (Tier 9.1) — replaced with the inline `((snapshot as ReadonlyMap<string, TMem> | undefined) ?? new Map<string, TMem>())` pattern at the 5 former call sites (mirrors Wave AM Unit 5's idiom).

### 10.2 `diffMap<K, V>` operator extraction
Wait for third consumer; YAGNI today.

### 10.3 Harness executor/verifier dev-mode sanity check
Assert ≤1 DATA per input wave in dev mode.

### 10.4 JSDoc additions ✅ landed (2026-04-28, Tier 9.1 batch ride-along)
- C23-2: `Evaluator<T>` JSDoc on `candidateIndex` semantics — already present at [patterns/harness/presets/refine-loop.ts:114–122](src/patterns/harness/presets/refine-loop.ts:114).
- C24-3: `validateSpec` effect-node feedback warning — added at [patterns/graphspec/index.ts](src/patterns/graphspec/index.ts) (advisory text on the `validateSpec` JSDoc explaining `warnings` covers feedback-from-effect-node).
- C24-4: `runReduction` sync-settle deferred-unsubscribe ordering invariant — formalized at [patterns/surface/reduce.ts](src/patterns/surface/reduce.ts) `Sync-settle deferred-unsubscribe invariant (C24-4)` block.
- (C24-2 ✅ obsolete — `decompileGraph` removed entirely in Tier 1.5.3 Phase 3; `decompileSpec` is `g.describe({ detail: "spec" })` plus a feedback-edge sugar scan, no fingerprinting.)

### 10.5 Operator-layer `filter` mixed-batch RESOLVED forwarding
Filter drops RESOLVED for failed batch entries → tier-3 counter drift. Low priority; no current consumer affected.
**Blocked by:** operator-layer-wide review session (deferred).

### 10.6 `restoreSnapshot` rejects `mode: "diff"` records
**Blocked by:** §8.7 WAL replay (prerequisite for diff replay).

### 10.7 Performance follow-ups
- Message-array allocation in hot path (A2 landed; tier-3 DATA/ERROR has further headroom).
- Fan-out scaling — sink notification overhead (profiling harness at `src/__bench__/fanout-profile.ts`); ongoing measurement.

### 10.8 Design follow-ups (deferred — file in optimizations.md when re-opened)
- `graphLens` 50k-node scaling (incremental delta stats vs full describe-per-tick). `graphLens(target)` still ships as a standalone factory; the `inspect()` preset embeds an instance as `inspect.lens.*` (Tier 9.1) — the scaling concern applies in both consumption modes.
- `graphLens.health` V2 (`completed` / `disconnected` flag classes; aggregate metrics).
- `lens.flow` delta companion.
- TopicGraph reactive `retainedLimit` (unblocks reactive `violationsLimit` on `policyGate` — `policyGate` now lives at [patterns/inspect/audit.ts](src/patterns/inspect/audit.ts) post Tier 9.1 γ-ii merge).
- `Graph.explain({reactive: true})` file-path-scoped observe (composes with Tier 1.5.2 `tiers` filter — natural follow-on for `pathScope` opt). The legacy `reactiveExplainPath` was deleted in Tier 3.5; the equivalent capability lives on `Graph.explain(...)` with `reactive: true` per Tier 1.5 / 3.5.
- End-of-batch `_handleBudgetMessage` boolean-return / forward-unknown audit across producer-pattern factories.
- `withStatus` decomposition (alternative (e)). Lives at [extra/resilience/index.ts](src/extra/resilience/index.ts) post Tier 2.1 reorg.
- `refineLoop` persistent re-seed / reset surface (awaits real-world demand). Lives at [patterns/harness/presets/refine-loop.ts](src/patterns/harness/presets/refine-loop.ts) post Tier 9.1 γ-β.

### 10.9 InspectGraph + processManager carry-throughs from Tier 9.1 /qa (added 2026-04-28)
Defer-until-consumer items surfaced by /qa B-group fixes; tracked here so they don't get lost when revisiting Tier 9 / Tier 10:
- **Framework gap:** `Graph._destroyClearOnly` doesn't drain child mounts' `_disposers`. Affects every mounted child graph (auditTrail, LensSubgraph, etc.). Fix: drain `child._disposers` inside `_destroyClearOnly` before clearing structure. Defer until a real disposer leak is observed in production.
- **`processManager.dispose()` doesn't unmount mounted nodes** (`${name}_process_seq`, `${name}_process_instances`). Fixture-style create+dispose loops accumulate nodes on the cqrsGraph indefinitely. Long-term fix: either `Graph.removeNode(name)` (broad feature) OR mount under a child `mount("__processManagers__/${name}", subgraph)` for clean teardown.
- **`auditTrail.includeTypes` introspectability** — currently private. Expose as readonly field or via meta so consumers can validate `complianceSnapshot.fingerprint` against the exact recorded set.
- **`validateNoIslands` reactive companion** — for continuous-validation use cases on large graphs (10k+ nodes), each call rebuilds the full `describe({detail:"minimal"})` snapshot. Future: `validateNoIslandsReactive(graph): Node<ValidateNoIslandsResult>` subscribed to topology changes.
- **`bumpCursor` silent reset diagnostic** — surface a one-shot `console.warn` (or meta-counter) when a cursor restores from a non-numeric snapshot, so seq-monotonicity violations don't cascade silently.

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
1. ✅ Land Tier 1.1 spec amendment + Tier 1.6.1 COMPOSITION-GUIDE §38 (doc-only edits in `~/src/graphrefly`).
2. ✅ Run Session C (Tier 1.2) — short, can happen alongside other work.
3. ✅ Implement Tier 1.5.1 + 1.5.2 (describe-diff, observe-reactive, tiers filter) — they unblock Tier 5.3 graphLens preset.
4. ✅ Implement Tier 1.5.3 (GraphSpec ≡ GraphDescribeOutput) — Phases 1, 2, 2.5, 3 all landed.
5. ✅ Land Tier 2.1 reorg (mechanical split + renderer extraction). **Carry:** per-category sub-file split inside `operators/` / `sources/` / `io/` / `resilience/` — physical mega-file move done; canonical body still lives in each `<folder>/index.ts`. Schedule the per-protocol split in a follow-up batch.
6. ✅ Land Tier 2.2 + Tier 2.3 (Wave 2A — promotions + renames + outcome/status enum migrations).
7. ✅ Land Tier 3 audits (Wave 2B — 5 units via 3 parallel agents; required port pass since worktrees branched from main).
8. ✅ Tier 5.1 (`guardedExecution`) + Tier 5.3 (`graphLens` reshape) landed (2026-04-27, parallel batch).
9. ✅ Tier 5.2 (`resilientPipeline` Graph-subclass rewrite + reactive options + companions + `tagFactory` provenance) and Tier 4 Wave AM follow-ups (Unit 1 `DEFAULT_DECAY_RATE` extraction, Unit 4 `llm-memory.ts` → `prompt-call.ts` promotion, Unit 5 `extractStoreMap` deletion) landed (2026-04-27). Wave A + Wave AM closed; Wave B closed.
10. ✅ /qa pass on Tier 5.2 + Wave AM batch (2026-04-28) — all approved fixes patched in-batch:
    - **G1A "same concept"** — `wrapper.scopedDescribe: Node<GraphDescribeOutput>` mounted property is the canonical reactive describe (one per wrapper, no per-call leak). `scopedDescribeNode(actorOverride, opts)` retained as the per-call escape hatch returning `{node, dispose}`.
    - **G1B** — caller-supplied `Node<Actor>` bridged through a derived w/ `null` initial to avoid SENTINEL stall on `scope`.
    - **G2A** — `graphLens.flow` uses monotonic `flushedAt_ns` cursor instead of changeset ref-comparison.
    - **G1C-prime** — `readOnce(opt.cache)` imperative-read removed from `resilient-pipeline`. Node-form pipeline options (rateLimit / budget / breaker / timeoutMs / retry) now use **switchMap-pattern rebuild**: subscribe to option Node, rebuild the layer on each emission. Per-layer companions exposed only for the static-options path. State-loss caveat documented; primitive-side widening remains the long-term fix.
    - **G2B (doc-only)** — F3/F6/F8 inline comments tightened; EC7 `rateLimitState` JSDoc clarified ("resets on producer-fn re-run"); EC5/EC6/EC7/F9 deferred items filed in [docs/optimizations.md](docs/optimizations.md) under "QA follow-ups from Tier 5.2 + Wave-AM /qa pass".
11. ✅ Tier 6 harness composition landed (2026-04-28, Wave 2C). Tier 6.5 C2 lock (`executeFlow` JobFlow chain replacing `merge → executor → verifier → fastRetry`) implemented; Tier 6.3 named-node registrations + explain regression test in place; Tier 6.1 / 6.2 / 6.4 / 6.6 / 6.7 reconciled as already-landed across earlier feature waves. Breaking executor/verifier interface change pre-1.0: `(input: Node<T>) => Node<U>` → `(job: JobEnvelope<HarnessJobPayload<A>>) => NodeInput<HarnessJobPayload<A>>`. `defaultLlmExecutor` / `defaultLlmVerifier` migrated to direct `adapter.invoke()` (no internal `promptNode`). All 2470 tests passing; build green; lint at 9-warning baseline.
12. ✅ Tier 7 (AI ergonomics) markup reconciliation + DF12 (`promptNode.tools` reactive widening) and Tier 8 (Wave C cross-pattern mutation framework migration) landed (2026-04-28, single batch). Framework change γ-0 (`MutationOpts.audit?` optional) collapsed γ-1's audit-Node design tension; messaging sites adopt the framework without new audit surfaces. Two `process/*` migrations deferred (#7, #8) due to failure-semantics conflict — surface to a design call before migrating. 2491 tests passing; build green; lint at 9-warning baseline.
13. ✅ Tier 9.1 γ-form full (presets split + audit/lens/guarded-execution → inspect merge + new `inspect()` factory) + Tier 9.3 (`validateNoIslands`) + Tier 10.1 (`mapFromSnapshot` deletion-then-restore) + Tier 10.4 (JSDoc additions) + Tier 4 markup reconciliation + γ-7-B (process appendRecord lightMutation-wrap) landed (2026-04-28, single batch). Pre-1.0 break: dropped `./patterns/{audit,lens,guarded-execution,refine-loop,resilient-pipeline}` subpaths; added `./patterns/inspect`; renamed bridge.ts `EvalResult` → `EvalRunResult` (collision with refine-loop's `EvalResult`). 2502 tests passing (+6 inspect-preset, +5 validateNoIslands); build green; lint at 9-warning baseline.
14. ✅ /qa pass on Tier 9.1 batch (2026-04-28) — all approved patches applied in-batch:
    - **D1** — lens lives in a child `LensSubgraph` mounted at `lens::*`. `inspect.destroy()`'s TEARDOWN signal cascade reaches the lens via `_destroyClearOnly` (no broadcast) instead of via `_signalDeliver` over `inspect._nodes`. External `view.lens.topology.subscribe(...)` references are no longer invalidated by the parent's TEARDOWN broadcast.
    - **D2** — `mapFromSnapshot` helper restored at [extra/composite.ts](src/extra/composite.ts) and a parallel defensive `instanceof Map` check added at [ai/adapters/core/capabilities.ts](src/patterns/ai/adapters/core/capabilities.ts). Tier 10.1's deletion was over-eager; the helper is the safety net for snapshot-restore paths where `JsonGraphCodec` round-trips a `Map` as a plain `{}`.
    - **D3** — `processManager` detects existing `${name}_process_instances` / `${name}_process_seq` mounts via `cqrsGraph.tryResolve(...)` and throws a specific error message before attempting `Graph.add`.
    - **D4** — `appendRecord` `freeze: true` (process states are typically small workflow records; prevents post-record state mutation from corrupting audit history).
    - **D5** — saga audit-record `aggregateId` always includes the key (parity with pre-Tier-8 shape; preserves `Object.hasOwn` semantics).
    - **D6** — accepted dispatch error-emit ↔ audit-append order flip (no code change; both events still fire same-wave).
    - **D7** — `validateNoIslands` JSDoc strengthened to call out the false-positive case (state nodes consumed only by external subscribers).
    - **A1** — `inspect()` self-tags via `tagFactory("inspect", placeholderArgs(opts))`.
    - **A2/A3** — `validateNoIslands` returns `IslandReport[]` with `{path, kind}` (kind helps triage state-orphans vs derived-orphans).
    - **A4** — added 4 new inspect-preset tests (reactive `explainTarget`, `inspect.topology` ≠ `inspect.lens.topology`, lens-mount path qualification, lens observes target not inspect) + 1 subgraph test for `validateNoIslands`.
    - **A5** — `appendRecord` / `appendRecordWithReason` collapsed into one helper.
    - **A6** — `InspectGraph.complianceSnapshot.policies` typed directly as `PolicyGateGraph`.
    - **A7** — fingerprint truncation caveat echoed in `inspect.complianceSnapshot()` JSDoc.
    - **A8** — `auditTrail` seq overflow comment fixed ("stagnates" not "wraps").
    - **A9** — `validateNoIslands` sort test now uses ASCII-distinct insertion order.
    - **A10** — `InspectGraph` JSDoc tightened to clarify path-namespace boundary (inspect.node("counter") does NOT resolve into target).
    - Remaining deferred items filed in [docs/optimizations.md](docs/optimizations.md) "QA follow-ups from Tier 9.1 /qa pass".
    - 2508 tests passing (+9 over Tier 9.1 land); lint clean (9-warning baseline); build green.
15. **← NEXT.** Tier 9.2 `classifyError` deferred (no caller). Remaining: Tier 8 γ-7-A (`process/start` + `cancel` full `wrapMutation` migration design call still outstanding), Tier 10.2/10.3/10.5/10.6/10.7/10.8 (perf + design follow-ups, all defer-until-consumer). No pressing structural work remains; next batches are likely thin polish or new feature work.
