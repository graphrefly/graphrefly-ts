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
- **⏳ `format` option removal — deferred to Tier 2.1:** drop pairs naturally with the renderer extraction so consumers and tests migrate atomically. Tracked there.
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

### 2.1 Consolidation Phase 1 — `extra/` folder split + renderer extraction
- **From consolidation plan §"Phase 1":** Mechanical codemod splitting `operators.ts`, `sources.ts`, `adapters.ts`, `resilience.ts` into folder structures (`operators/`, `sources/`, `io/`, `resilience/`, `data-structures/`, `storage/`, `composition/`).
- **From Session A.1 (carries Tier 1.5.1 deferred item):** Extract describe formatters into `extra/render/` as pure functions over `GraphDescribeOutput`:
  - `toMermaid`, `toMermaidUrl`, `toAscii`, `toD2`, `toPretty`.
  - Drop `format` option from `describe` API in the same change; consumers compose `describe → derived(toMermaid)` for live formatted output. Migrate ~10 in-tree consumers ([loop.ts](src/patterns/harness/loop.ts), [demo-shell/index.ts](src/patterns/demo-shell/index.ts), [llm-memory.ts](src/patterns/ai/memory/llm-memory.ts), [streaming.ts](src/patterns/ai/prompts/streaming.ts), [describe-ascii.ts](src/graph/describe-ascii.ts), tests in [graph.test.ts](src/__tests__/graph/graph.test.ts), [codec.test.ts](src/__tests__/graph/codec.test.ts), [describe-ascii.test.ts](src/__tests__/graph/describe-ascii.test.ts), [ai.test.ts](src/__tests__/patterns/ai.test.ts), [adapters.storage.test.ts](src/__tests__/extra/adapters.storage.test.ts)).
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
- Apply Tier 1.6.2 outcome-enum + Tier 1.6.3 status-enum migrations across `cqrs`, `process`, `orchestration/pipeline-graph`, `resilient-pipeline`.
- **Phase 2.5 ride-along:** tag the renamed `policyGate` with `g.tagFactory("policyGate", placeholderArgs(opts))` as part of this rename (DT5 deferral). One-line tag + regression test in `factory-tags-orchestration.test.ts` or a new `factory-tags-audit.test.ts`.
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

### 6.6 Unit 1 — `promptNode` JSDoc + test gate (Session C lock, reduced scope)
Implementation already at the locked design (path (b) producer-based, `::call` inner naming, `state(null)` empty-msgs branch, `abort?: Node<boolean>` via `nodeSignal`, `aiMeta("prompt_node::output")`, no `retries`/`cache`, system-prompt single-path via `opts.systemPrompt`). Remaining work:
- Add JSDoc cross-link to COMPOSITION-GUIDE §32 (cross-wave cache stickiness is a consumer concern; consumers add state-mirror).
- Add JSDoc middleware recipe: stack `withRetry` / `withReplayCache` on the adapter for retries/caching.
- **✅ Isolated unit test (Session C L8) landed (2026-04-27):** [phase5-llm-composition.test.ts](src/__tests__/phase5-llm-composition.test.ts) — "N upstream dep waves → exactly N DATAs on `prompt_node::output`, zero transient nulls, zero coalesce loss" covering 3 waves with synchronous `mockAdapter`. Locks the contract independent of harness entanglement.
- **✅ Open Q (Session C L9) resolved (2026-04-27):** `prompt_node::call` is **transient by design** — it activates inside switchMap during a wave and tears down on supersede / COMPLETE. With a synchronous adapter the producer activates and completes within the same wave, so steady-state `describe()` only shows `::messages` + `::output`. Mid-wave `describe()` (real async adapter, observed during in-flight call) WOULD see `::call` via `meta.ai = "prompt_node::call"` — but that's an in-flight observation, not a steady-state expectation. Regression test landed in [phase5-llm-composition.test.ts](src/__tests__/phase5-llm-composition.test.ts).
**Ratified by:** Tier 1.2 (Session C, locked 2026-04-27).

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
1. Land Tier 1.1 spec amendment + Tier 1.6.1 COMPOSITION-GUIDE §38 (doc-only edits in `~/src/graphrefly`).
2. Run Session C (Tier 1.2) — short, can happen alongside other work.
3. Implement Tier 1.5.1 + 1.5.2 (describe-diff, observe-reactive, tiers filter) — they unblock Tier 5.3 graphLens preset.
4. Implement Tier 1.5.3 (GraphSpec ≡ GraphDescribeOutput) — touches factories; do early so later code writes to the unified shape.
5. Land Tier 2.1 reorg (mechanical split + renderer extraction).
6. Branch off Tier 3 audits in parallel with Tier 2.2 + 2.3.
7. Pick up Tier 4 + 5 once 2.2 is in.
8. Tier 6 harness composition once Sessions A+B locks have implementation room (post Tier 1.5 + Tier 5).
