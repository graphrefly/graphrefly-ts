# SESSION: Strategy Review, Roadmap Reprioritization & Demo Realignment

**Date:** 2026-04-20
**Topic:** Post-小红书 strategy reflection. Analyzed all strategy docs against the "agent infra commoditization" thesis. Identified explainability-first as the P0 differentiator. Reprioritized demos, updated roadmap, profile README, and marketing strategy. Clarified knowledgeGraph() application.

---

## Trigger

A 小红书 post ("创业公司的Agent Infra，大概率不是你的护城河") argued that agent infra (sandbox, tool registration, tracing, agent loop) is being rapidly commoditized by Anthropic Managed Agents and AWS AgentCore. Prompted a full strategy review against SESSION-harness-engineering-strategy.md, SESSION-reactive-collaboration-harness.md, SESSION-universal-reduction-layer.md, and SESSION-competitive-landscape-self-evolution.md.

---

## Key Findings

### GraphReFly is NOT in the commoditized layer
The 小红书 post describes commoditized infra: sandbox execution, tracing, tool registration, agent loop execution. GraphReFly's substrate (reactive state coherence, `explainPath`, reduction layer, human governance gate) is exactly what the post calls "only when it's deeply coupled to business logic, no general platform can replace it."

### Commoditization risk by layer

| Layer | Risk | Reason |
|---|---|---|
| Agent loop / tool call | High | Managed Agents covers this |
| Tracing / observability | High | Langfuse, AgentCore, Future AGI |
| Reactive state coherence | Low | Protocol-level guarantee, PaaS won't expose this abstraction |
| `explainPath` / causal audit | Low | Topology-aware, no competitor has this |
| Reduction layer (info→action) | Low | Domain-specific composition, not a runtime |
| Human governance gate | Medium-Low | HITL is common; reactive backpressure + strategy model is not |

### Wave 1 eval story doesn't use the differentiator
The entire Wave 1 narrative ("catalog quality is the #1 lever") is a valid engineering insight but is in the commoditizable zone — every eval platform (Braintrust, Langfuse, Future AGI) can tell the same story. `explainPath` is shipped (§9.2) but not featured in Wave 1 at all.

### Eval and explainability are sequential, not parallel
`explainPath` is a runtime tool (why did this node get this value?). The eval failures happen at compile time (`validateSpec` rejects malformed GraphSpec). Wiring `explainPath` into the eval runner would not improve debugging — they operate at different layers. The bridge is narrative: eval finds *which* gaps → `explainPath` (Wave 2) shows *why* fixes propagate correctly.

---

## Decisions

### Eval: run Codex A + C, skip D
- Codex A: already running (non-thinking model, different failure distribution from GLM)
- Codex C: run (~$5) — F4 hypothesis: refine never triggered on GLM-4.7 (thinking model); Codex (non-thinking) likely to produce actual catalog-invalid outputs where refine demonstrates value
- Codex D: skip — template story already complete on GLM data; no new narrative value

### Roadmap changes
1. **Added §9.3e — Spending Alerts demo (Wave 2)**: minimal `fromTimer → anomalyDetector → flagNode` pipeline in `examples/spending-alerts/`. CLI CTA: `npx @graphrefly/cli explain spending-alerts.json --from transactions --to flag`. Backs homepage 02 ("Action Without Explanation") and proves `explainPath` as P0 differentiator without needing a GIF. Pages: `examples/spending-alerts/index.ts` + `website/src/content/docs/demos/spending-alerts.md`.
2. **Sharpened Demo 0 (§9.5)**: added pain-point-first narrative frame — "email scattered across Gmail/Slack/Linear → one graph → explain every flag." Closes homepage 01 AND 02 via the `explainPath` step at the end. GIF still required, still gates Show HN.
3. **Rewrote Demo 6 (§9.7)**: now explicitly the "self-improving + explainable" showcase. Agent fails mid-task → `explainPath` shows causal chain → REFLECT updates strategy model → next run avoids failure. This is the direct answer to "how do you make your agent learn from its mistakes?"
4. **Added homepage demo link inventory to Wave 3 deliverables**: all three homepage links mapped to specific files and waves. "Demo: Knowledge Graph →" resolved as a static quickstart on GraphSpec docs page — no full demo.
5. **Scorecard (§9.1.5)**: moved "Causal trace completeness" to first metric (was last). It's the P0 differentiator — lead with it.

### Profile README (`graphrefly_github/profile/README.md`)
- `persistentState()` → `Graph.attachStorage()` in the 6 building blocks table (persistentState was superseded per roadmap §7.6)
- Removed `auto-solidify` from `harnessLoop()` description (it's in optimizations.md as proposed, not shipped)

### Marketing strategy §15 Wave 1
- Blog post close now includes the Wave 1→2 bridge sentence: "The eval tells you *which* gaps remain. Wave 2 ships `explainPath` to show *why* — every failed composition has a causal chain, readable in one call. Watch the scorecard."

---

## Demo Priority Order (updated)

| Priority | Demo | Wave | Backs homepage |
|---|---|---|---|
| P0 | §9.3e Spending Alerts (new) | Wave 2 | 02 Causal Tracing |
| P1 | Demo 0 — Email Triage | Wave 3 | 01 + 02 |
| P2 | Demo 6 — Agent Observatory (enhanced) | Wave 3 | Harness story |
| P3 | Demo 4 — Docs Assistant | Post-Wave 3 | §9.3d dependency |
| Deferred | Demos 1, 2, 3, 5, 7 | Post-launch | — |

---

## knowledgeGraph() — Application Clarification

`entities`, `edges`, `adjacency` are **internal node names** inside the `knowledgeGraph()` Graph container — they describe the schema of the data structure, not vocabulary that users interact with directly. The user-facing data is the generic `TEntity` type (whatever shape you define) and `TRelation` (your relationship vocabulary).

**Primary application: structured memory for LLM pipelines.** The LLM doesn't hold state between calls. The KG holds the structured facts (entities, relationships) extracted from LLM outputs. On subsequent calls, the KG provides context: "here are the entities related to this query." The `adjacency` node being reactive means downstream nodes (context window builders, suggestion engines, routing decisions) automatically update whenever the graph structure changes — no re-query needed.

**Secondary application: reactive domain model.** Track relationships between domain objects that change over time, with automatic propagation to downstream nodes. Example: "which services depend on which services?" — when a new deployment is detected via `fromWebhook`, the adjacency node updates, and downstream alert/routing nodes react automatically.

**It is not a user-facing knowledge organization UI** (like Obsidian or Roam). It's plumbing. A UI on top, or an LLM reading from `adjacency`, would surface it meaningfully.

**Concrete example:**
```
fromWebhook (email) → promptNode (extract entities) → kg.upsertEntity / kg.link
                                                           ↓
                                                 adjacency Node (reactive)
                                                           ↓
                                         derived: "who should I CC on this email?"
                                         → kg.related("graphrefly-project", "works_on")
                                         → ["alice", "bob"] — updates automatically
                                              as project membership changes
```

Without the reactive layer: you'd poll the KG or manually trigger re-computation. With GraphReFly: `adjacency` is a `Node` — subscribe to it and downstream logic runs automatically.

---

## Knowledge Graph Quickstart — Scope & Context to Reveal

**Why a full pipeline is required:** If you show `upsertEntity` / `link` / `related` in isolation, users assume this is a human-readable knowledge organizer (like Obsidian or Roam). The reactive angle — and the reason to use GraphReFly's KG instead of a plain `Map` — only becomes clear when you show a *source driving writes* and a *derived node consuming the adjacency reactively*. The pipeline is the point.

### What to show (pedagogical arc)

**Step 1 — Dispel the misconception up front.**
Lead with: "`entities`, `edges`, `adjacency` are internal node names — the schema of the container. Your data lives in `TEntity` (whatever shape you define) and `TRelation` (your relationship vocabulary)." Show the type signature before any code so users don't pattern-match to user-facing vocabulary.

**Step 2 — The static baseline (30 seconds of context).**
One screen: create a KG, `upsertEntity`, `link`, call `related`. This gives users a mental model before reactivity enters. But explicitly label it "this is just a fancy Map so far."

**Step 3 — The reactive turn (where it becomes GraphReFly).**
Wire a `promptNode` (or a mock source for zero API cost) that receives a document, extracts `{ entities: [...], relations: [...] }` as structured output, and calls `kg.upsertEntity` / `kg.link` inside its effect. Then wire a `derived([kg.get("adjacency")], fn)` node downstream. Show that when the source pushes a new document, the derived node recomputes automatically — no re-query, no polling. This is the moment users understand why the KG is a `Graph`, not just a data structure.

**Step 4 — Inspect it.**
Call `describe(kg)` to show the node relationships. This surfaces that `adjacency` is derived from `edges`, `edges` is a state node, etc. Addresses the "human readable?" concern — yes, you *can* see the structure, but that's the graph topology, not your domain data. Your domain data is what you put into `TEntity`.

**Step 5 — Trace it.**
One `explainPath(kg, "entities", "adjacency")` call. Output shows: `adjacency ← derived([edges]) ← state`. Connects to homepage 02 ("ask why") — the lineage of the adjacency map is structurally traceable.

**Step 6 — Guard it (1 paragraph, optional section).**
`policyEnforcer(kg, [{ actor: "untrusted-llm", node: "entities", deny: "write" }])` — shows that even if the LLM goes off-script, it cannot corrupt the KG without the actor guard. This is the "Composition Without Guardrails → now with guardrails" closure for homepage 03.

### Context to reveal in the docs page (things users won't find in JSDoc)

1. **Why `adjacency` exists as a derived node (not just a method):** Any downstream node that depends on `adjacency` gets automatic reactivity. If you stored edges as a plain array and called a method, you'd have to remember to re-call on change. The reactive layer eliminates that category of bug.

2. **`related()` vs `adjacency` node — when to use which:**
   - `related(id, relation)` is an imperative query from outside the graph — use it in event handlers, tool call results, external consumer code.
   - `kg.get("adjacency")` is for wiring reactive downstream nodes inside the graph — use it in `derived(...)` factories.
   - Both are correct. They operate at different layers (external consumer vs reactive topology).

3. **Integration with `agentMemory`:** `agentMemory({ enableKnowledgeGraph: true })` creates a KG internally and wires it into the retrieval pipeline automatically. The standalone `knowledgeGraph()` factory is for users who want the KG without the full memory stack — lighter weight, same reactive semantics.

4. **What the KG does NOT do:** It does not embed, rank, or semantically search. For semantic retrieval, use `agentMemory` (which combines `vectorIndex` + `knowledgeGraph` + decay). The standalone KG is for explicit structural relationships where you control the relation vocabulary.

5. **Thread safety note (PY):** In Python, `upsertEntity` / `link` / `unlink` are not thread-safe without external locking. Call them from a single-threaded effect or wrap with an `RLock`. TS has no concern (single-threaded event loop).

### Files to create

| File | Purpose |
|------|---------|
| `examples/knowledge-graph/index.ts` | Full runnable pipeline: mock document source → promptNode (or mock) → KG writes → derived downstream → describe + explainPath |
| `website/src/content/docs/demos/knowledge-graph.md` | Docs walkthrough page. Homepage "Demo: Knowledge Graph →" links here |

### What NOT to show

- Do not start with `upsertEntity` alone — it looks like Obsidian and sets the wrong mental model
- Do not use a real LLM API call in the example — make the source a `fromArray` of pre-parsed documents so the example runs for free and tests without a key
- Do not call `related()` inside a reactive `derived` fn — it reads `.cache` imperatively; use `kg.get("adjacency")` there instead

---

---

## Strategic Pivot: Composition Success Rate as the Single Metric (end of session)

**Decision:** Stop focusing on blog/marketing. The single metric that matters is: can an LLM reliably compose GraphReFly primitives into correct solutions? Everything else (demos, blog, users) is derivative of this working.

**Current state:** 87% first-pass graphspec validity, 70% all-treatments-pass. Target: >95% first-pass, zero structural failures.

**Priority stack (highest leverage first):**

1. **Treatment E: catalog subsetting** — progressive disclosure. Don't dump full catalog. Give LLM only what's relevant to the task. Notion's #1 technique.
2. **GraphSpec format revision** — make structurally impossible errors (F3 template-param overreach) impossible at the schema level. Validation should catch mistakes at parse time, not require the LLM to "know the rules."
3. **Tighter validateSpec error messages** — when composition fails, the error message IS the next prompt. LLM-parseable errors enable Treatment C (auto-refine) to actually work.
4. **EXECUTE actuator (§9.1.3)** — close the loop: failure → diagnosis → fix → re-eval. No manual treatment switching.
5. **COMPOSITION-GUIDE as LLM context** — progressively disclosed guide content in the prompt.

**The dogfood loop:** The development process itself runs through the harness. Issue → triage → implementation → AC → eval → verification → insight → next issue. Each is a node. The strategy model accumulates effectiveness data. Triage gets smarter over time.

**What this means for the roadmap:**
- Blog (§9.1.5): deprioritized. Publish when we have something that actually works reliably.
- Demos (§9.3e, §9.5, §9.7): build when composition is reliable enough to demo without caveats.
- Treatment E + format revision: promoted to immediate priority, above Wave 1 external deliverables.
- EXECUTE actuator: promoted to unblock the internal iteration loop.

**Immediate next actions:**
1. Classify the 9 failing tasks by root cause category (format? catalog overload? missing primitive? reasoning exhaustion?)
2. Prototype catalog subsetting (even naive keyword-match)
3. Tighten `validateSpec` error messages for the most common failure modes

**Insight from Notion article (latent.space/p/notion):** Notion's key learning: "give the model what it wants." They adapted FROM their internal format TO formats LLMs already know (markdown, SQL). They invested in progressive tool disclosure. They built 3-tier evals with "frontier" tier at ~30% pass rate (intentionally hard). They created "Model Behavior Engineers" role. They use agents to debug their own evals. GraphReFly is directionally correct (eval-driven, schema as lever, iteration loop) but behind on format adaptation, progressive disclosure, and automated iteration.

---

## LangChain "Your Harness, Your Memory" — Analysis & Lock-In Assessment (added April 22, 2026)

**Trigger:** Harrison Chase (LangChain) published "Your Harness, Your Memory" blog post arguing that agent harnesses are permanent infrastructure and that memory creates vendor lock-in. Analyzed against SESSION-harness-engineering-strategy.md, SESSION-reactive-collaboration-harness.md, SESSION-agentic-memory-research.md, SESSION-marketing-promotion-strategy.md, and this file.

**Source:** https://www.langchain.com/blog/your-harness-your-memory

### Chase's Core Claims

1. **Harnesses are permanent.** Even as models improve, scaffolding grows — Claude Code's 512k lines proves better models create *more* harness, not less. Harnesses are "transmissions" — as fundamental as engines.
2. **Memory is the moat.** Without memory, agents are "easily replicable by anyone with access to the same tools." With memory, developers build "proprietary datasets of user interactions."
3. **Three escalating lock-in levels:** (a) Mild — stateful APIs (OpenAI Responses) store state server-side; (b) Bad — closed harnesses (Claude Agent SDK) obscure memory mechanics; (c) Worst — entire harness + long-term memory behind proprietary APIs (Anthropic Managed Agents).
4. **Model providers are incentivized to move memory behind APIs** because it creates lock-in that pricing alone cannot achieve. OpenAI Codex generates "encrypted compaction summaries not usable outside OpenAI's ecosystem."
5. **Product announcement: Deep Agents** — open source, model-agnostic, database plugins (Mongo/Postgres/Redis), self-hosted via LangSmith, user-controlled memory storage.

### Where Chase Is Correct

- Memory IS the moat for agent applications. This validates our `agentMemory()` investment (SESSION-agentic-memory-research).
- Harnesses are permanent infrastructure. Aligns with our harness engineering analysis (SESSION-harness-engineering-strategy Part 1).
- Provider incentive to lock memory behind APIs is real. This is a genuine risk for any team using Managed Agents or Codex without export paths.

### Where Chase Is Self-Serving

- The article frames LangChain as the "open" alternative to proprietary lock-in. But "open source" ≠ "no lock-in" — it's lock-in with visible source code. LangSmith (their hosted platform) is where they monetize; their OSS tools funnel users there.
- Deep Agents' "database plugins" are data-layer portability — you can export your bytes. But your agent's *coordination logic* (LangGraph state machines, node definitions, edge routing) is still locked to their abstractions.
- Chase doesn't address structural lock-in (coordination model becomes irreplaceable because domain logic is woven into it). Data is exportable; topology is not.

### GraphReFly's Lock-In Vectors (three deeper levels)

Chase sells *data-layer* lock-in (where your bytes live) as the whole story. GraphReFly operates at three deeper levels:

#### 1. Memory lock-in — we have this AND more

| Dimension | LangChain Deep Agents | GraphReFly |
|---|---|---|
| Memory model | Database plugins (Mongo, Postgres, Redis) — externalized, portable | In-process reactive: vector + KG + decay + distill + multi-tier — 10,000x faster, push-based |
| Memory evolution | Static store-and-retrieve | `llmConsolidator` + periodic reflection + `decay()` — memories that survive consolidation compound in value |
| Memory observability | Opaque | `observe({ causal: true })` — "why did this memory surface?" |

The lock-in: once agent memory is structured as a reactive graph with decay, consolidation, and causal tracing, migrating to a flat key-value store (what every competitor offers) means losing the *intelligence* of the memory, not just the data.

#### 2. Topology lock-in — Chase doesn't address this

When users wire domain logic into the 7-stage reactive loop (INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT), with `gate.modify()` as steering point and a strategy model learning from every iteration — **the topology itself becomes proprietary**. It's not data that's locked in, it's operational knowledge encoded as graph structure.

LangGraph's state machines are flat: node → edge → node. GraphReFly's composition — diamond resolution, two-phase push, feedback cycles, backpressure, causal tracing — creates structures meaningfully harder to replicate elsewhere.

The strategy model (`rootCause × intervention → successRate`) is the sharpest example: it accumulates organizational knowledge about what works. Switching means starting the learning curve from zero.

#### 3. Explainability lock-in — the compliance angle

Once an organization uses `explainPath` for compliance ("why was this flagged?"), switching to a system without causal tracing means losing audit trail capability. Particularly sticky in regulated industries. Chase mentions "compliance logging" as a concern but offers data portability, not structural causality.

### What Chase Reveals About Our Gap

Chase's Deep Agents pitch is: database plugins, open standards, self-hosted, model-agnostic. Simple. This validates the adoption friction concern from the strategic pivot (this file, "Composition Success Rate as the Single Metric" section).

Lock-in only works if users get in first. Chase can ship "open" mediocrity at scale because LangChain already has users. Our lock-in is structurally superior but requires composition success rate >95% before it compounds. The priority stack (Treatment E → format revision → tighter validateSpec → EXECUTE actuator) is the correct path to unlock this.

### Actionable Additions

1. **New reply marketing keyword:** Add "agent memory lock-in", "harness lock-in", "agent vendor lock-in" to §12 search keywords (SESSION-marketing-promotion-strategy). Chase's article will generate discussion threads we should enter.
2. **New comparison angle:** Add "memory portability" row to the "GraphReFly vs LangGraph" comparison page (Wave 2). Our reactive memory is *more* portable than theirs — it's in-process, no external service dependency, and `describe()`/`observe()` make the memory graph fully inspectable. "Open source" alone doesn't make memory portable; structural transparency does.
3. **Blog candidate (Wave 2):** "Data Portability Is Not Memory Portability — Why 'Open Source' Doesn't Prevent Agent Lock-In." Direct response to Chase's framing, positioning GraphReFly's reactive memory + causal tracing as genuine portability vs LangChain's "you own the Postgres rows."
4. **Vocabulary to claim:** "topology lock-in" and "structural portability" — neither term exists in the current harness engineering discourse. Claiming them positions GraphReFly as thinking about lock-in at a level competitors haven't articulated.

---

## Files Changed

- `docs/roadmap.md` — §9.3e added, §9.5/§9.7 sharpened, scorecard metrics reordered, Wave 3 demo link inventory added
- `archive/docs/SESSION-marketing-promotion-strategy.md` — §15 Wave 1 blog close updated with Wave 1→2 bridge
- `~/src/graphrefly_github/profile/README.md` — `persistentState()` → `Graph.attachStorage()`, `auto-solidify` removed from harnessLoop
- `archive/docs/SESSION-strategy-roadmap-demo-reprioritization.md` — added LangChain "Your Harness, Your Memory" analysis + lock-in assessment (April 22, 2026)
