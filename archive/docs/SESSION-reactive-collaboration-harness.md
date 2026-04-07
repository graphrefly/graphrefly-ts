---
SESSION: reactive-collaboration-harness
DATE: April 6, 2026
TOPIC: Designing a reactive collaboration harness — static-topology loop for human+LLM co-operation with gates, promptNode, cursor-driven readers, and strategy tracking
REPO: graphrefly-ts (primary)
---

## CONTEXT

Research across three prior sessions revealed a structural gap in the harness engineering strategy:

- **Catalog automation** (session-2026-04-06-catalog-automation) showed 5 persistent eval gaps surviving across models/runs. Fixes required human architectural judgment (root cause categorization, intervention type selection) — not automatable by evals alone.
- **Harness engineering strategy** (SESSION-harness-engineering-strategy) identified 8 harness requirements but left continuous improvement (#8) as the weakest — currently "human reads session logs manually."
- **Reactive issue tracker** (SESSION-reactive-issue-tracker-design) designed verifiable assertions, regression detection, and memory distillation — but as a project management tool, not as a harness component.

This session synthesizes these into a **reactive collaboration harness** — a static-topology loop where human steering and LLM execution flow through typed channels with gates, priority queues, and retrospective learning.

---

## PART 1: FIVE STRUCTURAL GAPS IN THE ORIGINAL TRACKER DESIGN

### Gap 1: No typed "human judgment" input

The tracker's `ingest(finding)` accepts `{ source, summary, detail }` — unstructured text. But human retrospective insights are structured decisions:

- Root cause category (composition / missing-fn / bad-docs / schema-gap / regression)
- Intervention type (template / catalog-fn / docs / wrapper / schema-change)
- Structural explanation (why the failure pattern exists)
- Confidence and affected eval tasks

**Solution:** `gate.modify()` IS the structured human input. When reviewing a pending item, the human enriches it with classification metadata before forwarding downstream. No separate `steer()` API needed — the gate itself is the steering point.

### Gap 2: No eval↔tracker reactive bridge

The eval system and tracker are currently separate. Three missing edges:

- **Eval → Tracker (inbound):** Eval results → structured findings per criterion → auto-ingested as IntakeItems
- **Tracker → Eval (outbound):** Open issues with `affectsEvalTasks` → eval focuses on those tasks first
- **Cross-run persistence:** Gap detector compares across runs ("T5 C3 failed in Run 3 AND Run 4 AND across Claude AND Gemini")

### Gap 3: No intervention effectiveness tracking

No meta-knowledge of "which intervention types work for which failure types." When a template fix closes a composition gap, the system should record the success. Over time this builds a strategy model:

```
composition → template:    85% effective (3/3 closed + 1 open)
guidance → docs:           50% effective (1/2 closed)
missing-op → catalog-fn:   100% effective (1/1)
```

This feeds back into triage: "template intervention has been 85% effective for composition failures."

### Gap 4: No predictive assertions (hypotheses)

The tracker only tracks things that already happened. Predictive insights ("if catalog exceeds ~25 fns, hallucination will rise") are untraceable. These should be `promptNode`-generated testable hypotheses that flow back into intake as early warnings.

### Gap 5: No attention decay tracking

Issues don't track when a human last interacted with them. High-severity issues that fell off the radar surface the same as freshly filed ones. The priority queue needs attention decay — using the existing `decay()` function from `src/patterns/memory.ts`.

---

## PART 2: THE KEY ARCHITECTURAL INSIGHT — STATIC TOPOLOGY, FLOWING DATA

### The problem with dynamic graph spawning

When `/dev-dispatch` triage produces N `needs-decision` items, a naive design would instantiate N sub-graphs. This requires graph template instantiation at runtime (`graph.instantiate()`), cross-graph lifecycle management, and dynamic topology changes — all hard engineering problems.

### The Kafka/Pulsar insight

The graph topology is **fixed** — it's the workflow channels (the pipes). What's dynamic is the **data flowing through** and **where human attention is focused** (the cursor). You don't rebuild plumbing every time you turn on a faucet.

Each branch in the workflow becomes a **sink** (TopicGraph) that accumulates items. A **cursor-driven reader** (SubscriptionGraph) consumes from the sink at its own pace. Processing each item starts a new linear graph — no branching, no nested topology.

**Existing infrastructure that already implements this:**
- `TopicGraph` — pub/sub topic with ordered entries
- `SubscriptionGraph` — cursor-based reader with `cursor: Node<number>`, `available: Node<T[]>`, `pull(limit)`, `ack(count)`
- `JobQueueGraph` — `enqueue`/`claim`/`ack`/`nack` work queue
- `bridge()` — cross-graph wiring (shipped in 8.2)

### Cursor reading as dimensionality reduction (降维)

Cursor-driven reading reduces graph composition complexity:

```
GRAPH-SUBGRAPH MODEL:                     CURSOR-READING MODEL:
(exponential branching)                   (linear consumption)

         ┌─ subA ─┬─ A1 ─┬─ A1a          fork ──→ sink_A ← cursor reads linearly
fork ────┤        ├─ A2   └─ A1b                ──→ sink_B ← cursor reads linearly
         ├─ subB ─┬─ B1                         ──→ sink_C ← cursor reads linearly
         └─ subC ─── C1
```

**Design decision:** Support BOTH modes. Graph-subgraph for tightly coupled processing (resilientFetch — retry, timeout, circuit breaker react together). Cursor-reading for independent work streams at different speeds (eval-triage, parity-check, doc-research). Same data can feed both simultaneously.

---

## PART 3: THE UNIFIED LOOP — 7 STAGES

### Overview

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    ▼                                                         │
 INTAKE ──→ TRIAGE ──→ QUEUE ──→ GATE ──→ EXECUTE ──→ VERIFY │
                                                        │     │
                                                        ▼     │
                                                    REFLECT ──┘
```

Every stage is a channel. Each channel has: an input topic (data arrives), a processing node (transform), and an output topic (data leaves). Human gates sit between stages where approval is needed.

### Stage 1: INTAKE — Issues arrive from multiple sources

```typescript
interface IntakeItem {
  source: 'eval' | 'test' | 'human' | 'code-change' | 'hypothesis' | 'parity'
  summary: string
  evidence: string
  affectsAreas: string[]
  affectsEvalTasks?: string[]
  severity?: 'critical' | 'high' | 'medium' | 'low'
  relatedTo?: string[]
}
```

Sources: `fromEval`, `fromTest`, `fromHuman`, `fromCodeChange`, `fromHypothesis`, `fromParity`. All produce the same `IntakeItem` shape. The intake topic doesn't care where items came from.

### Stage 2: TRIAGE — Categorize, classify, route

A `promptNode` that reads intake items and produces categorized output:

- rootCause: composition | missing-fn | bad-docs | schema-gap | regression | unknown
- intervention: template | catalog-fn | docs | wrapper | schema-change | investigate
- route: auto-fix | needs-decision | needs-investigation | backlog
- priority: computed from severity × area-impact × cross-run-persistence

Triage reads the **strategy model** (Gap 3) — intervention effectiveness from past completions — to make better routing decisions.

Output fans to four sinks (topics): `auto-fix-queue`, `needs-decision-queue`, `investigation-queue`, `backlog-queue`.

### Stage 3: QUEUE — Priority-ordered reactive work queues

Each sink is a priority queue with **developer-configurable scoring**. The priority function is a derived node — wire in whatever signals matter:

```typescript
const priorityScore = derived(
  [issue, lastInteraction, urgencySignal, issueTypeBias, strategyModel],
  (iss, lastTouch, urgency, typeBias, strategy) => {
    const ageSec = (monotonicNs() - lastTouch.timestamp) / 1e9
    let score = severityWeight[iss.severity] * 40

    // Use existing decay() from src/patterns/memory.ts
    score = decay(score, ageSec, opts.decayRate ?? DEFAULT_DECAY_RATE, 0)

    // Boost from strategy model
    const effectiveness = strategy[`${iss.rootCause}→${iss.intervention}`]
    if (effectiveness?.successRate > 0.7) score += 15

    score += urgency.level * 20
    score += typeBias[iss.rootCause] ?? 0
    return score
  }
)
```

Queue re-sorts reactively when any input signal changes. Uses existing `decay()` function with configurable half-life (7-day default from OpenViking formula).

### Stage 4: GATE — Human approval (ported from callbag-recharge)

```typescript
interface GateController<T> {
  pending: Node<T[]>           // reactive peek — subscribe to see queue
  count: Node<number>          // derived: pending.length
  isOpen: Node<boolean>        // auto-approve mode?

  approve(n?: number): void    // forward next n (default 1)
  reject(n?: number): void     // discard next n (default 1)
  modify(                      // transform then forward — THIS IS steer()
    fn: (value: T, index: number, pending: readonly T[]) => T,
    n?: number,                // default 1
  ): void
  open(): void                 // flush all + auto-approve
  close(): void                // back to manual
}
```

**`modify()` signature matches Array.map:** `(value, index, pending) => T`. The full pending array is visible in the callback, enabling context-aware steering ("related items in queue, fix structurally").

**Where gates go:** Not every channel needs a gate. `auto-fix-queue` flows straight to EXECUTE. `needs-decision-queue` and `investigation-queue` are gated. `backlog-queue` is parked (cursor advances when human gets to it). Developer configures which channels are gated.

**Human interaction:** `gate.pending` is a reactive node. Any rendering layer subscribes: CLI effect, reactive-layout panel, MCP resource. The gate doesn't care how the human sees or interacts with it.

### Stage 5: EXECUTE — Implementation via promptNode or human

A `promptNode` that reads the approved issue (with human-enriched rootCause/intervention) and generates the implementation. Or the human implements directly and writes results into a state node. The graph doesn't care who does the work.

### Stage 6: VERIFY — Automated + human review

Two parallel paths:
- **Automated:** Run affected tests/eval tasks (not the full suite), check pass/fail
- **Human QA:** `promptNode` adversarial review + gate for human to approve QA findings

Outcomes: verified (issue closes, effectiveness recorded) | failed (new findings → INTAKE) | partial (some new issues, some deferred).

### Stage 7: REFLECT — The retrospective engine

Three derived/prompt nodes watching completed items:

1. **Strategy model:** `rootCause × intervention → successRate` over completed issues. Feeds back to TRIAGE.
2. **Hypothesis generator:** `promptNode` that predicts future failures from trends. Outputs → INTAKE as new `source: 'hypothesis'` items.
3. **Memory distillation:** Uses existing `distill()` + `agentMemory()` infrastructure (NOT a new promptNode — see §4). Compact lessons for next session context.

**Reflect closes the loop:** strategy model → TRIAGE (routing), hypotheses → INTAKE (early warnings), memories → session context.

---

## PART 4: EXISTING INFRASTRUCTURE AUDIT

### What already exists (no new code needed)

| Component | Location | Status |
|-----------|----------|--------|
| `TopicGraph` + `SubscriptionGraph` | `src/patterns/messaging.ts` | Built — cursor, ack, pull |
| `JobQueueGraph` | `src/patterns/messaging.ts` | Built — enqueue/claim/ack/nack |
| `bridge()` | `src/core/bridge.ts` | Built (8.2) — cross-graph wiring |
| `distill()` | `src/extra/composite.ts:162` | Built — budget-constrained reactive memory |
| `agentMemory()` | `src/patterns/ai.ts:912` | Built — distill + vectors + KG + tiers |
| `decay()` | `src/patterns/memory.ts:124` | Built — exponential decay, configurable rate |
| `llmExtractor()` | `src/patterns/ai.ts:543` | Built — LLM-based memory extraction |
| `llmConsolidator()` | `src/patterns/ai.ts:615` | Built — LLM-based memory merging |
| `reactiveLog` | `src/extra/reactive-log.ts` | Built — append-only, tail view |
| `reactiveMap` | `src/extra/reactive-map.ts` | Built — key-value with reactive node |

### distill() vs promptNode for memory

**Decision: Keep distill(), don't replace with promptNode.** `distill()` handles budget packing, eviction, consolidation triggers, and store management — none of which a raw promptNode provides. `promptNode` is the right thing to plug INTO distill as the `extractFn` and `consolidateFn` (which is what `llmExtractor()` and `llmConsolidator()` already do). The architecture is:

```
promptNode (LLM call) → plugs into → distill() (reactive plumbing)
                                          ↓
                                     agentMemory() (full factory)
```

For harness-specific concerns:
- Strategy model entries → permanent tier (auto-classify via tier function)
- Issue-aware eviction → wire verification status into `opts.evict` predicate (no code change, wiring pattern)
- Cross-session cursor position → state node + existing auto-checkpoint

### What needs to be built

| Component | Effort | Description |
|-----------|--------|-------------|
| Port `gate` from callbag-recharge | ~200 LOC | Human approval gate with pending, approve/reject/modify(fn,n) |
| `promptNode` factory | ~100 LOC | Wraps LLM call in derived node, retry, cache, structured output |
| Rename `gate` → `valve` | ~50 LOC | Rename in extra/operators.ts, patterns/orchestration.ts, tests |
| Eval→intake bridge | ~50 LOC | Effect parsing RunResult into IntakeItem[] |
| Strategy model | ~80 LOC | Derived: rootCause×intervention→successRate |
| `harnessLoop()` factory | ~300 LOC | Wires the static topology with configurable prompts/gates/priorities |
| **Total** | **~780 LOC** | Mostly composition of existing primitives |

---

## PART 5: GATE DESIGN (PORT FROM CALLBAG-RECHARGE)

### callbag-recharge gate API (source of port)

File: `~/src/callbag-recharge/src/orchestrate/gate.ts`

- `pending: Store<A[]>` — reactive queue, peekable via `.get()`
- `isOpen: Store<boolean>` — auto-approve mode toggle
- `approve(count?: number)` — default 1, forwards next n from queue
- `reject(count?: number)` — default 1, discards next n
- `modify(fn: (value: A) => A)` — **hardcoded to 1** in callbag-recharge
- `open()` — flush all pending + auto-approve future
- `close()` — re-enable manual gating
- `maxPending` option — FIFO drop oldest when exceeded
- `startOpen` option — begin in auto-approve mode

### GraphReFly port changes

1. **Message protocol adaptation** — callbag signals → GraphReFly DATA/RESOLVED/DIRTY
2. **`modify(fn, n?)` with Array.map signature:**
   ```typescript
   modify(
     fn: (value: T, index: number, pending: readonly T[]) => T,
     n?: number,  // default 1
   ): void
   ```
3. **`count: Node<number>`** — derived from pending length, for dashboard/badge use
4. **Integration with orchestration pattern** — register as orchestration step with graph metadata

### Boolean gate rename: `gate` → `valve`

Current `gate` in `src/extra/operators.ts:2545` and `src/patterns/orchestration.ts:179` is a boolean control gate (forwards data when control is truthy). This is flow control, not human approval.

Rename to `valve` — opens/closes flow based on an external boolean signal. Update all tests, exports, and references.

---

## PART 6: PROMPTNODE FACTORY DESIGN

```typescript
function promptNode<I, O>(
  graph: Graph,
  name: string,
  opts: {
    prompt: string | ((input: I) => string)  // static or dynamic
    deps: StepRef[]                           // any nodes as input
    model: LLMAdapter
    output?: 'json' | 'text'                 // default: json
    retries?: number                          // auto-retry on parse failure
    cache?: boolean                           // cache identical inputs
  }
): Node<O>
```

**This single factory handles:** triage, QA review, hypothesis generation, parity checking, implementation, and any future LLM-mediated step. The developer writes a prompt and wires deps. The factory handles LLM calling, retry, caching, and graph registration.

**Not used for distill** — distill has its own reactive plumbing. promptNode plugs into distill as the extractFn/consolidateFn via existing llmExtractor/llmConsolidator.

---

## PART 7: GENERALIZABILITY

The loop is not specific to one workflow. Any developer+LLM collaboration maps onto it:

| Stage | Solo dev + Claude | Team + agents | OSS project |
|-------|-------------------|---------------|-------------|
| INTAKE | /dev-dispatch, manual filing | PM tickets, CI findings | CI evals, community reports |
| TRIAGE | promptNode categorizes | Tech lead classifies | Maintainer labels |
| QUEUE | Severity + attention decay | + assignee load + sprint deadline | + community upvotes |
| GATE | You steer via modify() | Senior devs approve | Maintainer approves |
| EXECUTE | LLM implements | Agent implements | Contributor PRs |
| VERIFY | /qa + affected eval tasks | Code review + CI | CI + reviewer |
| REFLECT | Strategy model + distill | Retro meeting findings | Release retrospective |

**What differs per team:** which channels are gated, what priority signals, what promptNode prompts, how many parallel queues.

**What's the same:** the loop structure, the primitives (promptNode, gate, topic+subscription, bridge), the strategy model, the distillation.

---

## PART 8: DUAL COMPOSITION MODES

### When to use graph-subgraph (tight coupling)

Use when all branches need simultaneous reactive propagation in the same cycle:
- resilientFetch (retry, timeout, circuit breaker react together)
- Real-time monitoring (alert threshold depends on rate AND trend)

### When to use cursor-reading (降维 — dimensionality reduction)

Use when branches are independent work streams processed at different speeds:
- eval-triage reader (automatable, fast)
- needs-decision reader (human-gated, slow)
- parity-check reader (periodic, batch)

### Both modes coexist

Same data can feed both: publish to a topic AND wire into a subgraph simultaneously. The system doesn't force one mode. The developer picks per-branch based on coupling requirements.

---

## PART 9: ROADMAP PLACEMENT — §9.0

**Decision:** Build as §9.0 BEFORE §9.1b so we can dogfood the loop while running the 4-treatment eval experiment. The 9.1b eval results flow through the loop automatically, and the blog story becomes "we built a reactive collaboration harness, then used it to manage our own eval-driven development."

### §9.0 — Reactive Collaboration Loop [NEW]

**Week 1: Primitives**
- [ ] Rename `gate` → `valve` in `src/extra/operators.ts` + `src/patterns/orchestration.ts` + all tests/exports
- [ ] Port `gate` from callbag-recharge → `src/patterns/orchestration.ts` (human approval gate with pending, approve/reject/modify with Array.map-style `(value, index, pending) => T` signature)
- [ ] `promptNode` factory → `src/patterns/ai.ts` (wraps LLM call in derived node, retry, cache, structured output)

**Week 2: Wiring**
- [ ] Eval→intake bridge — effect parsing `RunResult` into `IntakeItem[]`, publishes to intake topic
- [ ] Strategy model — derived node: `rootCause×intervention → successRate` over completed issues
- [ ] Priority scoring with `decay()` — configurable priority function template using existing `decay()` + strategy model
- [ ] `harnessLoop()` factory — wires the static topology (intake → triage → queues → gates → execute → verify → reflect)

**Week 3: Dogfood on 9.1b**
- [ ] Wire 9.1b eval runs through the harness loop
- [ ] Human steering flows through `gate.modify()` with structured rootCause/intervention
- [ ] Strategy model accumulates what works across treatments A→D
- [ ] Retrospective distills into `agentMemory` for next session context

---

## PART 10: REACT AGENT PATTERN COMPARISON

### ReAct operates inside EXECUTE; the harness wraps ReAct

ReAct (Yao et al., 2022) is the inner loop: Thought→Action→Observation within a single task. The harness is the outer loop: intake→triage→queue→gate→execute→verify→reflect across tasks with persistent learning. They are complementary, not competing.

### Learnings from ReAct evolution

**Reflexion (Shinn et al., 2023):** Self-reflection after failure → verbal critique → episodic memory → retry with critique. Our REFLECT stage is stronger (tracks meta-patterns: rootCause×intervention→successRate across many tasks, not just per-task critiques). But Reflexion has an immediate fast-retry path we're missing. **Added: fast-retry edge from VERIFY→EXECUTE for self-correctable errors (config, parse failures), skipping full INTAKE→TRIAGE→QUEUE→GATE cycle.**

**LATS (Zhou et al., 2023):** Tree search over multiple ReAct trajectories with MCTS. Our cursor-reading model naturally supports this: EXECUTE produces N candidates, VERIFY selects best. Priority queue + scorer handle selection. Not for MVP, but architecture supports it.

**ReWOO (Xu et al., 2023):** Plan-then-execute (separate planning from action). Our TRIAGE→QUEUE→GATE flow already is plan-then-execute, with the added benefit that humans can review the plan before execution starts.

**CoALA (Sumers et al., 2023):** Cognitive architecture framework (working/episodic/semantic/procedural memory + action space + decision procedure). Our harness maps directly: gate.pending = working memory, strategy model = episodic, agentMemory = semantic, graph topology = procedural, promptNode = action space, TRIAGE+QUEUE+GATE = decision procedure. The difference: CoALA is conceptual; our harness is concrete, reactive, and inspectable.

**Practical consensus (2025-2026):** "The agent is only as good as its tools." Our eval runs 1-4 validated this: catalog (tool interface) quality was the #1 lever. The catalog IS the tool interface in agent vocabulary.

### Vocabulary mapping (for positioning and blog)

| Our term | Agent/ReAct vocabulary |
|---|---|
| INTAKE | Environment / Observation ingestion |
| TRIAGE (promptNode) | Planning / Task decomposition |
| QUEUE (with decay) | Working memory management |
| GATE (modify) | Human-in-the-loop / Steering |
| EXECUTE (promptNode) | ReAct inner loop |
| VERIFY | Evaluation / Self-assessment |
| REFLECT (strategy model) | Meta-learning / Reflexion |
| distill → memory | Episodic → Semantic memory promotion |
| Static topology | Procedural memory |
| Fast-retry path | Reflexion self-correction |

---

## PART 11: TOOL CALL INTERCEPTION (POST-MVP)

### Current state

`agentLoop` (`src/patterns/ai.ts:1440+`) already runs a ReAct inner loop with tool call execution. `knobsAsTools()` auto-generates OpenAI + MCP tool schemas from graph knobs. `fromMCP` connector is shipped. §9.3 plans a full MCP Server package.

### The interception opportunity

Currently tool calls execute blindly inside `agentLoop`. The harness could intercept them reactively:

```
LLM generates tool_call
    → tool-call topic (intake)
    → valve (is this tool allowed right now?)
    → budgetGate (token/cost budget check)
    → policyEnforcer (ABAC guard — does this actor have permission?)
    → gate (human approval for destructive tools — e.g. file delete, DB write)
    → auditTrail (log the call + actor + timestamp)
    → execute tool
    → observe result
    → auditTrail (log the result)
    → feed back to agentLoop
```

This composes existing/planned primitives: `valve` (§9.0), `budgetGate` (8.1), `policyEnforcer` (§9.2), `gate` (§9.0), `auditTrail` (§9.2). No new primitives needed — just wiring.

### Why post-MVP

- `agentLoop` already works for the EXECUTE stage
- The interception value depends on §9.2 (audit, policy) which is Wave 2
- The MVP harness loop manages *across* tasks; tool interception is *within* a task
- Can be added incrementally: first audit-only (passive logging), then gating (active control)

### Design note for later

The `agentLoop` tool execution path (`response.toolCalls → execute → appendToolResult`) should be refactored to emit tool calls as messages into a configurable subgraph rather than executing inline. This makes the interception point a topology choice, not a code change. The subgraph defaults to "execute immediately" (current behavior) but can be swapped for the full interception chain.

---

## KEY INSIGHTS

1. **Static topology + flowing data beats dynamic graph spawning.** The Kafka insight: producers and consumers at different speeds, connected by a log. No runtime topology changes needed.

2. **`gate.modify()` IS the structured human judgment input.** No separate `steer()` API — the gate itself is where humans enrich data with classification before forwarding.

3. **Cursor reading is dimensionality reduction (降维).** Converts exponential graph branching into linear sequence consumption. Any complex subgraph becomes a sink + cursor reader.

4. **Existing infrastructure covers ~70% of the loop.** TopicGraph, SubscriptionGraph, distill, agentMemory, decay, bridge, reactiveLog, reactiveMap — all built. New work is gate port, promptNode, and wiring.

5. **The strategy model is the genuine differentiator.** Nobody else tracks "which intervention types work for which failure types" reactively. This makes human steering compound over time instead of being one-off.

6. **distill() is better than promptNode for memory.** promptNode plugs INTO distill as extractFn/consolidateFn. Don't rebuild the reactive plumbing.

7. **Support both graph-subgraph and cursor-reading.** Tight coupling needs subgraphs. Independent streams need cursor readers. Same data can feed both.

8. **Build before 9.1b to dogfood.** The harness loop manages the eval experiment. The eval experiment validates the harness loop. Circular proof by construction.

9. **ReAct is the inner loop; the harness is the outer loop.** ReAct (Thought→Action→Observation) runs inside EXECUTE. The harness wraps it with planning (TRIAGE), human steering (GATE), persistent learning (REFLECT), and meta-strategy (strategy model). Complementary, not competing.

10. **Fast-retry path from Reflexion.** Self-correctable errors (config, parse) should short-circuit VERIFY→EXECUTE directly, skipping the full loop. Structural errors (wrong composition, missing nodes) go full INTAKE→TRIAGE cycle.

---

## REJECTED ALTERNATIVES

### Dynamic graph spawning for each triage item
- **Why rejected:** Requires `graph.instantiate()` (unbuilt), cross-graph lifecycle (hard), dynamic topology changes mid-propagation (very hard). Static topology + flowing data achieves the same outcome with existing primitives.

### Separate `steer()` API alongside gate
- **Why rejected:** `gate.modify()` already provides structured human input. Adding a parallel API creates two paths for the same action. The gate IS the steering point.

### promptNode replacing distill() for memory
- **Why rejected:** distill() handles budget packing, eviction, consolidation, store management. promptNode would have to reimplement all of that. promptNode plugs into distill as extractFn/consolidateFn instead.

### Building the loop after 9.1b
- **Why rejected:** Misses the dogfooding opportunity. The loop manages 9.1b work; 9.1b validates the loop. Building after means doing 9.1b the old way (manual session logs) and never getting the feedback cycle.

---

## FILES

- This file: `archive/docs/SESSION-reactive-collaboration-harness.md`
- Referenced: `archive/docs/SESSION-reactive-issue-tracker-design.md`, `archive/docs/SESSION-harness-engineering-strategy.md`, `evals/results/session-2026-04-06-catalog-automation.md`, `archive/docs/SKETCH-reactive-tracker-factory.md`
- To update: `docs/roadmap.md` (add §9.0), `archive/docs/DESIGN-ARCHIVE-INDEX.md` (index entry)
