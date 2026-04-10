# Roadmap — Active Items (TS + PY)

> **This file is the single source of truth** for roadmap tracking across both graphrefly-ts and graphrefly-py.
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

The harness loop stages are wired but EXECUTE and VERIFY are currently promptNode shells — they output JSON assessments but don't touch code or re-run evals. The full closed loop requires:

- [ ] **EXECUTE actuators** — pluggable implementations that can apply catalog entry updates, template additions, doc edits, or `CatalogFnEntry` modifications. Default: promptNode (current). Advanced: tool-use agent that writes code + runs lint.
- [ ] **VERIFY re-eval** — after EXECUTE produces a fix, re-run *only the affected eval tasks* (not full suite). Wire `affectsEvalTasks` from the triaged item → eval runner → compare before/after scores. Default: promptNode review (current). Advanced: actual eval execution via `evals/lib/runner.ts`.
- [ ] **4-treatment runner script** (`evals/scripts/run-treatments.ts`) — automate the A→D experiment: iterate treatments, run evals per treatment, collect results, feed into harness loop for comparative analysis. Currently fully manual.
- [ ] **CI-triggered eval→harness pipeline** — on push/merge, run affected evals → feed results into harness → strategy model updates → report delta. Deferred until EXECUTE actuators are real.

**Design note:** EXECUTE and VERIFY are intentionally pluggable (the developer or LLM fills in the "how"). The above items wire *our specific* actuators for the catalog automation use case. Other users would plug in their own. The harness loop infrastructure is general; the actuators are domain-specific.

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

- [ ] **`streamingPromptNode`** — uses `adapter.stream()` instead of `invoke()`. Emits chunks to a `TopicGraph<StreamChunk>` as the LLM generates. Final parsed result goes to the output node as before.
- [ ] **`StreamChunk` type** — `{ source: string, token: string, accumulated: string, index: number }`. Generic enough for any streaming source, not just LLM.
- [ ] **Cancelable execution via `switchMap` + `AbortSignal`** — human steering signal cancels in-flight stream (`AbortController.abort()`). New input starts fresh. Uses existing `switchMap` — `switchMap(steeringSignal, () => streamingPromptNode(...))`.
- [ ] **Gate integration** — `gate.reject()` on the stream triggers abort. `gate.modify()` redirects with updated context.

Mountable extractor subgraphs (each is opt-in, composes with any stream topic):

- [ ] **`streamExtractor(streamTopic, extractFn, opts?)`** — generic factory: mount an extractor function to any streaming topic. Returns a derived node with extracted values. `extractFn: (accumulated: string) => T | null` — returns extracted value or null (nothing yet). This is the building block for all extractors below.
- [ ] **Keyword flag extractor** — `streamExtractor` with pattern-match for suspicious keywords. Config: `{ patterns: RegExp[], labels: string[] }`. Use cases: design invariant violations (`setTimeout`, `EventEmitter`, `process.nextTick`), PII detection (`SSN`, email, phone patterns), toxicity keywords, off-track reasoning indicators.
- [ ] **Tool call extractor** — `streamExtractor` that detects `tool_call` JSON in the stream. Feeds into the tool interception chain (SESSION-reactive-collaboration-harness §11). Enables reactive tool gating mid-stream, not post-hoc.
- [ ] **Cost meter extractor** — `streamExtractor` that counts tokens and feeds into `budgetGate`. Enables hard-stop when LLM output exceeds budget mid-generation.

**Pattern:** the stream topic is a `TopicGraph` (which extends `Graph`) — extractors are just nodes in that graph or mounted subgraphs. Sync vs async is a property of the sink, not the source: a `derived` extractor runs in the same propagation cycle as the chunk (sync — can abort before the next token), while a `SubscriptionGraph` cursor-reader consumes at its own pace (async — batches, renders at 60fps, flushes when ready). Same topology, same data, consumer picks the coupling mode. This is the dual composition mode (SESSION-reactive-collaboration-harness §8) applied to streaming.

This is what GraphReFly was built for from day 1: every flow is inspectable (`describe()`, `observe()`, `graphProfile()`), every node is subscribable, every subgraph is mountable. Stream extractors are not a new abstraction — they're what falls out naturally when a streaming source is a graph node instead of a raw `AsyncIterable`.

##### Reusable patterns to extract from harness work

Patterns discovered during §9.0 implementation that generalize beyond the harness:

- [ ] **Generalized source→intake bridge factory** — `evalIntakeBridge` is eval-specific; the pattern (parse domain results → uniform `IntakeItem[]` → publish to topic) generalizes to any source (CI results, test failures, Slack messages, monitoring alerts). Provide a `createIntakeBridge(parser, topic)` factory with pluggable parser.
- [ ] **Stage-aware prompt routing** (document pattern) — detecting which pipeline stage called the LLM based on prompt content keywords. Used in `mockLLM` and `run-harness.ts`. Worth documenting as a testing pattern for any multi-stage LLM pipeline.
- [ ] **Stable identity for retried items** (document pattern) — `trackingKey` pattern: use `relatedTo[0]` as stable identity, fall back to summary. Prevents retry/reingestion decorations (like `[RETRY N/M]` prefix) from generating novel keys that defeat dedup. Document in composition guide.

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
- [ ] **`evalSource(runner, config)`** — wraps any eval runner as a reactive producer node. Input: trigger signal (code change, manual, cron). Output: `EvalRun` results. Currently our eval runner is imperative (`await runLLMDXEval(config)`); this wraps it in a producer so results flow reactively into the harness.
- [ ] **`beforeAfterCompare(before, after)`** — derived node that takes two eval results and computes per-task deltas (score diff, new failures, resolved failures). Pure computation, no domain logic. Feeds into strategy model and report generation.
- [ ] **`affectedTaskFilter(issues, fullTaskSet)`** — derived node that selects which eval tasks to re-run based on `affectsEvalTasks` from triaged items. Avoids re-running the full suite on every fix.

**Composition B: Content safety pipeline**

LLM output flows through extractor subgraphs before reaching the user. Stream extractors (above) are the mechanism; this composition is the wiring pattern.

```
  LLM stream ──→ streamTopic ──→ piiRedactor ──→ toxicityGate ──→ outputTopic
                       │                                │
                       └─→ auditLog                     └─→ alert (if blocked)
```

Building blocks:
- [ ] **`redactor(streamTopic, patterns, replaceFn)`** — stream extractor that replaces matched patterns in-flight. `patterns`: PII regexes, custom terms. `replaceFn`: mask, hash, or remove. Output: sanitized stream topic.
- [ ] **`contentGate(streamTopic, classifier, threshold)`** — gate that blocks output if classifier score exceeds threshold. `classifier`: keyword-based (cheap) or promptNode-based (accurate). Falls through to human gate for borderline cases.

**Composition C: Agent tool interception**

From SESSION-reactive-collaboration-harness §11. Tool calls flow through a reactive pipeline before execution.

```
  agentLoop tool_call ──→ toolTopic ──→ valve (allowed?) ──→ budgetGate ──→ gate (human) ──→ execute ──→ auditTrail
```

Building blocks:
- [ ] **`toolInterceptor(agentLoop, opts?)`** — mounts a tool interception subgraph between `agentLoop` tool emission and tool execution. Pluggable pipeline: valve (policy), budgetGate (cost), gate (human approval for destructive ops). Default: passthrough (current behavior). Composition of valve (§9.0), budgetGate (§8.1), gate (§9.0), auditTrail (§9.2).

**Composition D: Quality gate (CI/CD)**

On code change, run affected checks → triage failures → auto-fix trivial ones → alert on structural ones.

```
  code change ──→ intakeBridge ──→ TRIAGE ──→ auto-fix queue ──→ EXECUTE (lint --fix, format) ──→ commit
                                         └──→ alert queue ──→ notify (Slack, PR comment)
```

Building blocks:
- [ ] **`codeChangeBridge(gitDiffSource, parser)`** — intake bridge that parses git diff / CI output into IntakeItems. `parser`: lint errors, test failures, type errors.
- [ ] **`notifyEffect(topic, transport)`** — effect node that sends triaged/verified items to an external channel (Slack webhook, GitHub PR comment, email). Pluggable transport.

**Composition E: Refinement loop (wraps refineLoop §9.8)**

The harness loop's EXECUTE→VERIFY cycle is a single-pass fix. For iterative refinement (prompt optimization, catalog tuning), wire `refineLoop` into the EXECUTE slot:

```
  triaged item ──→ refineLoop(seed=current, evaluator=affected_evals, strategy=errorCritique) ──→ best candidate ──→ VERIFY
```

This connects §9.0 (harness) with §9.8 (refineLoop) — the harness routes items, refineLoop iterates on fixes, the harness verifies and learns.

- [ ] **`refineExecutor(refineLoopFactory, opts?)`** — adapter that plugs a refineLoop into the EXECUTE slot of harnessLoop. Maps triaged item → seed, affected evals → evaluator, strategy model → refinement strategy selection.

**Design principle:** each composition is 5-20 lines of wiring, not a new factory. The building blocks above are the nodes and edges; the user's `harnessLoop` config determines which are active. We provide the Lego pieces and a few pre-assembled models (our own dogfood). The user remixes for their domain.

---

### §9.0b — Mid-Level Harness Blocks (between Wave 0 and Wave 1)

Goal: composed building blocks between raw primitives and `harnessLoop()`. Power users compose custom harness variants without wiring 5+ primitives per requirement. `harnessLoop()` uses these internally.

**Design reference:** `archive/docs/SESSION-mid-level-harness-blocks.md`

**Design principle:** The library produces structured, reactive data. It never generates natural language — that's the LLM's or UI's job. All block outputs are typed nodes, composable with any downstream consumer.

#### graphLens() — reactive graph observability

Small subgraph that rides on a target graph via `bridge()`. Each field is a reactive node — subscribable, composable with gates, alerts, memory.

```typescript
const lens = graphLens(graph)
lens.topology   // Node<TopologyStats> — nodeCount, edgeCount, sources, sinks, depth, hasCycles
lens.health     // Node<HealthReport> — { ok, problems: [{ node, status, since, upstreamCause? }] }
lens.flow       // Node<FlowStats> — per-node throughput, lastUpdate, staleSince?, bottlenecks[]
lens.why(node)  // Node<CausalChain> — reactive explainPath subscription (live, not one-shot)
```

- [ ] `TopologyStats` derived node — computed from `describe()`, pushes on topology change
- [ ] `HealthReport` derived node — aggregates node statuses, identifies upstream causes
- [ ] `FlowStats` derived node — rolling-window throughput per node, stale detection, bottleneck identification
- [ ] `why(node)` — reactive `explainPath` wrapper. Works after §9.2 ships; topology/health/flow work without it
- [ ] `graphLens()` factory — wires all four as a mounted subgraph via `bridge()`

#### resilientPipeline() — resilience composition with correct ordering

Encodes the nesting order discovered during eval runs: `rateLimiter → breaker → retry → timeout → fallback → cache feedback → status`.

```typescript
const step = resilientPipeline(graph, targetNode, {
  retry: { max: 3 },
  backoff: { strategy: 'exponential', base: 1000 },
  breaker: { threshold: 5, resetAfter: 30_000 },
  timeout: 10_000,
  budget: { maxTokens: 50_000 },
})
```

- [ ] `resilientPipeline()` factory — composes retry + backoff + withBreaker + timeout + budgetGate in correct order
- [ ] All options optional with sensible defaults — omit what you don't need
- [ ] Status node exposed: `step.status` — `Node<'ok' | 'retrying' | 'open-circuit' | 'timeout'>` for wiring into graphLens or dashboards
- [ ] Subsumes `resilientFetch` template (§9.1b) — template becomes a preconfigured instance

#### guardedExecution() — composable safety layer

Wraps any subgraph with ABAC + policy + budgetGate. Returns scoped view (actor sees only what they're allowed to).

```typescript
const guarded = guardedExecution(graph, subgraph, {
  actor: currentUser,
  policies: [allow('read', '*'), deny('write', 'system:*')],
  budget: { maxCost: 1.00 },
})
```

- [ ] `guardedExecution()` factory — composes Actor/Guard + `policyFromRules()` + `budgetGate`
- [ ] Scoped `describe()` — returns only nodes the actor can see
- [ ] Violation events emitted to alert subgraph (composable with `graphLens().health`)
- [ ] Depends on: Actor/Guard (Phase 1.5, done), `policyEnforcer` (§9.2)

#### persistentState() — survive restarts in one call

Bundles autoCheckpoint + snapshot + restore + incremental diff.

```typescript
const persistent = persistentState(graph, {
  store: sqliteStore('./data/checkpoint.db'),
  debounce: 500,
  incremental: true,  // uses Graph.diff() for delta checkpoints
})
```

- [ ] `persistentState()` factory — composes autoCheckpoint + snapshot + restore
- [ ] Incremental mode using `Graph.diff()` for delta checkpoints (existing)
- [ ] Auto-saves gated by `messageTier >= 3` (per CLAUDE.md auto-checkpoint rule)
- [ ] `persistent.save()` / `persistent.restore()` for manual control
- [ ] Depends on: autoCheckpoint (Phase 1.4b, done), Graph.diff() (done)

---

### Wave 1: "The Eval Story" — publish engineering discipline (Weeks 1-3)

Goal: establish credibility by showing eval → schema fix → re-eval feedback loop publicly. Low risk, no full architecture reveal.

#### 9.1 — Eval harness (presentable)

> **Portable eval tier, automated eval tier, and eval-driven schema fixes:** mostly DONE — archived to `archive/roadmap/phase-9-harness-sprint.jsonl`.

##### Remaining items

- [ ] 5+ automated runs across 2+ models with trend data committed
- [ ] Track schema gaps as running metric: gaps found → gaps resolved

#### 9.1b — Catalog automation (the eval-proven product feature)

> **Rich catalog types:** DONE — archived to `archive/roadmap/phase-9-harness-sprint.jsonl` (id: `9.1b-rich-catalog`).

##### Remaining gaps to close (identified Run 4, both models)

- [ ] **Pre-built `resilientFetch` template** — correct resilience ordering (rateLimiter→breaker→retry→timeout→fallback→cache feedback→status). Closes T5/T8a/T8b ordering + cache bugs.
- [ ] **Pre-built `adaptivePoller` template** — switchMap-based dynamic interval + feedback to interval state. Closes T6 producer-can't-read-state gap.
- [ ] **`conditionalMap` catalog wrapper** — thin wrapper over `dynamicNode` (not a new primitive). Exposed as rich `CatalogFnEntry`. Closes T6 interval computation gap.
- [ ] **`median` aggregate op** — add to `aggregate` fn config enum. Closes T8a "avg ≠ median" gap.
- [ ] **`llmScore` description update** — add guidance: "When comparing against existing data, add a database producer node as a second dep." Closes T11 missing-DB-query gap.

##### Eval validation: 4-treatment comparison (the 9.1b experiment)

Four treatments, same 12 tasks, measuring delta at each automation step:

| Treatment | Developer does | Library does | Measures |
|-----------|---------------|-------------|----------|
| A: Manual catalog | Writes `catalogDescription` string | Nothing | Baseline (Run 4: 173/180) |
| B: Auto-gen prompt | Writes `CatalogFnEntry` objects | `generateCatalogPrompt()` | Auto-prompt quality |
| C: + auto-refine | Same as B | + `maxAutoRefine: 2` | Error self-correction |
| D: + templates | Same as C + selects templates | + pre-built templates | Architectural gap closure |

- [ ] Write `CatalogFnEntry` objects for all portable-eval catalog fns/sources
- [ ] Run Treatment B (auto-gen prompt) — L0 across Claude + Gemini
- [ ] Run Treatment C (auto-gen + refine) — L0 across Claude + Gemini, track refine counts
- [ ] Build pre-built templates (`resilientFetch`, `adaptivePoller`)
- [ ] Run Treatment D (auto-gen + refine + templates) — L0 across Claude + Gemini
- [ ] Compare A→D progression, write up for blog
- [ ] Cross-model validation: GPT-4o

##### Decision framework: when to add vs when to prune

The eval itself governs catalog growth. Decision rules:

| Signal | Meaning | Action |
|--------|---------|--------|
| Score up, tokens flat | Good addition | Keep |
| Score flat, tokens up | Bloat | Remove or merge entries |
| Score up only with templates, not fns | Templates > fns for this gap | Invest in templates |
| Hallucination rises with catalog size | Prompt overload | Implement catalog subsetting |
| Auto-refine fixes same error repeatedly | Bad description | Fix description, don't rely on refine |
| Per-task delta = 0 across A→D | Task at ceiling | Stop adding catalog for it |

**Principle:** Add a catalog fn only when the operation genuinely doesn't exist. Add a template when the LLM composes correct fns in wrong structure. Add docs when the LLM doesn't reach for an existing fn. Add a catalog wrapper (not a primitive) when dynamicNode already supports the pattern. See session log `evals/results/session-2026-04-06-catalog-automation.md` §6 for full analysis.

**Key metric: score per prompt token.** If this ratio declines, the catalog is growing faster than quality. Declining efficiency = time to prune or subset.

##### Catalog quality telemetry (future)

- [ ] Track common `validateSpecAgainstCatalog` errors across runs (which fns get hallucinated most?)
- [ ] Surface "catalog improvement suggestions" from aggregated validation errors
- [ ] Auto-suggest new catalog entries when LLMs consistently invent the same fn name
- [ ] **Catalog subsetting** (Treatment E) — select only task-relevant fns/templates for the prompt. Hypothesis: for simple tasks, smaller catalog outperforms comprehensive one. Smart subsetting as the next automation layer after templates.

#### 9.1 deliverables for announcement

- [ ] Blog post: "How our eval harness found two schema bugs LLMs couldn't work around" → updated narrative: "How evals proved catalog quality is the #1 lever, and we automated it"
- [ ] Open-source the eval runner (already in repo — make it prominent)
- [ ] Multi-model comparison results page
- [ ] "Reproduce our evals" guide (portable prompts for anyone)
- [ ] **Pre-launch outreach: 20-30 personalized "design partner" emails** (see marketing strategy §16A) — send 1-2 weeks before Wave 1 announcement. Target: harness engineering blog authors, LangGraph/CrewAI contributors, reactive programming maintainers, agent reliability researchers, MCP ecosystem builders

---

### Wave 2: "The Harness Layer" — claim the category (Weeks 4-9)

Goal: ship the audit/explain layer + MCP server + scorecard. This is where GraphReFly explicitly becomes "harness engineering."

#### 9.2 — Audit & accountability (8.4 → 9.2)

The missing layer that makes "harness" real, not just "substrate."

- [ ] `explainPath(graph, from, to)` — walk backward through graph derivation chain. Returns human-readable + LLM-parseable causal chain. THE harness differentiator. (8.4 → 9.2)
- [ ] `auditTrail(graph, opts?)` → Graph — wraps any graph with `reactiveLog` recording every mutation, actor, timestamp, causal chain. Queryable by time range, actor, node. (8.4 → 9.2)
- [ ] `policyEnforcer(graph, policies)` — reactive constraint enforcement. Policies are nodes (LLM-updatable). Violations emit to alert subgraph. (8.4 → 9.2)
- [ ] `complianceSnapshot(graph)` — point-in-time export of full graph state + audit trail for regulatory archival. (8.4 → 9.2)

#### 9.3 — MCP Server (`@graphrefly/mcp-server`)

- [ ] MCP Server package exposing GraphReFly operations as tools:
  - `graphrefly_create` — create graph from GraphSpec JSON or natural language
  - `graphrefly_observe` — observe node/graph state (progressive detail levels)
  - `graphrefly_reduce` — run a reduction pipeline on input data
  - `graphrefly_explain` — causal chain for a decision (requires 9.2 `explainPath`)
  - `graphrefly_snapshot` — checkpoint/restore graph state
  - `graphrefly_describe` — graph topology introspection
- [ ] Publish to npm as `@graphrefly/mcp-server`
- [ ] Submit to: official MCP registry (`registry.modelcontextprotocol.io`), Cline Marketplace, PulseMCP
- [ ] "Try it with Claude Code in 2 minutes" quickstart

#### 9.4 — Harness scorecard (public)

- [ ] Scorecard page at `graphrefly.dev/scorecard` (or docs section):
  - First-pass GraphSpec validity rate (from 9.1 evals)
  - Hallucination rate by model
  - Schema gap count: open → resolved (with links to fixes)
  - Causal trace completeness (from 9.2 `explainPath` coverage — added once 9.2 ships)
  - Checkpoint restore integrity (from existing snapshot round-trip tests)
  - Multi-model comparison trend lines
- [ ] Updated weekly from CI eval runs
- [ ] Machine-readable `scorecard/latest.json` for programmatic consumption

#### 9.2 deliverables for announcement

- [ ] `@graphrefly/mcp-server` on npm
- [ ] Harness scorecard page live
- [ ] "GraphReFly vs LangGraph" comparison page (reactive push vs static DAG, causal trace, glitch-free)
- [ ] Blog: "Why agent harnesses need reactive graphs"

---

### Wave 3: "The Existential Demo" — prove the full vision (Weeks 10-15)

Goal: Demo 0 + framework integrations. Unlocks HN launch.

#### 9.5 — Demo 0 (7.3 → 9.5)

NL → GraphSpec → flow view → run → persist → explain. The demo that proves the reason to exist.

- [ ] Demo 0: Personal email triage (7.3 → 9.5, see §7.3 for full ACs in archive)

#### 9.6 — Framework infiltration packages

- [ ] **Vercel AI SDK middleware** (`@graphrefly/ai-sdk`) — `graphreflyMiddleware` wraps any model with reactive graph state. Intercepts calls to inject context, captures outputs as node updates.
- [ ] **LangGraph TS tools** (`@graphrefly/langgraph`) — Zod-validated tools exposing graph operations. Note: LangGraph also consumes MCP natively, so 9.3 MCP server may suffice.
- [ ] **3 golden template repos** — standalone starter projects:
  - Incident triage reduction (observabilityGraph + fromOTel)
  - Agent run observatory (agentLoop + tracing)
  - Alert dedup/prioritization (funnel + scorer)

#### 9.7 — Demo 6: AI Agent Observatory (7.3b → 9.7)

The harness engineering showcase. Instrument agentLoop, LLM observes LLM, distills "why agent went off-track."

- [ ] Demo 6 (7.3b → 9.7)

**Demo candidate: stream extractor showcase.** Part or all of the stream extractor pattern as a live demo — a single `streamingPromptNode` with multiple extractors mounted simultaneously, each visible in real time. Demonstrates that every flow is inspectable and pluggable — the core GraphReFly thesis applied to streaming. Scope decided at demo time.

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

- [ ] Demo 0 video/GIF
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

##### Category A: Move protocol-level operators from patterns/ to extra/ or core/

Several `patterns/` files contain protocol-level operators that belong in `extra/` or `core/`:
- `reduction.stratify()` — tier classification, belongs in `extra/`
- `orchestration.valve()` / `for_each()` / `wait()` — general reactive primitives, belong in `extra/`

These are currently in `patterns/` because they were built for harness use cases, but they have no domain-layer assumptions. Move them so non-harness users can compose with them.

- [ ] Audit and move protocol-level operators from `patterns/` to `extra/` (TS + PY) **M**

##### Category B: Replace direct `.down([(MessageType.DATA, value)])` with `.set()` sugar

~30+ sites across `patterns/` in both TS and PY use `.down([(MessageType.DATA, value)])` instead of `.set(value)`. The `.down()` calls expose protocol internals (MessageType) in domain-layer code. Gate `approve()`/`reject()` are already sugar for this boundary — the remaining sites should use `.set()` or equivalent sugar.

- [ ] Replace `.down([(DATA, value)])` with `.set()` sugar across patterns/ (TS + PY) **M**

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

##### Core API

- [ ] `refineLoop(seed, evaluator, strategy, opts?)` → `RefineGraph` — the universal optimization loop as a Graph. `seed`: initial artifact. `evaluator`: scores candidates. `strategy`: generates improved candidates from feedback. Returns graph with `best: Node<T>`, `history: Node<Iteration[]>`, `score: Node<number>`, `status: Node<"running"|"converged"|"budget"|"paused">`.
- [ ] `RefineGraph` is a standard `Graph` — `describe()`, `observe()`, `snapshot()`/`restore()`, `autoCheckpoint()` all work. Pause via PAUSE signal, resume via RESUME.
- [ ] `Evaluator<T>` interface: `(candidate: T, dataset: DatasetItem[]) => Node<EvalResult[]>` — reactive, not Promise.

##### RefineStrategy interface (the pluggable slot)

- [ ] `RefineStrategy<T>` interface:
  ```ts
  {
    name: string
    analyze: (scores: EvalResult[], candidate: T) => Node<Feedback>
    generate: (feedback: Feedback, candidates: T[]) => Node<T[]>
    select?: (scored: ScoredItem<T>[]) => T[]
  }
  ```
- [ ] Strategies are plain objects — no base class, no registration.

##### Built-in strategies (examples, not the product)

- [ ] **`blindVariation(teacher, opts?)`** — teacher generates N diverse candidates. No feedback analysis. (Random Search equivalent.)
- [ ] **`errorCritique(teacher, opts?)`** — identify errors, teacher generates critiques, apply critiques to produce improved candidates. (ProTeGi/Meta-Prompt equivalent.)
- [ ] **`mutateAndRefine(teacher, styles?, opts?)`** — mutation via configurable "thinking styles", then critique + refine. (PromptWizard equivalent.)

##### Strategy registry (BMAD-inspired)

- [ ] `strategyRegistry(entries)` — a `reactiveMap` of named strategies with metadata.
- [ ] `autoSelectStrategy(registry, context)` — `promptNode` that picks the best strategy from the registry.

##### Loop infrastructure (graph-native, what competitors lack)

- [ ] **Budget gating** — `budgetGate()` (§8.1) constrains total eval calls, teacher calls, and token spend.
- [ ] **Eval caching** — `cascadingCache()` (§3.1c) memoizes candidate→score.
- [ ] **Parallel evaluation** — dataset eval via `funnel()` (§8.1) with configurable concurrency.
- [ ] **Multi-objective scoring** — `scorer()` (§8.1) with reactive weights. Pareto front via derived node over history.
- [ ] **Early stopping** — reactive condition node: patience, min_score, min_delta, max_evaluations.
- [ ] **Checkpoint/resume** — `autoCheckpoint()`. Interrupt overnight, resume from exact state.
- [ ] **Causal tracing** — every selection decision traceable.

##### Catalog-specific optimization (extends 9.1b)

- [ ] `optimizeCatalog(catalog, dataset, opts?)` — wraps `refineLoop` for catalog description optimization.

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
- [ ] **Demo 4: AI Documentation Assistant** — 4.3 + 4.4 + 3.2b + 3.2 + 3.1 (Preact, WebLLM + Gemma 4 E4B, 12 ACs)

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
- [ ] **`restoreGraphAutoCheckpoint(graph, adapter)`** — restore counterpart for `autoCheckpoint`. Currently `autoCheckpoint` saves `GraphCheckpointRecord` (`{mode, snapshot, seq}`) but `restoreGraphCheckpoint` expects bare `GraphPersistSnapshot` — the shapes are incompatible. Need a restore function that unwraps `GraphCheckpointRecord`, applies diff-mode records, and feeds the snapshot to `graph.restore()`. Discovered during QA of `run-harness.ts` where `tiers.archiveAdapter` + manual `saveGraphCheckpoint` created a dual-writer collision on the same key.

### Phase 8.4 — Audit & accountability

- [ ] `auditTrail(graph, opts?)` → Graph
- [ ] `explainPath(graph, from, to)` — causal chain
- [ ] `policyEnforcer(graph, policies)` — reactive constraint enforcement
- [ ] `complianceSnapshot(graph)` — regulatory archival

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
