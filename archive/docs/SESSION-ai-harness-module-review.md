# Session — AI / Harness Module 24-Unit Review

**Date started:** 2026-04-23
**Scope:** `src/patterns/ai/` (~3,778 LOC in one file + 31 adapter files) and `src/patterns/harness/` (9 files, ~2,111 LOC), with `refine-loop/`, `graphspec/`, and `surface/` as Wave C adjacents.
**Format:** Per-unit walkthrough in the same shape as `SESSION-graph-module-24-unit-review.md` (implementation / ecosystem counterparts / alternatives / open items / pros-cons / stress scenarios) **plus a mandatory "Topology check" dimension per unit — see §"Explainability criterion" below.**
**Precedent:** `SESSION-graph-module-24-unit-review.md` (2026-04-16) for format; `SESSION-extras-wave1-audit.md` for prior wave.

---

## Why this review

Four drivers (resolved in this order during planning):

1. **User unfamiliarity with current ai/harness structure** — the `src/patterns/ai/index.ts` file has grown to ~3,778 LOC covering 12 distinct subsystems. Cross-references inside one file make invariant-auditing almost impossible.
2. **Drift from design invariants since the extras + graph reviews** — user flagged "monkey patch and composite" anti-patterns. Grep baseline: 27 `new Promise` / `AbortController` / `setTimeout` occurrences inside `patterns/ai/index.ts`; `harness/strategy.ts` exposes mutable `_map` through closure (cross-cutting mutation); P3 `.cache`-in-fn audit hasn't had a re-pass against the 3,778-LOC surface.
3. **The pagerduty-demo problem** — disconnected nodes in `describe()` ("decisions/log not linked to any other nodes", "tokens only by itself") are the visible symptom of imperative writes and closure-held state that bypass the reactive edge graph. **Explainability is only as good as the auto-generated edges.** If the topology shows islands, the primitive has leaked.
4. **Alignment against eventual vision** — the 6 building blocks in `~/src/graphrefly_github/profile/README.md` (`agentMemory`, `harnessLoop`, `guardedExecution`, `resilientPipeline`, `graphLens`, `Graph.attachStorage`) are the public face; the audit verifies each block's internals actually compose cleanly from reactive primitives. Blocks themselves are open for reshape.

---

## Explainability criterion (applies to every unit)

Borrowed from the pagerduty-demo feedback. For every primitive under review, before writing findings:

1. **Wire a minimal composition** that exercises the primitive with ≥2 upstream sources and ≥1 downstream sink.
2. **Run `graph.describe({ format: "ascii" })` and `graph.describe({ format: "mermaid" })`** on the resulting subgraph.
3. **Check for islands / self-only nodes.** A node with zero in-edges AND zero out-edges (and that isn't the designated entry/exit) is a smell. A node where the deps shown in describe do NOT match the dataflow you'd draw by hand is a bigger smell.
4. **Run `graph.explain(source, sink)`** across the primitive. The causal chain should name every node the data flowed through. Gaps in the chain indicate imperative writes or closure-held state.
5. **Record the topology check result** in the unit write-up: either "clean — all nodes linked, explain walks cleanly" or "islands: X / Y / Z — proposed fix: …".

When the topology check fails, the fix is ALWAYS one of:
- Convert imperative `.emit()` / `statusNode.set()` calls inside effect bodies into proper `derived([...], fn)` edges.
- Replace closure-captured mutable state with a registered `state()` node.
- Remove `.cache` reads from reactive fn bodies (COMPOSITION-GUIDE §28 factory-time seed).
- Move source-boundary work (Promise / AbortController / async iterator) into `fromAny` / `fromPromise` / `fromAsyncIter` sources at the edge, not inside domain fns.
- For "it works but describe is ugly" cases, add proper `meta.kind` + `domainMeta(…)` so the diagram groups correctly.

---

## Unit ordering

### Wave 0 — Structural split (prerequisite)

`patterns/ai/index.ts` is carved into a folder-shape first, analogous to the `patterns/ai/adapters/` layout. Rationale: auditing a 3,778-LOC file unit-by-unit wastes effort on navigation. The split is a codemod pass (same shape as the messaging → messaging+job-queue split landed 2026-04-22) that lets Wave A reviews reference file paths instead of line ranges.

**Proposed carve-out (open for refinement at Unit 0):**

```
src/patterns/ai/
├── index.ts                        — thin public barrel
├── node.ts                         — existing Node-only re-exports
├── browser.ts                      — existing browser-only re-exports
├── adapters/                       — already folder-shaped, untouched
├── prompts/
│   ├── prompt-node.ts              — promptNode, firstDataFromNode
│   ├── streaming.ts                — streamingPromptNode, StreamChunk, gatedStream
│   └── extractors.ts               — streamExtractor + keyword/toolCall/costMeter
├── agents/
│   ├── agent-loop.ts               — agentLoop + interceptToolCalls splice
│   ├── handoff.ts                  — handoff + toolSelector
│   └── tool-registry.ts            — ToolRegistry
├── memory/
│   ├── agent-memory.ts             — AgentMemory, retrieveFn, retrieveReactive
│   └── extractors.ts               — llmExtractor, llmConsolidator
└── context/
    └── frozen-context.ts           — frozenContext
```

Wave 0 deliverables:
- [ ] **Unit 0:** dry-run the split (filesystem layout + import rewrites). Confirm symbols and dependencies. No behavior change.
- [ ] Codemod to move files and rewrite in-tree imports (TS AST, archived to TRASH/ per precedent).
- [ ] `package.json` exports updated (if new subpaths surface).
- [ ] `tsup.config.ts` `ENTRY_POINTS` + `assertBrowserSafeBundles` allow-list verified.
- [ ] All 2037+ tests pass after move; lint + build green.

### Wave A — AI primitives audit (Units 1–14)

| Wave | Units | Topic |
|---|---|---|
| A.1 | 1–3 | Prompts (`promptNode`, `streamingPromptNode`, stream extractors, `gatedStream`) |
| A.2 | 4–6 | Agents (`agentLoop` + `interceptToolCalls`, `handoff`+`toolSelector`, `ToolRegistry`) |
| A.3 | 7–9 | Memory (`agentMemory` orchestration, primitive collections, `llmExtractor`/`llmConsolidator`/`retrieveFn`) |
| A.4 | 10–13 | Adapters (core, middleware, providers, routing) |
| A.5 | 14 | `frozenContext` + cross-cutting findings consolidation |

### Wave B — Harness composition audit (Units 15–22)

| Wave | Units | Topic |
|---|---|---|
| B.1 | 15–16 | Types + TRIAGE / QUEUE stages |
| B.2 | 17–18 | GATE / EXECUTE / VERIFY / REFLECT stages + fast-retry |
| B.3 | 19–20 | `strategy.ts` + `bridge.ts` |
| B.4 | 21–22 | `refine-executor.ts` + `eval-verifier.ts`, `trace.ts` + `profile.ts` |

### Wave C — Adjacent surfaces (Units 23–24)

| Wave | Units | Topic |
|---|---|---|
| C | 23–24 | `refine-loop/index.ts`, `graphspec/index.ts` + `surface/` |

---

## Eventual vision — the frame this review validates against

Ring 1 — Substrate (shipped): reactive state coherence · `graph.explain` causal tracing · reduction layer (`funnel`/`feedback`/`budgetGate`/`scorer`) · multi-tier `attachStorage` + codec envelope.

Ring 2 — Harness composition (scope of this review): 7-stage loop INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT · `promptNode` as universal LLM action · `gate.modify()` as the ONLY structured human-judgment input · strategy model (`rootCause × intervention → successRate`) · `agentMemory` (distill + vector + KG + decay + tiers) · `refineLoop` as EXECUTE inner loop · stream extractors as universal taps.

Ring 3 — Distribution: `surface/` → MCP + CLI · Vercel AI SDK middleware · LangGraph tools · template repos · scorecard + demos.

**Lock-in vectors (per LangChain rebuttal):** memory (reactive + decay + consolidation, not just "your bytes exportable") · topology (the 7-stage loop as organizational knowledge) · explainability (causal chain as compliance artifact). All three live in ai/harness.

**Strategic metric (per 2026-04-20 pivot):** composition success rate. Current 87% first-pass, target >95%. Everything else is derivative.

**The 6 proposed building blocks (review can reshape):**
`agentMemory()` · `harnessLoop()` · `guardedExecution()` · `resilientPipeline()` · `graphLens()` · `Graph.attachStorage()`.

---

## Current state (where we are, honest)

**Shipped in scope:**
- Wave 0 harness primitives (`gate`, `promptNode`, `streamingPromptNode`, stream extractors, `valve`/`stratify`/`forEach` moved to extra or renamed)
- §9.0b mid-level blocks (`graphLens`, `resilientPipeline`, `guardedExecution`)
- §9.2 audit/accountability (`explainPath`, `auditTrail`, `policyEnforcer`, `complianceSnapshot`, `reactiveExplainPath`)
- §9.3 MCP server core + CLI (`surface/` layer)
- §9.3d LLM Adapter Layer (adapters/core + middleware + providers + routing + presets)
- §9.8 `refineLoop` v1 (4-topic static topology, `blindVariation` + `errorCritique` strategies)
- Inspection consolidation (9 tools final), browser/node/universal split enforced
- `Graph.attachStorage` + codec envelope v1

**Explicitly open (from `docs/optimizations.md`):**
- switchMap-inner teardown hardening for `refineExecutor` / `evalVerifier`
- `executeAndVerify` unified slot escape hatch
- Harness executor/verifier dev-mode assertion (≤1 DATA per input wave)
- `refineLoop.setSeed` / `reset` persistent re-seed for cross-item learning
- Domain-level `for/await` in strategies — TopicGraph+cursor alternative investigation
- EXECUTE actuators + VERIFY re-eval (closing the dogfood loop)
- `autoSolidify` (VERIFY success → catalog entry promotion) proposed
- Strategy model thread-safety for PY

**Drift suspicions (to validate per-unit):**
- `ai/index.ts` at 3,778 LOC
- 27 raw-async occurrences in `ai/index.ts`
- `harness/strategy.ts` mutable-`_map`-through-closure pattern
- `agentLoop._currentAbortController` + `statusNode.emit()` inside effect bodies
- P3 `.cache`-in-fn re-pass needed over 3,778 LOC
- Hardcoded message-type checks not yet scrubbed against `messageTier` utility

---

## Decisions log (running)

Appended as we work. Entries sized roughly: `YYYY-MM-DD | unit | decision`.

- 2026-04-23 | planning | Wave 0 split agreed. Codemod before Unit 1.
- 2026-04-23 | planning | Explainability criterion added as mandatory per-unit check.
- 2026-04-23 | planning | The 6 README building blocks are open for reshape during this review.

---

## Wave 0 — Structural split (pending)

_To be filled during Unit 0 execution._

### Unit 0 — AI folder carve-out

- **Current shape:** 3,778-LOC single file
- **Proposed shape:** see tree above
- **Open questions for this unit:**
  - Does `handoff` belong under `agents/` or `prompts/`? (It's a thin sugar over `switchMap` + adapter selection — no agent loop.)
  - Does `frozenContext` deserve its own folder or belong in `prompts/`?
  - Are there private helpers (`firstDataFromNode`, `extractStoreMap`, `canonicalJson`, etc.) that should hoist to a shared `ai/_internal.ts`?
  - Memory collections are re-exports from `patterns/memory/` — confirm no duplicated impl.

---

## Wave A — AI primitives audit (pending)

_To be filled unit-by-unit. Each unit gets the full structure:_

> **Unit N — `name`**
>
> **Implementation:** _what it does, line refs_
>
> **Topology check:** _minimal composition + describe output + verdict_
>
> **Ecosystem counterparts:** _RxJS / callbag / LangGraph / DSPy analogues_
>
> **Alternatives considered (A/B/C…):** _design alternatives + rejections_
>
> **Open items:** _linked to optimizations.md entries_
>
> **Pros / cons:** _what's good, what's lurking_
>
> **Stress scenarios:** _what breaks this_
>
> **Decision / batch:** _what we land, what we defer_

---

## Wave B — Harness composition audit (pending)

_Same structure. Fold findings that cross Wave A/B boundaries here with back-refs._

---

## Wave C — Adjacent surfaces (pending)

---

## Open design questions (running — will close or move to optimizations.md)

1. **6-blocks proposal — does it survive review?** Concrete sub-questions:
   - Does `harnessLoop()` stay one block or split into "loop topology" + "strategy model as a separate composable"?
   - Does `resilientPipeline()` belong in `patterns/ai/` or `patterns/resilient-pipeline/` only? (Today it's the latter.)
   - Is `Graph.attachStorage()` a "block" (the README says yes) or a core Graph method? (It's the latter — README wording may need trim.)
2. **Topology check as a shipped utility?** If every primitive's review produces a "minimal composition" that verifies islands-free topology, should this become a `validateNoIslands(graph)` helper exported for user use? (Candidate companion to `validateGraphObservability`.)
3. **`agentLoop` imperative-ish coordination** — the `interceptToolCalls` splice (shipped 2026-04-22) proved the reactive shape for tool calls. Should the rest of `agentLoop` (status transitions, cancel signal) move to the same splice pattern?

---

## Related files

- `src/patterns/ai/index.ts` (to split in Unit 0)
- `src/patterns/ai/adapters/` (already folder-shaped)
- `src/patterns/harness/` (9 files — types, loop, strategy, bridge, trace, profile, refine-executor, eval-verifier)
- `src/patterns/refine-loop/index.ts` (Wave C)
- `src/patterns/graphspec/index.ts` (Wave C)
- `src/patterns/surface/` (Wave C)
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §5.8–5.12 (design invariants)
- `~/src/graphrefly/COMPOSITION-GUIDE.md` §7, §28, §32 (feedback cycles, factory-time seed, nested-drain state-mirror)
- `~/src/graphrefly_github/profile/README.md` (6-blocks proposal)
- `archive/docs/SESSION-graph-module-24-unit-review.md` (format precedent)
- `archive/docs/SESSION-harness-engineering-strategy.md` (positioning)
- `archive/docs/SESSION-reactive-collaboration-harness.md` (7-stage loop design source)
- `archive/docs/SESSION-strategy-roadmap-demo-reprioritization.md` (strategic pivot)
- `archive/docs/SESSION-mid-level-harness-blocks.md` (mid-level blocks design)
- `archive/docs/SESSION-competitive-landscape-self-evolution.md` (6-blocks origin)
- `docs/optimizations.md` (open work items in scope)
- `docs/roadmap.md` §9.0, §9.0b, §9.2, §9.3, §9.3d, §9.8 (active work)

---

## Outcome / status

- **2026-04-23:** planning complete, session log created. Wave 0 scoped (ai/index.ts split). Waves A+B+C unit ordering locked.
- _To be updated as each wave closes._
