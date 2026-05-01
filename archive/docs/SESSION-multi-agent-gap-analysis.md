# Session — Multi-Agent Gap Analysis

**Date:** 2026-04-28
**Trigger:** User asked for industry research on multi-agent orchestration + communication, focused on Claude-Code-style coordinator/primary-subagent modes spontaneously triggered by human or LLM. Three concrete hypotheses to evaluate: (1) hub mode as dimensional degradation from dynamic to static topology; (2) multi-agent ≠ N × `promptNode`; (3) hub-as-preset-registry vs fixed 1:1 character:preset wiring. Industry research surfaced 12 pain points; this session maps the 10-unit gap slate and walks G1–G4 as a linked design block. Hand-off target: implementation session, in tandem with `SESSION-human-llm-intervention-primitives.md` (shared substrate decisions).

**Precedent sessions:**
- `SESSION-reactive-collaboration-harness.md` (7-stage loop, valve, gate)
- `SESSION-patterns-extras-consolidation-plan.md` (preset/building-block separation, naming rules, gate-family disambiguation)
- `SESSION-harness-engineering-strategy.md` (positioning vs LangGraph, AG-UI, MCP)
- `SESSION-ai-harness-module-review.md` (per-unit 9Q format precedent; current state of `ai/` and `harness/`)
- `SESSION-human-llm-intervention-primitives.md` (sibling-preset architecture, schema-carrying envelope, adapter-abort gap) — **shared substrate; this session inherits its reframes**
- `SESSION-mid-level-harness-blocks.md` (graphLens / resilientPipeline / guardedExecution shipped as the 6-block face)
- `SESSION-graph-module-24-unit-review.md` (9Q format origin)

---

## Core Principle: Agent abstraction layer over existing substrate

The five multi-agent patterns industry has converged on (generator-verifier, orchestrator-subagent, agent teams, message bus, shared state) all wire over primitives our reactive substrate already ships. The gap is the **agent abstraction layer** above them: a typed inbox/outbox bundle (`AgentBundle<TIn, TOut>`), a preset/persona/skill registry over `reactiveMap`, a spawn recipe over `MessagingHubGraph` + the standard `Message<T>` envelope, and three observability/control sub-recipes (criteria-grid verifier, cost-bubble, convergence detector). **No new substrate primitive is needed**, per locked decision.

```
                ┌─────────────────────────────────────────┐
                │ Substrate (shipped + intervention-session) │
                │   hub + Message envelope (with schema)  │
                │   valve + adapter-abort                 │
                │   AgentMemoryGraph (post-Wave-AM)       │
                │   promptNode/agentLoop/toolRegistry     │
                └────────────────┬────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────────┐
              │                  │                      │
       AgentBundle<TIn,TOut>  presetRegistry+      spawnable() preset
       (block, G1)            selector+materialize  (harness preset, G3)
                              (composition, G2)
              │                  │                      │
              └──────────┬───────┴──────────────────────┘
                         │
              Multi-agent compositions (harness presets):
              coordinatorTeam(), pipelineOfAgents(), …
```

**Boundary test for "is this a primitive or a composition?":** if it can be implemented by composing existing operators (`derived`, `switchMap`, `valve`, `bufferWhen`, `topic`, `state`, `reactiveMap`) over the substrate, it's a composition. Only `hub`+envelope and `valve`+adapter-abort are true primitives (per intervention session). Same boundary applies here — `agent()`, `presetRegistry()`, `spawnable()` all compose existing primitives.

---

## 1. Industry Research Summary

### Five patterns industry converged on (Anthropic 2026-04 taxonomy)

| Pattern | Mechanic | Maps to our substrate |
|---|---|---|
| Generator-verifier | Two roles, eval-feedback loop with explicit criteria + max iterations | `harnessLoop` body; verifier slot in G1 |
| Orchestrator-subagent | Hub plans, delegates bounded one-shots, synthesizes; subagent terminates after one return | G3 `spawnable()` + G4 hub-mounted child subgraph |
| Agent teams | Coordinator spawns long-lived workers pulling from shared queue; workers accumulate context | N × `agent()` instances on shared queue topic |
| Message bus | Pub/sub topics, router-mediated, growing agent ecosystem | `MessagingHubGraph` (shipped); router = `derived` selector |
| Shared state | No central coordinator; agents read/write a blackboard, terminate on convergence | Graph + cache as blackboard; G9 convergence detector for termination |

**Hybridization is the norm.** Anthropic explicitly recommends starting orchestrator-subagent and evolving. Our 6-block face must support gradual evolution — single orchestrator-subagent should grow into message-bus without rewrites.

### Twelve pain points industry hits (with substrate mapping)

| # | Pain | Our substrate covers via |
|---|---|---|
| 1 | Orchestrator information bottleneck | Shared `AgentMemoryGraph` between agents (§29 context transfer); G6 `explain()` cross-graph drill |
| 2 | Reactive loops in shared state, no termination | G9 convergence detector; `expiresAt` envelope; budget gate |
| 3 | Routing failures silent (LLM router misclassifies) | `stratify` operator + dev-mode "no-route" warning; pair with G7 criteria grid for routing audit |
| 4 | Handoff context loss | Same `AgentMemoryGraph` instance OR explicit memory partition (§29) |
| 5 | Concurrent-write conflicts in agent teams | `lightMutation` + audit; explicit task partitioning |
| 6 | Long-running coordinator amnesia | `agentMemory` with decay/tiers; reactive checkpointing via `Graph.attachStorage` |
| 7 | Verifier rubber-stamping (single "is this good?") | **G7: criteria-grid via `humanInput<{axes}>` or structured `promptNode` (recipe, not factory)** |
| 8 | Cost explosion hard to control by harness engineering | **G8: `budgetGate` upstream of every spawn + adapter-abort gap closed** (without abort hookup, only propagation stops, not in-flight token burn) |
| 9 | Subagents-inside-subagents recursion ("3-day cooked") | G5: depth guard via `valve(open: derived([depth], n => n < cap))` |
| 10 | Persona/skill catalog drift, hardcoded persona-per-agent | G2: preset registry (industry direction — Anthropic Skills, SKILL.md, dynamic system prompt research) |
| 11 | Cross-agent debugging — traces span sessions | G6: `describe()`/`explain()` drilling into mounted slot |
| 12 | Single point of failure (coordinator/router crash) | Shared-state pattern via `agentMemory` blackboard removes coordinator dependence |

**Pain points 7 and 8 (user-flagged):** §1 row 7 and §1 row 8 above. G7 collapses from new factory to documented recipe; G8 surfaces the adapter-abort gap as a hard prerequisite shared with `SESSION-human-llm-intervention-primitives.md` Real Gap #1.

---

## 2. Per-Unit Review Format (gap-analysis variant)

Each gap unit answers nine questions. Q1 reframed for gap-analysis (vs primitive audit). Q7 folds topology check + perf/memory.

| Q | Adapted (gap analysis) |
|---|---|
| 1 | **Gap statement** — user need unmet today; minimum closing shape; existing primitives in the area |
| 2 | Semantically correct? Edge cases the closing must handle. Does it solve the named pain or rename it? |
| 3 | Design-invariant violations? (COMPOSITION-GUIDE §1–§32 + spec §5.8–5.12). Flag 🔴 / 🟡 / 🟢 |
| 4 | Open items — link to roadmap/optimizations entries |
| 5 | Right abstraction? More generic possible? Is this a building block, a preset, or both? |
| 6 | Right long-term? Caveats / maintenance burden / competitor-API churn risk |
| 7 | Simplify / reactive / composable + topology check + perf/memory |
| 8 | Alternative implementations (A/B/C…) with pros/cons |
| 9 | Recommendation + coverage table for Q2–Q6 |

Lock-block at end of each unit: `Decisions locked YYYY-MM-DD`.

---

## 3. Unit Slate

| # | Gap unit | Status | Cross-cut |
|---|---|---|---|
| **G1** | Agent primitive (`AgentBundle` interface + `agent()` preset) | LOCKED B (§5) | Underpins G2/G3/G4 |
| **G2** | Preset / persona / skill registry | LOCKED C (§6) | Feeds G1, G3, G10 |
| **G3** | Spawn surface (`spawnable()` harness preset) | LOCKED B (§7) | Builds on §29 handoff |
| **G4** | Hub as dimensional-degradation boundary (agent-agnostic) | LOCKED A (§8) | Differentiator vs LangGraph imperative supervisor |
| **G5** | Spawn termination contract + depth guard | REFRAMED (§9.1) | `valve` + adapter abort + `expiresAt`; **NOT `gate`** per intervention session |
| **G6** | Cross-agent inspect drilling | OPEN (§9.2) | Topology-check criterion at multi-agent layer |
| **G7** | Criteria-grid verifier | DOWNGRADED to recipe (§9.3) | `humanInput<{axes}>` or structured `promptNode` over schema; not a new factory |
| **G8** | Cost-bubble contract | HARDENED (§9.4) | `budgetGate` (have) + adapter-abort hookup (gap, shared with intervention session) |
| **G9** | Convergence detector | OPEN (§9.5) | "no new DATA in N waves" → COMPLETE; pure operator |
| **G10** | Atomic registry hot-swap | DEFERRED (§10) | Ties to `project_rewire_gap`; gate G2 API to keep future open |

### Cross-cut diagram

```
G1 (agent primitive)
   ↑           ↘
G2 (registry)   G5 (termination — valve+abort+expiresAt)
   ↑              ↘
G3 (spawn surface) ─→ G4 (hub-as-boundary) ─→ G6 (inspect drilling)
                                              ↘
                                           G7 (criteria grid recipe)
                                           G8 (cost bubble — needs adapter abort)
                                           G9 (convergence detector)

G10 (hot-swap) — depends on G2's API; DEFERRED
```

G1+G2+G3+G4 walked as one linked block this session. G5/G7/G8 reframed against intervention session. G6/G9 unwalked. G10 parked.

---

## 4. Eventual Vision Frame (multi-agent layer)

Ring 1 — Substrate (shipped): hub + envelope (intervention §4 adds `schema`); valve + adapter-abort (gap); AgentMemoryGraph (post-Wave-AM); promptNode/agentLoop/toolRegistry; reduction layer (`budgetGate`, `funnel`, `feedback`, `scorer`); reactive map.

Ring 2 — Agent abstraction (this session's scope): `AgentBundle<TIn, TOut>` interface + `agent()` preset (G1); `presetRegistry` + generalized `selector` / `materialize` (G2); `spawnable()` harness preset (G3); hub agent-slot convention (G4); criteria-grid recipe (G7); cost-bubble recipe (G8 + adapter abort).

Ring 3 — Multi-agent compositions (post-implementation): `coordinatorTeam()`, `pipelineOfAgents()`, `swarmAgents()` as harness presets in `patterns/harness/presets.ts`. None are new primitives.

**Lock-in vectors stay aligned with `SESSION-harness-engineering-strategy.md`:**
- Memory (reactive + decay + consolidation per agent) ← agentMemory
- Topology (the agent slate as organizational knowledge) ← G1–G4
- Explainability (causal chain across agents as compliance artifact) ← G6

**Strategic differentiator:** static-face / dynamic-interior. From outside the hub, `describe()` shows declared agent slots as stable nodes. Inside, the active subgraph backing each slot can swap reactively. LangGraph's supervisor pattern is imperative-functional (returns next-agent name) — its static graph either omits dynamic agents or breaks visualization. We get both.

---

## 5. Current State

### Shipped that is load-bearing

| Surface | Coverage |
|---|---|
| `MessagingHubGraph` | Lazy topic registry; topics mounted as child subgraphs; `removeTopic` does TEARDOWN; version counter on create/remove |
| `agentLoop` + `interceptToolCalls` + `ToolRegistryGraph` (reactive-only) | Single-agent multi-turn; per-call AbortController via producer; signal-aware tool handlers |
| `handoff` + `toolSelector` (D8) + COMPOSITION-GUIDE §29–§32 | Two handoff modes; reactive tool narrowing; state-mirror pattern documented |
| `harnessLoop` (7-stage) + `refineLoop` v1 | INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT; 4-topic refine inner-loop hub-rooted (Unit 23) |
| `gate`, `valve`, `gatedStream`, `contentGate`, `policyGate`, `budgetGate` | Boolean / numeric / human / safety / cost gates, all reactive |
| `agentMemory` (Wave AM rebuild in flight — closes 2026-04-26 sequence) | Substrate: collection + vector + KG + decay + tiers |
| `Graph.attachStorage` + codec envelope v1 | Multi-tier checkpointing; `messageTier ≥ 3` auto-checkpoint trigger |
| `reactiveMap`, `reactiveList`, `reactiveLog`, `reactiveIndex` | G2's substrate; preset registry is `reactiveMap<PresetId, Preset>` |

### In-flight that gates this work

- **Wave AM** (`patterns/ai/memory/` 6-unit pass) — closes the `class AgentMemoryGraph extends Graph` rebuild. **Hard prereq for G1's memory slot.** Sequencing AM.0 → AM.1 → AM.2 → AM.3, ~8–9 days focused.
- **DF12** — `promptNode.tools` reactive widening from `readonly ToolDefinition[]` to `... | Node<readonly ToolDefinition[]>`. **Hard prereq for G1's tools slot.** Already in `optimizations.md`, Tier 7 follow-up.
- **Adapter abort hookup** — closing valve / `switchMap` cancellation does not propagate to in-flight LLM HTTP call. **Hard prereq for G5/G8 to be honest.** Surfaced in `SESSION-human-llm-intervention-primitives.md` Real Gap #1; same gap.
- **Patterns-extras consolidation** (`SESSION-patterns-extras-consolidation-plan.md`) — folder structure for `patterns/ai/agents/`, `patterns/harness/presets.ts`, `extra/composition/`. Not blocking, but aligns landing locations.

### Drift suspicions to validate during implementation

- **`gateGraph.mount` vs hub queue topics** — Unit 17 B's intended shape `gateGraph.mount(\`queue/\${route}\`, topic)` fell back to `gateGraph.add(hub.topic(route).latest, ...)` because a topic can't be mounted in two parents. Re-introduces wrapper-node shape. Same pattern may bite G3's spawn topic — design decision: either (a) `gate()` accepts foreign nodes, or (b) the spawn admission gate lives inside the hub, or (c) cross-graph path resolution. Pick during G3 implementation.
- **G6 cross-graph `explain()`** — current `explain()` walks one Graph's edges. Cross-Graph drill (parent hub → mounted subgraph → return) is unverified. May surface a missing operator.

---

## 6. Decisions Log

### Block-level locks (G1–G4) — 2026-04-28

- **2026-04-28 | G1 | Alternative B (interface + preset) locked.** `AgentBundle<TIn, TOut>` exported as the building-block contract from `patterns/ai/agents/agent.ts`. `agent(spec)` factory in `patterns/ai/agents/presets.ts` returns a bundle. `class AgentGraph<TIn, TOut> extends Graph` mirrors Wave AM AM.3 precedent.
- **2026-04-28 | G2 | Alternative C (generalize) locked.** `selector` and `materialize` extracted as composers in `extra/composition/`. `presetRegistry()` becomes a thin sugar in `patterns/ai/agents/presets.ts`. Strategy-model integration: harnessLoop's strategy node plugs directly into the `selector` slot — no new strategy infrastructure.
- **2026-04-28 | G3 | Alternative B (`spawnable()` harness preset) locked.** Lives in `patterns/harness/presets.ts`. Wraps `MessagingHubGraph` + presetRegistry + materialize + depth guard + termination contract. Returns the spawn topic. User emits to it.
- **2026-04-28 | G4 | Alternative A locked (with B as 2-line sugar inside `spawnable()`).** Hub stays agent-agnostic — child-subgraph mount via existing `MessagingHubGraph` API. Agent-ness lives in meta tags. `hub.mountAgent(slot, bundle)` is sugar wrapping `Graph.add` + meta stamp; not a new hub method, lives inside `spawnable()`.

### Cross-cut locks — 2026-04-28

1. **`agent.run()` imperative sugar — REFUSED.** Caller-side: `bundle.in.emit(input)` + `awaitSettled(bundle.out)`. Legacy `agentLoop.run()` lives until 1.0; deprecation TBD post-launch.
2. **`agent()` is NOT a 7th headline block.** Stays one layer below the 6 (`agentMemory · harnessLoop · guardedExecution · resilientPipeline · graphLens · Graph.attachStorage`). Like `harnessLoop` composes lower primitives, `agent()` composes `agentMemory` + `agentLoop` + verifier + budget.
3. **`AgentBundle<TIn, TOut>` interface as building block** (same as G1 lock).
4. **Generalize `selector` / `materialize`** to `extra/composition/` (same as G2 lock).
5. **`spawnable()` lives in `patterns/harness/presets.ts`** (same as G3 lock).
6. **Hub stays agent-agnostic; agent-ness via meta tags** (same as G4 lock).
7. **DF12 promotion gates G1 land.** No half-feature ship — `agent()` requires reactive tool list to support agent-as-tool-of-agent and runtime tool narrowing.

### Reframes from `SESSION-human-llm-intervention-primitives.md` — 2026-04-28

- **G5 reframed**: termination contract centers on `valve` + adapter abort + `expiresAt` envelope, **not `gate`**. `gate` is design-time veto (returns `GateController`); `valve` is runtime cut on propagation. For "kill in-flight agent now," `valve` is the answer.
- **G7 downgraded** from new factory to documented recipe in COMPOSITION-GUIDE. Per intervention session §4 rule: "approve-with-edits is not a specialized factory — it's a schema convention." Same applies. Human verifier: `humanInput<{ axes: { id, pass: boolean, evidence: string }[] }>` with schema. LLM verifier: structured-output `promptNode` over same schema. Aggregate via `derived(.every(a => a.pass))` feeding `approvalGate`.
- **G8 hardened**: `budgetGate` (shipped) is observability + propagation cut. **Honest cost control requires the adapter-abort gap closed** (intervention session Real Gap #1). Without it, in-flight token burn continues after gate trips. Multi-agent amplifies: N agents × M cost-burning calls. Adapter-abort is shared blocker.
- **G3 envelope tightens**: spawn requests use the standard `Message<T>` envelope from intervention session §4–§5. Adds `schema?: JsonSchema`, `expiresAt?: string`, `correlationId?: string`. Proposed new well-known topic `spawns` alongside intervention's `prompts`/`responses`/`injections`/`deferred` — needs cross-session alignment with the implementation of intervention's standard topic naming (intervention §6 #4).
- **Cascading sub-agent cancellation** is free in our reactive substrate (intervention §3i): subscription cleanup propagates through subgraphs. Combined with adapter abort, parent-`valve`-closes also cancels in-flight sub-agent LLM calls. No additional G5 work.

---

## 7. G1 — Agent primitive (full 9Q)

### Q1. Gap statement

We have parts (`agentLoop`, `handoff`, `toolSelector`, `interceptToolCalls`, `ToolRegistryGraph`, `agentMemory`); no named, composed *agent* — a typed inbox/outbox subgraph other parts of a multi-agent system wire to. Industry mindshare ("agents-as-tools," Anthropic Skills, Google ADK) is converging on agent-as-first-class-object.

Sketch:
```ts
type AgentSpec<TIn, TOut> = {
  name: string;
  systemPrompt: string | NodeInput<string>;
  model: AdapterRef | NodeInput<AdapterRef>;
  tools?: NodeInput<readonly ToolDefinition[]>;       // gated on DF12
  memory?: AgentMemoryGraph<unknown>;
  verifier?: VerifierSpec<TOut>;                       // → G7 recipe; can be Node<VerifierResult>
  budget?: NodeInput<readonly BudgetConstraint[]>;     // → G8 + adapter abort
  maxIterations?: number;                              // hard requirement (Q2-c)
  meta?: Record<string, unknown>;                      // escape hatch
};
type AgentBundle<TIn, TOut> = {
  in: NodeInput<TIn>;        // typed inbox
  out: Node<TOut>;           // typed outbox
  status: Node<"idle"|"running"|"verifying"|"done"|"error">;
  cost: Node<CostState>;     // for G8 bubble
  graph: AgentGraph<TIn, TOut>;  // class extends Graph
};
agent<TIn, TOut>(parent: Graph, spec: AgentSpec<TIn, TOut>): AgentBundle<TIn, TOut>
```

### Q2. Semantically correct?

Edge cases the closing must handle:
- a. **Handoff to another agent** — `bundle.out → topicBridge → otherAgent.in`. §29 says context transfer = shared `AgentMemoryGraph` between agents. Private-memory handoff needs explicit memory-instance partitioning (Q6-c).
- b. **Status reset across re-invocations** — §32 state-mirror must wire `status` and `cost`. Internal to preset; not user-visible.
- c. **Verifier reject loop** — `maxIterations` is a hard requirement, not optional. Anthropic's "stalls" failure mode.
- d. **DF12 widening** — agent-as-tool-of-agent with reactive tool list is impossible until `promptNode.tools` accepts `Node<readonly ToolDefinition[]>`. Hard prereq.

Solves: "wiring divergence" pain (industry pain point, not numbered above).
Inherits but does not solve alone: orchestrator-bottleneck (G3+G2 + memory partitioning); rubber-stamp verifier (G7 recipe).

### Q3. Design-invariant violations?

🟢 §1, §3, §4, §5, §29, §31, §32 — all clean if wired correctly.
🟡→🟢 §2 (no imperative): `agent.run()` REFUSED (cross-cut #1 lock). Caller-side `bundle.in.emit + awaitSettled(bundle.out)` is the escape hatch. agentLoop's existing `run()` is legacy; documented in JSDoc as deprecated post-1.0.

### Q4. Open items

- Hard prereq: DF12 (in `optimizations.md`, Tier 7).
- Hard prereq: Wave AM completion (in flight, AM.0–AM.3 sequencing).
- New surfaced (this session): G7 recipe doc; G8 adapter-abort hookup (shared with intervention session); G5 depth-guard pattern doc.
- Roadmap: `agent()` lands as a Phase 4+ patterns-layer addition, NOT a 7th headline block (cross-cut #2 lock). Update `~/src/graphrefly_github/profile/README.md` 6-block face: agent() referenced as composer, not headline.

### Q5. Right abstraction? More generic possible?

Building-block-vs-preset split locked (cross-cut #3): `AgentBundle<TIn, TOut>` interface = building block (the *contract* is the abstraction); `agent(spec)` factory = preset (the *helper* is sugar). User-built agents that compose primitives manually still satisfy the contract.

More generic: agent ≅ "subgraph with typed I/O + lifecycle + cost + status." Too generic; agents have specific verifier/memory/tools slots. Stay at agent level. **Don't generalize to `subgraphInterface<TIn, TOut>`** — not enough callers.

### Q6. Right long-term? Caveats / maintenance burden

- a. **Spec creep.** `meta` escape hatch for non-core fields; doc explicitly. Required-field set frozen at: `name`, `systemPrompt`, `model`. Everything else optional.
- b. **API churn pressure** from LangGraph/AutoGen rev'ing. Mitigation: stabilize `AgentBundle` contract; let `AgentSpec` evolve.
- c. **Memory partition default.** Default = **private memory per agent** (each `agent()` call creates its own `AgentMemoryGraph` if none passed). Explicit shared instance for §29 handoff. Document in JSDoc + COMPOSITION-GUIDE §29 update.
- d. **Strategy-model key shape.** harnessLoop strategy = `rootCause × intervention → successRate`. With agents, "intervention" extends to `(presetId × rootCause) → successRate`. Plan key shape now or churn later. **Decision: extend strategy key in this implementation wave.**

### Q7. Topology check + perf/memory

Topology check (mental, not run): minimal `intake → triage promptNode → derived split (route) → agent("codefix") → bundle.out → verifier → output`. Each agent appears as one box in parent `describe()` per `extends Graph` precedent (Wave AM AM.3, refineLoop Unit 23). Drilling shows internal subgraph — **G6 cross-graph drill must work**; without G6, agent is a black box and explainability lock-in vector regresses.

Perf: N agents = N subgraphs. Each retains memory subgraph. Default `retention` cap on memory tiers prevents unbounded growth. Per-call AbortController exists in agentLoop (signal-aware). `class AgentGraph extends Graph` enables instanceof narrowing; constructor-time invariants assertable.

### Q8. Alternatives

- **A. Pure preset, no contract.** `agent()` returns whatever shape; no exported interface. Pro: minimal surface. Con: handoff types are `Node<unknown>`; every preset reinvents bundle shape. **Rejected.**
- **B. Interface + preset.** `AgentBundle<TIn, TOut>` interface + `agent(spec)` preset. Pro: typed handoff, user-built agents satisfy contract. Con: 1 extra exported type. **LOCKED.**
- **C. Class hierarchy.** `abstract class AgentGraph` + concrete subclasses. Pro: instanceof discoverable. Con: rigid; doesn't compose; conflicts with bundle pattern (Wave AM is class+bundle, not OO subclassing). **Rejected.**

### Q9. Recommendation + coverage

**B (interface + preset).** Coverage:

| Concern | Addressed by |
|---|---|
| Q2-a typed handoff | `AgentBundle<TIn, TOut>` interface |
| Q2-b status reset | §32 mirror internal to preset |
| Q2-c verifier loop | `maxIterations` required field |
| Q2-d tools reactive | gated on DF12 (cross-cut #7 lock) |
| Q3 §2 imperative | run() refused; awaitSettled escape hatch |
| Q5 abstraction | interface = block, factory = preset |
| Q6-c memory leak | default private partition; explicit shared instance for handoff |
| Q6-d strategy key | extend `(presetId × rootCause) → successRate` in this wave |

**Decisions locked 2026-04-28.** Implementation gated on: DF12, Wave AM completion, adapter-abort hookup. None of these are blockers for the *type definitions* — `AgentBundle` interface can land first; `agent()` preset implementation lands when prereqs do.

---

## 8. G2 — Preset / persona / skill registry

### Q1. Gap statement

`MessagingHubGraph` (topic registry, lazy mount) and `ToolRegistryGraph` (tool registry, reactive) exist. Missing: a **preset registry** — `Map<presetId, Preset>` where `Preset = { systemPrompt, persona, skills[], tools[], model, agentSpec? }`. Plus reactive **selector** (`(request, registry) → presetId`) and **materializer** (`(presetId, registry, factoryMap) → mounted subgraph`).

Sketch:
```ts
// In extra/composition/ (generalized)
selector<TIn, TKey>(input: Node<TIn>, fn: (input: TIn) => TKey): Node<TKey>
materialize<TKey, TGraph extends Graph>(
  key: Node<TKey>,
  factories: Map<TKey, GraphFactory<TGraph>>,
  parent: Graph,
): Node<TGraph>

// In patterns/ai/agents/presets.ts (sugar)
presetRegistry<TPreset>(initial?: ReadonlyMap<string, TPreset>): {
  registry: ReactiveMapBundle<string, TPreset>;
  put(id: string, preset: TPreset): void;  // reactive write
  remove(id: string): void;
}
```

### Q5. Right abstraction?

`reactiveMap<K, V>` is the substrate (shipped). `presetRegistry` = `reactiveMap<PresetId, Preset>` + selector + materializer. The registry itself is *not* a new primitive. The generalization candidates are `selector` and `materialize` — both useful beyond agents (dynamic stage choice in pipelineGraph, dynamic adapter routing, dynamic strategy in refineLoop). Locked: extract to `extra/composition/`.

### Q8. Alternatives

- **A. Convention-only.** Document recipe in COMPOSITION-GUIDE; user composes `reactiveMap` + `derived` selector + `derived` materialize. No new exports. Pro: minimal. Con: discovery; every caller reinvents.
- **B. Single `presetRegistry` factory.** New preset in `patterns/ai/agents/presets.ts` returning `{registry, selector, materialize}` bundle. Pro: discoverable. Con: hides reusability.
- **C. Generalize.** `selector` + `materialize` as composers in `extra/composition/`; `presetRegistry` is thin sugar. **LOCKED.**

### Q9. Recommendation

**C.** Coverage: `selector` reused for harnessLoop strategy routing (existing), pipelineGraph dynamic stage selection (potential), agent preset selection (this work). `materialize` reused for hub-mounted subgraph (G4), refineLoop strategy swap (potential). **Strategy-model integration:** harnessLoop's strategy node IS a `selector` instance — the strategy node plugs directly into `selector(input, strategyFn)`. No new strategy infrastructure.

**Decisions locked 2026-04-28.** Implementation note: `materialize` interacts with G10 hot-swap. Design the `factories` arg to be a `Node<Map<...>>` (reactive) so registry mutations re-mount slots — but defer hot-swap *correctness* (unsubscribe + resubscribe atomic) to G10. Today: reactive read of factories map; mutation behavior is "current sessions complete on old factory; new sessions use new factory."

---

## 9. G3 — Spawn surface

### Q1. Gap statement

§29 handles two static handoff modes (full handoff via topic fan-out, agent-as-tool via tool registry). Missing: **reactive spawn primitive** that handles "human or LLM spontaneously decides to spawn agent X" — same surface for both triggers. Per invariant §2 (no imperative), trigger = `NodeInput<SpawnRequest>` write into a hub topic, regardless of authoring source.

Sketch:
```ts
// Standard envelope from intervention session §4
type SpawnRequest = Message<{
  presetId: string;
  taskInput: unknown;
}>;  // inherits id, schema?, expiresAt?, correlationId?, payload

// In patterns/harness/presets.ts
spawnable<TIn, TOut>(opts: {
  hub: MessagingHubGraph;
  registry: PresetRegistry;
  budgetGate?: BudgetConstraints;
  depthCap?: number;
  validatorSchema?: JsonSchema;
}): {
  spawnTopic: TopicGraph<SpawnRequest>;        // emit here to spawn
  activeSlot: Node<ReadonlyMap<string, AgentBundle<TIn, TOut>>>;  // currently mounted agents
  rejected: TopicGraph<{request: SpawnRequest; reason: string}>;
}
```

### Q5. Right abstraction?

Spawn = preset registry + materialize + SpawnRequest topic + termination contract (G5). Mostly recipe. The "primitive" candidate is the recipe wrapper that bundles the four pieces with sensible defaults (depth cap, budget, validator, expired-request handling).

### Q8. Alternatives

- **A. Recipe documented in §29-extension.** No new exports; doc the spawn topic shape, point at G2's materialize, point at G5's depth guard. Pro: minimal. Con: every user reinvents wiring.
- **B. `spawnable()` harness preset.** Wires SpawnRequest topic, materialize, depth guard, termination contract — returns spawn topic. **LOCKED.**
- **C. `agentHub()` distinct primitive.** Rejected per cross-cut #2 (no new primitive).

### Q9. Recommendation

**B.** Lives in `patterns/harness/presets.ts` (per user's "if combining with control → harness"). Wraps `MessagingHubGraph` + `presetRegistry` + `materialize`. Returns spawn topic with standard `Message<T>` envelope. Schema-validated requests (gated by `validatorSchema` opt). Rejected requests fan into `rejected` topic for observability.

**Standard topic naming alignment** (intervention session §5 gap):
- New well-known topic: **`spawns`** alongside `prompts`/`responses`/`injections`/`deferred`. Add to intervention session's standard topic constants in `patterns/messaging`. Cross-session decision needed during implementation.

**Decisions locked 2026-04-28.** Implementation note: depth-guard pattern locked as `valve(spawnTopic, { open: derived([depthCounter, budget], (n, b) => n < cap && b.ok) })`. depthCounter = `derived` over count of currently-mounted slots in `materialize`'s output (G2 surface).

---

## 10. G4 — Hub as dimensional-degradation boundary

### Q1. Gap statement

The contract: from outside the hub, `describe()` shows declared topics + agent slots as **stable nodes** (typed I/O contract). Inside, the active subgraph backing each slot can swap reactively. Static-face / dynamic-interior is our differentiator vs LangGraph's imperative supervisor.

`MessagingHubGraph` already has the *mechanism* (topics mounted as child subgraphs, lifecycle managed by `Graph.remove`). Missing: an **agent-slot convention** that says "topic X is the I/O contract; the subgraph mounted under X is the agent."

### Q5. Right abstraction?

Pure convention over `MessagingHubGraph`. Agent's `class AgentGraph extends Graph` is mounted as a child of the hub via existing topic-mount API. Hub remains agent-agnostic.

### Q8. Alternatives

- **A. Hub child = agent subgraph.** Mount `AgentGraph` as hub child. Spawn = mount; despawn = unmount via `Graph.remove`. Pure convention. **LOCKED.**
- **B. `hub.mountAgent(slot, bundle)` sugar method.** Just A under the hood. Use as 2-line sugar inside `spawnable()` preset.
- **C. Hub holds preset registry directly.** Couples hub to agent semantics. **Rejected** — violates "hub is generic messaging."

### Q9. Recommendation

**A primarily, with B as 2-line sugar inside `spawnable()` (G3 preset).** Keeps `MessagingHubGraph` agent-agnostic. The "agent slot" is just a child subgraph the hub doesn't know is an agent. Agent-ness observed via meta tags + drill (G6).

**G6 dependency:** for the dimensional-degradation contract to hold, `describe()` and `explain()` must drill into mounted slot. Without G6, the agent is a black box from the parent's view — degrades to "static stub, mysterious interior." Implementation must verify G6 works before claiming the differentiator.

**Decisions locked 2026-04-28.**

---

## 11. G5–G9 — Unit shells (awaiting walk)

### G5 — Spawn termination contract + depth guard (REFRAMED)

**Q1 stub.** Every spawn declares `{ doneTopic, budgetGate, depthCap, expiresAt }`. Refuse mount otherwise. Bubble-up on overflow as typed ERROR via `rejected` topic (G3 surface). Counter to "subagents-inside-subagents cooked for 3 days."

**Reframe from intervention session.**
- Emergency stop: `valve` (NOT `gate`). `gate` is design-time veto; `valve` is runtime cut.
- Depth cap: `valve(spawnTopic, { open: derived([depth], n => n < cap) })`. Pure recipe.
- Budget cap: `valve(spawnTopic, { open: derived([budget], b => b.ok) })` chained with depth-cap `valve`.
- TTL: `expiresAt` field in `Message<T>` envelope + `timeout` operator + `fallback`. No new primitive.
- Cascading sub-agent cancellation: free via subscription cleanup propagation. With adapter-abort closed, parent-`valve`-closes also cancels in-flight sub-agent LLM calls.

**Hard prereq:** adapter-abort hookup (intervention session Real Gap #1). Without it, G5 is propagation-only — in-flight token burn continues.

**Open Q2–Q9:** alternatives for depth-counter shape (`derived` over registry's mounted-count vs separate counter); whether `rejected` topic should carry the original `SpawnRequest` envelope for retry-after-budget-replenish; whether expired-request handling lives in `spawnable()` or in the consumer.

### G6 — Cross-agent inspect drilling

**Q1 stub.** `describe()` and `explain()` drill into the currently-mounted slot of a hub. `explain(from, to)` follows messages across hub → subgraph → return without losing tier/causal info.

**Topology-check criterion** (from `SESSION-ai-harness-module-review.md` §"Explainability criterion"): every primitive's `describe()` must show clean dataflow without islands. Multi-agent extends this to *cross-graph* dataflow.

**Open:** does `explain()` already cross Graph boundaries? Validate with a minimal composition (parent hub + 2 mounted agent subgraphs + topicBridge between them); if `explain(parent.intake, child.out)` fails or loses tier info, file a separate gap. Likely: extend `explainPath` to walk into mounted children when crossing a hub topic.

**Open Q2–Q9:** awaiting walk.

### G7 — Criteria-grid verifier (DOWNGRADED to recipe)

**Q1 stub.** Industry pain #7: single LLM "is this good?" verifier rubber-stamps. Replace with N binary checks: `criteriaResult = { axes: [{id, pass: boolean, evidence: string}] }`. Aggregate via `derived(.every(a => a.pass))` feeding `approvalGate`.

**Reframe (from intervention session §4):** per "schema convention not factory" rule, this is NOT a new exported primitive. It's a recipe in COMPOSITION-GUIDE.

```ts
// Human verifier (uses humanInput from intervention session)
const criteria = humanInput<CriteriaResult>(prompt, {
  schema: { axes: [{ id: "accuracy", check: "..." }, ...] }
});

// LLM verifier (structured-output promptNode)
const criteria = promptNode(graph, "verifier", {
  prompt: ...,
  output: "json",
  schema: criteriaSchema,
});

// Aggregate
const verified = derived([criteria], (r) => r.axes.every((a) => a.pass));
const approved = approvalGate(verified, { ... });
```

**Open:** doc location in COMPOSITION-GUIDE (probably new §33 "Criteria-grid verifier recipe"). Cross-link from G1 verifier slot's JSDoc.

**Open Q2–Q9:** awaiting walk; mostly cosmetic since this is recipe.

### G8 — Cost-bubble contract (HARDENED)

**Q1 stub.** `budgetGate` upstream of every spawn; spawn inherits parent budget split; total cost is first-class observable node. Industry pain #8: cost explosion hard to control.

**Reframe (from intervention session Real Gap #1):** `budgetGate` (shipped) cuts propagation. **Honest cost control requires adapter-abort hookup**. Without it, in-flight token burn continues after gate trips. Multi-agent amplifies.

**Cost-bubble recipe:**
```ts
// Per-agent cost node
const agentCost = costMeterExtractor(agent.streamTopic);  // existing primitive

// Parent collects sub-agent costs
const totalCost = derived([costsByAgent], (m) =>
  Array.from(m.values()).reduce((a, c) => a + c.usd, 0)
);

// Budget gate upstream of spawn (cross-cut with G5)
const canSpawn = budgetGate(totalCost, { maxUsd: 5.0 });
const spawn = spawnable({ hub, registry, budgetGate: canSpawn });
```

**Open:** does `costMeterExtractor` already exist for non-streaming agents? (It exists for streaming per Wave A Unit 3.) Extend for `agent()` outputs.

**Hard prereq:** adapter-abort hookup. Shared blocker with G5, intervention session, and project_harness_closed_loop_gap.

**Open Q2–Q9:** awaiting walk.

### G9 — Convergence detector

**Q1 stub.** First-class operator for shared-state pattern: "no new DATA on topic for N waves" → emit COMPLETE. Closes Anthropic's named "reactive loop" failure for shared-state pattern.

Sketch:
```ts
// In extra/operators/control.ts (probably)
convergence<T>(source: Node<T>, opts: {
  quietWaves: number;     // N waves with no new DATA
  maxWaves?: number;      // hard cap
  equals?: (a: T, b: T) => boolean;
}): Node<T>  // emits last-stable value + COMPLETE
```

**Open:** name. `convergence` vs `settle` vs `quiet` vs `idle`. Existing `awaitSettled` is a related concept — clarify boundary.

**Open Q2–Q9:** awaiting walk. Pure operator; smallest scope.

---

## 12. G10 — Atomic registry hot-swap (DEFERRED)

Same underlying problem as `project_rewire_gap.md`: no atomic rewire API; disconnect/resubscribe untested. Park until patterns consolidation; gate G2's API to keep the future open (factories arg accepts `Node<Map<...>>` so reactive mutation surface exists).

**Re-evaluate after:** patterns-extras consolidation lands (folder structure stable for any future `extra/composition/rewire.ts`); a concrete consumer surfaces (current preset-mutation use case is "current sessions complete on old, new sessions use new" which doesn't require atomic rewire).

---

## 13. Open Questions (for implementation hand-off)

1. **Cross-session topic naming alignment.** Intervention session proposes `prompts`/`responses`/`injections`/`deferred` standard topics. This session proposes adding `spawns`. Coordinate during implementation — both sessions land in `patterns/messaging` standard topic constants together.
2. **Adapter abort contract change.** Intervention session §9 Phase 1: adapter contract widens to `LLMAdapter.call(spec) → { stream, abort }`. This is a breaking change pre-1.0; impacts every adapter implementation. Gate G5/G8 honesty on landing.
3. **Strategy-model key shape extension.** From `(rootCause × intervention) → successRate` to `(presetId × rootCause × intervention) → successRate`. Implementation must extend the key in this wave or churn later. Decision needed before G2 ships.
4. **G6 cross-graph `explain()` validation.** Required before claiming the static-face/dynamic-interior differentiator. May surface a separate gap; if so, file it before G1 implementation.
5. **`AgentMemoryGraph` partition default.** Lock: private memory per agent (each `agent()` creates its own if none passed). Doc default + explicit shared-instance for §29 handoff.
6. **G7 doc location.** New COMPOSITION-GUIDE §33 "Criteria-grid verifier recipe." Cross-link from `agent()` verifier slot JSDoc.
7. **G9 operator name.** `convergence` vs `settle` vs `quiet` vs `idle`. Decide during operator-layer landing; existing `awaitSettled` semantically adjacent.
8. **G5 `rejected` topic envelope shape.** Carries original `SpawnRequest` for retry-after-budget-replenish, or just `{request, reason}`? Lean: full envelope, since `correlationId` enables retry mechanism without state.
9. **Worked example before implementation.** A single test file demonstrating handoff between two `agent()` instances using `topicBridge` would prove the design before the next session implements. Suggest landing at `src/__tests__/patterns/ai/agents/multi-agent-example.test.ts` as the first concrete artifact.
10. **Pre-1.0 deprecation path for `agentLoop.run()`.** Refused for new `agent()` primitive (cross-cut #1 lock). Schedule deprecation warning post-launch; remove pre-1.0 if no real consumer needs imperative entry. Track in optimizations.md.

---

## 14. Hand-Off Sequencing for Implementation Session

Recommended order for the next session (implementation):

**Phase A — Prereqs (parallel)**
1. DF12 land (`promptNode.tools` reactive widening).
2. Wave AM completion (AM.0–AM.3).
3. Adapter-abort contract change (intervention session Phase 1, shared blocker).

**Phase B — Substrate additions (after Phase A)**
4. `Message<T>` envelope `schema` field (intervention session Phase 0).
5. Standard topic constants in `patterns/messaging`: `prompts`/`responses`/`injections`/`deferred`/`spawns` (cross-session).
6. `selector` + `materialize` in `extra/composition/` (G2).
7. `bufferWhen(notifier)` operator if not covered (intervention session Phase 0).

**Phase C — Agent layer**
8. `AgentBundle<TIn, TOut>` interface in `patterns/ai/agents/agent.ts` (G1 block).
9. `class AgentGraph<TIn, TOut> extends Graph` (G1).
10. `agent(spec)` preset in `patterns/ai/agents/presets.ts` (G1).
11. `presetRegistry` sugar in `patterns/ai/agents/presets.ts` (G2).
12. Strategy-model key extension (`presetId × rootCause × intervention`).

**Phase D — Multi-agent presets**
13. `humanInput<T>` + `tracker` from intervention session (sibling presets).
14. `spawnable()` in `patterns/harness/presets.ts` (G3 + G4 sugar + G5 depth/budget/expiresAt wiring).
15. G7 recipe doc — COMPOSITION-GUIDE §33.
16. Cost-bubble recipe doc — extend G1 JSDoc + COMPOSITION-GUIDE.

**Phase E — Validation**
17. Worked example: `multi-agent-example.test.ts`.
18. G6 cross-graph `explain()` validation.
19. G9 operator (`convergence` or `settle`).

**Defer:** G10 (hot-swap), 7th-block question (locked: no), AG-UI translation adapter (intervention session Phase 3).

---

## Related Files

- `archive/docs/SESSION-human-llm-intervention-primitives.md` — **shared substrate; co-handoff target**
- `archive/docs/SESSION-reactive-collaboration-harness.md` — 7-stage loop, valve, gate
- `archive/docs/SESSION-patterns-extras-consolidation-plan.md` — folder structure, naming rules, gate-family disambiguation
- `archive/docs/SESSION-harness-engineering-strategy.md` — competitive positioning vs LangGraph, MCP infiltration plan
- `archive/docs/SESSION-ai-harness-module-review.md` — 9Q format precedent; current ai/harness state
- `archive/docs/SESSION-mid-level-harness-blocks.md` — 6-block face: graphLens / resilientPipeline / guardedExecution shipped
- `archive/docs/SESSION-graph-module-24-unit-review.md` — 9Q format origin
- `~/src/graphrefly/COMPOSITION-GUIDE.md` §29–§32 — handoff, parallel guardrail, dynamic tool selection, state-mirror; **new §33 candidate: criteria-grid verifier recipe**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §5.8–5.12 — design invariants
- `src/patterns/ai/agents/` — current `agentLoop` / `handoff` / `toolSelector` / `tool-registry` / `tool-execution`
- `src/patterns/messaging/` — `MessagingHubGraph`, `TopicGraph`, `SubscriptionGraph`, `TopicBridgeGraph`
- `src/patterns/harness/` — `harnessLoop`, strategy model, bridge factories
- `src/patterns/orchestration/` — `gate`, `valve`, `pipelineGraph`
- `src/extra/composition/` — `verifiable`, `distill`, `pubsub`, `stratify`; **target for `selector` + `materialize`**
- `src/patterns/ai/adapters/` — site of adapter-abort gap (shared with intervention session)
- `docs/optimizations.md` — DF12 (Tier 7 follow-up), Wave AM in flight, adapter-abort gap (this session surfaces)
- `docs/roadmap.md` — Phase 4+ patterns layer; multi-agent presets land in Wave 2 / Wave 3 era

---

**Status:** SCAFFOLDED 2026-04-28. G1–G4 locked; G5/G7/G8 reframed; G6/G9 stubbed; G10 deferred. Hand-off ready. Implementation session inherits this doc + `SESSION-human-llm-intervention-primitives.md` + listed prereqs.
