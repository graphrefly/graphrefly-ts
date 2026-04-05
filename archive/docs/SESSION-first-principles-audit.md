---
SESSION: first-principles-audit
DATE: April 4, 2026
TOPIC: First-principles audit of GraphReFly's necessity — is the library justified, what uniquely differentiates it, and what is the minimal optimal solution for human+LLM reactive co-operation?
REPO: graphrefly-ts
---

## CONTEXT

A deep self-examination of whether GraphReFly is necessary or over-engineered. The discussion starts from first principles: data flows from one function's output to the next function's input — why add a reactive graph layer? Is callbag-style reactivity genuinely useful, or is it self-indulgent engineering? Does the industry need this, or have others considered and rejected similar approaches?

This session synthesizes web research (callbag history, reactive programming criticisms, signals vs observables landscape), internal design documents, and first-principles reasoning to arrive at a clear answer.

---

## PART 1: WHY HASN'T ANYONE DONE THIS BEFORE?

### The callbag precedent

Andre Staltz created callbag in 2018 with a nearly identical thesis: one minimal function signature to unify push/pull, sync/async. Result: essentially no adoption.

**Why callbag failed:**
- "Open source without maintainers" philosophy — elegant in theory, zero ecosystem in practice
- Too abstract for mainstream developers
- Staltz moved on to Manyverse/SSB, then Socket
- By 2018, RxJS was entrenched in Angular; fragmented npm-per-operator never reached critical mass

**Lesson for GraphReFly:** A spec-only approach with no opinionated DX produces elegant minimalism but zero adoption. The value must be in what users can *do*, not in the protocol's elegance.

### Others who considered and chose differently

- **Brian Goetz (Java architect):** "I think Project Loom is going to kill Reactive Programming." Virtual threads eliminate the concurrency argument for server-side reactive.
- **Spring documentation:** "If you have a Spring MVC application that works fine, there is no need to change. Imperative programming is the easiest way to write, understand, and debug code."
- **TechYourChance (Jan 2025):** "Reactive Programming Considered Harmful" — complexity inversion, architectural lock-in, debugging difficulty.
- **The signals convergence:** Angular 16+, SolidJS, Preact Signals, Vue refs, Svelte runes all converged on signals for synchronous reactivity. TC39 Signals proposal working toward language-level standardization.

### Current industry consensus (2024-2025)

| Need | Solution | Representatives |
|------|----------|----------------|
| Synchronous state + change propagation | Signals | Angular, SolidJS, Preact, Vue, TC39 |
| Async event streams | Observables/RxJS | HTTP, WebSocket, complex async |
| Stateless transformations | Plain functions | Utilities, data pipelines |

---

## PART 2: HONEST AUDIT OF CLAIMED ADVANTAGES

### "Reactive/push-based memory — everyone else is pull-only"

**True.** Mem0, Letta, Zep are all query-retrieve-return. No push-based memory invalidation exists.

**But only matters for long-running agents.** Request-response agents (most current usage) re-retrieve every turn anyway. Push vs pull difference is zero for them.

**Verdict:** Real advantage, narrow applicability (today). Applicability widens as agents become long-running.

### "In-process ~10ns vs Redis ~500us"

**True but misleading.** LLM inference is seconds. Memory read latency is not the bottleneck. Single-process = no horizontal scaling.

**Verdict:** Micro-benchmark truth, macro-architecture non-factor.

### "Diamond-safe two-phase push"

**Matters when derived values have side effects** (API calls, tool calls, logging). Intermediate inconsistent states can trigger incorrect actions.

**Verdict:** Correctness guarantee, not a headline feature. Users won't come for this, but they'll stay because of it.

### "`describe()` + `observe()` — full graph auditability"

**Genuinely differentiated.** Compared to LangGraph (state checkpoints), CrewAI (task logs), plain functions (console.log), GraphReFly provides complete topology + values + meta + causal chains. Not just "what happened" but "why it happened."

**Verdict:** Killer feature in regulated/compliance scenarios. Overkill for casual dev work.

### "Glitch-free diamond dependency"

**Staltz argued in 2015 that "Rx glitches aren't actually a problem."** His point: use the right operator and glitches disappear.

**History disagreed.** Every major framework in 2024-2025 (Angular Signals, SolidJS, Preact) makes glitch-free a core guarantee. It's now table stakes, not a differentiator.

**Verdict:** Necessary but not sufficient. No one will come for glitch-free alone; they'll leave without it.

---

## PART 3: "CAN LLMs JUST USE PLAIN FUNCTIONS?"

### Yes, for most cases

```typescript
// Plain functions version
const memories = await retrieveMemories(query);
const context = assembleContext(memories, systemPrompt);
const response = await llm.chat(context);
const extracted = extractEntities(response);
await storeMemories(extracted);
```

This works for linear flows. Problems appear with:
1. Manual decision of *when* to re-retrieve
2. Manual consistency management across multiple simultaneous data source changes
3. Manual causal tracking (why was this memory selected?)
4. Manual budget management (context window overflow)

**But for most agent applications, these aren't hard** because flow is linear.

### GraphReFly's advantage is non-linear scenarios

Multiple sources, multiple consumers, feedback loops, dynamic topology, concurrent updates — this is where plain functions require reinventing pieces of GraphReFly.

---

## PART 4: IS GRAPH THE BEST REPRESENTATION?

### Graph is not about "display" — it's about operability

| Representation | Human readability | LLM readability | Executable | Structurally diffable |
|---------------|-------------------|-----------------|------------|----------------------|
| Flowchart | High | Medium | No | No |
| UML | Medium | Low | No | No |
| Code | Medium-High | High | Yes | Semantic diff hard |
| Adjacency list / JSON | Low | High | Yes | Yes |
| Reactive graph (GraphReFly) | Low-Medium | High | Yes | Yes |

**Graph's unique property:** It can be structurally read, written, diffed, and merged by LLMs — something neither code nor flowcharts enable well.

**For human display, graph needs multiple layers:**
- High level: flowchart / diagram (`graph.diagram()`)
- Mid level: declarative config (GraphSpec JSON)
- Low level: code (custom logic)

**Conclusion:** Graph is the right *execution model*. Display should be multi-layered and audience-adapted.

---

## PART 5: THE FOUR REQUIREMENTS ANALYSIS

### Requirement 1: LLM can create without too many bugs

Plain functions have unbounded error space (any JS can go wrong). GraphSpec constrains composition to structural operations (nodes, edges, types). LLMs make fewer mistakes in constrained systems.

**But:** Node-internal functions are still code. Graph constrains *composition*, not *computation*.

**Sufficient?** Yes — single-node functions are simple, testable in isolation. Composition bugs are the hard ones, and graph eliminates them structurally.

### Requirement 2: Human can audit

Plain functions: read code + add logging. GraphReFly: `describe()` + `observe({ causal: true })` + `snapshot()` diff. Built-in vs bolted-on.

**Key difference from OTel:** OTel is post-hoc (after the fact). GraphReFly is live (any moment during runtime).

### Requirement 3: Security and trust

`Actor/Guard` + per-node access control is genuine differentiation. Multi-tenant and multi-agent scenarios (different agents see different subgraphs) are the sweet spot.

### Requirement 4: Human/LLM symmetry

**Most novel requirement.** Current paradigm: human writes code, LLM executes (or vice versa). GraphSpec enables:
- LLM compose graph -> human review topology -> graph executes
- Human compose graph -> LLM audit correctness -> human confirms
- LLM A compose -> LLM B audit -> human approve

**This symmetry is new** because graph is declarative + structural. Reviewing a GraphSpec diff is easier than reviewing a code diff — for both humans and LLMs.

---

## PART 6: WHAT IS THE IRREDUCIBLE CORE?

The minimal set without which at least one of the four requirements fails:

| Component | Remove it and... |
|-----------|------------------|
| `node` (minimal compute unit with declared deps) | LLM returns to writing arbitrary code, error space unbounded |
| Explicit edges (dependency as data) | Causal chain breaks, audit impossible |
| Propagation (change -> downstream notified) | Manual update coordination, back to vibe coding |
| `describe()` / `snapshot()` (structure visible, persistable, diffable) | Not auditable, not persistable, not trustable |
| `GraphSpec` (declarative LLM-readable representation) | LLM can't structurally operate on the graph |

**These five are the minimum.** Everything else (operators, adapters, patterns) is convenience on top.

---

## PART 7: GRAPH > FUNCTIONS FOR LLM COMPOSITION — THE CORE ARGUMENT

### Why LLMs struggle with function composition

LLMs write individual functions well. They struggle with *systems*: shared mutable state, implicit dependencies, scattered error handling, refactoring cascading effects.

**Common thread:** Dependencies are implicit. No place in the code explicitly declares "A depends on B."

### Why graph makes this easier

GraphSpec makes dependencies explicit data:
```jsonc
{
  "nodes": {
    "inbox": { "type": "producer", "source": "email" },
    "filtered": { "type": "derived", "deps": ["inbox"], "fn": "filterByScore" },
    "summary": { "type": "derived", "deps": ["filtered"], "fn": "summarize" },
    "alert": { "type": "effect", "deps": ["summary"], "fn": "notify" }
  }
}
```

vs imperative code where dependencies hide in call order and variable references.

### Error space comparison

| | Plain functions | GraphSpec |
|---|---|---|
| Possible error types | Unbounded (any JS mistake) | Finite (node missing, edge wrong, type mismatch) |
| Error detectability | Requires execution | Most errors caught statically pre-execution |
| Error localization | Requires understanding global control flow | Which node/edge is wrong |
| Fix blast radius | Changing one function may affect others | Changing one node, others unchanged (isolation) |
| LLM global understanding | Must trace all variable flows | `describe()` gives topology directly |

**Analogy:** SQL vs hand-written database operations. SQL won not by being more powerful, but by constraining operations to a declarative structure, reducing the error space by orders of magnitude.

---

## PART 8: CAUSAL CHAIN PERSISTENCE — THE KILLER ARGUMENT

### The anti-vibe-coding thesis

**Vibe coding:** Start from scratch each time, previous correctness unknown, context lost.
**Plain functions + git:** Code persists, but "why it was written this way" is lost. Next change may break prior assumptions.
**Graph + causal chain:** Structure persists + causality persists. Changing upstream, downstream knows it may no longer hold.

**This is progressive trust accumulation.** People don't trust AI not because AI isn't smart enough, but because:
- Errors are unexplainable ("the model said so")
- Changes have unknown blast radius
- Nothing persists reliably between sessions

Graph's structural causality directly addresses all three.

---

## PART 9: VALUE FOR ORDINARY PEOPLE (NOT JUST COMPANIES)

### Companies (clear): Reduce labor cost via accountability

LLM does heavy lifting, humans approve. Need: audit trail, compliance, accountability. Graph's `describe()` + causal chain is natural fit.

### Ordinary people (less obvious): Protect attention via empowerment

The shared pain: exponentially growing information, FOMO about missing something important, insufficient energy to process it all. People need a **universal reduction engine** that filters and prioritizes.

**Concrete scenarios:**

1. **Personal knowledge management (second brain):** Notes change -> auto-discover contradictions -> proactive alerts. Not pull-based Q&A, but reactive push.

2. **Personal finance/health monitoring:** Bank transactions + diet + exercise -> derived health/budget trends -> proactive suggestions. Currently siloed across 10 apps.

3. **Small business/freelancer automation:** Customer inquiry -> check inventory -> generate quote -> await confirmation -> send. Long-running reactive flow, currently manual or requires technical skill (Zapier/n8n).

4. **Adaptive learning:** Student path = reactive graph. Correct -> unlock next. Wrong -> back to prerequisites. LLM nodes for semantic judgment.

### Key difference from company scenarios

| Company | Individual |
|---------|-----------|
| LLM replaces human labor | LLM empowers human capability |
| Audit/compliance driven | Understanding/trust driven |
| Human approves LLM output | Human adjusts LLM behavior |
| Graph is infrastructure (invisible) | **Graph must be visible and understandable** |

The last row is critical: if ordinary people can't understand what the graph is doing, it's useless to them.

---

## PART 10: THREE-LAYER DX/UX STRATEGY

### Layer 1: LLM-DX (LLM developer experience)

- GraphSpec JSON schema must be simple enough for high first-pass success rate
- Error messages must be structured, actionable, LLM-self-debuggable
- compose/validate/diff tooling

### Layer 2: Dev-DX (Engineer developer experience)

- 5-minute setup: `npm install` -> 3 lines -> visible result
- Zero-concept start: `state()` + `derived()` + `effect()` as intuitive as React hooks
- Progressive complexity: internals (DIRTY, RESOLVED, bitmask) only surface when debugging/optimizing

### Layer 3: End-user UX

- Natural language -> Graph: "When I get Amazon emails, extract amount, add to monthly spending, alert me over 5000"
- Simplified flow view: IFTTT/Shortcuts-style linear display even when underlying structure is a graph
- Audience-adaptive rendering:
  - Engineers: topology diagram + code
  - Ordinary people: simplified flow + natural language descriptions
  - LLMs: GraphSpec JSON

**Layer 3 is the real moat.** Anyone can build a reactive graph library. "Ordinary person describes need in natural language -> LLM composes graph -> user reviews flow view -> graph runs persistently and auditably" — nobody is doing this end-to-end.

---

## PART 11: END-TO-END DEMO DESIGN

### Demo 0: "NL -> Graph -> Flow -> Run -> Persist" (The Existential Demo)

This demo proves GraphReFly's reason to exist. It must show the complete cycle that no other tool provides.

**Scenario:** Personal email triage assistant

**Flow:**
1. User types: "Watch my Gmail. Urgent emails from my team go to a priority list. Newsletter-type emails get summarized weekly. Everything else, just count by sender."
2. LLM composes a GraphSpec from this description
3. User sees a simplified flow view (not raw graph — IFTTT-style)
4. User tweaks: "Actually, also flag anything mentioning 'deadline'"
5. LLM generates a GraphSpec diff, user reviews
6. Graph runs, processes incoming emails reactively
7. User closes app, reopens -> graph resumes exactly where it left off (auto-checkpoint)
8. User asks: "Why was this email marked urgent?" -> system walks causal chain

**What this exercises:**
- `graphFromSpec()` / `llmCompose()` (5.4 / 8.3) — NL to graph
- `describe()` -> simplified flow rendering — graph to human-readable
- `llmRefine()` (8.3) — iterative graph modification
- `specDiff()` (8.3) — structural diff for review
- `autoCheckpoint()` (1.4b) — persist and resume
- `explainPath()` (8.4) — causal chain explanation
- `fromWebhook()` / `fromIMAPPoll()` — real data source
- `stratify()` + `scorer()` (8.1) — reduction primitives

**Acceptance criteria:**
1. NL input produces valid, runnable GraphSpec on first attempt (>80% of reasonable descriptions)
2. Flow view is understandable by non-technical user (no graph jargon, no node IDs)
3. Modification via NL produces correct diff (no unrelated changes)
4. App restart restores full graph state including in-flight processing
5. Causal explanation is human-readable ("This email was marked urgent because sender 'alice@team.com' matches your team rule AND subject contains 'deadline'")
6. End-to-end latency from email arrival to classification < 2s (excluding LLM inference)
7. Graph topology visible in dev tools for engineers (parallel to simplified flow for end users)
8. Works with zero configuration beyond Gmail OAuth + LLM API key

---

## PART 12: SCHEMA MINIMALITY — DO WE NEED LORA/SFT?

### Current describe() schema (Appendix B)

```json
{
  "name": "string",
  "nodes": {
    "<name>": {
      "type": "state|derived|producer|operator|effect",
      "status": "disconnected|dirty|settled|resolved|completed|errored",
      "value": "<any>",
      "deps": ["<name>", ...],
      "meta": { "<key>": "<any>" }
    }
  },
  "edges": [{ "from": "<name>", "to": "<name>" }],
  "subgraphs": ["<name>"]
}
```

### Assessment: Is this minimal enough for zero-shot LLM composition?

**Yes, for `describe()` output.** Five fields per node, flat structure, no nesting beyond meta. Any LLM can read this.

**GraphSpec (input format) doesn't exist yet.** It needs to be even simpler than `describe()` output because LLMs are *generating* it, not just reading it.

### Proposed minimal GraphSpec for LLM composition

```json
{
  "nodes": {
    "inbox": { "type": "producer", "source": "gmail", "config": { "filter": "is:unread" } },
    "classify": { "type": "derived", "deps": ["inbox"], "fn": "llm:classify-urgency" },
    "urgent": { "type": "effect", "deps": ["classify"], "fn": "notify", "config": { "channel": "push" } }
  }
}
```

Key design choices:
- **No edges array** — edges are implicit in `deps` (redundant for LLM generation; can be computed)
- **`fn` is a string reference**, not code — LLM picks from a catalog of available functions
- **`source` for producers, `fn` for derived/effect** — clear role distinction
- **`config` is the only freeform field** — everything else is structural

### Do we need LoRA / SFT?

**No, if the schema is simple enough.** Evidence:

1. **JSON Schema + few-shot examples** is sufficient for current frontier models (GPT-4o, Claude, Gemini) to generate valid structured output with >90% accuracy.

2. **Function calling / structured output** is a native capability — models are already trained to produce JSON conforming to a schema.

3. **The schema above has ~5 fields per node.** Compare to function calling schemas that models handle routinely — those often have 10+ parameters with complex nesting.

4. **LoRA/SFT would lock you to specific model versions.** Every model update requires retraining. The schema approach works across all models and improves automatically as models improve.

**When LoRA/SFT would become necessary:**
- If the schema grows to 20+ fields with complex validation rules
- If domain-specific operator selection requires knowledge not in training data
- If you need to run on very small models (< 7B params) where zero-shot structured output is unreliable

**Recommendation:** Keep the schema simple enough that zero-shot works. Invest in validation + error messages, not fine-tuning. If the schema needs fine-tuning to work, the schema is too complex.

**The litmus test:** If a junior developer can write a valid GraphSpec by hand after reading a 1-page guide, an LLM can generate one zero-shot. If the spec requires a tutorial, simplify the spec.

---

## KEY INSIGHTS

1. **GraphReFly is not over-engineered — it's optimized for a specific bet.** The bet: long-running human+LLM reactive co-operation will become the dominant software pattern. If yes, GraphReFly is the minimal solution. If no, any reactive library is unnecessary.

2. **The irreducible core is five things:** node, edge, propagation, describe/snapshot, GraphSpec. Remove any one and at least one of the four requirements (LLM-safe creation, human audit, security, human/LLM symmetry) fails.

3. **Graph > functions for LLM composition because it constrains error space.** Like SQL constraining database operations, GraphSpec constrains system composition to structural operations. LLMs make fewer mistakes in constrained systems.

4. **Causal chain persistence is the killer argument.** Not reactivity, not performance, not glitch-free. Structural causality that persists and auto-invalidates is what enables progressive trust accumulation — the antidote to vibe coding.

5. **The existential demo must prove NL -> Graph -> Flow -> Run -> Persist end-to-end.** This is the capability no other tool provides. If this works, the library justifies itself. If not, nothing else matters.

6. **Three-layer DX/UX (LLM-DX, Dev-DX, End-user UX) is not polish — it's the product.** Callbag died from DX neglect. The protocol is necessary but not sufficient.

7. **No LoRA/SFT needed if the schema stays simple.** The litmus test: if a junior dev can write it by hand from a 1-page guide, an LLM can generate it zero-shot.

8. **The real moat is Layer 3 (End-user UX).** Anyone can build a reactive graph library. "Natural language -> graph -> simplified flow view -> persistent reactive execution" is the full stack nobody else is building.

9. **Position as pain-point solver, not architecture seller.** HN feedback confirms: "sounds like a good idea but I'm not sure I fully understand what the solution is." Lead with the problem (information overload, FOMO, attention protection), not the protocol.

10. **For ordinary people:** The value is the same as for companies but framed differently — not "reduce labor cost" but "protect your attention and energy for the hard problems only you can solve."

---

## HN FEEDBACK (April 2026)

Thread: https://news.ycombinator.com/item?id=47636642

Two comments:
1. **ryebread777:** "Sounds like a good idea but I'm not sure I fully understand what the solution is. Also, the landing page is almost unreadable on my phone."
2. **clfhhc (author):** Clarified as "reactive state library (like Zustand/Jotai) + streaming operators (like RxJS) + graph introspection, zero-dep, for AI agent workflows."

**Key takeaway:** The comparison to known libraries (Zustand, RxJS) was clearer than the landing page. But even this framing is architecture-first. The relaunch should lead with user pain points, not library comparisons.

---

## DECISIONS

1. **Confirm the bet:** Long-running human+LLM reactive co-operation is the target. All positioning, demos, and DX orient around this.

2. **Design Demo 0 ("The Existential Demo"):** NL -> GraphSpec -> flow view -> run -> persist -> explain. This demo is the #1 priority because it proves the library's reason to exist.

3. **Redesign public presence:** Lead with pain points (information overload, FOMO, attention fatigue, vibe-coding fragility), not architecture (two-phase push, diamond resolution, message protocol).

4. **Keep GraphSpec simple enough for zero-shot.** No LoRA/SFT. If models can't generate it zero-shot, simplify the schema.

5. **Separate session to design DX/UX benchmarks** — quantify LLM composition accuracy, dev onboarding time, end-user comprehension.

---

## RELATED SESSIONS

- `SESSION-universal-reduction-layer.md` — the "massive info -> actionable items" thesis
- `SESSION-agentic-memory-research.md` — reactive memory uniqueness analysis
- `SESSION-snapshot-hydration-design.md` — persistence foundation for the demo
- `SESSION-marketing-promotion-strategy.md` — current positioning (to be revised based on this session)
- `SESSION-demo-test-strategy.md` — existing demo plan (Demo 0 inserts before Demo 1)

## FILES CHANGED

- This file created: `archive/docs/SESSION-first-principles-audit.md`
- Updated: `archive/docs/DESIGN-ARCHIVE-INDEX.md` (new entry)
- Updated: `docs/roadmap.md` (Demo 0 added to Phase 7.3; Phase 3.3b progressive disclosure for describe/observe)

---END SESSION---
