# Roadmap — Active Items (TS + PY)

> **⚠️ Canonical source has moved (2026-04-30):** Active pre-1.0 work is now sequenced in **[`docs/implementation-plan.md`](implementation-plan.md)** (Phases 11–16 + Parked table + Open design sessions). This roadmap is retained as the **vision / wave context document** — useful for the strategic frame (Wave 0/1/2/3 announcement structure, harness engineering positioning, eval-story narrative) but **not authoritative for what's NEXT**. New items go to `implementation-plan.md`; this roadmap is amended only when waves complete and the high-level frame shifts.
>
> **PY parity (TS-paired items, PY Wave 2/3 sections, all `[py-parity-*]` tags):** parked until 1.0 ship per re-prioritization 2026-04-30. See `implementation-plan.md` § Parked.

> **This file was originally the single source of truth** for roadmap tracking across both graphrefly-ts and graphrefly-py. Per the canonical-source migration above, item-level state is no longer maintained here — the residuals have been folded into `implementation-plan.md` Phase 14.5 (refineLoop tail, mockLLM promotion, demo deck, etc.) or the Parked table (post-1.0 distributed, content-addressing depth, memory optimization).
>
> **Completed phases and items have been archived to `archive/roadmap/*.jsonl`.** See `docs/docs-guidance.md` § "Roadmap archive" for the archive structure and workflow.
>
> **Spec:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` (canonical)
>
> **Guidance:** [docs-guidance.md](docs-guidance.md) (documentation), [test-guidance.md](test-guidance.md) (tests). Agent context: repo root `CLAUDE.md`; skills under `.claude/skills/`.
>
> **Predecessors:** callbag-recharge (TS, 170+ modules), callbag-recharge-py (PY, Phase 0–1). Key patterns and lessons carried forward — see `archive/docs/design-archive-index.jsonl` for lineage. Clone paths: `~/src/callbag-recharge` (TS), `~/src/callbag-recharge-py` (PY).

---

## Push Model Migration (Spec v0.1 → v0.2)

> **Branch:** `push-model` (ts, py, spec repos)
>
> All nodes with cached value push `[[DATA, cached]]` to every new subscriber. Derived nodes compute reactively from upstream push instead of eager compute on connection. See `GRAPHREFLY-SPEC.md` §2.2.

### Phase 1–3: Spec + prototype + test migration (TS)

> **DONE — archived to `archive/roadmap/push-model-migration.jsonl`** (ids: `push-model-phase1`, `push-model-phase2`, `push-model-phase3`).

### Phase 4: Python parity

> **DONE — archived to `archive/roadmap/push-model-migration.jsonl`** (id: `push-model-phase4`).
>
> Summary: Full v0.2 push-on-subscribe + v5 architecture (START message, tier shift, NodeBase extraction, ROM/RAM cache rule, first-run gate, at-most-once `_active` deactivation guard) ported to graphrefly-py. QA pass fixed terminal replay (reverted to match TS/spec), first-run gate, RAM cache clear, adapter test race conditions, initial status for compute nodes. `_connected` field removed — connect guards use `_upstream_unsubs`/`_dep_unsubs` directly. All 1156 PY tests pass, lint + mypy clean.

### Phase 5: LLM composition validation

> **DONE — archived to `archive/roadmap/push-model-migration.jsonl`** (id: `push-model-phase5`).
>
> Summary: 10 scenarios, 11 tests, all passing. Push model highly LLM-compatible (9/11 first-attempt). Fixed connection-time diamond spec-impl gap, documented two-phase source protocol (COMPOSITION-GUIDE §9), SENTINEL vs null-guard cascading (§10), SENTINEL indicator in describe(). Test file: `src/__tests__/phase5-llm-composition.test.ts`.

---

## Harness Engineering Sprint — Priority Build Order

> **Context:** "Harness engineering" is the defining trend of 2026 (named by Mitchell Hashimoto ~Feb 2026, adopted by OpenAI, Anthropic, Martin Fowler). GraphReFly already covers the execution substrate — what's missing is proof artifacts, the audit/explain layer, ecosystem distribution, and public narrative. This sprint reorders remaining work into three announcement waves.
>
> **Design reference:** `archive/docs/SESSION-harness-engineering-strategy.md`

### Wave 0: Reactive Collaboration Loop — dogfood infrastructure (Weeks 0-2)

Goal: build the reactive collaboration harness and use it to manage the Wave 1 eval work. Static-topology loop with gates, promptNode, cursor-driven readers, and strategy tracking. Dogfooding validates the design; the eval experiment is the first real workload.

**Design reference:** `archive/docs/SESSION-reactive-collaboration-harness.md`

#### 9.0 — Reactive Collaboration Loop

> **Primitives:** DONE — archived to `archive/roadmap/phase-9-harness-sprint.jsonl` (id: `9.0-primitives`).
>
> **Wiring:** DONE — archived to `archive/roadmap/phase-9-harness-sprint.jsonl` (id: `9.0-wiring`).

##### Dual composition mode

Supports both graph-subgraph (tight coupling, same propagation cycle) and cursor-reading via `SubscriptionGraph` (降維 — dimensionality reduction, independent consumption pace). Developer picks per-branch. Same data can feed both modes.

##### Dogfood on 9.1b

- [x] Wire 9.1b eval runs through the harness loop
- [x] Human steering through `gate.modify()` with structured `rootCause`/`intervention` metadata
- [x] Strategy model accumulates effectiveness data across treatments A→D
- [x] Retrospective distills into `agentMemory` for next session context

##### Closed-loop automation (eval → harness → implement → verify → re-eval)

> **Moved to §9.1.3** — the closed-loop automation work is now tracked as the "Harness-driven" execution method inside the unified §9.1 Eval Program. It's *how a run is performed*, not a separate phase.

##### Streaming promptNode + mountable stream extractors (promptNode v2)

Generalized stream processing for any streaming source (LLM tokens, WebSocket, SSE, file tail). The stream topic is a universal tap point; extractor subgraphs mount independently. Zero cost if nobody subscribes.

```
streamingPromptNode (or any streaming source)
  └─→ streamTopic: TopicGraph<StreamChunk>
        ├─→ piiRedactor        (regex/NER → redaction events → gate blocks output)
        ├─→ invariantChecker   (design invariant keywords → flags topic)
        ├─→ toolCallExtractor  (detects tool_call JSON mid-stream → interception chain from §11)
        ├─→ thinkingRenderer   (accumulates reasoning → human subscriber: CLI, UI, MCP)
        ├─→ costMeter          (token count → budgetGate)
        └─→ streamExtractor(fn) (user-defined: any derived/effect on the stream)
```

Core streaming infrastructure:

- [x] **`streamingPromptNode`** — uses `adapter.stream()` instead of `invoke()`. Emits chunks to a `TopicGraph<StreamChunk>` as the LLM generates. Final parsed result goes to the output node as before. TS: `src/patterns/ai.ts`. PY: `src/graphrefly/patterns/ai.py` — dual path (async iterable via runner, sync iterable via `from_iter`).
- [x] **`StreamChunk` type** — `{ source: string, token: string, accumulated: string, index: number }`. Generic enough for any streaming source, not just LLM.
- [x] **Cancelable execution via `switchMap` + `AbortSignal`** — human steering signal cancels in-flight stream (`AbortController.abort()`). New input starts fresh. Uses existing `switchMap` — `switchMap(steeringSignal, () => streamingPromptNode(...))`. PY: async path cancellable via `from_async_iter` cleanup; sync path runs to completion (single-threaded, no interleave risk).
- [x] **Gate integration** — `gatedStream` (TS) / `gated_stream` (PY) composes `streamingPromptNode` + `gate`. TS: `reject()` aborts in-flight stream via cancel signal → switchMap restart → AbortController. PY: `reject()` discards pending value (sync streams complete before reject; async streams cancelled by switchMap cleanup). `modify()` transforms pending value. `approve()` forwards. Null filter suppresses switchMap initial/cancel state.

Mountable extractor subgraphs (each is opt-in, composes with any stream topic):

- [x] **`streamExtractor(streamTopic, extractFn, opts?)`** — generic factory: mount an extractor function to any streaming topic. Returns a derived node with extracted values. `extractFn: (accumulated: string) => T | null` — returns extracted value or null (nothing yet). This is the building block for all extractors below. TS: `src/patterns/ai.ts`. PY: `src/graphrefly/patterns/ai.py`.
- [x] **Keyword flag extractor** — `keywordFlagExtractor(streamTopic, { patterns })`. Scans accumulated text for all configured `RegExp` patterns, emits `KeywordFlag[]`. Use cases: design invariant violations, PII detection, toxicity keywords, off-track reasoning. TS: `src/patterns/ai.ts`.
- [x] **Tool call extractor** — `toolCallExtractor(streamTopic)`. String-aware brace scanner detects complete `{ name, arguments }` JSON blocks mid-stream, emits `ExtractedToolCall[]`. Feeds into tool interception chain for reactive gating. TS: `src/patterns/ai.ts`.
- [x] **Cost meter extractor** — `costMeterExtractor(streamTopic, { charsPerToken? })`. Tracks chunk count, char count, estimated tokens. Compose with `budgetGate` for mid-generation hard-stop. TS: `src/patterns/ai.ts`.

**Pattern:** the stream topic is a `TopicGraph` (which extends `Graph`) — extractors are just nodes in that graph or mounted subgraphs. Sync vs async is a property of the sink, not the source: a `derived` extractor runs in the same propagation cycle as the chunk (sync — can abort before the next token), while a `SubscriptionGraph` cursor-reader consumes at its own pace (async — batches, renders at 60fps, flushes when ready). Same topology, same data, consumer picks the coupling mode. This is the dual composition mode (SESSION-reactive-collaboration-harness §8) applied to streaming.

This is what GraphReFly was built for from day 1: every flow is inspectable (`describe()`, `observe()`, `graphProfile()`), every node is subscribable, every subgraph is mountable. Stream extractors are not a new abstraction — they're what falls out naturally when a streaming source is a graph node instead of a raw `AsyncIterable`.

##### Reusable patterns to extract from harness work

Patterns discovered during §9.0 implementation that generalize beyond the harness:

- [x] **Generalized source→intake bridge factory** — `createIntakeBridge(source, topic, parser)` in `harness/bridge.ts` / `harness/bridge.py`. `evalIntakeBridge` kept as thin wrapper. Both TS and PY.
- [ ] **Stage-aware prompt routing** (document pattern) — detecting which pipeline stage called the LLM based on prompt content keywords. Used in `mockLLM` and `run-harness.ts`. Worth documenting as a testing pattern for any multi-stage LLM pipeline.
- [x] **Stable identity for retried items** (document pattern) — `trackingKey` extracted to `patterns/_internal.ts` / `patterns/_internal.py`. Documented in COMPOSITION-GUIDE §17. Both TS and PY.

Additional patterns extracted:

- [x] **Shared `keepalive` + `domainMeta`** — deduplicated from 5 TS / 4 PY copies into `patterns/_internal.ts` / `patterns/_internal.py`. Eliminates copy-paste across orchestration, messaging, reduction, ai, cqrs, and domain-templates modules.
- [x] **`effectivenessTracker`** — generalized from `strategyModel` into `reduction.ts` / `reduction.py`. Tracks action×context → success rate. Reusable for A/B testing, routing optimization, cache policy tuning.
- [x] **`reactiveCounter`** — circuit breaker counter kernel extracted to `patterns/_internal.ts` / `patterns/_internal.py`. Reactive `state(0)` + cap-checked `increment()`.
- [x] **Nested `withLatestFrom` pattern** — documented in COMPOSITION-GUIDE §16. Fire on stage N, sample stages N-1 and N-2 without making them reactive triggers.

##### Common harness compositions (reusable building blocks)

The harness loop is general infrastructure. Below are pre-composed building blocks that users wire together for common workflows. Each is a composition of existing primitives — not new abstractions. We don't babysit every combination; we provide the Lego pieces with clear "snap here" points.

**Composition A: Eval-driven improvement loop**

The most common pattern: find issues → implement fixes → eval to verify → learn what works.

```
  issues ──→ TRIAGE ──→ IMPLEMENT ──→ EVAL ──→ COMPARE ──→ REPORT
    ↑                                              │
    └─── REFLECT (strategy model, new issues) ─────┘
```

Building blocks to provide:
- [x] **`evalSource(trigger, runner)`** — wraps any eval runner as a reactive producer node. `switchMap(trigger, () => fromAny(runner()))` — trigger fires → runner executes async → result flows into harness. TS: `harness/bridge.ts`. PY: `harness/bridge.py`.
- [x] **`beforeAfterCompare(before, after)`** — derived node that takes two eval results and computes per-task deltas (score diff, new failures, resolved failures). Pure computation, no domain logic. Feeds into strategy model and report generation. TS: `harness/bridge.ts`. PY: `harness/bridge.py`.
- [x] **`affectedTaskFilter(issues, fullTaskSet?)`** — derived node that selects which eval tasks to re-run based on `affectsEvalTasks` from triaged items. Avoids re-running the full suite on every fix. TS: `harness/bridge.ts`. PY: `harness/bridge.py`.

**Composition B: Content safety pipeline**

LLM output flows through extractor subgraphs before reaching the user. Stream extractors (above) are the mechanism; this composition is the wiring pattern.

```
  LLM stream ──→ streamTopic ──→ piiRedactor ──→ toxicityGate ──→ outputTopic
                       │                                │
                       └─→ auditLog                     └─→ alert (if blocked)
```

Building blocks:
- [x] **`redactor(streamTopic, patterns, replaceFn?)`** — stream extractor that replaces matched patterns in-flight. Returns `Node<StreamChunk>` with sanitized `accumulated`/`token`. TS: `ai.ts`. PY: `ai.py`.
- [x] **`contentGate(streamTopic, classifier, threshold)`** — returns `Node<'allow' | 'review' | 'block'>`. Three-way classification: allow (below threshold), review ([threshold, threshold×1.5)), block (above). Classifier can be a `(text) => number` function or a live `Node<number>`. Wire into valve (automatic) or gate (human approval). TS: `ai.ts`. PY: `ai.py`.

**Composition C: Agent tool interception**

From SESSION-reactive-collaboration-harness §11. Tool calls flow through a reactive pipeline before execution.

```
  agentLoop tool_call ──→ toolTopic ──→ valve (allowed?) ──→ budgetGate ──→ gate (human) ──→ execute ──→ auditTrail
```

Building blocks:
- [ ] **`toolInterceptor(agentLoop, opts?)`** — mounts a tool interception subgraph between `agentLoop` tool emission and tool execution. Pluggable pipeline: valve (policy), budgetGate (cost), gate (human approval for destructive ops). **Blocked:** requires `agentLoop` refactor to emit tool calls as reactive DATA before execution (currently imperative inside `async run()`). Tracked in `docs/optimizations.md`.

**Composition D: Quality gate (CI/CD)**

On code change, run affected checks → triage failures → auto-fix trivial ones → alert on structural ones.

```
  code change ──→ intakeBridge ──→ TRIAGE ──→ auto-fix queue ──→ EXECUTE (lint --fix, format) ──→ commit
                                         └──→ alert queue ──→ notify (Slack, PR comment)
```

Building blocks:
- [x] **`codeChangeBridge(source, intakeTopic, parser?)`** — intake bridge that parses `CodeChange` (lint errors, test failures) into `IntakeItem[]`. Custom parser optional. TS: `harness/bridge.ts`. PY: `harness/bridge.py`.
- [x] **`notifyEffect(topic, transport)`** — effect node that sends each topic entry to an external channel (Slack webhook, GitHub PR comment, email). Async transports fire-and-forget. TS: `harness/bridge.ts`. PY: `harness/bridge.py`.

**Composition E: Refinement loop (wraps refineLoop §9.8)**

The harness loop's EXECUTE→VERIFY cycle is a single-pass fix. For iterative refinement (prompt optimization, catalog tuning), wire `refineLoop` into the EXECUTE slot:

```
  triaged item ──→ refineLoop(seed=current, evaluator=affected_evals, strategy=errorCritique) ──→ best candidate ──→ VERIFY
```

This connects §9.0 (harness) with §9.8 (refineLoop) — the harness routes items, refineLoop iterates on fixes, the harness verifies and learns.

- [ ] **`refineExecutor(refineLoopFactory, opts?)`** — adapter that plugs a refineLoop into the EXECUTE slot of harnessLoop. Maps triaged item → seed, affected evals → evaluator, strategy model → refinement strategy selection.

**Design principle:** each composition is 5-20 lines of wiring, not a new factory. The building blocks above are the nodes and edges; the user's `harnessLoop` config determines which are active. We provide the Lego pieces and a few pre-assembled models (our own dogfood). The user remixes for their domain.

---

### §9.0b — Mid-Level Harness Blocks

> **DONE — archived to `archive/roadmap/phase-9-harness-sprint.jsonl`** (id: `9.0b-mid-level-harness-blocks`, resolved 2026-04-19).
>
> Shipped in this wave: `graphLens()` ([src/patterns/lens.ts](../src/patterns/lens.ts)), `resilientPipeline()` ([src/patterns/resilient-pipeline.ts](../src/patterns/resilient-pipeline.ts)), `guardedExecution()` ([src/patterns/guarded-execution.ts](../src/patterns/guarded-execution.ts)), plus the `Graph.topology` event companion and `watchTopologyTree()` helper ([src/graph/topology-tree.ts](../src/graph/topology-tree.ts)) — the transitive structural-change subscription used by graphLens and by policyEnforcer's dynamic-coverage upgrade. `persistentState()` retired (superseded by `Graph.attachStorage()`). Design reference: `archive/docs/SESSION-mid-level-harness-blocks.md`.

---

### Wave 1: "The Eval Story" — publish engineering discipline (Weeks 1-3)

Goal: establish credibility by showing eval → schema fix → re-eval feedback loop publicly. Low risk, no full architecture reveal.

#### 9.1 — Eval Program (umbrella)

> **Replaces former §9.1 (eval harness), §9.1b (catalog automation), §9.0 closed-loop subsection, and §9.4 (scorecard).** Single source of truth for the eval work.
>
> **Cost safety:** Always run `EVAL_MODE=dry-run` first. Default budget cap is `$2 / 100 calls` with replay cache on. See [evals/CHEAP-AND-SAFE.md](../evals/CHEAP-AND-SAFE.md) for the 4-step pre-flight ladder, the USD-cap gotcha for OpenRouter routes, and the cheap-model preset table (GLM, DeepSeek, Gemini Flash, GPT-nano).

##### Next-action sequence (the dependency chain)

1. ~~Write `CatalogFnEntry` objects + Treatment-D templates~~ — DONE (archived id `9.1.2-portable-catalog-and-templates`). `EVAL_TREATMENT=A|B|C|D` env var live in [evals/lib/contrastive.ts](../evals/lib/contrastive.ts).
2. **Now → Run B + C** automated, two cheap models (e.g. `gemini-2.0-flash` + `z-ai/glm-4.7`), 5 runs each, commit trend data. → §9.1.1 L0 + §9.1.2 + §9.1.3 automated
3. ~~Build templates (`resilientFetch`, `adaptivePoller`, `conditionalMap`, `median`, `llmScore` desc)~~ — DONE (same archive entry).
4. **Run D** — compare A→B→C→D progression. → §9.1.2
5. **Wire harness execution method** (EXECUTE actuator + VERIFY re-eval + `run-treatments.ts`). Wave 1 dogfood demo. → §9.1.3
6. **Cross-model validation** — promote to publish-tier models (`claude-sonnet-4-6`, `gpt-4.1`) for the blog numbers. → §9.1.1 + §9.1.3
7. **Publish**: blog + scorecard + reproduce-guide + design-partner outreach. → §9.1.5

Steps 2 and 4 are the **internal evidence track**. Step 5 is the **demo track** (we use our own harness to run our own evals — the meta-story for Wave 1). Steps 6-7 are the **external story track**.

##### 9.1.0 — Eval matrix (orientation)

Every eval run picks a value from each axis. The intersection determines cost, signal, and audience.

| Axis | Values |
|---|---|
| **Tier** (what is measured) | L0 contrastive · L1 generation · L1 comprehension · Dev-DX |
| **Treatment** (catalog delivery) | A manual · B auto-prompt · C +refine · D +templates · E +subsetting |
| **Method** (how the run happens) | Portable copy-paste · Local Ollama · Automated API · Harness-driven · CI scheduled |
| **Audience** (what we do with results) | Internal telemetry · External story |

##### 9.1.1 — Active eval tiers (the "what is measured")

- **L0 — Graph > Functions contrastive** — DONE infra; Run 1-4 archived. Open: trend data (§9.1.5).
- **L1 — NL → GraphSpec generation** — DONE infra; uses real `validateSpec()` + `compileSpec()` from `src/patterns/graphspec.ts`.
- **L1 — Comprehension** — debug/modify/explain via `nl-mod` + `contrastive-bugs` corpora.
- **Dev-DX** — vitest, no LLM calls; validates `validateSpec()` error messages. Implementation: [evals/dev-dx/seeded-errors.test.ts](../evals/dev-dx/seeded-errors.test.ts).

##### 9.1.2 — Treatment progression (the eval-driven catalog experiment)

Four treatments, same 12 tasks, measuring delta at each automation step.

| Treatment | Developer does | Library does | Status |
|-----------|---------------|-------------|--------|
| A: Manual catalog | Writes `catalogDescription` string | Nothing | DONE — Run 4 baseline 173/180 |
| B: Auto-gen prompt | Writes `CatalogFnEntry` objects | `generateCatalogPrompt()` | **Ready to run** — `EVAL_TREATMENT=B pnpm eval:contrastive` |
| C: + auto-refine | Same as B | + `maxAutoRefine: 2` | **Ready to run** — `EVAL_TREATMENT=C pnpm eval:contrastive`. Refine loop wired via `llmRefine` + a cost-safe adapter shim. Records `auto-refine attempts used` as a JudgeScore diagnostic per task. |
| D: + templates | Same as C + selects templates | + pre-built templates | **Ready to run** — `EVAL_TREATMENT=D pnpm eval:contrastive` |
| E: + catalog subsetting | Same as D | + task-relevant subset | Future |

**Treatment B/C/D enablement (DONE):**

> Authoring of `CatalogFnEntry` data, Treatment-D templates, the 5 Run-4 gap fixes, the `EVAL_TREATMENT` env var, and contrastive-runner wiring archived to `archive/roadmap/phase-9-harness-sprint.jsonl` (id: `9.1.2-portable-catalog-and-templates`). Files: [evals/lib/portable-catalog.ts](../evals/lib/portable-catalog.ts), [evals/lib/portable-templates.ts](../evals/lib/portable-templates.ts), [evals/lib/contrastive.ts](../evals/lib/contrastive.ts).

**Treatment B/C/D — execution remaining:**

- [ ] Run Treatment B (auto-gen prompt) — L0 across two cheap models (e.g. `gemini-2.0-flash` + `z-ai/glm-4.7`)
- [ ] Run Treatment C (auto-gen + refine) — L0 across same two models, track refine counts. Requires wiring `llmCompose` (with `maxAutoRefine: 2`) into contrastive runner; current path is equivalent to B.
- [ ] Run Treatment D (auto-gen + refine + templates) — L0 across same two models
- [ ] Compare A→D progression, write up for blog
- [ ] Cross-model validation on publish-tier model (GPT-4o or Claude Sonnet)

> **Rich catalog types** (`CatalogFnEntry` schema, `generateCatalogPrompt()`): DONE — archived to `archive/roadmap/phase-9-harness-sprint.jsonl` (id: `9.1b-rich-catalog`).

**Decision framework — when to add vs when to prune:**

| Signal | Meaning | Action |
|--------|---------|--------|
| Score up, tokens flat | Good addition | Keep |
| Score flat, tokens up | Bloat | Remove or merge entries |
| Score up only with templates, not fns | Templates > fns for this gap | Invest in templates |
| Hallucination rises with catalog size | Prompt overload | Implement catalog subsetting |
| Auto-refine fixes same error repeatedly | Bad description | Fix description, don't rely on refine |
| Per-task delta = 0 across A→D | Task at ceiling | Stop adding catalog for it |

**Principle:** Add a catalog fn only when the operation genuinely doesn't exist. Add a template when the LLM composes correct fns in wrong structure. Add docs when the LLM doesn't reach for an existing fn. Add a catalog wrapper (not a primitive) when `dynamicNode` already supports the pattern. See session log [evals/results/session-2026-04-06-catalog-automation.md](../evals/results/session-2026-04-06-catalog-automation.md) §6 for full analysis.

**Key metric: score per prompt token.** If this ratio declines, the catalog is growing faster than quality. Declining efficiency = time to prune or subset.

##### 9.1.3 — Execution methods (how a run happens)

Pick one per run. The first three are zero or low cost — exhaust them before reaching for paid API runs.

> **Mandatory pre-flight ladder for any paid run:** see [evals/CHEAP-AND-SAFE.md](../evals/CHEAP-AND-SAFE.md). Step 1 = `EVAL_MODE=dry-run`. Step 2 = local Ollama. Step 3 = single task with `EVAL_MAX_PRICE_USD=0.10` and `EVAL_REPLAY=write-only`. Step 4 = full corpus with replay cache on. Cost-safety implementation: [evals/lib/llm-client.ts:281](../evals/lib/llm-client.ts) (`createSafeProvider`).

- **Portable / copy-paste** — DONE; [evals/portable-eval-prompts.md](../evals/portable-eval-prompts.md). Zero cost, any AI. Used for first-look credibility checks and reproducibility claims.
- **Local Ollama** — DONE; zero cost, slower. Validates pipeline end-to-end before paid runs. `EVAL_PROVIDER=ollama EVAL_MODEL=gemma4:e4b pnpm eval`.
- **Automated API (cheap budget tier)** — DONE infra; cost-safety wired. Default cheap picks: `gemini-2.0-flash` (in pricing table — USD cap works), `z-ai/glm-4.7` and `deepseek/deepseek-v3.2` via OpenRouter (rely on `EVAL_MAX_CALLS`). Used for treatment-progression iteration.
- **Automated API (publish tier)** — DONE infra; gated by budget caps. Sonnet/Opus/GPT-4.1 for blog numbers. Used only after cheap-tier validates the methodology.
- **Harness-driven (dogfood demo)** — partially DONE; the §9.0 harness loop wraps eval runs via `evalIntakeBridge`. Closed-loop automation work moved here from §9.0:
  - [ ] **EXECUTE actuators** — pluggable implementations that apply catalog entry updates, template additions, doc edits, or `CatalogFnEntry` modifications. Default: promptNode (current). Advanced: tool-use agent that writes code + runs lint.
  - [ ] **VERIFY re-eval** — after EXECUTE produces a fix, re-run *only the affected eval tasks* (not full suite). Wire `affectsEvalTasks` from the triaged item → eval runner → compare before/after scores. Default: promptNode review (current). Advanced: actual eval execution via [evals/lib/runner.ts](../evals/lib/runner.ts).
  - [ ] **4-treatment runner script** ([evals/scripts/run-treatments.ts](../evals/scripts/run-treatments.ts)) — automate the A→D experiment: iterate treatments, run evals per treatment, collect results, feed into harness loop for comparative analysis. Currently fully manual.
  - [ ] **CI-triggered eval→harness pipeline** — on push/merge, run affected evals → feed results into harness → strategy model updates → report delta. Deferred until EXECUTE actuators are real.
- **CI scheduled** — DONE; `eval.yml` runs weekly Mon 6am UTC + on manual dispatch. Generates scorecard, runs regression gate (fails if validity drops >5%).

**Design note:** EXECUTE and VERIFY are intentionally pluggable. The above wires *our specific* actuators for the catalog automation use case. Other users plug in their own. The harness loop infrastructure is general; the actuators are domain-specific.

##### 9.1.4 — Internal telemetry (what we learn each run)

- [ ] Track common `validateSpecAgainstCatalog` errors across runs (which fns get hallucinated most?)
- [ ] Surface "catalog improvement suggestions" from aggregated validation errors
- [ ] Auto-suggest new catalog entries when LLMs consistently invent the same fn name
- [ ] **Catalog subsetting** (Treatment E) — select only task-relevant fns/templates for the prompt. Hypothesis: for simple tasks, smaller catalog outperforms comprehensive one. Smart subsetting as the next automation layer after templates.

##### 9.1.5 — External deliverables (what we publish)

The Wave 1 announcement payload. Folds in former §9.4 (scorecard).

- [ ] 5+ automated runs across 2+ models with trend data committed
- [ ] Schema gaps as running metric: gaps found → gaps resolved (with links to fixes)
- [ ] **Scorecard page** at `graphrefly.dev/scorecard` (was §9.4):
  - **Causal trace completeness** — `explainPath` available on all shipped graphs (§9.2 shipped; this is the P0 differentiator, lead with it)
  - First-pass GraphSpec validity rate (from L0)
  - Hallucination rate by model
  - Schema gap count: open → resolved
  - Checkpoint restore integrity (from existing snapshot round-trip tests)
  - Multi-model comparison trend lines
- [ ] Updated weekly from CI eval runs
- [ ] Machine-readable `scorecard/latest.json` for programmatic consumption
- [ ] Blog post: "How evals proved catalog quality is the #1 lever, and we automated it"
- [ ] Open-source the eval runner (already in repo — make it prominent)
- [ ] Multi-model comparison results page
- [ ] "Reproduce our evals" guide (portable prompts for anyone)
- [ ] **Pre-launch outreach: 20-30 personalized "design partner" emails** (see marketing strategy §16A) — send 1-2 weeks before Wave 1 announcement. Target: harness engineering blog authors, LangGraph/CrewAI contributors, reactive programming maintainers, agent reliability researchers, MCP ecosystem builders.

---

### Wave 2: "The Harness Layer" — claim the category (Weeks 4-9)

Goal: ship the audit/explain layer + MCP server + scorecard. This is where GraphReFly explicitly becomes "harness engineering."

#### 9.2 — Audit & accountability (8.4 → 9.2)

The missing layer that makes "harness" real, not just "substrate."

- [x] `explainPath(graph, from, to)` — walk backward through graph derivation chain. Returns human-readable + LLM-parseable causal chain. THE harness differentiator. (TS shipped — `src/graph/explain.ts` + `Graph.explain()`)
- [x] `auditTrail(graph, opts?)` → Graph — wraps any graph with `reactiveLog` recording every mutation, actor, timestamp, causal chain. Queryable by time range, actor, node. (TS shipped — `src/patterns/audit.ts`, namespace `patterns.accountability`)
- [x] `policyEnforcer(graph, policies)` — reactive constraint enforcement. Policies are nodes (LLM-updatable). Violations emit to alert subgraph. Modes: `"audit"` (forensic) and `"enforce"` (live guard stacking via `NodeImpl._pushGuard`). (TS shipped)
- [x] `complianceSnapshot(graph)` — point-in-time export of full graph state + audit trail for regulatory archival. Includes deterministic FNV-1a fingerprint over canonical JSON. (TS shipped)
- [x] `graph.explain(from, to, { reactive: true })` — `Node<CausalChain>` that recomputes on graph mutations; foundation for `graphLens.why(node)` (§9.0b). Tier 3.5 (2026-04-27) deleted the standalone `reactiveExplainPath` wrapper in favor of the consolidated `Graph.explain` overload (mental-model parity with `describe` / `observe`); the overload also accepts reactive `from` / `to` / `maxDepth` / `findCycle` per F.9 carve-out. (TS shipped)
- [ ] PY parity — tracked under "PY 9.2" below.

#### 9.3 — MCP Server (`@graphrefly/mcp-server`)

Thin surface over the shared **9.3-core** domain layer (see 9.3c). MCP and CLI are two projections of the same operations — the core lives in `src/patterns/surface/` and re-exports from both packages.

**Design note — the delta from the original roadmap sketch:** §9.2 and the graph-module 24-unit review already shipped most of the operations the roadmap called out (`graph.describe`, `graph.observe` with progressive detail levels + structured/causal/timeline flags, `graph.explain` returning `CausalChain`, `graph.snapshot`/`restore`, static `Graph.diff`, `Graph.attachStorage` over multi-tier `StorageTier` with full/diff `GraphCheckpointRecord`). The surface layer is therefore a thin projection: a typed-error envelope (`SurfaceError`), a `createGraph` wrapper over `compileSpec`, and one genuinely new operation — `runReduction` (named to avoid collision with the reactive `reduce` operator in `extra/operators.ts`). Snapshot save/restore/diff/list reuses the existing `StorageTier` substrate — a surface-saved snapshot is a `mode: "full"` `GraphCheckpointRecord` interoperable with `attachStorage({autoRestore: true})`. No new wire format. The registry (`graphId → Graph`) lives in the MCP server session, not in core — consistent with the graph-module review's "derive from live state, don't maintain a parallel registry" principle.

- [x] **9.3-core** — shared surface core in `src/patterns/surface/` (TS shipped):
  - `createGraph(spec, opts?)` — wraps `compileSpec` with typed `SurfaceError` on validation failure
  - `runReduction(spec, input, opts?)` — one-shot `input → pipeline → output`, subscribe-before-push ordering to catch both sync and async graphs
  - `saveSnapshot` / `restoreSnapshot` / `diffSnapshots` / `listSnapshots` / `deleteSnapshot` — over existing `StorageTier` adapters
  - `SurfaceError` — JSON-safe `{code, message, details?}` + `toJSON()`; codes: `invalid-spec`, `graph-not-found`, `snapshot-not-found`, `node-not-found`, `reduce-timeout`, `catalog-error`, `restore-failed`, `snapshot-failed`, `tier-no-list`, `internal-error`
  - `StorageTier.list?()` added as optional method; implemented on `memoryStorage`, `dictStorage`, `fileStorage`, `sqliteStorage`
  - Top-level + namespaced exports: `import { createGraph } from "@graphrefly/graphrefly"` or `import { patterns } from "@graphrefly/graphrefly"; patterns.surface.createGraph`
- [x] **MCP Server package** (`packages/mcp-server/`, TS shipped) exposing 9.3-core as tools:
  - `graphrefly_create` — compile a GraphSpec into a graph registered under `graphId`
  - `graphrefly_describe` — topology + values snapshot with progressive detail + mermaid/d2 export
  - `graphrefly_observe` — one-shot node/graph state (live streaming is a wrapper concern, not a stdio tool)
  - `graphrefly_explain` — causal chain via `graph.explain` (requires §9.2 `explainPath`, shipped)
  - `graphrefly_reduce` — wraps `runReduction` for stateless pipeline runs
  - `graphrefly_snapshot_save` / `_restore` / `_diff` / `_list` / `_delete` — checkpoint/restore over the session's storage tier
  - `graphrefly_delete` / `graphrefly_list` — registry lifecycle
  - Session holds `Map<graphId, Graph>` + default `memoryStorage` (opt-in `fileStorage` via `GRAPHREFLY_STORAGE_DIR` env or `storageDir` option)
  - Server operators register fn/source catalog at startup (`buildMcpServer(session, { catalog })`) — catalog delivery over the wire is a separate design pass
  - Errors throw `SurfaceError`; wrap layer converts to MCP `isError` content
- [x] NL→spec (`llmCompose`) bridged through `graphrefly_compose` — SHIPPED 2026-04-21. See §9.3d bullet above.
- [ ] Publish to npm as `@graphrefly/mcp-server`
- [ ] Submit to: official MCP registry (`registry.modelcontextprotocol.io`), Cline Marketplace, PulseMCP
- [ ] "Try it with Claude Code in 2 minutes" quickstart

#### 9.3b — OpenClaw Context Engine Plugin (`@graphrefly/openclaw-context-engine`)

Reactive agent memory as an OpenClaw ContextEngine plugin. Implements the 3-hook interface (select, budget, compact) with GraphReFly's reactive memory graph underneath. Lower effort than MCP Server, deeper integration (controls what the agent remembers), reaches all OpenClaw users (250k+).

**Design reference:** `archive/docs/SESSION-openclaw-context-engine-research.md`

- [ ] Implement ContextEngine 3-hook interface (select, budget, compact)
- [ ] Reactive memory graph: store, extractor, stale-filter, consolidator, compact-view
- [ ] Work context signal derived from OpenClaw session state
- [ ] Persistence via `Graph.attachStorage([fileStorage('.graphrefly/')])` with `autoRestore: true`
- [ ] Unit tests: packIntoBudget, scoreRelevance, stale-filter, consolidation
- [ ] Integration tests: ContextEngine interface compliance
- [ ] Regression tests: no degradation of default OpenClaw behavior
- [ ] E2E quality test: multi-turn recall comparison (reactive memory vs legacy)
- [ ] Publish to npm as `@graphrefly/openclaw-context-engine`
- [ ] OpenClaw plugin registry submission

#### 9.3c — CLI surface (`@graphrefly/cli`)

Peer projection of **9.3-core** as a terminal binary. Targets the Claude Code / Codex CLI / Gemini CLI / Aider audience that already has a Bash tool — zero plugin install, usable from shell pipes, CI, and humans. Distribution vehicle for Wave 1 eval story (blog-quotable commands).

**Rationale:** April-2026 landscape — three dominant terminal agents, Uni-CLI pattern (declarative adapters → `unicli mcp serve` auto-registers MCP tools), ~80 tokens per CLI invocation vs. MCP's schema/discovery overhead for high-frequency calls. Non-MCP contexts (Aider, CI, bash-tool-only, humans) win too.

- [x] `graphrefly` binary (Node, shipped as `@graphrefly/cli`) — TS shipped. Subcommands:
  - `graphrefly describe <spec>` — compile + emit topology (JSON default, `--format=pretty|mermaid|d2`)
  - `graphrefly explain <spec> --from X --to Y` — compile + emit `CausalChain`
  - `graphrefly observe <spec> [--path P]` — compile + emit one-shot node/graph state
  - `graphrefly reduce <spec> --input <path|->` — one-shot `runReduction`
  - `graphrefly snapshot diff <a> <b>` — diff two snapshot files
  - `graphrefly snapshot validate <file>` — validate a snapshot file envelope
  - `graphrefly mcp` — start the MCP server on stdio from the same binary (Uni-CLI pattern, lazy-imports `@graphrefly/mcp-server`)
- [x] Output contract — stdout = JSON by default, `--format=pretty` toggles pretty JSON; `describe` supports `--format=mermaid|d2` for diagram export; stderr = `SurfaceError` JSON payload on failure; exit codes `0` (ok), `1` (error), `2` (usage)
- [x] Stdin pipe support — any `<spec>` positional accepts `-` for stdin; `reduce --input -` piping works (`cat input.json | graphrefly reduce spec.json --input -`)
- [x] Zero external args-parser — hand-rolled dispatcher. Keeps the package dependency surface tiny; no `commander`/`yargs`.
- [ ] `graphrefly eval [run|matrix|scorecard]` — deferred. Existing `tsx evals/scripts/run-all.ts` pipelines cover the workflow today; folding into CLI requires deciding whether eval logic moves into `@graphrefly/cli` or stays in the repo's `evals/` dir.
- [ ] Publish to npm as `@graphrefly/cli`, single `bin` entry, `npx @graphrefly/cli` works without install
- [ ] "Try it in 30 seconds" section in README: single `npx` command producing visible eval output
- [ ] Man page / `--help` parity with MCP tool descriptions (shared JSDoc source) — `printHelp()` stub exists, parity pass deferred
- [ ] CI: smoke test every subcommand in GitHub Actions alongside MCP server tests
- [ ] Homebrew formula (post-Wave 2, if demand warrants)

**Constraint:** The CLI MUST NOT duplicate graph logic. If a command can't be a thin shell around 9.3-core, the gap belongs in 9.3-core, not in the CLI package.

#### 9.3d — LLM Adapter Layer (`src/patterns/ai/adapters/`) — **SHIPPED 2026-04-21**

Full adapter layer archived to `archive/optimizations/resolved-decisions.jsonl` (id: `llm-adapter-layer-9-3d`). Core, providers, middleware, and routing all landed together. Open follow-ups:

- [x] **`resilientAdapter()` call-path wrapper** — SHIPPED 2026-04-21 at [src/patterns/ai/adapters/middleware/resilient-adapter.ts](../src/patterns/ai/adapters/middleware/resilient-adapter.ts). Composes `withRateLimiter` + `withBudgetGate` + `withBreaker` + `withTimeout` + `withRetry` + `cascadingLlmAdapter` fallback in the documented order; per-attempt deadline rearm; `withTimeout` re-throws `LLMTimeoutError` (so retry's default predicate recognizes it against real fetch/SDK providers). Follow-ups tracked in [docs/optimizations.md](optimizations.md): `onFallback`/`onExhausted` surface, shared limiter across calls.
- [ ] **`evals/lib/` migration** — fresh eval work after §9.1 will use the new adapter layer directly; the existing imperative stack at `evals/lib/{llm-client, rate-limiter, budget-gate, replay-cache, limits}.ts` stays untouched until then (per QA direction).
- [x] **MCP `llmCompose` wiring** — SHIPPED 2026-04-21 as `graphrefly_compose` tool in [packages/mcp-server/src/tools.ts](../packages/mcp-server/src/tools.ts) with `composeAdapter` + `composeModelAllowlist` options on `BuildMcpServerOptions`. Compose-only (returns validated spec; caller follows with `graphrefly_create`). New surface error codes: `compose-not-configured`, `compose-failed`.
- [ ] **Limits registry population** — library ships shape only. Users populate a `CapabilitiesRegistry` with their own data. A first-party curated table can ship as an opt-in `@graphrefly/capabilities-*` package post-1.0 if demand warrants.


#### 9.4 — Harness scorecard (public)

> **Moved to §9.1.5** — folded into the Eval Program external deliverables. The scorecard is an eval artifact, not a separate work stream.

#### 9.3e — Spending Alerts demo (Wave 2, pairs with MCP + CLI launch)

Minimal demo that backs homepage pain point 02 ("Action Without Explanation") and proves `explainPath` as the P0 differentiator. Intentionally simple — no NL→GraphSpec, just a reactive pipeline with a visible causal chain.

**Topology:**
```
fromTimer(interval) → fetchTransactions → anomalyDetector → flagNode
                                                                 ↓
                                          user asks: "why was this flagged?"
                                          graphrefly explain spending-alerts.json \
                                            --from transactions --to flag
                                          → CausalChain: flagNode ← anomalyDetector
                                                         (score: 0.94, z-score: 4.2)
                                                       ← fetchTransactions
                                                         (vendor: AMZN, amount: $847)
```

**Presentation:** `examples/spending-alerts/` (runnable code) + `website/src/content/docs/demos/spending-alerts.md` (code walkthrough + causal chain output as structured text). Homepage "Demo: Spending Alerts →" links here. No GIF required — static walkthrough is sufficient for Wave 2.

**Try it yourself CTA (two paths):**
- CLI: `npx @graphrefly/cli explain spending-alerts.json --from transactions --to flag` — zero install, copy-paste in terminal, best for blog post
- MCP: `graphrefly_explain` from Claude Code — best for the "inside your agent" story

- [x] `examples/spending-alerts/` — SHIPPED 2026-04-21. 5-hop deterministic pipeline (`txFeed → anomalyScore → thresholdGate → reasonFactors → alertMessage`, with `vendorStats`/`userProfile` as side inputs). Runnable via `pnpm --filter @graphrefly-examples/spending-alerts start`.
- [x] `website/src/content/docs/demos/spending-alerts.md` — SHIPPED 2026-04-21. Walkthrough + causal chain output + "how you get this in your own code" + agent-extension path (swap `alertMessage` for a `promptNode` with `resilientAdapter`).
- [x] Wire homepage "Demo: Spending Alerts →" link to the docs page.
- [ ] Interactive 3-pane Astro shell at `demos/spending-alerts/` — follow-up. Will reuse `demoShell` + `lazyAdapter` patterns from `demos/knowledge-graph/`; adds a Chrome-Nano-backed `promptNode` justifier with mock fallback. Non-blocking for Wave 2 (roadmap note: "No GIF required — static walkthrough is sufficient").

#### 9.2 deliverables for announcement

- [ ] `@graphrefly/mcp-server` on npm
- [ ] `@graphrefly/cli` on npm (`npx @graphrefly/cli explain` as the demo CTA — copy-pasteable in blog posts)
- [ ] Spending Alerts demo page live (`website/src/content/docs/demos/spending-alerts.md`) — backs homepage 02 and proves `explainPath`
- [ ] Harness scorecard page live (owned by §9.1.5)
- [ ] "GraphReFly vs LangGraph" comparison page (reactive push vs static DAG, causal trace, glitch-free)
- [ ] Blog: "Why agent harnesses need reactive graphs"

---

### Wave 3: "The Existential Demo" — prove the full vision (Weeks 10-15)

Goal: Demo 0 + framework integrations. Unlocks HN launch.

#### 9.5 — Demo 0 (7.3 → 9.5)

NL → GraphSpec → flow view → run → persist → explain. The demo that proves the reason to exist.

**Narrative frame (pain-point-first):** "Your email is scattered across Gmail, Slack, Linear. Demo 0 shows one graph watching all three, reducing noise to 3 actionable items, persisting across restarts — and explaining every flag." Closes the loop on homepage pain points 01 (state scattered → one reactive topology) and 02 (why was this flagged → `explainPath` output). The "explain" step at the end of the walkthrough is the bridge to homepage 02 and to the Spending Alerts demo.

**Presentation:** video/GIF required (gates Show HN). Demo 0 is the centerpiece of Wave 3 announcement.

- [ ] Demo 0: Personal email triage (7.3 → 9.5, see §7.3 for full ACs in archive)

#### 9.6 — Framework infiltration packages

- [ ] **Vercel AI SDK middleware** (`@graphrefly/ai-sdk`) — `graphreflyMiddleware` wraps any model with reactive graph state. Intercepts calls to inject context, captures outputs as node updates.
- [ ] **LangGraph TS tools** (`@graphrefly/langgraph`) — Zod-validated tools exposing graph operations. Note: LangGraph also consumes MCP natively, so 9.3 MCP server may suffice.
- [ ] **3 golden template repos** — standalone starter projects:
  - Incident triage reduction (observabilityGraph + fromOTel)
  - Agent run observatory (agentLoop + tracing)
  - Alert dedup/prioritization (funnel + scorer)

#### 9.7 — Demo 6: AI Agent Observatory (7.3b → 9.7)

The harness engineering showcase and the full self-improving loop in one screen.

**Narrative frame:** An agent runs a multi-step task, goes off-track mid-way. `explainPath` surfaces the causal chain of the failure. `harnessLoop`'s REFLECT stage distills it into `agentMemory`. On the next run, the same failure route is avoided — the strategy model updated. Explainability (Wave 2) + self-improvement (the harness) visible together.

```
agentLoop (multi-step task)
  → something fails mid-task
  → graphrefly_explain shows WHY (causal chain to the failure node)
  → REFLECT distills into agentMemory + strategy model update
  → re-run: different routing, failure avoided
```

This is the answer to the 小红书 post's "how do you make your agent learn from its mistakes?" — not gene gimmicks, but reactive feedback through inspectable topology.

- [ ] Demo 6 (7.3b → 9.7)

**Stream extractor showcase** (optional scope extension): mount multiple extractors on a single `streamingPromptNode` simultaneously — each visible in real time. Shows that every flow is inspectable and pluggable. Can be folded into Demo 6 or kept as a standalone appendix.

```
streamingPromptNode
  └─→ streamTopic: TopicGraph<StreamChunk>
        ├─→ piiRedactor        (regex/NER → redaction events → gate blocks output)
        ├─→ invariantChecker   (design invariant keywords → flags topic)
        ├─→ toolCallExtractor  (tool_call JSON mid-stream → interception chain)
        ├─→ thinkingAccumulator (reasoning rendered to human subscriber)
        ├─→ costMeter          (token count → budgetGate)
        └─→ userDefinedExtractor(...)
```

#### Wave 3 deliverables for announcement

**Homepage demo link inventory (all three must be live before Wave 3 launch):**

| Homepage link | Pain point | Demo | Wave shipped |
|---|---|---|---|
| "Demo: Email Triage →" | 01 Context Without Control | Demo 0 (`website/src/content/docs/demos/email-triage.md`) | Wave 3 |
| "Demo: Spending Alerts →" | 02 Action Without Explanation | §9.3e (`website/src/content/docs/demos/spending-alerts.md`) | **Wave 2** |
| "Demo: Knowledge Graph →" | 03 Composition Without Guardrails | Interactive 4-chapter demo at `demos/knowledge-graph/` (Chrome Nano on-device extraction; mock fallback). Docs page at `website/src/content/docs/demos/knowledge-graph.md`. Node-runnable mirror at `examples/knowledge-graph/`. | Wave 2 (interactive) |

- [ ] Demo 0 video/GIF — required to gate Show HN
- [ ] `website/src/content/docs/demos/email-triage.md` (Demo 0 companion page)
- [ ] **Port `examples/inbox-reducer` to a website demo page (opened 2026-04-21):** `website/src/content/docs/demos/inbox-reducer.md` companion to the Node-runnable example. Highlights what this example shows well (correct + concise + intuitive + capable): 7-node pipeline, 3 LLM calls over 50 emails, live stage-by-stage trace, `graph.explain` causal chain, dry-run with exact token counts, mermaid.live clickable diagram, fallback/replay-cache/resilience stack in one line, reactive delta demo (honestly framed — see next item for the true reactive-savings demo). Keep as a "here's a complete, production-shaped pipeline" reference. Does NOT replace Email Triage (Demo 0) or Spending Alerts — it's a more thorough walkthrough of adapter stack + observability than those.
- [ ] **Second inbox-like demo that genuinely shows reactive-savings + explainability (opened 2026-04-21):** The current `inbox-reducer` batches classify over all emails, so a 1-email delta re-runs every stage at full cost — it doesn't sell the reactive-push efficiency claim. Build a sibling example (working name: `inbox-stream` or `live-inbox-reducer`) that:
  - **Classifies per-email** — a `map(emails, classifyOne)`-shaped topology where each email is classified individually (50 small LLM calls initially). Compose via `funnel` or `mergeMap` with configurable concurrency.
  - **Shows real delta savings** — push a 51st email, only THAT email re-classifies (1 small call), downstream extract/rank/brief recompute deterministically plus maybe one small brief call. Vs. a full rerun = 51+N+1 calls.
  - **Leans into `graph.explain`** — for any action item in the final brief, `graph.explain("emails[e42]", "brief")` walks back through its own classify call, its extract call, and the rank decision. Shows causal-chain UX on a DAG with real fan-in/out, not just a linear pipeline.
  - **Streams incoming emails** via `fromTimer` or `fromAsyncIter` so the "arrive live, re-triage" story is visible.
  - Optional: fan-out multiple consumers of `classifications` (actionable / notifications / deferred digest) to show multi-sink reactivity.
  **Ship as a website demo**: `website/src/content/docs/demos/inbox-stream.md`. This is the demo that sells the "reactive + explainable" moat; `inbox-reducer` stays as the approachable baseline.
- [ ] Show HN: "GraphReFly — the reactive harness layer for agent workflows [harness scorecard inside]"
- [ ] `@graphrefly/ai-sdk` and/or `@graphrefly/langgraph` on npm
- [ ] 3 template repos public
- [ ] Reddit posts: r/AI_Agents, r/typescript, r/ClaudeCode
- [ ] 小红书 original post: "为什么 Agent Harness 需要 reactive graph"
- [ ] Submit to harness-engineering.ai knowledge graph

---

### Inspection Tool Consolidation (cross-cutting, TS + PY)

Goal: reduce the inspection surface from 14+ exported tools to 9 with clear, non-overlapping responsibilities. Pre-1.0 — breaking changes, no aliases or legacy shims.

**Design principle:** 3 verbs (`describe`, `observe`, `trace`), 2 profilers (`graphProfile`, `harnessProfile`), 2 analyzers (`diff`, `reachable`), 1 reactive primitive (`filter | take`), 1 harness helper (`harnessTrace`).

#### TS consolidation (breaking)

> **DONE — archived to `archive/roadmap/push-model-migration.jsonl`** (id: `inspection-ts-consolidation`).
>
> Merged: spy()→observe(format=), annotate()+traceLog()→trace(), 4 RxJS bridges→toObservable(source, opts?), unexported describeNode/metaSnapshot, implemented harnessTrace().

#### PY consolidation (match TS)

Apply same merges to PY — `spy()` → `observe(format=)`, `trace_log()` → `trace()`, unexport `describe_node` / `meta_snapshot`.

- [ ] Merge `spy()` into `observe(format=)` **S**
- [ ] Add `trace()` (write + read overload), merge `trace_log()` into it **S**
- [ ] Unexport `describe_node`, `meta_snapshot` from public API **S**

#### PY new tools

##### `Graph.diff()` — snapshot diffing (port from TS)

Static method on `Graph`. Computes structural + value diff between two `describe()` snapshots. Returns `GraphDiffResult` with `nodes_added`, `nodes_removed`, `nodes_changed`, `edges_added`, `edges_removed`.

- [ ] Port `Graph.diff()` from TS to PY **S**

##### `harness_trace()` — pipeline stage trace

Attaches reactive listeners (via `observe(format="pretty")`) to all 7 harness stages. One call gives full pipeline visibility:

```
[0.000s] INTAKE    ← "T5: resilience ordering wrong" (source=eval, severity=high)
[0.312s] TRIAGE    → route=needs-decision, rootCause=unknown
[0.312s] QUEUE     → needs-decision (depth: 1)
[0.850s] GATE      ▶ modify() → rootCause=composition, intervention=template
[1.102s] EXECUTE   → outcome=success
[1.305s] VERIFY    → verified=true
[1.305s] STRATEGY  → upsert composition→template (1/1 = 100%)
```

- [ ] Implement `harness_trace(harness, logger=print)` → `dispose()` — wires `observe()` to harness stage nodes **S**

##### Runner `__repr__` — diagnostic visibility

Add pending task counter and `__repr__` to runner implementations. Surfaces in assertion failure messages and `harness_profile()` output. No new exported function — just better diagnostics when things fail.

- [ ] Add `_scheduled`/`_completed` counters + `__repr__` to `_ThreadRunner` and `AsyncioRunner` **S**

#### TS new tools (parity)

##### Runner diagnostic `__repr__` / `toString()`

N/A in TS — no runner abstraction (TS uses microtask scheduling natively via `promptNode` + `LLMAdapter`).

#### Final surface (both languages)

| Tool | Type | Responsibility |
|------|------|----------------|
| `describe()` | Graph method | Structure snapshot (topology, types, values) |
| `observe()` | Graph method | Live events + pretty-print (absorbs spy) |
| `trace()` | Graph method | Write reasoning annotations + read ring buffer (absorbs annotate + traceLog) |
| `graphProfile()` | Function | Memory & connectivity profiling |
| `harnessProfile()` | Function | Harness domain profiling (extends graphProfile) |
| `diff()` | Static method | Compare two describe snapshots |
| `reachable()` | Function | Upstream/downstream graph traversal |
| `filter() \| take()` | Operators | Reactive composition for "first value where…" (replaces polling `_wait_for`) |
| `harnessTrace()` | Function | Pipeline stage-level trace (wires observe to all stages) |

9 tools, no overlaps, no memorization burden. Internals (`describeNode`, `metaSnapshot`, `sizeof`) stay internal.

#### Immediate follow-ups (from inspection-harness-revalidation session, 2026-04-08)

##### Category A: Move protocol-level operators from patterns/ to extra/ or core/ — **SHIPPED (TS) 2026-04-22**

TS: `stratify` moved to [src/extra/stratify.ts](../src/extra/stratify.ts) (unique primitive). The patterns/ versions of `valve`, `forEach`, and `wait` were duplicates of existing extra/ operators ([extra/operators.valve](../src/extra/operators.ts), [extra/sources.forEach](../src/extra/sources.ts), [extra/operators.delay](../src/extra/operators.ts)) with a Graph-registering wrapper — removed in favor of `graph.add(op, { name })` composition. Test migrations + exports test updated. PY parity deferred.

- [ ] PY parity — move `stratify` → `extra/`, remove duplicate `valve` / `for_each` / `wait` from `patterns/orchestration.py`

##### Category B: Replace direct `.down([(MessageType.DATA, value)])` with `.emit()` sugar — **SHIPPED (TS) 2026-04-22**

TS: all 29 sites across 9 files (`memory.ts`, `reduction.ts`, `cqrs.ts`, `domain-templates.ts`, `ai.ts`, `orchestration.ts`, `graphspec.ts`, `messaging.ts`, `harness/bridge.ts`) migrated to `.emit(v)` (the actual sugar — `.set()` in the original roadmap line was a misnomer; see [src/core/node.ts:303](../src/core/node.ts:303)). `{ internal: true }` option preserved at the four `cqrs.ts` sites that use it. PY parity deferred.

- [ ] PY parity — audit + migrate `.down([(DATA, v)])` sites in `graphrefly-py/src/graphrefly/patterns/**.py` to `.emit(v)`

---

### Wave 2.5: Prompt & Catalog Optimization (Weeks 7-9)

Goal: generalize the catalog auto-refine loop (9.1b) into a reactive prompt optimization framework. The optimization loop itself is a Graph — observable, checkpointable, causally traceable.

**Competitive context:** Future AGI's `agent-opt` implements 6 prompt optimization algorithms (Random Search, Bayesian/Optuna, ProTeGi, Meta-Prompt, PromptWizard, GEPA). Their implementation has quality issues (hardcoded models, no parallelism, no caching, misleading Bayesian Search). Our advantage: optimization-as-a-graph — the trajectory is inspectable and resumable. See `archive/docs/SESSION-marketing-promotion-strategy.md` §17 for full algorithm analysis.

#### 9.8 — Reactive optimization loop (`refineLoop`)

**Key insight:** All prompt optimization algorithms (Random Search, Bayesian, ProTeGi, Meta-Prompt, PromptWizard, GEPA) are the same feedback loop with different strategies at the feedback→generate step. We should provide the **loop infrastructure** and a **pluggable strategy interface** — not reimplement 6 algorithms.

**The universal loop:**
```
candidates = seed(artifact)
loop:
  scores     = evaluate(candidates, dataset)      ← §9.1 eval runner / custom evaluator
  feedback   = analyze(scores, errors)             ← RefineStrategy (pluggable)
  candidates = generate(feedback, candidates)      ← RefineStrategy (pluggable)
  if converged: break                              ← early stopping condition node
return best(candidates)
```

##### Core API — **SHIPPED (TS) 2026-04-22**

Landed at [src/patterns/refine-loop.ts](../src/patterns/refine-loop.ts). Topology is Shape B + C-aspects: 4 mounted `TopicGraph`s (GENERATE / EVALUATE / ANALYZE / DECIDE) backbone + reactive feedback loop. Composition invariants honored: §7 (feedback cycle via closure-seeded strategy/feedback/prev-candidates reads, not reactive deps — avoids retriggering), §28 (factory-time seed pattern for multi-state subscribe ordering), §32 (state-mirror — decide-effect writes `lastFeedback` BEFORE `iterationTrigger` inside one `batch()` so the closure-updater drains between them and the next generate sees fresh feedback), inline convergence checks in decideEffect to avoid cache-round-trip deadlock. 9 tests at [src/__tests__/patterns/refine-loop.test.ts](../src/__tests__/patterns/refine-loop.test.ts).

- [x] `refineLoop(seed, evaluator, strategy, opts)` → `RefineLoopGraph<T>` — extends `Graph` so `describe()`, `observe()`, `snapshot()` / `restore()`, `attachStorage()` all work via inheritance.
- [x] Observable state nodes: `best`, `score`, `status` (`"running"|"converged"|"budget"|"paused"|"errored"`), `history`, `strategy`, `iteration`.
- [x] 4 topics exposed as graph-mounted subgraphs — subscribe for streaming or cursor-based consumption.
- [x] `Evaluator<T>` — **Shape 4** from 2026-04-22 architecture review: `(candidates: Node<readonly T[]>, dataset: Node<readonly DatasetItem[]>) => Node<readonly EvalResult[]>`. Both deps reactive; the evaluator's returned node IS the EVALUATE topic's source.
- [x] `dataset: NodeInput | readonly DatasetItem[]` — arrays auto-wrapped in `state()` so the static-dataset case stays one line.

##### RefineStrategy interface (the pluggable slot) — **SHIPPED (TS) 2026-04-22**

- [x] `RefineStrategy<T>`:
  ```ts
  { name: string
  , seed(seed: T): readonly T[]
  , analyze(scores: readonly EvalResult[], candidates: readonly T[]): Feedback
  , generate(feedback: Feedback, candidates: readonly T[]): Promise<readonly T[]> | readonly T[]
  }
  ```
  Plain object, no base class, no registration. `generate` may be sync or async — the loop bridges via `fromAny` + `switchMap` so in-flight generation is cancellable.
- [x] Mid-run strategy swap: `loop.setStrategy(newStrategy)`. Human-in-the-loop handoff per COMPOSITION-GUIDE §29.

##### Built-in strategies (examples, not the product)

- [x] **`blindVariation(teacher, opts?)`** — teacher generates N variants per iteration; no feedback analysis. (Random Search equivalent.) SHIPPED.
- [x] **`errorCritique(teacher, opts?)`** — ProTeGi-style critique-driven strategy. `analyze` classifies tasks below a threshold as failures, picks the best candidate via fan-out-aware `pickBest`, and packs `{best, failures, critiqueText}` into `feedback.critique` as a private payload. `generate` unpacks it and calls the teacher `width` times with `{prior, critique, failures, reportCost}`. Options: `width`, `failureThreshold` (number | function, default batch-mean with NaN → all-failures fallback), `maxFailureSamples` (default 5), `formatCritique`, `parallel` (default true, `Promise.all`; false opts into sequential `for/await`), `tokens?: Node<number>` companion counter (delta delivered in `finally` on success AND teacher-throw so partial spend survives errors). Fallback path when swapped mid-run against a foreign `Feedback`: `candidates[last]` + `feedback.summary` as critique. Empty-batch throw matches `blindVariation`. SHIPPED + QA-hardened (TS) 2026-04-23. [src/patterns/refine-loop/index.ts](../src/patterns/refine-loop/index.ts). Same QA pass upgraded `blindVariation` to the `{prior, reportCost}` context shape with matching `parallel` + `tokens` options (pre-1.0 breaking change on `teacher` signature — no back-compat). `EvalResult` gained optional `candidateIndex` for multi-task fan-out evaluators.
- [ ] **`mutateAndRefine(teacher, styles?, opts?)`** — deferred to post-v1.

##### Strategy registry (BMAD-inspired) — deferred

- [ ] `strategyRegistry(entries)` — deferred to post-v1.
- [ ] `autoSelectStrategy(registry, context)` — deferred to post-v1.

##### Loop infrastructure

- [x] **Budget gating** — `opts.budget` caps total candidate count; `opts.maxEvaluations` caps iteration × candidates. SHIPPED.
- [x] **Early stopping** — reactive convergence nodes (`patience-check` / `min-score-check` / `min-delta-check` / `max-evaluations-check` / `max-iterations-check` / `budget-exhausted-check`) plus inline checks inside `decideEffect` (the derived convergence nodes surface in `describe()`; the inline check avoids a cache-round-trip deadlock). SHIPPED.
- [x] **Checkpoint/resume** — works for free via `graph.attachStorage()` since `RefineLoopGraph` extends `Graph`. SHIPPED (no refine-loop-specific work needed).
- [x] **Pause / resume** — `loop.pause()` / `loop.resume()` surface, `status: "paused"` observable. SHIPPED.
- [ ] **Eval caching** — defer to user's `cascadingCache()` wiring around the evaluator; not baked into `refineLoop`.
- [ ] **Parallel evaluation** — user composes with `funnel()` concurrency inside the evaluator.
- [ ] **Multi-objective scoring** — user composes `scorer()` inside evaluator; Pareto front via `derived` over `history`.

##### Catalog-specific optimization (extends 9.1b)

- [ ] `optimizeCatalog(catalog, dataset, opts?)` — wraps `refineLoop` for catalog description optimization. Deferred.

##### Composition E — `refineExecutor`

- [ ] `refineExecutor(refineLoopFactory, opts?)` — adapter that plugs a refineLoop into the EXECUTE slot of `harnessLoop`. Unblocked by the v1 landing above; ready to schedule.

##### Deliverables

- [ ] Blog: "The feedback loop is the product — why we don't ship 6 optimization algorithms"
- [ ] Comparison page: GraphReFly `refineLoop` vs DSPy vs agent-opt

---

### Deferred (post-Wave 3 / post-launch)

Items not needed for harness engineering adoption. Build when demanded by users/pilots.

- §8.5 `peerGraph(transport)`, `shardedGraph(shardFn)`, adaptive sampling — distributed scale
- §8.6 GraphCodec (pluggable serialization) — performance optimization
- §8.7 Delta checkpoints & WAL — persistence optimization
- §8.8 Memory optimization (lazy meta, node pooling, dormant eviction) — scale optimization
- §6.2 V2 schema validation, §6.3 V3 caps+refs — versioning depth
- §7.3 Demos 1-4 — non-harness showcase demos
- §7.3b Demo 5 (Observability Pipeline), Demo 7 (Log Reduction) — build after Demo 0 + Demo 6 prove the pattern
- §7.4 Scenario tests — after demos ship
- §7.5 Inspection stress tests — quality hardening
- Consumer track (pillar #1 "Stop Drowning in Information") — revisit at v1.0

---

## Python-Specific Active Items

> Python tracks TS for core parity. Eval harness is TS-primary (corpus, rubrics, runner). MCP server and framework infiltration packages are TS-only. Python focus: §9.2 parity + backpressure + polish.

### PY Wave 2: Audit & accountability parity (Weeks 4-9)

#### PY 9.2 — Audit & accountability (8.4 → 9.2) — TS parity

- [ ] `explain_path(graph, from_node, to_node)` — walk backward through graph derivation chain
- [ ] `audit_trail(graph, opts)` → Graph — wraps graph with `reactive_log` recording every mutation
- [ ] `policy_enforcer(graph, policies)` — reactive constraint enforcement
- [ ] `compliance_snapshot(graph)` — point-in-time export for regulatory archival

#### PY 9.2b — Backpressure protocol (8.5 → 9.2b)

- [ ] Backpressure protocol — formalize PAUSE/RESUME for throughput control across graph boundaries

### PY Wave 3: Polish & publish (Weeks 10-15)

- [ ] `llms.txt` for AI agent discovery (7 → 9.3)
- [ ] PyPI publish: `graphrefly-py` (7 → 9.3)
- [ ] Docs site at `py.graphrefly.dev` (7 → 9.3)
- [ ] Free-threaded Python 3.14 benchmark suite

### PY Deferred (post-Wave 3)

- §7.2 Showcase demos (Pyodide/WASM lab) — after TS demos prove the pattern
- §7.3 Scenario tests — after demos
- §7.4 Inspection stress tests (thread-safety: concurrent factory composition under per-subgraph locks)
- §8.5 `peer_graph`, `sharded_graph`, adaptive sampling — distributed scale

---

## Open items from completed phases

Items that were not done when their parent phase shipped. Tracked here for visibility.

### Phase 0.5 — Sugar constructors (omitted by design)

- [ ] `subscribe(dep, callback)` — omitted in TS: use `node([dep], fn)` or `effect([dep], fn)`; instance `Node.subscribe` covers sink attachment
- [ ] `operator(deps, fn, opts?)` — omitted; use `derived`

### Phase 3.1b — Reactive output consistency

- [ ] **Python parity:** same treatment in `graphrefly-py` — no `async def` / `Awaitable` / `Future` in public APIs; wrap `asyncio` calls in reactive sources

### Phase 6.1 — V1 content addressing

- [ ] Lazy CID computation — `node.cid` computed on first access after value change, not on every DATA

### Phase 6.2 — V2: + schema (type validation)

- [ ] V2: + schema (type validation at node boundaries)

### Phase 6.3 — V3: + caps + refs

- [ ] V3: + caps (serialized guard policy) + refs (cross-graph references)

### Phase 7 — Polish & Launch

- [ ] README with "graph + re + fly" tagline
- [ ] npm publish: `@graphrefly/graphrefly-ts`
- [ ] Docs site
- [ ] Community launch (HN, Reddit, dev.to)

### Phase 7.3 — Showcase demos

- [ ] **Demo 0: Personal email triage** — NL → GraphSpec → flow → run → persist → explain (moved to 9.5)
- [ ] **Demo 1: Order Processing Pipeline** — 4.1 + 4.2 + 4.5 + 1.5 + 3.3 (vanilla JS, 10 ACs)
- [ ] **Demo 2: Multi-Agent Task Board** — 4.1 + 4.3 + 4.4 + 3.2b + 1.5 (React, WebLLM + Gemma 4 E2B, 11 ACs)
- [ ] **Demo 3: Real-Time Monitoring Dashboard** — 4.1 + 4.2 + 4.3 + 3.1 + 3.2 (Vue, 12 ACs)
- [ ] **Demo 4: AI Documentation Assistant** — 4.3 + 4.4 + 9.3d + 3.2b + 3.2 + 3.1 (Preact, `cascadingLlmAdapter`: BYOK + WebLLM + Chrome Nano + FTS5, 13 ACs)

### Phase 7.3b — Universal reduction demos

- [ ] **Demo 5: Observability Pipeline** — 5.2c + 8.1 + 8.4 + 3.2b
- [ ] **Demo 6: AI Agent Observatory** — 4.4 + 8.1 + 8.4 + 3.3 (moved to 9.7)
- [ ] **Demo 7: Log Reduction Pipeline** — 5.2c + 8.1 + 8.2

### Phase 7.4 — Scenario tests

- [ ] `src/__tests__/scenarios/order-pipeline.test.ts`
- [ ] `src/__tests__/scenarios/agent-task-board.test.ts`
- [ ] `src/__tests__/scenarios/monitoring-dashboard.test.ts`
- [ ] `src/__tests__/scenarios/docs-assistant.test.ts`

### Phase 7.5 — Inspection stress & adversarial tests

- [ ] `describe()` consistency during batch drain
- [ ] `observe({ structured/causal/timeline: true })` correctness under concurrent updates
- [ ] `Graph.diff()` performance on 500-node graphs (<10ms)
- [ ] `toMermaid()` output validity (parseable by mermaid-js)
- [ ] `trace()` ring buffer wrap correctness
- [ ] Cross-factory composition: mounted subgraphs don't interfere
- [ ] Guard bypass attempts (`.down()` without actor)
- [ ] `snapshot()` during batch drain (consistent, never partial)
- [ ] `subscription()` added mid-drain (correct offset)
- [ ] `collection()` eviction during derived read (no stale refs)

### Phase 7.6 — Foreseen building blocks

- [ ] **Reactive cursor** (shared by `subscription()` + `jobQueue()`) — cursor advancing through `reactiveLog`
- [ ] **Factory composition helper** — shared pattern/utility for 4.x graph factory boilerplate
- [ ] **Cross-island state bridge** — shared graph state across Astro islands
- [ ] **Guard-aware describe for UI** — `describe({ showDenied: true })` variant
- [ ] **Mock LLM fixture system** — `mockLLM(responses[])` adapter for `fromLLM()`. **Partially done:** scenario-scripted `mockLLM` with stage detection, call recording, per-stage cycling, and `callsFor(stage)` inspection exists in `src/__tests__/helpers/mock-llm.ts`. Needs promotion to a public library export (e.g. `src/patterns/testing.ts` or `src/testing/mock-llm.ts`) so any developer testing AI patterns can use it.
- [ ] **Time simulation** — `monotonicNs()` test-mode override for `vi.useFakeTimers()` integration
- [x] ~~`restoreGraphAutoCheckpoint(graph, adapter)`~~ — **superseded 2026-04-19** by `Graph.attachStorage(tiers, { autoRestore: true })`. The new path unwraps full and diff `GraphCheckpointRecord` modes internally via `_cascadeRestore`, eliminating the dual-writer collision. No follow-up work required.

### Phase 8.4 — Audit & accountability

> **DONE — archived to `archive/roadmap/phase-8-reduction-layer.jsonl`** (id: `phase-8.4-audit-accountability`). All four items (`auditTrail`, `explainPath`, `policyEnforcer`, `complianceSnapshot`) shipped under §9.2.

### Phase 8.5 — Performance & scale (remaining)

- [ ] `peerGraph(transport, opts?)` — federate graphs across processes/services
- [ ] Benchmark suite: 10K nodes, 100K msgs/sec
- [ ] `shardedGraph(shardFn, opts?)` — partition large graphs across workers
- [ ] Adaptive sampling

### Phase 8.6 — GraphCodec (pluggable serialization)

- [ ] `GraphCodec` interface
- [ ] `JsonCodec`, `DagCborCodec`, `DagCborZstdCodec`
- [ ] `graph.snapshot({ codec })` / `Graph.fromSnapshot(buffer, { codec })`
- [ ] `autoCheckpoint` codec option
- [ ] Codec negotiation for `peerGraph`

### Phase 8.7 — Delta checkpoints & WAL

- [ ] `graph.checkpoint()` → `DeltaCheckpoint`
- [ ] WAL append mode + periodic full snapshot compaction
- [ ] `Graph.fromWAL(entries[], opts?)`
- [ ] Delta-aware `peerGraph` sync

### Phase 8.8 — Memory optimization & tiered representation

- [ ] Lazy meta materialization
- [ ] Bounded history (ring buffer, time-based eviction, spill-to-disk)
- [ ] Structural sharing (value dedup, shared meta schemas)
- [ ] Node pooling (struct-of-arrays)
- [ ] Dormant subgraph eviction
- [ ] Lazy hydration

---

## Effort Key

| Size | Meaning |
|------|---------|
| **S** | Half day or less |
| **M** | 1-2 days |
| **L** | 3-4 days |
| **XL** | 5+ days |
