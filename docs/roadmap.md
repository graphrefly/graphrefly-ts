# Roadmap — Active Items

> **Completed phases and items have been archived to `archive/roadmap/*.jsonl`.** See `docs/docs-guidance.md` § "Roadmap archive" for the archive structure and workflow.
>
> **Spec:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` (canonical; not vendored in this repo)
>
> **Guidance:** [docs-guidance.md](docs-guidance.md) (documentation), [test-guidance.md](test-guidance.md) (tests). Agent context: repo root `CLAUDE.md`; skills under `.claude/skills/`.
>
> **Predecessor:** callbag-recharge (170+ modules, 13 categories). Key patterns and lessons
> carried forward — see `archive/docs/DESIGN-ARCHIVE-INDEX.md` for lineage. Clone path for local reference: `~/src/callbag-recharge`.

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

##### Wiring

- [ ] Eval→intake bridge — effect parsing `RunResult` into `IntakeItem[]` (per-criterion findings, not just per-task scores), publishes to intake topic
- [ ] Strategy model — derived node over completed issues: `rootCause × intervention → { attempts, successes, successRate }`. Feeds back into triage promptNode for routing hints
- [ ] Priority scoring template — configurable derived node using existing `decay()` from `src/patterns/memory.ts` + strategy model + developer-supplied signals (urgency, type bias, assignee load, etc.)
- [ ] Fast-retry path (from Reflexion pattern) — conditional edge VERIFY→EXECUTE for self-correctable errors (config validation, parse failures), skipping full INTAKE→TRIAGE cycle. Max retries per item (default 2) to prevent loops
- [ ] `harnessLoop()` factory — wires the static topology: intake topic → triage (promptNode) → 4 queue topics (auto-fix, needs-decision, investigation, backlog) → gates on configured channels → execute → verify (with fast-retry) → reflect (strategy model + hypothesis promptNode + distill via existing agentMemory)

##### Dual composition mode

Supports both graph-subgraph (tight coupling, same propagation cycle) and cursor-reading via `SubscriptionGraph` (降維 — dimensionality reduction, independent consumption pace). Developer picks per-branch. Same data can feed both modes.

##### Dogfood on 9.1b

- [ ] Wire 9.1b eval runs through the harness loop
- [ ] Human steering through `gate.modify()` with structured `rootCause`/`intervention` metadata
- [ ] Strategy model accumulates effectiveness data across treatments A→D
- [ ] Retrospective distills into `agentMemory` for next session context

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

#### Wave 3 deliverables for announcement

- [ ] Demo 0 video/GIF
- [ ] Show HN: "GraphReFly — the reactive harness layer for agent workflows [harness scorecard inside]"
- [ ] `@graphrefly/ai-sdk` and/or `@graphrefly/langgraph` on npm
- [ ] 3 template repos public
- [ ] Reddit posts: r/AI_Agents, r/typescript, r/ClaudeCode
- [ ] 小红书 original post: "为什么 Agent Harness 需要 reactive graph"
- [ ] Submit to harness-engineering.ai knowledge graph

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
- [ ] `traceLog()` ring buffer wrap correctness
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
- [ ] **Mock LLM fixture system** — `mockLLM(responses[])` adapter for `fromLLM()`
- [ ] **Time simulation** — `monotonicNs()` test-mode override for `vi.useFakeTimers()` integration

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
