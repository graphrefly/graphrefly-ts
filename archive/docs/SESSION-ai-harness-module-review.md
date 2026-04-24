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

## Per-unit review format (used across Waves A/B/C)

**Revised 2026-04-23.** Every unit in every wave answers these nine questions. Topology check + perf/memory are folded into Q7.

1. **Semantics, purpose, implementation** — what does it do, with file+line refs.
2. **Semantically correct?** — edge cases, subtle bugs, latent issues.
3. **Design-invariant violations?** — check against COMPOSITION-GUIDE (§1–§32) + spec §5.8–5.12. Flag drift explicitly (🔴 violation / 🟡 gray-zone / 🟢 clean).
4. **Open items** — link to `docs/roadmap.md` + `docs/optimizations.md` entries; surface new candidates.
5. **Right abstraction? More generic possible?** — is this at the right level; does it deserve factoring into smaller primitives; is there a more universal shape.
6. **Right long-term solution? Caveats / special cases / maintenance burden?** — what will hurt 6 months from now; what special cases increase the cognitive load of future readers.
7. **Simplify / reactive / composable + topology check + performance & memory footprint.**
    - Propose a simpler shape if there is one (not binding — a sketch).
    - Run a minimal composition through the primitive and report the `describe()` output. Check for islands, missing edges, closure reads, imperative side-effects that invalidate explainability.
    - Perf: per-call/per-wave cost. Hot-path allocations. Memory: retained state, unbounded growth risks, cache-hit characteristics.
8. **Alternative implementations (A/B/C…)** — named alternatives with pros/cons.
9. **Recommendation** — which alternative, and does it cover every concern in Q2–Q6? Include a coverage table.

**Locking a unit:** each unit ends with a "Decisions locked (date)" block that captures user decisions on the open questions + the implementation-session scope.

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
| B.2 | 17–18 | GATE / EXECUTE / VERIFY / REFLECT stages + fast-retry — **includes `gate()` primitive + `gatedStream` consolidation** (deferred from Unit 2 per 2026-04-23 decision) |
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
- 2026-04-24 | Unit 23 | refineLoop: Option B — hub + derived event nodes + bridges. 4 standalone TopicGraphs → one `messagingHub("stages")`. Each stage effect splits into: (1) derived computes event (reactive edge), (2) topicBridge derived→hub topic, (3) slimmed effect retains state-mirror only. §32 batch ordering preserved in decideEffect. Breaking: `generateTopic`/`evaluateTopic`/`analyzeTopic`/`decideTopic` → `hub.topic(...)` accessors. Pre-1.0, no shim.
- 2026-04-24 | Unit 24 | C24-8 (high): `graphFromSpec` → `compileSpec` instead of `Graph.fromSnapshot`. Gains validation + template expansion + feedback wiring.
- 2026-04-24 | Unit 24 | C24-1 (medium): `compileSpec` `opts.onMissing: "error" | "warn" | "placeholder"` (default "placeholder"). Surfaces missing catalog entries explicitly.
- 2026-04-24 | Unit 24 | C24-7 (medium): reactive `graphFromSpecReactive` + `suggestStrategyReactive` alongside imperative versions. Unit 14 commitment.
- 2026-04-24 | Unit 24 | C24-2/3/4 + C23-2 (low): JSDoc + inline comments only. Land with whichever implementation session touches the file.
- 2026-04-24 | Wave C hub audit | Hub model applies only to TopicGraph-publish-in-effects pattern. Wave A + B hub scope unchanged. No new hub candidates found in Wave A or B. All other imperative-publish patterns are §32 sanctioned, call-boundary instrumentation, or terminal side-effects.

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

## Wave A — AI primitives audit

### Review format per unit (revised 2026-04-23 per user direction)

Each unit answers nine questions. Topology check + perf/memory folded into Q7.

1. Semantics, purpose, implementation (line refs)
2. Semantically correct?
3. Design-invariant violations? (COMPOSITION-GUIDE + spec §5.8–5.12)
4. Open items (roadmap.md / optimizations.md)
5. Right abstraction? More generic possible?
6. Right long-term solution? Caveats / special cases / maintenance burden?
7. Simplify / reactive / composable + topology check (describe/explain) + **performance & memory footprint** (added 2026-04-23)
8. Alternative implementations (A/B/C…) with pros/cons
9. Recommendation — does it cover the concerns in Q2–Q6?

---

### Unit 1 — `promptNode` + `firstDataFromNode`

**Scope:** [src/patterns/ai/prompts/prompt-node.ts](../../src/patterns/ai/prompts/prompt-node.ts) (130 LOC), [firstDataFromNode](../../src/patterns/ai/_internal.ts) in `_internal.ts:46–86`.

#### Q1 — Semantics, purpose, implementation

- **`promptNode(adapter, deps, prompt, opts)`** — universal LLM transform as a reactive derived node. Re-invokes the adapter whenever any dep changes. Returns `Node<T | null>` where `null` is the "input not ready" sentinel.
- Internal shape: `messagesNode = derived(deps, buildMessages, { initial: [] })` → `switchMap(messagesNode, invokeFn)` where `invokeFn` returns a per-wave NodeInput<T|null>.
- **Dep-level null guard** ([prompt-node.ts:67](../../src/patterns/ai/prompts/prompt-node.ts:67)): any nullish dep → `[]` messages → inner `switchMap` emits `state(null)`.
- **Format:** `"text"` (raw content) or `"json"` (runs `stripFences` then `JSON.parse`).
- **Retries:** recursive `attempt(remaining)` — pure Promise recursion on thrown error.
- **Cache:** optional `Map<string, T>` keyed on `JSON.stringify(msgs.map(m => [role, content]))`. Closure-held, unbounded.
- **LLM invocation** ([prompt-node.ts:94–109](../../src/patterns/ai/prompts/prompt-node.ts:94)): `adapter.invoke(msgs, opts)` returns `NodeInput<LLMResponse>` — the code manually `new Promise`s the result, branching on Promise / Node / raw-value shape, with the Node branch reading `.cache` eagerly.
- **System prompt** double-path: pushed as a `{role:"system"}` message AND forwarded via `opts.systemPrompt` to `adapter.invoke`.
- **`firstDataFromNode(node, {timeoutMs=30_000})`** — boundary utility that resolves a `Promise<unknown>` on first DATA/ERROR/COMPLETE from a Node. Short-circuits via `.cache` when `status === "settled"`. Used by `resolveToolHandlerResult` (tool-registry, suggest-strategy, graph-from-spec).

#### Q2 — Semantically correct?

- ✅ Dep-level null guard (loose `!= null`) matches COMPOSITION-GUIDE §3 + §8.
- ✅ `initial: []` on messagesNode correctly drives `switchMap` to emit `null` while deps are SENTINEL; regression-protected by the sole in-tree test ([phase5-llm-composition.test.ts:277](../../src/__tests__/phase5-llm-composition.test.ts:277)).
- ✅ `firstDataFromNode`'s `status === "settled"` short-circuit matches guide §28 "external-observer boundary read" sanctioning.
- ⚠️ **System-prompt double-send** (line 71 AND line 99). Most providers accept either shape, but adapters that normalize both will duplicate the system message. Anthropic maps both `systemPrompt` and `{role:"system"}` into the final `system` field — the content array ends up with two entries. Silent bug under the right adapter.
- ⚠️ **Node-shaped `invoke()` return is stale** (line 104–106). If an adapter returns a `Node<LLMResponse>` that hasn't settled yet, the code resolves with `.cache` which may be `undefined` — then `extractContent(undefined)` returns `"undefined"` and downstream JSON parse explodes. No shipped adapter triggers this, but the type signature (`NodeInput<LLMResponse>`) permits it.
- ⚠️ **Cache key fragility** ([prompt-node.ts:87](../../src/patterns/ai/prompts/prompt-node.ts:87)): only `role` + `content` are hashed. Tool-call context, `opts.model`, `opts.temperature`, image content inside messages are all ignored — cache collisions cross-model / cross-temperature. This is a subset of the canonical-key work already done for `withReplayCache` ([middleware/replay-cache.ts](../../src/patterns/ai/adapters/middleware/replay-cache.ts)) — not reused here.
- ⚠️ **`retries` re-implemented** (lines 92–123). Existing `withRetry` middleware ([middleware/retry.ts](../../src/patterns/ai/adapters/middleware/retry.ts)) already handles this — users stacking both get multiplicative retries.

#### Q3 — Design-invariant violations?

- 🔴 **Spec §5.10 raw-async** — `new Promise<LLMResponse>((resolve, reject) => ...)` at [prompt-node.ts:94](../../src/patterns/ai/prompts/prompt-node.ts:94) is a bare Promise constructor inside a reactive fn body. `switchMap` already accepts a `NodeInput<T>` (which itself accepts Promise, Node, or raw), so the correct shape is `return fromAny(adapter.invoke(msgs, opts))` — no Promise construction. The dual-shape resolution is exactly what `fromAny` is for.
- 🔴 **COMPOSITION-GUIDE §24 + P3 cross-node `.cache`** — Node-branch `resolve((input as Node).cache as LLMResponse)` at line 105 reads a cross-node cache inside a reactive fn. If the returned Node is unsettled this is also stale; either way, it's the sanctioned case only at the factory boundary, not inside a switchMap fn body.
- 🟡 **§5.11 central timer** — `firstDataFromNode` uses `ResettableTimer` ✅ (central-timer compliant), but the surrounding `new Promise` + `subscribe` is itself a boundary bridge. Sanctioned as boundary, called out only because every additional boundary utility raises the cost of the reactive-describe ceiling — users can't `explain(dep, promptResult)` through `firstDataFromNode`.
- 🟡 **Explainability gap (pagerduty-demo class)** — the adapter call is invisible to `describe()` / `explain()`. Users cannot ask the graph "which model produced this output, how many tokens, what latency." The LLM invocation does not participate in the reactive edge graph — §24 ("edges are derived from `_deps`") means the adapter-call "edge" simply does not exist.

#### Q4 — Open items (roadmap / optimizations.md)

- [optimizations.md "`fallbackAdapter` + `withReplayCache` directory commingling"](../../docs/optimizations.md) — shared key-computation logic between fallback and replay caches uses `canonicalJson` (duplicated once already, flagged for dedupe). A shared canonical key utility would retire `promptNode`'s inferior `JSON.stringify(msgs.map(…))`.
- [optimizations.md "Developer-defined cache key generator"](../../docs/optimizations.md) — `withReplayCache`/`fallbackAdapter` now accept `keyFn(ctx)` for custom sharding. `promptNode`'s `cache: true` lacks this extensibility.
- roadmap §9.0 "promptNode as universal LLM action" — single-shot promptNode is shipped; streaming variant (Unit 2) is shipped; structured-output `format` is text/json only.
- **Not in optimizations.md yet (candidates for this review):**
  - `new Promise` shape vs `fromAny` in the switchMap body (§5.10).
  - `systemPrompt` double-send.
  - Replace in-built `cache`/`retries` options with middleware stacking guidance.
  - Surface the adapter invocation as a real node (explainability).

#### Q5 — Right abstraction? More generic possible?

- **Purpose is right.** "One reactive node per LLM call; deps feed the prompt; re-invokes on dep change" is the canonical harness action — every stage of the 7-stage loop uses this shape. The fact that `promptNode` is used across `agentLoop`, `handoff`, `toolSelector`, and (via docs) every harness example validates this.
- **Scope creep.** `promptNode` today owns: prompt building, dep guarding, LLM invocation, response extraction, format parsing, retries, in-memory caching. That's six responsibilities. Each except prompt building + dep guarding has a better home elsewhere:
  - Retries → `withRetry` middleware on the adapter (already exists).
  - Caching → `withReplayCache` middleware (already exists).
  - Format parsing → a post-promptNode extractor (composable per stream-extractor pattern already in `extractors/`).
  - Response extraction → adapter's `LLMResponse.content` is already `string`; the fallback `extractContent` is defensive-only.
- **"More generic"** — prompts are a specific case of "derive an LLM request from deps." A truly generic primitive would be `actionNode(adapter, deps, buildRequest, invoke)` — with `promptNode` as the text-prompt special case. Premature today; revisit when a non-text-prompt action (embed, tool-only, structured-output) shows demand. Not recommending yet.
- **`firstDataFromNode`** is a boundary helper — can't become more generic without becoming `awaitNode`, which already exists spiritually as `firstValueFrom` in many reactive libs. Name is fine. Scope is fine. **But see §14 of COMPOSITION-GUIDE (PY deadlock)** — TS is safe today; long-term the reactive-composition-only path (no `firstDataFromNode` at all, let callers subscribe) is cleaner.

#### Q6 — Right long-term solution? Caveats / maintenance burden

- **Long-term shape is close, but the switchMap body needs a haircut.** The `new Promise` + dual-shape branching + `.cache` read + manual retry loop is 35 LOC of procedural glue inside the reactive fn. This is the single biggest maintenance burden in `patterns/ai/prompts/`: every adapter author who returns something new (Node-shaped, AsyncIterable, batched) re-surfaces a special case here. The canonical bridge is `fromAny` — 1 LOC.
- **Caveats (kept-as-is):**
  - Unbounded cache Map — no TTL, no LRU, no eviction. Long-running processes leak until restart. Today nobody hits this because `cache: true` is rare, but documenting this is a debt.
  - `format: "json"` swallows parse errors into ERROR on the node; callers who want "retry-on-invalid-JSON" need to wrap their own. OK for v1.
  - `systemPrompt` double-send.
  - `retries` and `cache` duplicate middleware that already exists.
- **Special cases that will increase maintenance burden:**
  - Node-branch in invoke-shape resolution — dead code for all shipped adapters; live code for any future Node-returning adapter. Two equally bad options: keep it (stale-.cache bug), delete it (breaks the type signature's `NodeInput<T>` promise). Replace with `fromAny`.
  - `useCache ? new Map() : null` null-check threaded through the switchMap body.

#### Q7 — Simplify / reactive / composable + topology check

**Proposed simpler shape (illustrative, not for this session):**

```ts
export function promptNode<T = string>(
  adapter: LLMAdapter,
  deps: readonly Node<unknown>[],
  prompt: string | ((...depValues: unknown[]) => string),
  opts?: PromptNodeOptions,
): Node<T | null> {
  const messagesNode = derived(deps, values => {
    if (values.some(v => v == null)) return [];
    const text = typeof prompt === "string" ? prompt : prompt(...values);
    if (!text) return [];
    // NOTE: systemPrompt is forwarded via opts.systemPrompt only;
    // adapters inject it — no double-message-send.
    return [{ role: "user" as const, content: text }];
  }, { name: opts?.name ? `${opts.name}::messages` : "prompt_node::messages",
      meta: aiMeta("prompt_node"),
      initial: [] });

  return switchMap(messagesNode, msgs => {
    if (!msgs || msgs.length === 0) return state<T | null>(null);
    const call = fromAny(adapter.invoke(msgs, {
      model: opts?.model, temperature: opts?.temperature,
      maxTokens: opts?.maxTokens, systemPrompt: opts?.systemPrompt,
    }));
    return derived([call], ([resp]) => {
      const content = resp == null ? null : extractContent(resp);
      if (content == null) return null;
      return (opts?.format === "json"
        ? JSON.parse(stripFences(content))
        : content) as T;
    });
  });
}
```

Deltas: `new Promise` → `fromAny`. Node/Promise/raw branching → gone. `.cache` read → gone. Retry / cache options → removed (stack `withRetry` / `withReplayCache` on the adapter). System-prompt double-send → fixed.

**Topology check — minimal composition.**

```ts
const intake  = state("classify this document");
const context = state("document body here");
const answer  = promptNode(mockAdapter, [intake, context], (q, c) => `${c}\n\n${q}`);
answer.subscribe(() => {});
```

`describe()` (current shape):

```
intake                     (state)                  -> prompt_node::messages
context                    (state)                  -> prompt_node::messages
prompt_node::messages      (derived, meta.ai)       -> <switchMap-product>
<switchMap-product>        (producer, no meta.ai)   -> [answer returned to caller]
```

`explain(intake → answer)`: `intake → prompt_node::messages → switchMap-product`. ✅ chain closes. **No islands.** But:

- The **adapter call is off-graph.** No node represents "model X invoked with N tokens, Y ms latency." An auditor asking "what did the LLM do for this answer?" gets no edge to follow.
- The **returned node has no `meta.ai` tag** — describe renders it as a generic operator. Downstream tooling filtering by `meta.ai.kind` misses `promptNode` outputs.

**Verdict:** **Clean — no islands, explain closes.** BUT a "clean" topology only covers the reactive scaffold; the adapter-invocation layer is invisible. Proposed fix (above): `fromAny(adapter.invoke(...))` + a `derived` wrapper for parse — adds one named `prompt_node::response` node between `messages` and the switchMap product, giving the call its own edge + meta. Also add `meta: aiMeta("prompt_node::output")` on the final switchMap result via a passthrough `derived` so `describe` can group.

**Performance & memory footprint (retrofitted 2026-04-23):**
- **Current:** 2 nodes (messagesNode + switchMap product) + optional unbounded cache Map. `new Promise` allocation per invocation + branch cost. Each cache entry retains the parsed `T` indefinitely.
- **Recommended (C+D):** 3 nodes (messages + response + output). Zero extra Promise allocation (`fromAny` reuses the adapter's return). Zero in-primitive cache — if user opts in via `withReplayCache`, storage/tier policy governs eviction. Net: +1 node, −1 Promise allocation, −1 unbounded Map. Per-invocation memory drops; long-run memory drops significantly for cache-users.
- **Hot path cost:** identical on the common case (single LLM invocation per dep wave). No O(N²) or O(N) traps.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo — keep `new Promise` + branching, fix only the stale `.cache` read.** Pros: minimal change, preserves Node-returning-adapter compat (that nobody uses). Cons: keeps §5.10 violation; doesn't simplify maintenance burden.
- **(B) `fromAny`-ify the switchMap body; keep `retries` + `cache` options.** Pros: removes the §5.10 + P3 violations, keeps API compat. Cons: keeps the two duplicated-middleware options; still 90 LOC.
- **(C) `fromAny`-ify + remove `retries` + `cache`; document stacking `withRetry` / `withReplayCache` on the adapter instead.** Pros: simplest primitive, fully composable, zero duplicated logic; removes surprise double-retry hazard. Cons: breaking change for `promptNode({ retries, cache })` callers (need an in-tree grep — small; pre-1.0 policy). Need JSDoc examples showing the middleware recipe.
- **(D) Full refactor: add a real `prompt_node::response` node inside promptNode via `fromAny` + `derived` for extraction, and pass `meta.ai` through to the output.** Pros: closes the explainability gap (Q7); makes `describe()` show the LLM-call edge. Cons: one extra node per promptNode instance; tiny memory bump.

Recommendation: **C + D** together. One coherent change: canonical bridge via `fromAny`, surface the call as a node, drop duplicated options, fix system-prompt double-send.

#### Q9 — Does the recommendation cover the concerns?

| Concern (from Q2/Q3/Q6) | Covered by |
|---|---|
| §5.10 raw-Promise in switchMap body | C — `fromAny` replaces `new Promise` |
| P3 `.cache` read inside reactive fn | C — Node-branch disappears with `fromAny` |
| System-prompt double-send | C — build-messages no longer pushes `{role:"system"}` |
| Unbounded cache Map leak | C — remove `cache` option; delegate to `withReplayCache` |
| Retries duplication w/ `withRetry` | C — remove `retries` option |
| Cache key collision across model/temperature | C — delegates to `withReplayCache` which has canonical keys + `keyFn` |
| Adapter call off-graph (explainability) | D — surface `prompt_node::response` as a node |
| Returned node has no `meta.ai` tag | D — passthrough `derived` with `aiMeta("prompt_node::output")` |
| Stale `.cache` on Node-returning adapter | C — `fromAny` correctly drives reactively |

**Open question — requires user call:**
1. **`firstDataFromNode` future.** Keep as boundary helper, or migrate all three callers (`resolveToolHandlerResult`, `suggest-strategy`, `graph-from-spec`) to reactive-compose paths? Current shape is sanctioned; migration is larger scope (will surface again in Units 6/9/graph-integration).
2. **Breaking change tolerance on `retries`/`cache` options.** Pre-1.0 policy says yes, but there are no in-tree callers using them (grep confirms `cache:` / `retries:` never appear as a `promptNode` option). User confirms removal is fine?
3. **Scope of fix in implementation session.** (C) alone is ~30 LOC diff; (D) is another ~10. User preference: land both as one change, or split C then D?

#### Decisions locked (2026-04-23)

- **Q1: `firstDataFromNode`** — keep as-is in this unit; **migration to reactive-compose paths scheduled for Unit 14** (cross-cutting). User direction: "I want to do migration but OK to push to Unit 14 in this wave."
- **Q2: Remove `retries` + `cache` options** — pre-1.0 breaking change approved. No in-tree callers. JSDoc on the new shape must point users at `withRetry` + `withReplayCache` middleware.
- **Q3: Implement C + D together** in the follow-up implementation session. Single coherent change: `fromAny` bridge, remove duplicated options, surface `prompt_node::response` as a node, tag output with `meta: aiMeta("prompt_node::output")`, fix system-prompt double-send.
- **Added to review format going forward:** Q7 now includes **performance & memory footprint** alongside topology check. Unit 1 Q7 retrofitted above.

---

### Unit 2 — `streamingPromptNode` + `gatedStream` + `StreamChunk`

**Scope:** [src/patterns/ai/prompts/streaming.ts](../../src/patterns/ai/prompts/streaming.ts) (304 LOC total).

#### Q1 — Semantics, purpose, implementation

- **`streamingPromptNode`** (lines 68–146) — streaming variant of `promptNode`. Returns `{ output, stream, dispose }`:
  - `output: Node<T | null>` — emits the final parsed result once per invocation.
  - `stream: TopicGraph<StreamChunk>` — live per-token topic. Extractors mount on it.
  - `dispose` — unsubscribe keepalive + destroy stream topic.
  - Internal: `messagesNode = derived(deps, buildMessages)` (no `initial`, no `meta.ai`) → `switchMap` hosting an async-generator that iterates `adapter.stream(...)`, publishes each `"token"` delta to the topic, accumulates text, and yields the final parsed result on completion. `fromAny(asyncGenerator)` bridges into the switchMap return.
  - Cancellation: `new AbortController()` per invocation; passed to `adapter.stream({signal})`; `.abort()` in `finally`. switchMap teardown (previous inner subscription) triggers `finally` on supersede.
  - Non-token deltas (`thinking`, `tool-call-delta`, `usage`, `finish`) **dropped silently** at line 107 (`if (delta.type !== "token") continue`).
- **`gatedStream`** (lines 181–304) — composes streaming + a reactive gate.
  - Signature: `(graph, name, adapter, deps, prompt, opts)` — **takes `graph` as required arg** (streamingPromptNode doesn't).
  - Adds an extra state node `cancelSignal: state<number>` as an extra dep of messagesNode. `reject()` increments a counter → emits on `cancelSignal` → switchMap re-fires with the new dep value → builds empty messages (if cancelled mid-text) or restarts → previous `finally` aborts.
  - `nonNullOutput` filter returns `undefined` to suppress `null` passes (valid per spec §2.4).
  - Registers `nonNullOutput` into the graph as `${name}/raw` so `gate()` can resolve it by name.
  - `gateWithAbort` wraps `reject()` imperatively to toggle `cancelSignal` alongside the normal gate reject.
  - `dispose()` tears down only the keepalive + topic; **does not** remove the `${name}/raw` registered node or clean up gate internal state.
- **`StreamChunk`** (lines 23–32) — `{ source, token, accumulated, index }`. Token-only. No timestamp, no delta-type discriminator.

#### Q2 — Semantically correct?

- ✅ `fromAny(pumpAndCollect())` bridge is the canonical §5.10 shape (unlike `promptNode`'s raw Promise).
- ✅ AbortController in `finally` correctly cancels adapter stream on switchMap teardown.
- ✅ Null filter via `return undefined` (line 270) matches spec §2.4 no-auto-emit semantics.
- ⚠️ **System-prompt double-send** — same bug as Unit 1 (lines 83 + 104, lines 208 + 229).
- ⚠️ **`format: "json"` swallows parse errors** (lines 119–123) — silently returns `null` on JSON.parse failure. `promptNode` in Unit 1 throws → node ERROR. Inconsistent. Callers can't distinguish "model produced nothing" from "model produced invalid JSON."
- ⚠️ **Non-token deltas silently dropped** — `usage`, `finish`, `thinking`, `tool-call-delta` never reach any consumer via the stream topic. Cost-meter extractor (Unit 3) must hook somewhere else. Forces a second invisible channel.
- ⚠️ **gatedStream `dispose` leak** — registered `${name}/raw` node stays in the graph after dispose. Long-running apps that create many gated streams leak nodes.
- ⚠️ **Duplicated body** — lines 88–134 vs 213–259 are ~95% identical. Any future fix has to land twice.
- ⚠️ **`messagesNode` inconsistency with promptNode** — no `meta: aiMeta("prompt_node")`, no `initial: []`. The "nullish dep → empty messages → switchMap emits state(null)" trick in Unit 1 relied on `initial: []`; here it works anyway because switchMap's first-run after activation uses messagesNode's first real emission. But without `initial`, the node carries no domain tag in `describe()`.
- ⚠️ **`keepalive(output)` unconditional** (lines 136, 261) contradicts the docstring's "Zero overhead if nobody subscribes to the stream topic" — the output keepalive forces the switchMap to stay active whether anyone reads output or stream. Fine for typical use (user always subscribes somewhere), but contradicts the stated invariant.

#### Q3 — Design-invariant violations?

- 🟢 **Spec §5.10 bridge path** — `fromAny(asyncGenerator)` is correct. No raw Promise here. This is the shape `promptNode` should adopt.
- 🟡 **COMPOSITION-GUIDE §24 ("edges are derived from `_deps`") — deliberate orphan.** `streamTopic.publish(...)` is an imperative side-effect inside the async generator. `describe()` renders the streamTopic as a disconnected subgraph with no inbound edge from the output node. This is the **producer pattern §24 explicitly blesses** ("producer-pattern factories that manually `source.subscribe` inside their fn body produce nodes whose `_deps` is empty even though they react to something. Those edges are intentionally invisible"). So it's not a violation — it's a **known invisibility**. But this IS the "pagerduty-demo problem" the session doc calls out: "tokens only by itself" in describe. The §24 blessing is a design-time invariant allowance; the session doc's explainability standard says "gaps in the chain indicate imperative writes."
- 🟡 **Spec §5.9 imperative-trigger (borderline)** — `gateWithAbort.reject()` wraps the gate's reject to imperatively `cancelSignal.emit(++cancelCounter)`. `cancelSignal` is itself a reactive node (fine), but `.emit()` on a state node from inside a user-invoked method is control flow crossing the reactive boundary. Spec §5.9 targets *coordination*; `reject()` is already a control action on a GateController (allowed), so the extra emit is in the same band. Not a violation, but indirect.
- 🟡 **`format: "json"` error suppression** violates the library's "clear errors" invariant in spec §5.12 ("Phase 4+ APIs must be developer-friendly — clear errors").

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §9.0 "Streaming promptNode + mountable stream extractors"](../../docs/roadmap.md) — both primitives marked shipped (lines 89, 92).
- [optimizations.md "Parallel guardrail pattern" (resolved 2026-04-22)](../../docs/optimizations.md) — documents `gatedStream` as the "parallel optimistic + cancel" execution mode (COMPOSITION-GUIDE §30). The pattern is documented; the *implementation details* (this unit) are what's under review.
- **Not in optimizations.md — candidates for this review:**
  - Deduplicate the `streamingPromptNode` ↔ `gatedStream` body.
  - Stream topic default retention cap (today unbounded).
  - Broaden `StreamChunk` (or add sibling topics) to surface non-token deltas to extractors.
  - System-prompt double-send (shared with Unit 1 — one fix covers both).
  - `format: "json"` parse-error alignment with `promptNode`.
  - `keepalive` unconditional vs "zero overhead" claim.
  - gatedStream `graph` param asymmetry + dispose leak.

#### Q5 — Right abstraction? More generic possible?

- **Streaming is the right primitive.** Every streaming adapter worth supporting in 2026+ (Anthropic, OpenAI, Gemini, Groq, vLLM) emits token deltas; a first-class streaming node + topic is the minimum viable surface.
- **`StreamChunk` is under-specified.** The session doc's eventual vision says "stream extractors as universal taps" — universal requires the tap payload to include all delta kinds, not just tokens. Today the shape is token-only. Cost-meter extractor must separately reach into adapter-level tracking to see `usage`; it can't compose on the topic alone. That breaks the "zero cost if nobody subscribes" promise of extractors — cost-meter must hook the adapter.
- **`gatedStream` is specific enough to stay.** It could in principle be rewritten as `gate(graph, name, streamingPromptNode(...).output)` with the cancel wiring done by the caller — but then every caller reinvents the cancel-signal pattern. Keep as sugar; deduplicate the body via a shared helper.
- **More generic possibility: a `streamingActionNode`** parallel to Unit 1's `actionNode`. Single primitive that takes an arbitrary `(deps) => AsyncIterable<Delta>` and splits deltas across configurable sub-topics. `streamingPromptNode` becomes an LLM-specific wrapper. Premature today; revisit when a second streaming action lands (WebSocket, SSE tail).

#### Q6 — Long-term caveats & maintenance burden

- **Hottest maintenance item: the 95%-duplicated body.** Any streaming bug fix needs to land twice; drift risk high.
- **Non-token deltas invisible — forcing downstream workarounds.** Cost-meter reaches into adapter middleware (replay-cache, breaker) to see usage. If a future `thinking`-aware extractor wants to show reasoning tokens live, it cannot use the topic at all. This will cascade into Unit 3 findings.
- **Stream topic unbounded retention** (confirmed: [messaging/index.ts:342–346](../../src/patterns/messaging/index.ts:342)) — "unbounded retention per topic unless `retainedLimit` is set per call." `streamingPromptNode` doesn't pass `retainedLimit`. For a 10K-token response, the topic retains 10K `StreamChunk` objects each holding the full accumulated string — ~50MB per response. Never reclaimed until `dispose()`. Fixing this is a **default-value change**, not a structural refactor.
- **`accumulated += token` O(N²) cost** — every token allocates a new string of length `|acc|+|token|`, then the StreamChunk holds a reference to that (unique) string. For N tokens, total bytes retained ≈ O(N²). 10K tokens averaging 3 chars each = ~10K × ~1500 avg chars = ~15MB. With default retention that's per-response cost.
- **Abort via cancelSignal toggle is hard to reason about.** "Rejecting in the gate → counter increment → switchMap sees dep wave → new messages empty-or-same → previous finally aborts" is three indirections. A named helper or a dedicated `streamCancel(signal)` operator would read better. Not urgent — works today.
- **gatedStream `graph` param leaks the registration detail** — the only reason graph exists is because the gate is looked up via path string. If gate accepted a Node directly (not a string path), gatedStream wouldn't need graph.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check — minimal composition:**

```ts
const input = state("analyze this");
const { output, stream } = streamingPromptNode(mockStreamingAdapter, [input], v => v);
output.subscribe(() => {});
stream.latest.subscribe(() => {});
```

`describe()`:

```
input                    (state)                 -> messages
messages                 (derived, NO meta.ai)   -> <switchMap-product>
<switchMap-product>      (producer, NO meta.ai)  -> [output returned]

messages/stream          (TopicGraph subgraph)   -> [ORPHAN — no inbound edge]
 ├─ events  (reactiveLog, unbounded)
 └─ latest  (derived)
```

**Verdict: ORPHAN ISLAND.** `streamTopic` has no constructor-time edge back to the switchMap product. The publish is an imperative side-effect inside the async generator. This is §24-blessed ("producer pattern — edges intentionally invisible") BUT it's also the pagerduty-demo class. `explain(input, anyExtractorDownstreamOfStream)` cannot walk through the topic — it hits the orphan wall.

`gatedStream` topology adds:

```
cancelSignal  (state)    -> messages   (visible edge — cancelSignal IS a dep)
```

So gatedStream is *slightly more* transparent (cancel is visible), but the streamTopic orphan problem is unchanged.

**Proposed simpler shape (for implementation session):**

1. Extract a shared `streamingInvoke(adapter, messagesNode, streamTopic, opts)` that both functions call.
2. Pass `retainedLimit` to the topic constructor (default e.g. 1024 or time-based — pick after checking harness/long-stream perf).
3. Broaden `StreamChunk` to a discriminated union OR add sibling topics (`thinkingTopic?`, `usageTopic?`) on the handle. Decision needed (see Q8).
4. Drop the `return undefined` null-filter + `graph.add` registration from `gatedStream`; make `gate()` accept a `Node` directly (cross-cutting — flag to Wave B for `gate()` API).
5. Align `format: "json"` error behavior with `promptNode` (throw → node ERROR) for consistency.
6. Fix system-prompt double-send (same fix as Unit 1).
7. Remove unconditional `keepalive(output)` — or gate it behind an `activate?: boolean` option so callers can opt in.
8. Add `meta: aiMeta("prompt_node::messages")` + `initial: []` to `messagesNode` for describe parity with promptNode.

**Performance & memory footprint:**
- **Current:** Each streamingPromptNode instance retains the full sequence of StreamChunks in the topic. For an N-token generation, memory ≈ `N × avg_chunk_size + Σ|accumulated_i| ≈ O(N²) bytes retained`. For 10K-token responses, ~15MB per response, permanent until `dispose()`.
- **Recommended shape:** with `retainedLimit: 512` (configurable), memory ≈ `512 × avg_chunk_size + 512 × avg_accumulated = O(N × 512)` — linear in N, bounded per-response. Cost-meter / extractors operating on `stream.latest` don't care about retention; only cursor-based late subscribers do, and 512 chunks is still a usable replay window.
- **Hot-path allocation:** the `accumulated += token; publish({..., accumulated})` pattern allocates N strings per response. Alternative: publish `{token, offset}` + recompute `accumulated` at the consumer via a running derived. Saves one string per chunk at the cost of extractor complexity. Not urgent; only revisit if a perf regression surfaces.
- **Chunks-as-objects:** ~80B per StreamChunk object + string payload. Default retention of 1024 = ~80KB overhead per active stream. Acceptable.

#### Q8 — Alternative implementations (A/B/C/D)

- **(A) Minimal fixes** — dedup body, fix system-prompt, align JSON error, add default `retainedLimit`. Keep shape. Pros: smallest diff. Cons: keeps orphan topology, keeps narrow `StreamChunk`.
- **(B) A + broaden `StreamChunk` to a discriminated union** `{ type: "token" | "thinking" | "usage" | "finish" | "tool-call-delta"; ... }`. Pros: extractors see everything; cost-meter stops needing adapter hooks. Cons: breaking change for in-tree consumers (stream-extractor, keyword-flag, tool-call, cost-meter) — need to add `if (c.type === "token")` guards. ~4 files to touch.
- **(C) A + sibling topics on the handle** — `{ output, stream, thinkingStream?, usageStream?, finishStream?, dispose }`. Keep token stream shape; add optional sibling topics that ONLY exist if the adapter emits those deltas. Pros: preserves token-extractor backwards compat; stream-extractor.ts stays token-only; cost-meter / thinking-renderer subscribe to sibling topics. Cons: more topics = more memory overhead even when unused; API surface grows; still "zero cost if nobody subscribes" holds (topic is lazily consumed).
- **(D) C + surface the stream topic as a visible describe edge** — add a `meta.side_channel_of: "prompt_node::output"` annotation on the topic so `describe()` renders a dashed edge or a note explaining the producer-pattern. Pros: closes the pagerduty-demo-class explainability gap without restructuring the code path. Cons: requires a `describe` convention — not purely local to this file.

**Recommendation: A + C + D.** B's discriminated union breaks too much; C's sibling topics align with the existing "zero cost if nobody subscribes" story; D is a small annotation change that pays back on every stream's describe output.

Also: **remove unconditional `keepalive`**, **drop `gatedStream`'s `graph` param** (contingent on a `gate(node)` overload landing — cross-cutting with Wave B Unit 19), **align JSON error**, **fix system-prompt double-send**, **add `retainedLimit: 1024` default**.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3/Q6) | Covered by |
|---|---|
| 95% duplicated body (streamingPromptNode ↔ gatedStream) | A — shared `streamingInvoke` helper |
| System-prompt double-send | A — single build-messages (no `{role:"system"}` push) |
| `format:"json"` silently swallows errors | A — align with promptNode (throw → ERROR) |
| Non-token deltas invisible to extractors | C — sibling topics for thinking/usage/finish |
| Stream topic unbounded retention | A — default `retainedLimit: 1024` |
| O(N²) accumulated strings | Not covered (deferred — revisit on perf regression) |
| `keepalive(output)` contradicts zero-overhead promise | A — remove or gate behind opt-in flag |
| gatedStream `graph` param asymmetry | Blocked on Wave B `gate(node)` overload (Unit 19) |
| gatedStream `dispose` leaks registered node | A — dispose removes the graph registration |
| `messagesNode` missing `meta` + `initial` | A — parity fix with promptNode |
| Stream topic orphan in describe (pagerduty-demo class) | D — `meta.side_channel_of` annotation |
| Abort-via-cancel-signal indirection | Not covered (works; revisit if user confusion surfaces) |

**Open questions — requires user call:**
1. **Discriminated-union vs sibling-topics for non-token deltas** — I recommend C (sibling topics). B is simpler API-wise but breaks every existing extractor. Confirm preference before we commit? (Affects Unit 3 directly.)
2. **Default `retainedLimit` value** — 512 / 1024 / time-based? Default governs a real memory tradeoff. Recommendation: 1024 chunks OR `retainedLimit: Infinity + opt-in cap` (matches today's behavior with an easier knob). Your call.
3. **`gatedStream` `graph` param removal** is blocked on a `gate(node)` overload (Wave B). Do we defer gatedStream's cleanup to Wave B and only land A+C+D on `streamingPromptNode` in this unit's implementation session?
4. **O(N²) accumulated-string perf** — defer to a perf regression? Or pre-emptively redesign StreamChunk to `{token, offset}`? Recommendation: defer. No user has hit this yet.
5. **`keepalive(output)` removal** is mildly breaking — callers who relied on implicit activation would need to subscribe themselves. Pre-1.0 says fine, but confirm?

#### Decisions locked (2026-04-23)

- **Q1 REVERSED: go with B (single discriminated log of deltas), NOT C.** Backward compat off the table per "No backward compat" memory. One `deltaTopic: TopicGraph<StreamDelta & { seq: number; ts: number }>` captures the full per-stream event log. Transcript reconstruction = iterate the log. Extractors filter on `delta.type` inside their own fn.
  - **Transcript reconstruction:** every delta carries `seq: number` (monotonic per-stream counter) and `ts: number` (`wallClockNs()` — spec §5.11 central timer). `topic.retained()` → full log in order. Accumulated text is a *derived view*, not stored per-delta: `derived([deltaTopic.events], deltas => deltas.filter(d => d.type === "token").map(d => d.delta).join(""))` — or a memoized `reactiveAccumulator` helper if we find repeat callers.
  - **Consequence for Q4:** `{token, offset}` is subsumed — `accumulated` field is removed entirely. `offset` = `seq`. Net effect: O(N²) memory collapses to O(N) because each delta is ~50 bytes with a token-length `delta` string only. No retained per-chunk growing-string references.
- **Q2: no library default retention cap.** Session scale is domain-specific (single 4K response vs 1M-token context). Library can't pick. Expose `retainedLimit?: number` on `StreamingPromptNodeOptions` and document the tradeoff — single-response: 8K, session: 1M, worker pool: explicit dispose.
- **Q3: move `gatedStream` + `gate()` to a consolidated batch.** `gate()` lives in `patterns/orchestration/` — outside Wave A's ai/ scope. Defer `gatedStream` review to **Wave B (proposed: folded into the GATE-stage unit, Units 17–18)** where `gate()` itself is reviewed. This unit's implementation session covers `streamingPromptNode` only; `gatedStream` + `gate()` are a single batch later. Session doc "Unit ordering" updated below.
- **Q4: do the redesign now.** Subsumed by Q1-B: no `accumulated` field, delta shape = `StreamDelta & { seq, ts }`. Drops O(N²) → O(N).
- **Q5: remove `keepalive(output)`.** Confirmed. Callers subscribe themselves; "zero cost if nobody subscribes" becomes truthful.
- **Q6: (user message cut off — placeholder. If additional concern surfaces, fold in before implementation session.)**

**Implementation-session scope for Unit 2** (streamingPromptNode only; gatedStream deferred):

1. Replace per-token `streamTopic: TopicGraph<StreamChunk>` with `deltaTopic: TopicGraph<StreamDelta & { seq, ts }>`. Drop `StreamChunk` type entirely.
2. Publish *every* delta the adapter emits (remove the `if (delta.type !== "token") continue` filter).
3. Stamp `seq` (monotonic per stream) and `ts` (`wallClockNs()`) as the delta is published.
4. Remove `accumulated` string math from the streaming body. Extractors that need accumulated text compose a `derived` over the filtered token deltas (Unit 3 update).
5. Expose `retainedLimit?: number` in `StreamingPromptNodeOptions`; pass through to `topic(name, { retainedLimit })`. No default.
6. Remove unconditional `keepalive(output)`.
7. Fix system-prompt double-send (shared fix with Unit 1).
8. Align `format: "json"` error behavior — throw → node ERROR (parity with Unit 1's recommended shape).
9. Add `meta: aiMeta("prompt_node::messages")` + `initial: []` to `messagesNode` (parity with promptNode).
10. Add `meta.side_channel_of: "prompt_node::output"` to the delta topic so `describe()` can annotate the producer-pattern edge.
11. Ship a helper `streamingInvoke(...)` extracted from the body — used by Unit 19's `gatedStream` rewrite later.

**Cross-unit implications:**
- **Unit 3** (stream extractors) must change: extractors now consume `deltaTopic.latest` / `deltaTopic.events` filtered by `delta.type`. `streamExtractor`'s signature changes because `accumulated` is no longer a field — it's a derived computation.
- **Wave B (Units 17–18)** picks up `gatedStream` + `gate()` consolidation. Add to session-doc unit ordering.
- **Cost-meter extractor** (Unit 3): no longer needs adapter-middleware hooks. The `usage` delta flows through `deltaTopic` directly.

---

### Unit 3 — Stream extractors (`streamExtractor`, `keywordFlagExtractor`, `toolCallExtractor`, `costMeterExtractor`)

**Scope:** [extractors/stream-extractor.ts](../../src/patterns/ai/extractors/stream-extractor.ts) (56 LOC), [keyword-flag.ts](../../src/patterns/ai/extractors/keyword-flag.ts) (114), [tool-call.ts](../../src/patterns/ai/extractors/tool-call.ts) (139), [cost-meter.ts](../../src/patterns/ai/extractors/cost-meter.ts) (68). Total ~377 LOC.

#### Q1 — Semantics, purpose, implementation

All four are thin `derived` nodes mounted on `streamTopic.latest`. They share:
- Consume `Node<StreamChunk | null>` (the topic's `latest` view).
- Read `chunk.accumulated` — the grown running text.
- Use `ctx.store` for per-activation state (COMPOSITION-GUIDE §20).
- Custom structural `equals` to dedup RESOLVED-style emissions when nothing new was detected.
- Carry `meta: aiMeta(...)` + `describeKind: "derived"` + `initial`.

Specific behaviors:
- **`streamExtractor<T>`** — generic primitive. Takes `extractFn: (accumulated: string) => T | null`. Returns `Node<T | null>`. No cursor — `extractFn` receives the full accumulated text each chunk. Caller supplies optional `equals`.
- **`keywordFlagExtractor`** ([keyword-flag.ts:65](../../src/patterns/ai/extractors/keyword-flag.ts:65)) — scans accumulated text for regex patterns. Maintains cursor `ctx.store.scannedTo` + flag array. Scans only the delta region with a `maxPatternLength` overlap window (default 128) so cross-chunk matches aren't missed. Rebuilds RegExp every chunk (`new RegExp(...)` inside the fn body). Returns `Node<readonly KeywordFlag[]>`.
- **`toolCallExtractor`** ([tool-call.ts:50](../../src/patterns/ai/extractors/tool-call.ts:50)) — brace-depth JSON parser. Maintains `ctx.store.scanFrom` + completed calls. Skips open-brace + quote-escape edge cases. On incomplete JSON (depth !== 0 at end-of-text), rewinds `scanFrom` to the open brace so next chunk resumes parsing. Validates `{name: string, arguments: object}` shape. Silently skips on `JSON.parse` failure. Returns `Node<readonly ExtractedToolCall[]>`.
- **`costMeterExtractor`** ([cost-meter.ts:42](../../src/patterns/ai/extractors/cost-meter.ts:42)) — counts chunks (via `chunk.index + 1`) + chars (via `accumulated.length`) + estimated tokens (`charCount / charsPerToken`, default 4). No cursor; pure function of the latest chunk. Returns `Node<CostMeterReading>`.

#### Q2 — Semantically correct?

- ✅ All four use `ctx.store` correctly (§20): state persists across fn runs in one activation, clears on deactivation.
- ✅ Fresh-copy return (`[...flags]` / `flags.slice()`) prevents downstream from holding live references to `ctx.store.flags` — correct immutability pattern.
- ✅ Custom `equals` suppresses no-change emissions (structural equality for arrays-of-objects) — correct RESOLVED-vs-DATA semantics.
- ✅ `initial` + `describeKind` + `meta.ai` on all four — describe parity.
- ✅ keyword-flag overlap window (`scannedTo - maxPatternLength`) correctly catches cross-boundary matches like `"EventE" + "mitter"`.
- ✅ tool-call quote-escape handling is correct: `\\` skips the next char, so `\"` inside a JSON string is handled.
- ⚠️ **costMeter uses char-estimation heuristic** (`charsPerToken: 4`) — wrong for Anthropic / Gemini / Qwen tokenizers; the *real* token count is in the adapter's `usage` delta which is DROPPED by streamingPromptNode (see Unit 2 Q1). So today's cost-meter is strictly an estimate, even when real data exists.
- ⚠️ **keyword extractor rebuilds RegExp every chunk** ([keyword-flag.ts:89](../../src/patterns/ai/extractors/keyword-flag.ts:89)) — `new RegExp(pattern.source, ...)` allocates a fresh RegExp per chunk per pattern. For N chunks × M patterns, that's N×M RegExp allocations. Cache once at factory time.
- ⚠️ **tool-call extractor silently drops invalid JSON** — an attempted-but-malformed tool call is invisible. Callers who need "the model tried to call a tool but produced bad JSON" visibility have no signal. Fine for v1 but worth noting.
- ⚠️ **`maxPatternLength` is a silent-miss trap** — if a user's regex has a literal longer than 128 chars and they forget to override `maxPatternLength`, cross-boundary matches that span more than 128 chars are silently missed. No runtime validation of regex-source length vs the option.
- ⚠️ **Reactivation resets cursor** — if user unsubscribes and resubscribes mid-stream (switchMap supersede in downstream pipelines, for example), `ctx.store` clears and the extractor re-scans from position 0. With Unit 2 B's topic retention, this means it replays the full retained delta log. Cost is O(retention × M patterns). For a 1M-token retained session, this is expensive per reactivation. Acknowledged as §12 RAM-semantics consequence.

#### Q3 — Design-invariant violations?

- 🟢 `ctx.store` usage is §20-sanctioned.
- 🟢 All four are pure `derived` nodes with declared deps — §24 edges visible.
- 🟢 No raw async, no imperative triggers, no polling.
- 🟢 Central-timer: neither extractor timestamps today; but cost-meter could add `wallClockNs()` on each reading — minor.
- 🟢 `messageTier` utility not needed — these operate on DATA only.

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §9.0 "Mountable extractor subgraphs"](../../docs/roadmap.md) — all four shipped. "Zero cost if nobody subscribes" is the roadmap claim — holds for today's shape (extractors are `derived`, not activated without subscribers).
- [optimizations.md "Missing `meta=_ai_meta(...)` on stream extractor `derived()` calls (TS portion)"](../../docs/optimizations.md) — verified done 2026-04-22; all four carry `meta: aiMeta(...)`.
- **Not in optimizations.md — candidates for this review:**
  - Every extractor rewrites under Unit 2 B (no `accumulated` field on chunks; consumes `deltaTopic` or a helper `accumulatedText` node).
  - costMeter should use real `usage` delta, not char-estimate.
  - keyword RegExp factory-time caching.
  - `maxPatternLength` silent-miss validation.

#### Q5 — Right abstraction? More generic possible?

- **`streamExtractor` IS the generic primitive.** The other three are specialized instances. This is the right layering.
- **Generalize to any reactive text source.** The `streamExtractor(streamTopic, extractFn)` shape only needs `Node<{accumulated: string}>` — it's not tied to LLM topics. A WebSocket stream or SSE feed with an accumulator would work with minor adapter. Under Unit 2 B, the primitive becomes `streamExtractor(accumulatedText: Node<string>, extractFn)` — fully source-agnostic.
- **Under Unit 2 B, extractors split cleanly by what they consume:**
  - **Text-only consumers** (`streamExtractor`, `keywordFlagExtractor`, `toolCallExtractor`) — take `Node<string>` (accumulated text).
  - **Delta-type-specific consumers** (`costMeterExtractor`) — take `TopicGraph<Delta>` and filter `usage` deltas.
  - This is a clean API split: text vs raw deltas.
- **Could be more generic with a `deltaFilter<T>(deltaTopic, type): Node<T | null>`** helper — returns the latest delta of a given type. `costMeterExtractor` becomes `derived([deltaFilter(topic, "usage")], [usage] => …)`. But premature — one caller isn't enough to pay for a named primitive.

#### Q6 — Long-term caveats & maintenance burden

- **All four rewrite under Unit 2 B.** The `accumulated` field disappears; extractors either maintain their own accumulator, or take a shared `accumulatedText: Node<string>` node from the bundle. Pre-1.0, so the rewrite is free of back-compat shims. **This is the main maintenance burden** — one rewrite pass, then stable.
- **keyword extractor `maxPatternLength` validation** — silent-miss. Easy to add a factory-time assert: if any `pattern.source` has a literal substring longer than `maxPatternLength`, throw. One-line fix; catches real footguns.
- **keyword RegExp caching** — minor perf. `new RegExp(pattern.source, ...)` allocates. Cache `compiledPatterns` at factory time. ~5 LOC.
- **costMeter correctness** — today's char-estimate masks real provider usage. Under Unit 2 B it should prefer the real `usage` delta and fall back to the heuristic when usage is absent (e.g. streaming adapters without usage support). API shape: same; internals change.
- **Reactivation-replay cost** under long retention. Acceptable consequence of §12 RAM cache — document clearly on each extractor's JSDoc. Users who need persistent state across reactivations use `state()` / `ReactiveMapBundle` for the flags/calls store instead of `ctx.store`. For now, none of the shipped extractors need this — they're reactivated rarely.
- **Tool-call parser fragility** — a streaming JSON parser (stream-json, clarinet) would be more robust. Current brace-depth approach is correct for well-formed model output. Ship as-is; swap later if users hit edge cases.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology — minimal composition:**

```ts
const input = state("analyze this");
const { output, stream } = streamingPromptNode(adapter, [input], v => v);
const flags = keywordFlagExtractor(stream, { patterns: [{ pattern: /setTimeout/g, label: "bad" }] });
const calls = toolCallExtractor(stream);
const cost  = costMeterExtractor(stream);
flags.subscribe(() => {}); calls.subscribe(() => {}); cost.subscribe(() => {});
```

`describe()` (current):

```
input                   (state)     -> messages
messages                (derived)   -> switchMap-product
switchMap-product       (producer)  [output]

stream (TopicGraph subgraph)
 ├─ events  (reactiveLog)
 └─ latest  (derived)               -> keyword-flag-extractor
                                     -> tool-call-extractor
                                     -> cost-meter
```

- Extractors have visible edges from `stream.latest`. **No islands among extractors.**
- But the streamTopic itself is still the orphan from Unit 2 (no edge from switchMap-product → stream — that's the §24-blessed producer pattern).
- `explain(stream.latest, flags)` walks cleanly: `stream.latest → keyword-flag-extractor`. ✅
- `explain(input, flags)` fails at the stream-topic boundary: `input → messages → switchMap-product → [WALL] stream.latest → keyword-flag-extractor`. This is the same pagerduty-demo gap Unit 2 identified; Unit 2's D (meta annotation) is the fix.

**Verdict:** **Extractors themselves are clean.** They inherit the explainability gap from Unit 2's stream topic.

**Proposed shape under Unit 2 B (for implementation session):**

1. Expose `accumulatedText: Node<string>` on `streamingPromptNode`'s bundle (lazy-built over `deltaTopic` with an internal `ctx.store.acc` concatenator).
2. `streamExtractor(accumulatedText, extractFn, opts)` — takes `Node<string>`, not topic. Generic for any accumulated-text source.
3. `keywordFlagExtractor(accumulatedText, opts)` — same signature change.
4. `toolCallExtractor(accumulatedText, opts)` — same signature change.
5. `costMeterExtractor(deltaTopic, opts)` — takes `TopicGraph<Delta>`. Filters `usage` deltas for real token counts; falls back to char-estimate + token delta counting only when adapter omits usage.
6. Cache compiled regex in `keywordFlagExtractor` at factory time.
7. Factory-time assert on `maxPatternLength`: if any pattern's literal length exceeds `maxPatternLength`, throw `Error("pattern longer than maxPatternLength; raise the option")`.
8. Reconsider `streamExtractor` default `equals` — drop the `Object.is` default for structural extractors, require caller to pass `equals` (or explicitly `undefined` for reference). Opens the door to fewer accidental over-emissions. Minor.

**Performance & memory footprint:**
- **Current:** each extractor allocates fresh arrays on every chunk (O(matches) per chunk). keyword allocates N×M RegExps over a response. Total memory: `sum(extractor flag/call arrays) + ctx.store running text copies if we add local accumulators`.
- **After rewrite (shared `accumulatedText`):** one running string per `streamingPromptNode`, shared across all extractors that need text. O(N) total text memory, not O(extractor_count × N). Extractor-local `ctx.store` for cursors / flag lists unchanged. Cost-meter becomes O(1) per usage delta (rare; maybe 1/response) — significant drop from per-chunk O(1).
- **Hot-path allocation:** keyword extractor goes from N×M RegExp allocations to M (factory-time). ~100× reduction for typical streams. Fresh-copy arrays on emit stay — required for immutability — but structural equals means most emits are RESOLVED (no downstream work).
- **Memory ceiling per extractor:** unbounded `ctx.store.flags` / `ctx.store.calls` grows with matches. For a 1M-token session with many matches, these arrays grow unbounded. Acceptable because (a) ctx.store clears on deactivation, (b) typical match counts are small. Document on JSDoc.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Minimal migration: extractors each maintain their own accumulator.** Pros: simple, each extractor self-contained. Cons: 3 running-string copies when all 3 text-extractors run (O(3N) text memory).
- **(B) Shared `accumulatedText: Node<string>` on the bundle.** Pros: one running string, used by all text consumers; clean API split (text vs deltas); composable outside streamingPromptNode (any `Node<string>` source works). Cons: extra node in the graph; caller must know which to pass.
- **(C) `accumulatedText` + `deltaFilter<T>(topic, type)` helper.** Pros: maximally generic; cost-meter becomes 3 LOC. Cons: one more primitive in extractors/ just for one caller.
- **(D) Keep today's `streamChunk` in addition to `deltaTopic`** as a denormalized convenience on the bundle. Pros: extractors unchanged. Cons: reintroduces O(N²) accumulated-string memory — contradicts Unit 2 lock.

Recommendation: **B.** Clean split, no primitive creep, addresses all concerns. C is premature; A wastes memory; D contradicts Unit 2.

Also: cache compiled regex; factory-time validate `maxPatternLength`; cost-meter reads real usage; drop `streamExtractor`'s default `equals` (opt-in instead of Object.is).

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3/Q6) | Covered by |
|---|---|
| All four rewrite under Unit 2 B | B — signature change: `Node<string>` vs `TopicGraph<Delta>` |
| costMeter char-estimation wrong vs real usage | B — costMeter reads `usage` deltas |
| keyword regex allocated every chunk | Factory-time compile cache (~5 LOC) |
| `maxPatternLength` silent-miss | Factory-time assert (1 LOC) |
| `streamExtractor` default `equals` hides bad behavior | Drop default; require caller |
| Reactivation replays log | Document on JSDoc (§12 consequence) |
| Tool-call silent JSON skip | Defer (v1 acceptable; swap parser if user hits it) |
| Explainability at streamTopic boundary | Inherited from Unit 2 D (`meta.side_channel_of`) |

**Open questions — requires user call:**
1. **A vs B vs C for the accumulated-text shape** — I recommend **B** (shared `accumulatedText: Node<string>` on the bundle). A = 3 running copies; C adds a primitive for one caller. Your call?
2. **costMeter fallback** — when the adapter doesn't emit `usage` deltas (many OSS adapters), fall back to char-estimation + token-delta counting? Or emit `null`/"usage unknown" and let the caller decide? Recommendation: fallback with `meta.estimated: true` flag on the reading so downstream knows it's approximate.
3. **`streamExtractor` default `equals`** — remove the `Object.is` default (require caller to opt in)? Or keep it (forcing the caller to always pass a custom `equals` for structured outputs — the current shape)? Recommendation: **keep `Object.is` as a safe default, document clearly** — callers returning structured objects must override. This is the current shape; I was overthinking it.
4. **Factory-time `maxPatternLength` validation** — throw on mismatch, or just warn via `console.warn`? Recommendation: **throw** (consistent with other library assertions). Silent misses are worse than loud fails pre-1.0.

#### Decisions locked (2026-04-23)

- **Q1: B** — shared `accumulatedText: Node<string>` on the `streamingPromptNode` bundle. Text-only extractors (`streamExtractor`, `keywordFlagExtractor`, `toolCallExtractor`) take `Node<string>`; delta-specific extractors (`costMeterExtractor`) take `TopicGraph<Delta>`.
- **Q2: costMeter fallback** with `meta.estimated: true` flag. Prefers real `usage` delta; falls back to char-estimation + token-delta counting when adapter omits usage.
- **Q3: `streamExtractor` keeps `Object.is` default** for `equals`. Callers returning structured `T` opt in to a custom equals. Document clearly.
- **Q4: factory-time throw** on `maxPatternLength` mismatch. `new Error("pattern literal exceeds maxPatternLength: raise the option or shorten the pattern")` with the offending pattern label in the message.

**Implementation-session scope for Unit 3** (all four extractors; lands after Unit 2's `streamingPromptNode` rewrite):

1. **Rewrite signatures:**
   - `streamExtractor(accumulatedText: Node<string>, extractFn, opts): Node<T | null>`
   - `keywordFlagExtractor(accumulatedText: Node<string>, opts): Node<readonly KeywordFlag[]>`
   - `toolCallExtractor(accumulatedText: Node<string>, opts): Node<readonly ExtractedToolCall[]>`
   - `costMeterExtractor(deltaTopic: TopicGraph<Delta>, opts): Node<CostMeterReading>`
2. **Bundle exposure:** `streamingPromptNode` returns `{ output, deltaTopic, accumulatedText, dispose }`. `accumulatedText` is lazy-built via `derived([deltaTopic.latest], (d, ctx) => ... ctx.store.acc += d.delta on token deltas ...)` with `meta: aiMeta("accumulated_text")`.
3. **keyword regex caching:** compile all patterns once at factory time (`opts.patterns.map(p => ({compiled: new RegExp(p.pattern.source, ...), label: p.label}))`) — reuse the compiled array inside the fn.
4. **keyword `maxPatternLength` assert:** factory-time scan — for each pattern, check `pattern.source`'s literal-character length (approximation; won't catch arbitrary regex) against `maxPatternLength`; throw if any exceeds.
5. **costMeter real-usage path:** read from `deltaTopic.latest` filtered for `type === "usage"`. Use `sumInputTokens` + `sumOutputTokens` from `adapters/core/types.ts`. Fall back to char-estimate when no usage delta seen yet. Emit `meta.estimated: true` flag on the reading when fallback is active.
6. **costMeter `chunkCount`:** derive from count of token-type deltas seen (use seq or `ctx.store` counter), not `chunk.index + 1`.
7. **Retain structural equals + fresh-copy return** on all four — unchanged.
8. **Retain `ctx.store` state + initial + meta + describeKind** — unchanged.
9. **JSDoc update:** on each extractor, document the "reactivation resets cursor (§12 RAM)" behavior.
10. **Tests:** existing extractor tests (~5 per extractor in [ai.test.ts](../../src/__tests__/patterns/ai.test.ts)) rewrite to the new signatures.

**Cross-unit dependency:** This unit's implementation session must land *after* Unit 2's `streamingPromptNode` rewrite (which introduces `deltaTopic` + `accumulatedText`). Ordering: Unit 2 first, then Unit 3 in the same or next session.

---

### Unit 4 — `agentLoop` + `interceptToolCalls`

**Scope:** [src/patterns/ai/agents/agent-loop.ts](../../src/patterns/ai/agents/agent-loop.ts) (701 LOC). Heaviest Wave A unit.

#### Q1 — Semantics, purpose, implementation

A reactive multi-turn LLM agent implemented as a 5-state reactive state machine (`idle | thinking | acting | done | error`) wired entirely from graph primitives.

**Pipeline:**
```
status (trigger) ─→ promptInput (raw node; gates on closure-read state) ─→
  switchMap(promptInput) ─→ llmResponse (adapter.invoke via fromAny)
    ├─→ effResponse (effect): batch { lastResponseState.emit(resp); status.emit(next); turn.emit(next); chat.append(assistant, resp) }
    └─→ _terminalResult ← (deps: status, lastResponseState; emits {response, runVersion} when status="done")

lastResponseState + status ─→ toolCallsNode (raw; DATA only if status="acting" + non-empty calls; RESOLVED otherwise)
  ─→ [optional interceptToolCalls splice] ─→ gatedToolCallsNode
    ─→ switchMap(calls) ─→ toolResultsNode (per-call retrySource + rescue → ToolResult array)
      ─→ effResults: batch { status.emit(next); chat.appendToolResult(...) }

aborted ─→ effAbort: this._currentAbortController?.abort(); status.emit("done")
```

**External surface:**
- Subgraphs: `chat` (ChatStreamGraph), `tools` (ToolRegistryGraph).
- State nodes: `status`, `turn`, `aborted`, `lastResponse` (state mirror).
- SENTINEL outputs: `toolCalls` (post-intercept), `toolResults`.
- Imperative: `run(userMessage?, signal?) → Promise<LLMResponse | null>`, `abort()`.
- Splice point: `opts.interceptToolCalls?: (calls: Node<readonly ToolCall[]>) => Node<readonly ToolCall[]>` — pure reactive composition (§31).

**Private mutable state:**
- `_runVersion: number` — monotonic per-`run()` stamp, filters stale awaitSettled resolutions.
- `_running: boolean` — mutex throwing RangeError on re-entrant `run()`.
- `_currentAbortController: AbortController | null` — set in switchMap project, aborted in `effAbort`, cleared in `run()` finally.

**Factory-time seed mirrors:** `latestTurn`, `latestAborted` — closure vars subscribed at construction, read inside reactive fns to enforce `maxTurns` and abort guards without `.cache` reads (§28).

**External-consumer reads inside reactive fns:** `chat.allMessages()` + `tools.schemas.cache` inside `promptInput` — author cites "external-consumer API boundary (documented P3 exception)" but reads happen inside a reactive fn body, not at the boundary.

**Deprecated alias:** `turnCount` = `turn` (pre-1.0 rename, JSDoc says removable).

#### Q2 — Semantically correct?

The code is careful and well-annotated. Most bugs it documents are already fixed:

- ✅ `lastResponseState` state-mirror pattern (§32) correctly serialized emission order inside `effResponse`'s batch (mirror first, then status, then turn, then chat) — defends against nested-drain peer-stale reads.
- ✅ `_terminalResult` runVersion stamping (C1) filters stale resolution under re-entrant composition.
- ✅ Abort-before-response → `ERROR(AbortError)` instead of hanging RESOLVED (C3).
- ✅ Abort micro-race defense-in-depth (C2) — both effects bail on `latestAborted`.
- ✅ Tool-result shape: string handler returns NOT double-JSON-stringified (line 662).
- ✅ `toolCallsNode` emits RESOLVED (not `DATA([])`) when no calls — prevents switchMap re-dispatch of its inner source on empty batches.
- ✅ `executeToolReactively` wraps `tools.execute` in `Promise.resolve().then(...)` so synchronous throws surface as rejected Promises for retrySource.
- ✅ Fresh array copy on tool-result emission prevents downstream from holding live references to internal state.

**Concerns:**
- ⚠️ **`_currentAbortController` is non-reactive mutable state.** Set inside switchMap's project, read inside `effAbort`, cleared in `run()` finally. The controller itself isn't a node, so nothing in `describe()` represents "who holds the current abort." Works, but is the drift the session doc flagged.
- ⚠️ **Closure mirrors are asymmetric.** `latestTurn` / `latestAborted` are §28-pattern closure mirrors. But `chat.allMessages()` / `tools.schemas.cache` are read directly inside promptInput's fn body with no mirror. Two patterns serve the same role inconsistently.
- ⚠️ **`Promise.resolve(adapter.invoke(...))` wrapper** (line 281) — `fromAny` already handles Promise | Node | raw value. The extra Promise.resolve is either a type-coercion workaround or accidental. If an adapter returns a `Node<LLMResponse>`, `Promise.resolve(node)` resolves to the same node object, then `fromAny(Promise<Node>)` awaits once extra and sees a Node. Minor perf (one microtask) and less clear code.
- ⚠️ **`effAbort` emits `status.emit("done")` unconditionally.** If the LLM had already produced a final response and `effResponse` set `status="done"`, a late `abort()` fires `effAbort` which re-emits `status="done"` → `_terminalResult` wave fires with the cached lastResponse + current runVersion. Since `run()` has already resolved, this is a trailing no-op; but it pollutes the status-node event log.
- ⚠️ **Deprecated `turnCount` alias** — pre-1.0 policy is no back-compat; remove.
- ⚠️ **`effAbort`'s imperative `abort()`** is the core "imperative shim" — triggers adapter.invoke's wire cancellation AND fromAny's signal-bound error surfacing. `statusNode.emit("done")` is redundant-but-defensive.

#### Q3 — Design-invariant violations?

- 🟢 **Most invariants honored.** The §7 (feedback cycles), §28 (factory-time seed), §32 (state-mirror) patterns are explicitly cited in comments and correctly implemented.
- 🟡 **P3 cross-node `.cache` reads inside fn bodies** — `chat.allMessages()` (which reads `chat.messages.cache`) + `tools.schemas.cache` inside `promptInput` (line 254, 262). Author classifies as "sanctioned external-consumer API boundary" but the reads happen inside a reactive fn body, not at the factory boundary. Gray zone §28 describes: the *sanctioned* pattern is factory-time seed, not in-fn `.cache` reads.
- 🟡 **§24 hidden edges** — `chat.messages` (indirectly, via messageCount) and `tools.schemas` are semantically inputs to `promptInput`. They're read via closure / external-consumer API, so `describe()` shows no edge. A user tracing "why did the agent fire a new prompt?" has to know these hidden reads exist. Deliberate (to avoid feedback cycles), but an explainability gap — same class as Unit 2's stream-topic orphan.
- 🟡 **§5.9 imperative-trigger** — `_currentAbortController.abort()` inside `effAbort` is an imperative call out of the reactive layer. It's mitigated by being wrapped in a signal that threads into `fromAny`, which DOES emit ERROR reactively; so the reactive layer eventually sees cancellation. Not a clear violation, but it's the "imperative shim to bridge to external APIs" case that §5.9 warns lives outside the spec's "reactive trigger" ban.
- 🟢 **§5.10 raw-async** — Promise.resolve wrapper is a wart but not a violation; `fromAny` is the bridge. No raw `setTimeout`/microtask scheduling.
- 🟢 **Central timer** — not used here (no timestamps emitted).
- 🟢 **interceptToolCalls splice is the good pattern** — pure `Node → Node` composition, visible in describe, no imperative wraps. §31 dynamic tool selection correctly realized.

#### Q4 — Open items (roadmap / optimizations.md)

- No explicit `agentLoop` items in optimizations.md — implies past audits considered it stable.
- [roadmap.md "INTERCEPT TOOL CALLS splice (§9.0d)"](../../docs/roadmap.md) — splice landed 2026-04-22.
- [optimizations.md §32 state-mirror ref](../../docs/optimizations.md) — agentLoop's `lastResponseState` is the cited exemplar.
- Candidates surfaced by this review:
  - `_currentAbortController` → reactive signal derivation (`nodeSignal(aborted)` helper).
  - Remove deprecated `turnCount`.
  - Consolidate closure-mirror patterns (or migrate `.cache` reads to factory-time seed symmetric with `latestTurn`).
  - Drop `Promise.resolve()` wrapper.
  - Optional: document closure reads in `describe()` via `meta.closureReads: [...]` annotation.
  - Long-term: reshape agentLoop as `harnessLoop` sugar (Ring 2 vision); deferred.

#### Q5 — Right abstraction? More generic possible?

- **The state machine IS the right abstraction** — 5 states cover idle / thinking / acting / done / error; this matches every production LLM agent framework (OpenAI Agents SDK, LangGraph's AgentExecutor, CrewAI). Not simplifiable further without losing capability.
- **`interceptToolCalls` is the right splice point.** One-function composition surface (`Node → Node`) aligns with §31 dynamic tool selection; pipe through filter / throttle / gate transparently. ✅
- **Is `agentLoop` a unique primitive or a special case of `harnessLoop`?** The 7-stage harness (`INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT`) overlaps heavily with agentLoop: INTAKE=user message, GATE=interceptToolCalls, EXECUTE=tool execution, REFLECT=continue vs done. If harnessLoop is Ring 2's primitive, agentLoop should become sugar over it. **Deferred as an open design question for a dedicated session.** Premature in-scope for this review.
- **More generic slices inside agentLoop:**
  - `promptInvocation(chat, tools, status, opts) → Node<LLMResponse>` — pure adapter-invocation pipeline.
  - `toolExecution(toolCalls, tools) → Node<readonly ToolResult[]>` — per-call retrySource/rescue batch.
  Extracting these would let users build "promptInvocation without tools" or "toolExecution without chat." Today embedded in agentLoop. Premature; extract when a second caller shows demand.

#### Q6 — Long-term caveats & maintenance burden

- **The cognitive weight is real.** 9 composition-guide pitfalls cited inline (§7, §28, §32, C1, C2, C3, §24, §5.8-12, §31). The code is correct precisely because every footgun has been marked; any future maintainer must preserve the ordering discipline in `effResponse`'s batch, the state-mirror, the closure reads, the runVersion stamping, the RESOLVED-vs-DATA([]) gate on toolCallsNode, the C3 abort-before-response branch on `_terminalResult`. That's a lot to hold in one's head.
- **The closure-mirror pattern inconsistency** is the biggest maintenance trap. New deps that should sample-without-trigger today land as either closure mirror or in-fn `.cache` read depending on developer memory. Pick one and consolidate.
- **`_currentAbortController` mutable member** — each `run()` creates an AC which leaks into switchMap's project (assigned to `this._currentAbortController`), is read from a peer effect, and is cleared by the run finally. The assignment happens inside a reactive fn body, which is itself unusual (assigning `this.X` from a switchMap project is side-effecty).
- **`run()` Promise bridge** is where most of the weight lives: runVersion, mutex, signal listener binding, finally cleanup. The reactive pipeline itself is much simpler; `run()` is the Promise-world adapter.
- **`_runVersion` stamping** is a workaround for `awaitSettled` lacking a per-call identity. If `awaitSettled` supported `{ startingFrom: version }` natively, the workaround disappears. Tracked implicitly.
- **Hidden reads in describe** make "why did the agent fire?" harder to explain than "look at the topology." Users who trust `describe()` to show all inputs get a misleading picture.
- **Deprecated `turnCount`** — small debt, one-line removal.
- **Long-term reshape (agentLoop as harnessLoop sugar)** — large scope, high reward (unification). Defer to a dedicated session.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check — minimal composition:**

```ts
const agent = agentLoop("a", {
  adapter: mockAdapter([...]),
  tools: [myTool],
  maxTurns: 3,
});
agent.chat.append("user", "hi");
await agent.run();
```

`describe()` shape (paths relative to agent graph):

```
chat::messages          (state, bundle)     -> chat::latest, chat::messageCount
chat::latest            (derived)
chat::messageCount      (derived)
tools::schemas          (state, bundle)
tools::toolNode<each>   (derived)

status                  (state)             -> promptInput, toolCallsNode, _terminalResult
turn                    (state)
aborted                 (state)             -> effAbort
lastResponse            (state)             -> toolCallsNode, _terminalResult

promptInput             (raw node)          -> llmResponse
llmResponse             (switchMap)         -> effResponse
effResponse             (effect, keepalive)
toolCallsNode           (raw node)          -> gatedToolCallsNode
gatedToolCallsNode      (identity | splice) -> toolResultsNode
toolResultsNode         (switchMap)         -> effResults
effResults              (effect, keepalive)
effAbort                (effect, keepalive)
_terminalResult         (raw node)          -> awaitSettled(run())
```

**Verdict — no islands; most edges visible.** `interceptToolCalls` splice is visible when set. BUT:
- **Invisible reads** inside `promptInput` fn: `chat.allMessages()`, `tools.schemas.cache`, `latestTurn`, `latestAborted`.
- **Invisible writes** inside effects: `effResponse → {lastResponse, status, turn, chat.messages}`; `effResults → {status, chat.messages}`; `effAbort → {_currentAbortController.abort(), status}`.
- **`_currentAbortController`** isn't a node — no edge can represent it.

So `explain(chat.messageCount, promptInput)` would report "no causal path" even though chat writes semantically trigger re-prompts (via a closure + status transition). Same invisibility Unit 2 stream topic had — here magnified because more deps are closure-sampled.

**Performance & memory footprint:**
- **Per agent instance:** ~10 reactive nodes + 2 subgraphs. 3 keepalives + 2 closure-mirror subscriptions = 5 long-lived subscriptions.
- **Per `run()`:**
  - 1 `AbortController`.
  - 1 `adapter.invoke` call per turn (up to `maxTurns`).
  - Up-to-N tool calls per turn → N `retrySource` + `derived` + `rescue` nodes mounted inside switchMap's inner. Each call may allocate 1-2 Promises + the `Promise.resolve().then(...)` trick.
  - 1 chat append per response + 1 per tool result.
- **State retention:** `lastResponseState` holds the most recent response (including toolCalls) — ROM, retained until next overwrite or graph destroy. Response objects can be large (streaming-accumulated; the adapter layer delivers final content, so ~10KB-1MB range).
- **Chat buffer:** bounded by `maxMessages` option (if set) — default unbounded. Unbounded chat is an O(N) memory per-run.
- **Hot path:** per-token cost is NOT paid here (agentLoop uses `invoke`, not `stream` — Unit 2 covers streaming). Per-turn allocations are modest.
- **Describe cost:** moderate — ~10 top-level nodes + mount traversal through chat/tools subgraphs. Acceptable for a domain-layer primitive.

**Proposed simpler shape (for implementation session):**

1. **Replace `_currentAbortController` with a reactive signal.** Add a helper `nodeSignal(aborted: Node<boolean>): AbortSignal` that returns an AbortSignal that fires when `aborted` emits `true`. Thread it into `adapter.invoke` + `fromAny`. Remove the mutable member; `effAbort` collapses to `effect([aborted], ([isAborted]) => { if (isAborted) statusNode.emit("done"); })`.
2. **Consolidate closure-mirror patterns.** Either (a) migrate `chat.messages` + `tools.schemas` to factory-time seed (symmetric with `latestTurn` / `latestAborted`), OR (b) migrate `latestTurn` + `latestAborted` to direct `promptInput` deps and accept the in-fn `.cache` reads. **Recommendation: (a) — extend closure-mirror to all four.** Single pattern, symmetric, re-readable.
3. **Drop `Promise.resolve()` wrapper** in switchMap project — `fromAny(adapter.invoke(...))` directly. One LOC.
4. **Remove deprecated `turnCount` alias.**
5. **Add `meta.closureReads: [...]` to `promptInput` / `effResponse` / `effResults`** so `describe()` can render dashed edges for sampled-but-not-triggering deps. Renderer/tooling picks it up; no behavior change.
6. **`run()` hardening:** keep the Promise bridge as-is for user ergonomics. Add a deprecation note if a reactive-only `waitForDone()` helper ships first — but don't break `run()` in this session.

**Not in this implementation session:**
- Reshaping agentLoop as `harnessLoop` sugar (Ring 2 unification). Dedicated session.
- Extracting `promptInvocation` / `toolExecution` as first-class primitives. Wait for second caller.

#### Q8 — Alternative implementations (A/B/C/D)

- **(A) Drift cleanup (recommendation).** Items 1–5 above. Pros: preserves well-tested shape, retires the drift-candidates. Cons: 700 LOC stays; composition-guide density unchanged.
- **(B) Reshape as harnessLoop sugar.** agentLoop = harnessLoop with `INTAKE=user message`, `GATE=interceptToolCalls`, `EXECUTE=tool execution`, `REFLECT=done vs continue`. Pros: unifies Ring 2; massive code-reuse; showcase-worthy. Cons: destabilizes harness + agent tests simultaneously; big-bang refactor; needs a dedicated session.
- **(C) Refactor into smaller factories.** `promptInvocation`, `toolExecution`, `agentStateMachine`. Pros: reusable parts. Cons: API surface widens without obvious second caller; premature.
- **(D) Reactive-only API: drop `run()` / `abort()`.** Force callers to subscribe. Pros: 200+ LOC removal, no `_runVersion` / `_running` / Promise bridge. Cons: hostile to users who want `await agent.run()` ergonomics; breaks tests; harness/demos use `run()`.

Recommendation: **A now; flag B as open design question for a dedicated session.**

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3/Q6) | Covered by |
|---|---|
| `_currentAbortController` mutable member + drift | A1 — `nodeSignal(aborted)` helper |
| Closure-mirror pattern inconsistency (4 deps, 2 patterns) | A2 — extend closure-mirror to all four |
| `Promise.resolve(adapter.invoke(...))` wrapper wart | A3 — drop it |
| Deprecated `turnCount` alias | A4 — remove |
| Closure reads hidden in `describe()` | A5 — `meta.closureReads: [...]` annotation for tooling |
| P3 gray-zone `chat.allMessages() / tools.schemas.cache` reads | Covered by A2 (both become closure mirrors) |
| `_runVersion` stamping workaround | Not covered — awaitSettled native support is a separate open item |
| `agentLoop` ↔ `harnessLoop` unification | Deferred to B (dedicated session) |
| `run()` Promise bridge complexity | Kept as-is; user ergonomics > LOC |
| `effAbort` late-fire polluting status log | Not covered (cosmetic; revisit if user-visible) |

**Open questions — requires user call:**
1. **Closure-mirror consolidation direction** — A2 (a) extend closure-mirror to chat.messages + tools.schemas, OR A2 (b) collapse latestTurn/latestAborted into direct deps + accept in-fn `.cache` reads. Recommendation: **(a)** — symmetric. Confirm?
2. **`agentLoop` as `harnessLoop` sugar** — spin up a dedicated post-Wave-A reshape session? Or defer indefinitely? Recommendation: **spin up after Wave B completes** (harness review may surface the exact shape needed).
3. **`run()` Promise bridge** — keep as-is (user ergonomics), or deprecate in favor of reactive-only + a `waitForDone(agent) → Promise` helper? Recommendation: **keep `run()`** — 80%+ of agent users want the Promise ergonomics; dropping it raises adoption cost.
4. **`meta.closureReads: [...]` annotation** — useful only if `describe()` renderers pick it up. Worth adding speculatively, or wait for a renderer? Recommendation: **add speculatively** (tiny cost; surfaces intent).
5. **`effAbort` late-fire status-log pollution** — cosmetic; ignore or add a status guard (`if (latestStatus !== "done") statusNode.emit("done")`)? Recommendation: **add the guard** — one line, prevents log noise.
6. **`_runVersion` workaround retirement** — defer to an `awaitSettled` enhancement in `extra/sources.ts`? Low urgency.

#### Decisions locked (2026-04-23)

User direction: **prefer C (extract reusable factories)**, with B as a further step if possible. "agentLoop or harnessLoop are just two possible compositions out of hundreds; if we abstract to the right level, users compose their own loops."

- **Q1: extend closure-mirror to `chat.messages` + `tools.schemas`** (symmetric §28).
- **Q2: harnessLoop reshape deferred to post-Wave-B**, but take this factoring into account when reviewing harness (Units 15–22 should use the same extracted primitives where they overlap). C factoring is the foundation for B.
- **Q3: keep `run()` Promise bridge.**
- **Q4: add `meta.closureReads: [...]` annotation.**
- **Q5: add `effAbort` status guard.**
- **Q6 (_runVersion retirement): `awaitSettled` infrastructure answer.**
  - Verified: Node has public `readonly v: Readonly<NodeVersionInfo> | undefined` (node.ts:309) but it's **content-dedup versioning** (same value → RESOLVED), NOT per-emission sequence. Not the right tool.
  - `awaitSettled(source, { predicate, timeoutMs })` has no `fromNow`/`afterVersion` option today.
  - **Decision: add `awaitSettled(source, { skipCurrent: true })` enhancement in `extra/sources.ts`** — ~10 LOC. Ignores the cached initial DATA and only resolves on future emissions. Retires `_runVersion` stamping entirely. `_terminalResult` emits `LLMResponse` directly (not compound `{response, runVersion}`).

**Core shape pivot — Option C: extract reusable primitives.**

Key realization: Unit 1's `promptNode` (recommended shape C+D) and Unit 4's proposed `promptInvocation` are the **same primitive**. Unifying them drops duplicate scope and pays back the Ring 2 unification investment.

**Extracted primitives:**

1. **`promptNode(adapter, deps, prompt, opts)`** — Unit 1's recommended shape, **with an added `abort?: Node<boolean>` option** that threads into `adapter.invoke({signal})` + `fromAny({signal})` via the `nodeSignal(abort)` helper. Single primitive covers "one-shot LLM call" + "LLM call inside a state machine with cancellation." agentLoop uses it with `abort: this.aborted`.

2. **`toolExecution({ toolCalls, tools, retryCount?, onError? })`** — lift `executeToolReactively` (agent-loop.ts:640) to a public primitive. Handles per-call `retrySource` + `rescue` + ToolResult shaping. Usable standalone (any caller with a reactive tool-call batch).

3. **`nodeSignal(aborted: Node<boolean>): AbortSignal`** — small extra helper that converts a reactive boolean state to a browser-standard AbortSignal. Fires `abort()` when the node emits `true`. Used by promptNode + any future primitive needing reactive cancellation.

4. **`awaitSettled(source, { predicate?, timeoutMs?, skipCurrent?: true })`** — the infrastructure enhancement that retires `_runVersion`.

**agentLoop becomes composition** (not a monolithic factory):
- `chatStream` + `toolRegistry` subgraphs (unchanged).
- state nodes: `status`, `turn`, `aborted`, `lastResponse` (state mirror).
- closure mirrors for `latestTurn` / `latestAborted` / `latestMessages` / `latestSchemas` (all four symmetric §28).
- `invokeInput` (gated on status, samples closures) → `promptNode({ deps: [invokeInput], ..., abort: aborted })` → `llmResponse`.
- state-machine effects drive status transitions (unchanged shape, minus abort drift).
- `toolCalls` raw node → `interceptToolCalls` splice → `toolExecution({toolCalls, tools, retryCount: 1, onError: "rescue"})` → `toolResults`.
- `_terminalResult` uses `awaitSettled({ skipCurrent: true })`; no runVersion stamp.
- `run()` + `abort()` + public API surface unchanged.

**Estimated scope for Unit 4 implementation session:**
- ~150 LOC extracted as `toolExecution` (new file: `src/patterns/ai/agents/tool-execution.ts` — candidate location; or colocate with toolRegistry).
- Unit 1's implementation-session (promptNode rewrite) lands the `abort?: Node<boolean>` option at the same time.
- ~10 LOC `awaitSettled` enhancement + test.
- ~5 LOC `nodeSignal(aborted)` helper.
- agentLoop drops from ~700 LOC to ~400 LOC (rough estimate).
- Remove `_runVersion` + `_currentAbortController` + `turnCount` alias.
- Add `effAbort` status guard (Q5).
- Add `meta.closureReads` annotations (Q4).

**Cross-unit implications:**
- **Unit 1** gains the `abort?: Node<boolean>` option — update Unit 1's locked scope. Flag below.
- **Wave B harness review (Units 17–22)** must evaluate whether the same `promptNode` + `toolExecution` primitives fit the `EXECUTE` / `VERIFY` stages. If yes → harnessLoop reshape (Q2 B) becomes tractable in a follow-up session.
- **Unit 6 (`ToolRegistry`)** is unaffected — `toolExecution` consumes ToolRegistryGraph as-is.
- **Unit 14 firstDataFromNode migration** — `executeToolReactively`'s `Promise.resolve().then(...)` trick around `tools.execute` is in this scope; the reactive-compose migration touches the same code path. Cross-reference in Unit 14 planning.

**Unit 1 scope addition (retroactive):** add `abort?: Node<boolean>` option to the `promptNode` rewrite. One extra arg threaded through the `fromAny(..., { signal })` already recommended.

---

### Unit 5 — `handoff` + `toolSelector`

**Scope:** [handoff.ts](../../src/patterns/ai/agents/handoff.ts) (110 LOC), [tool-selector.ts](../../src/patterns/ai/agents/tool-selector.ts) (90 LOC). Total ~200 LOC.

#### Q1 — Semantics, purpose, implementation

- **`handoff(from, toFactory, opts?)`** — multi-agent routing sugar (COMPOSITION-GUIDE §29). Thin composition over `switchMap` + `fromAny` + optional gate.
  - Without `condition`: `switchMap(src, v => v == null ? nullState : toFactory(state(v)))`.
  - With `condition`: pairs `(src, cond)` via a `router` derived, then `switchMap` branches between `toFactory(state(v))` (open) and `state(v)` pass-through (closed).
  - Shared `nullState` reused across null emissions — allocation-churn optimization.
  - Specialist is mounted **per-emission** — each source emission allocates a fresh `state<T>(v)` input + invokes `toFactory`. switchMap cancels stale branches.
- **`toolSelector(allTools, constraints, opts?)`** — reactive tool availability (§31). Pure `derived([allTools, ...constraints], (values) => filtered)`.
  - Each constraint is a `NodeInput<(tool) => boolean>`. A tool passes iff every predicate returns true.
  - Null-predicate pass-through: a not-yet-ready predicate doesn't exclude tools (treats unsettled as "no opinion").
  - Reference-equality dedup on the returned array.

#### Q2 — Semantically correct?

- ✅ `handoff` — correct switchMap semantics; pre-allocated `nullState` avoids the churn of `state(null)` per null emission.
- ✅ `handoff` condition gate — open/closed branches produce comparable `Node<T | null>` shapes.
- ✅ `toolSelector` null-predicate pass-through is the right default (async predicates shouldn't silently drop all tools on first emit).
- ✅ `toolSelector` reference-equality dedup works correctly for stable toolRegistry schemas (refs update only on register/unregister).
- ⚠️ **`handoff` per-emission specialist allocation** — each emission mounts a fresh `toFactory(state(v))` subgraph. For a `promptNode` specialist, that means a new messagesNode + switchMap + LLM call per source emission. High-frequency sources create churn. Not a correctness bug; a perf caveat.
- ⚠️ **`handoff` pass-through closed-gate branch** also allocates a fresh `state<T | null>(v)` per emission. Could reuse a single closed-gate state with imperative updates inside switchMap… but that breaks reactive hygiene. Accept.
- ⚠️ **`toolSelector` predicate-throw** propagates as ERROR on the tool-set node — a single buggy predicate breaks the entire selection. No opt-in silent-exclude option.

#### Q3 — Design-invariant violations?

- 🟢 Both pure reactive compositions: `switchMap` + `derived` + `fromAny` + `state`. Visible edges, no imperative.
- 🟢 §29 handoff pattern exactly mapped ("full handoff" branch).
- 🟢 §31 dynamic tool selection exactly mapped.
- 🟢 No raw async, no `.cache` reads, no closure-state surprises (just the shared `nullState`).

**Nothing to fix here.** These are the cleanest primitives in Wave A so far.

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §D8 `toolSelector`](../../docs/roadmap.md), [§B10 `handoff`](../../docs/roadmap.md) — both shipped.
- [optimizations.md "D8 regression test for B10 handoff"](../../docs/optimizations.md) — shipped.
- No open items for either primitive.
- **Not in optimizations.md — surfaced this review (minor):**
  - `handoff` per-emission specialist allocation — document as JSDoc perf caveat.
  - `toolSelector` predicate-throw policy — optional opt-in "continue on throw" behavior.

#### Q5 — Right abstraction? More generic possible?

- **`handoff` — marginal sugar, but named-idiom value.** It's 15-30 LOC more than users writing `switchMap + fromAny + conditional specialist factory` themselves. The value is (a) `handoff` is the searchable term matching §29, (b) the `nullState` optimization is non-obvious, (c) the router-derived shape is a judgment call new users wouldn't replicate cleanly. Keep.
- **`toolSelector` — right abstraction.** The alternative (users hand-writing `derived([tools, ...constraints], filter)`) is almost the same LOC but lacks the null-predicate pass-through default. Keep.
- **Neither needs to be more generic.** `handoff` is specifically "route from → specialist with optional gate"; generalizing to "route from → N specialists with a router function" is the pattern `stratify` already provides. `toolSelector` is specifically "constrain a reactive list by N predicates"; generalizing to "filter any reactive list by N predicates" has a natural home but isn't pressing (users can do it themselves).

#### Q6 — Long-term caveats & maintenance burden

- **Low maintenance burden.** Both are short, single-responsibility factories with no mutable state (beyond the shared `nullState` optimization).
- **`handoff` perf caveat** — only concern. For high-frequency sources (e.g. handing off on every tool-call result), the per-emission subgraph mount/unmount thrashes. Document in JSDoc: "for infrequent handoffs (once per conversation turn), this is fine; for per-token routing, wire manually." Not a structural issue; a usage guideline.
- **`toolSelector` predicate-throw** — cosmetic hardening. Could add `onPredicateError?: 'throw' | 'deny' | 'allow'` option, default `'throw'`. Defer until a user hits it.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology — minimal composition:**

```ts
const intake = state({ topic: "urgent refund" });
const urgent = derived([intake], ([i]) => i.topic.includes("urgent"));
const result = handoff(
  intake,
  (input) => promptNode(specialistAdapter, [input], v => `specialist: ${v}`),
  { condition: urgent, name: "triage" },
);
result.subscribe(() => {});
```

`describe()`:

```
intake              (state)          -> urgent, triage::router
urgent              (derived)        -> triage::router
triage::router      (derived)        -> <switchMap-product>  [result]
  per emission: state(v) -> promptNode::messages -> promptNode::output (inner)
```

**Verdict — clean, no islands.** The inner specialist subgraph is visible under switchMap (per-emission mount shows up as a nested subtree in describe).

**`toolSelector` topology:**

```
allTools            (state/node)     -> tool-selector
constraint1         (derived)        -> tool-selector
constraint2         (derived)        -> tool-selector
tool-selector       (derived)        [returned]
```

**Verdict — textbook clean.** Every dep visible.

**Performance & memory footprint:**
- **`handoff`:**
  - Per emission: `state<T>(v)` allocation (~80 bytes) + subgraph mount (`toFactory(input)`).
  - For a `promptNode` specialist: ~3 nodes + messagesNode + switchMap-product (~500 bytes/LLM-call overhead + the wire call itself).
  - For simple specialists (e.g. `derived` wrappers): ~100-200 bytes/emission.
  - **High-frequency churn concern:** sources emitting >10x/second would mount/unmount fast enough to pressure GC. For the documented "multi-agent routing on conversation turns" use case (~1/sec at peak), negligible.
- **`toolSelector`:**
  - Per recompute: one `Array.filter` pass — O(|tools| × |constraints|).
  - For 20 tools × 3 constraints = 60 predicate evaluations per recompute. Trivial.
  - Array allocation per emission (the filtered result). Reference-equality dedup on returns prevents downstream spurious waves.
  - Memory: holds no state beyond deps. Negligible.

#### Q8 — Alternative implementations (A/B/C)

- **`handoff`:**
  - **(A) Status quo** (recommendation). Document per-emission perf caveat.
  - **(B) Drop `handoff`, tell users to write switchMap+fromAny themselves.** Pros: less surface. Cons: loses named §29 idiom; `nullState` optimization gets lost.
  - **(C) Persistent-specialist variant** — specialist mounted once, gated reactively via the condition. Specialist needs to read `from` as an explicit dep. More efficient but signature gets ugly (`handoff(from, specialistNode, { condition })` where specialistNode is expected to already take `from` as dep). Rejected — current signature is clearer for a "fresh specialist per handoff" semantic.
- **`toolSelector`:**
  - **(A) Status quo** (recommendation). Optional: add `onPredicateError?` option later.
  - **(B) Generalize to `filterReactive(source, predicates)`** for any reactive list. Pros: reusable outside tool selection. Cons: no second caller today; `derived` already covers this in ~5 LOC.

Recommendation: **A for both. Document `handoff` perf caveat in JSDoc.**

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q6) | Covered by |
|---|---|
| `handoff` per-emission specialist allocation | A — JSDoc caveat; usage guideline |
| `toolSelector` predicate-throw policy | Defer; current shape is correct default |

**Open questions — requires user call:**
1. **`handoff` — keep sugar or drop?** Recommendation: **keep** — §29-searchable, encodes `nullState` optimization, clean composition. Sub-question: add JSDoc perf caveat on high-frequency use?
2. **`toolSelector` predicate-throw option** — defer? Recommendation: **defer until a user hits it.**
3. **Minor: drop `handoff`'s pass-through `state<T>(v)` fresh-allocation per emission?** Optimization candidate — reuse a single closed-gate state with `.emit(v)` inside switchMap. Marginal win (~80 bytes/emission saved). Recommendation: **skip** — `state.emit` inside switchMap project fn crosses a reactive hygiene line (§28-ish); the cleaner allocation is worth the ~80B.

**Scope for implementation session (minimal):**
1. Add JSDoc perf caveat to `handoff` — "specialist re-mounts per source emission; batch high-frequency sources upstream."
2. Everything else: **no changes.**

#### Decisions locked (2026-04-23)

- **`handoff` kept as sugar.** Add JSDoc perf caveat on per-emission specialist mount. §29-searchable; encodes `nullState` optimization and router-derived judgment call.
- **`toolSelector` predicate-throw** — deferred. Current default (propagate ERROR) is correct; opt-in silent-exclude can ship when a user needs it.
- **`handoff` pass-through state fresh-allocation** — skipped. Reactive hygiene over ~80B/emission savings.

**Implementation-session scope for Unit 5:** 1 line of JSDoc on `handoff`. Cleanest unit in Wave A.

---

### Unit 6 — `ToolRegistry`

**Scope:** [tool-registry.ts](../../src/patterns/ai/agents/tool-registry.ts) (74 LOC).

#### Q1 — Semantics, purpose, implementation

A Graph subgraph owning a name-keyed registry of `ToolDefinition`s. Public surface:
- `definitions: Node<ReadonlyMap<string, ToolDefinition>>` — full map snapshot.
- `schemas: Node<readonly ToolDefinition[]>` — reactive array-view derived over `definitions`.
- `register(tool)` / `unregister(name)` — imperative boundary mutations: read `.cache`, build new Map, `.emit(next)`.
- `execute(name, args): Promise<unknown>` — O(1) Map.get + `tool.handler(args)` + `resolveToolHandlerResult` (Promise|Node|AsyncIter bridge).
- `getDefinition(name): ToolDefinition | undefined` — imperative cache read.

#### Q2 — Semantically correct?

- ✅ Map immutability via "new Map + emit" pattern is the canonical state-of-T-collection idiom.
- ✅ `unregister` idempotent (early-return on missing name).
- ✅ `schemas` derived with `initial: []` — subscribers get push-on-subscribe with an empty array even before any register.
- ✅ `keepalive(this.schemas)` ensures the derived survives whether or not external subscribers attach (schemas is the intended consumer surface).
- ✅ `execute` correctly bridges any `NodeInput`-shaped handler return via `resolveToolHandlerResult`.
- ⚠️ **Silent overwrite on re-register.** `register(tool)` with an existing name overwrites without warning. Might be intentional (upsert), but worth documenting — agents that register duplicate tools silently get the last-registered handler.
- ⚠️ **Read-modify-write reads `.cache` from within the boundary API.** Fine — these are external-consumer API boundaries (§28-sanctioned), not reactive fn bodies.
- ⚠️ **O(N) Map copy per register/unregister** — acceptable for typical tool counts (<50) but scales poorly if the registry is re-populated frequently.

#### Q3 — Design-invariant violations?

- 🟢 Boundary-layer imperative mutations (register/unregister/execute) are correctly placed outside reactive fn bodies.
- 🟢 `schemas` derived is clean.
- 🟢 `execute` uses `resolveToolHandlerResult` (→ `firstDataFromNode`) which is the boundary bridge for NodeInput-shaped results — sanctioned per §5.10 "async belongs in sources and runner layer."
- 🟡 **Cross-reference Unit 14:** `execute`'s call into `resolveToolHandlerResult` is one of the 4 `firstDataFromNode` consumers scheduled for reactive-compose migration. Cross-reference in Unit 14 planning.

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §4.4 "Tool registry"](../../docs/roadmap.md) — shipped.
- No explicit `toolRegistry` items in optimizations.md.
- **Surfaced this review:**
  - Migrate internal `state<Map>` storage to `ReactiveMapBundle` (version-counter + bulk APIs + O(1) has/get + reactive size).
  - Silent-overwrite-on-re-register: document as upsert semantics, or dev-mode warn.
  - `execute` ties into Unit 14 `firstDataFromNode` migration.

#### Q5 — Right abstraction? More generic possible?

- **Right abstraction.** ToolRegistry has specific semantics (name-keyed, handler invocation, JSON schemas array) — a generic `reactiveRegistry<T>` would ship naturally for pubsub/cache/priority-queue shapes that don't apply here.
- **Storage layer can be more generic.** Today `state<Map>` re-implements what `ReactiveMapBundle` already provides. The user-facing API stays the same; internal storage becomes the shared primitive. ✅ recommended.
- **Reactive registration not present.** No `registerFrom(Node<ToolDefinition>)` that subscribes and upserts on DATA. Premature — no caller today; if a discovery-service-driven registry emerges, add as a sugar.

#### Q6 — Long-term caveats & maintenance burden

- **Low burden.** 74 LOC, single responsibility, clear boundaries.
- **Scaling: O(N) Map copy per mutation.** For stable tool sets (<50 tools, registered once at startup), negligible. For dynamic registries (100+ tools with frequent churn), `ReactiveMapBundle` retires this.
- **Silent overwrite** — upsert semantics in disguise. Easy to accidentally double-register a tool from two initialization paths and lose the first. Low severity.
- **`execute` imperative API** is the right boundary shape — the reactive tool-call pipeline lives in `toolExecution` (Unit 4 C factoring), not here.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology — minimal composition:**

```ts
const reg = toolRegistry("r");
reg.register({ name: "add", /* ... */ });
reg.schemas.subscribe(() => {});
```

`describe()`:

```
definitions        (state, Map)       -> schemas
schemas            (derived)          -> [external subscribers]
```

**Clean. Two nodes, one edge.** No islands. `explain(definitions, schemas)` closes trivially.

**Migration to `ReactiveMapBundle` topology:**

```
definitions-bundle
  ├─ entries       (state<Versioned<{map}>>)   -> schemas
  └─ size          (derived)                    (available but unused by ToolRegistry)
schemas            (derived)
```

Same number of visible nodes; `ReactiveMapBundle` internals are a subgraph. Describe-surface unchanged (users still see `definitions` + `schemas` reactively).

**Performance & memory:**
- **Current:** O(N) Map copy per register/unregister. For 50 tools, each register = ~50 entry copies. 50 registers total = 1275 entry copies (N(N+1)/2). At ~40 bytes/entry = ~50KB allocation traffic over startup. Negligible.
- **With `ReactiveMapBundle`:** O(1) `.set` / `.delete` (version-bump only; no Map rebuild). 50 registers = 50 version bumps. Allocation traffic: ~zero. Scales flat regardless of registry size.
- **schemas derived:** O(N) array construction per emission — unchanged after migration.
- **Memory:** one Map per registry (shared structure via `ReactiveMapBundle` internal snapshot machinery if we opt into that). Negligible.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo** — 74 LOC, works.
- **(B) Migrate internal storage to `ReactiveMapBundle`** — O(1) mutations, built-in version counter, library-consistent. Public API unchanged (definitions + schemas stay reactive; register/unregister/execute/getDefinition unchanged signatures, implementations simplify to `.set()` / `.delete()` / `.get()`).
- **(C) Add `registerFrom(Node<ToolDefinition>)`** — reactive registration source. Premature; no caller.
- **(D) Add dev-mode warn on re-register** — silent-overwrite mitigation. Low value.

Recommendation: **B.** Clean win; scales better; library-consistent.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q6) | Covered by |
|---|---|
| O(N) Map copy per mutation | B — `ReactiveMapBundle` O(1) mutations |
| Silent overwrite on re-register | Not covered (defer; upsert semantics acceptable) |
| `execute` ties into Unit 14 `firstDataFromNode` migration | Cross-referenced; handled in Unit 14 |
| Version-counter for reactivity dedup | B — built-in |

**Open questions — requires user call:**
1. **Migrate to `ReactiveMapBundle` (B)?** Recommendation: **yes.** Scales better, library-consistent, same public API.
2. **Silent overwrite** — keep as upsert semantics, or add dev-mode warn? Recommendation: **keep as upsert** (common registry pattern; callers who want error-on-duplicate can wrap).
3. **`registerFrom(Node<ToolDefinition>)` reactive sugar** — defer? Recommendation: **defer** (no caller).

**Implementation-session scope for Unit 6** (minimal):
1. Internal: `this.definitions: state<Map>` → `ReactiveMapBundle<string, ToolDefinition>`.
2. `register` / `unregister` → `bundle.set()` / `bundle.delete()`.
3. `getDefinition` → `bundle.get()`.
4. `schemas` derived reads from bundle's map view instead of `state.cache`.
5. `execute` unchanged (still `bundle.get()` + handler call).
6. `definitions: Node<ReadonlyMap<...>>` public surface: expose as a derived over the bundle's map view so existing consumers (agentLoop reading `.cache`) stay working. Or change to `Node<ReadonlyMap<...>>` over the bundle's `data` view — one unwrap layer.

#### Decisions locked (2026-04-23)

- **Migrate to `ReactiveMapBundle` (B).** Internal storage only; public API unchanged.
- **Silent overwrite kept as upsert semantics.** Callers who want error-on-duplicate wrap externally.
- **`registerFrom(Node<ToolDefinition>)` deferred.** No caller today.

---

### Unit 7 — `agentMemory` orchestration

**Scope:** [memory/agent-memory.ts](../../src/patterns/ai/memory/agent-memory.ts) (614 LOC). Composition kit wiring 5 optional capabilities.

#### Q1 — Semantics, purpose, implementation

agentMemory is a **composition factory**, not a primitive. It wires already-existing primitives (`distill`, `vectorIndex`, `knowledgeGraph`, `lightCollection`, `memoryTiers`) into a pre-configured agentic-memory graph.

**Mandatory pipeline:**
- `source → admissionFilter → distill(extractFn) → store` (the core).
- Extraction: either user `extractFn` OR `llmExtractor(adapter, extractPrompt)`.

**Optional capabilities (each opt-in):**
- **Consolidation:** `fromTimer(interval)` (default 5 min) triggers `distill.consolidate` via `consolidateFn` or `llmConsolidator`.
- **Vector index** (`opts.vectorDimensions > 0` + `embedFn`): `effect([storeNode], indexer)` upserts embeddings.
- **Knowledge graph** (`enableKnowledgeGraph` + `entityFn`): same indexer effect upserts entities/relations.
- **3-tier storage** (`opts.tiers`): **`tierClassifier` effect** on storeNode runs per-store-change scan → computes decayed scores → writes to `permanent` collection (via `upsert`) and deletes low-scored keys from active store (via `distillBundle.store.delete()`).
- **Retrieval** (vectors OR kg enabled): exposes two APIs:
  - `retrieve(query): Readonly<Entry[]>` — synchronous boundary API; reads `.cache`, computes via shared `runRetrieval`, batch-writes `retrievalOutput` + `traceState` state nodes.
  - `retrieveReactive(queryInput): Node<Entry[]>` — derived over `[storeNode, contextNode, query]`; fully reactive; does NOT write the state nodes.

**Closure-held mutable state:**
- `permanentKeys: Set<string>` — tracks permanent-classification keys; read in `tierOf`, written in `markPermanent`.
- `entryCreatedAtNs: Map<string, number>` — tracks creation times for decay-age calculation; grows with active entries.
- `keepaliveSubs: Array<() => void>` — cleanup registry.

#### Q2 — Semantically correct?

- ✅ `distill` core correctly composes; extraction + consolidation wired properly.
- ✅ `runRetrieval` is a pure function, reused by both `retrieve()` (imperative) and `retrieveReactive()` (reactive). Good separation.
- ✅ Admission filter uses `return undefined` (§2.4 no-auto-emit) — correct.
- ✅ `fromTimer` as consolidation trigger — correct reactive source.
- ✅ `batch(() => for (delete))` inside tierClassifier correctly coalesces multiple deletes into one snapshot wave.
- ⚠️ **Feedback cycle in `tierClassifier` (§7 pattern).** Effect's deps: `[storeNode, contextNode]`. Effect writes back to the store via `distillBundle.store.delete(key)`. Each delete triggers a new `storeNode` emission, which re-fires the effect. Converges because each wave reduces archival candidates, but it's a fixpoint iteration — fragile and O(iterations × N).
- ⚠️ **Closure state invisible in `describe()`** — `permanentKeys` / `entryCreatedAtNs` hold per-entry metadata that semantically belongs on the graph (are these nodes? Could be). Opaque to explain().
- ⚠️ **Asymmetric observability:** `retrieve()` writes `retrievalOutput` + `traceState`; `retrieveReactive()` emits its own derived but does NOT mirror to these state nodes. A caller subscribing to `memory.retrieval` only sees `retrieve()` outputs, not `retrieveReactive()` outputs. Inconsistent.
- ⚠️ **`tierClassifier` runs full-scan on every store change.** O(N) per insert. For frequent inserts to a large store → O(N²) cumulative. Reasonable for <500 entries; scales poorly.
- ⚠️ **`indexer` (vector + KG) also runs full-scan on every store change.** Same O(N²) concern. For vector indexes of 10k entries with frequent updates, this is measurable.
- ⚠️ **`state<unknown>(null)` when no context** (two allocations at lines 296 + 427) — minor but duplicated.

#### Q3 — Design-invariant violations?

- 🔴 **§7 feedback cycle in `tierClassifier`.** Effect writes back to its own reactive dep. Converges only because the fixpoint is monotone (archive lowers count, eventually no more to archive). Not an infinite loop in practice, but §7 explicitly warns against this pattern.
- 🟡 **Closure state (`permanentKeys`, `entryCreatedAtNs`) invisible in `describe()`** — similar to agentLoop's latestTurn/latestAborted mirrors, but here they carry more semantic weight (tier classification). §28 factory-time seed sanctions closure-held mirrors of STATE NODES; this is closure-held mutable state that isn't mirroring any node — it's ownership. Different class of hidden state.
- 🟡 **`distillBundle.store.delete(key)` imperative write from effect body** — bundle-boundary write, usually sanctioned. But inside an effect whose dep IS the same store, it's §7-adjacent.
- 🟢 No raw async, no polling, no imperative triggers out of reactive layer. `fromTimer` used correctly for reflection.
- 🟢 `retrieveReactive` is purely reactive; `retrieve` is boundary-imperative (documented correctly).
- 🟢 Central-timer used (`monotonicNs` + `fromTimer`).

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §4.4 "agentic memory"](../../docs/roadmap.md) — all capabilities shipped.
- [optimizations.md "Re-indexes entire store on every change" — Deferred](../../docs/optimizations.md) — acknowledged; decision was "diff-based indexing via version counter, deferred to after Phase 6 — current N is small enough that full re-index is acceptable pre-1.0."
- [optimizations.md "Budget packing always includes first item" — Documented behavior](../../docs/optimizations.md) — intentional "never return empty" semantics.
- [optimizations.md "Retrieval pipeline auto-wires when vectors/KG enabled" — Documented behavior](../../docs/optimizations.md) — intentional; no opt-out per stage.
- **Surfaced this review:**
  - **`tierClassifier` feedback cycle** — §7 pattern; fix candidate.
  - **Closure state visibility** — promote `permanentKeys` / `entryCreatedAtNs` to reactive nodes? Or document the ownership clearly?
  - **Asymmetric observability** — retrieveReactive doesn't mirror to state nodes.
  - **O(N²) full-scan indexing** — already tracked as deferred.

#### Q5 — Right abstraction? More generic possible?

- **agentMemory IS a composition kit**, not a primitive. It bundles 5 optional capabilities into one factory. Users who want distill + vectors + KG + tiers don't want to wire 5 effects themselves.
- **Core primitives already exist and are reusable** — `distill`, `vectorIndex`, `knowledgeGraph`, `lightCollection`, `memoryTiers` are in `patterns/memory/`. agentMemory only adds: (a) wiring, (b) `runRetrieval` helper, (c) tierClassifier effect, (d) indexer effect, (e) dual retrieve API.
- **Per user's Unit-4 directive (C factoring):** extract smaller memory composers? Possible shape:
  - `memoryWithVectors(store, embedFn, opts)` → adds vector index effect.
  - `memoryWithKG(store, entityFn, opts)` → adds KG effect.
  - `memoryWithTiers(store, opts)` → adds tier classifier.
  - `memoryRetrieval(store, vectors?, kg?, opts)` → builds retrieve + retrieveReactive.
  - `agentMemory` becomes sugar: `memoryWithVectors(memoryWithTiers(distill(source, extractFn)), embedFn)` etc.
- **Tension:** user writes `agentMemory({ source, extractFn, score, cost, vectorDimensions, embedFn, enableKnowledgeGraph, entityFn, tiers })` — ONE call with 8+ opts; decomposing means 4 composed calls, each with its own slice of opts. Ergonomics loss vs factoring win.
- **Recommendation:** keep `agentMemory` as the ergonomic sugar. Extract `memoryWithVectors`, `memoryWithTiers`, `memoryRetrieval` as underlying composers — agentMemory is then a thin `(source, opts) => memoryRetrieval(memoryWithTiers(memoryWithVectors(distill(source, ...))))` pipeline. Power users compose themselves; common case stays ergonomic.

#### Q6 — Long-term caveats & maintenance burden

- **Moderate maintenance burden.** 614 LOC, but mostly conditional wiring — not dense state-machine logic. The real hotspots:
  - tierClassifier feedback cycle — converges today; fragile if thresholds/scoring change.
  - Closure state (`permanentKeys`, `entryCreatedAtNs`) — invisible ownership; hard to debug "why was X archived?" without adding logging.
  - Asymmetric observability — user confusion likely.
  - O(N²) full-scan indexing — scales poorly; accepted deferral.
- **Low correctness risk.** Core primitives are well-tested in `patterns/memory/`. agentMemory is wiring.
- **High documentation burden.** 8+ opts, 2 retrieve APIs, tier semantics, consolidation behavior, admission filter — large surface to explain. JSDoc is extensive but user-friendliness is strained.
- **Long-term reshape candidate (per user C directive):** decompose into `memoryWith*` composers. Not urgent, pays back when harness/orchestration reviews want to reuse subsets.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check — minimal composition:**

```ts
const mem = agentMemory("m", source, {
  extractFn: (raw) => ({ upsert: [{ key: "1", value: raw }] }),
  score: (m) => 1,
  cost: (m) => 10,
  budget: 100,
});
```

`describe()` (minimal):

```
source                              -> admissionFilter? -> distillBundle.store
distillBundle.store    (bundle)     -> distillBundle.compact, distillBundle.size
distillBundle.compact  (derived)
distillBundle.size     (derived)
```

**Clean minimal topology.** With tiers/vectors/kg/retrieval enabled:

```
source → distill → store (bundle)
                   ├─→ [tierClassifier effect] (writes back to store — §7 feedback-adjacent)
                   ├─→ [indexer effect] (writes to vectors/kg — external)
                   ├─→ retrievalOutput (state)     [written by retrieve() only]
                   └─→ traceState (state)          [written by retrieve() only]

vectors.entries (optional)         [written by indexer effect]
kg subgraph (optional)              [written by indexer effect]
permanent.entries (optional)        [written by tierClassifier effect via markPermanent]

retrieveReactive(queryInput) constructs: derived([storeNode, contextNode, queryInput], runRetrieval)
  -- standalone node, not connected to retrievalOutput/traceState
```

**Islands / invisible edges:**
- tierClassifier writes to store — invisible edge (imperative `.delete()`).
- tierClassifier reads `permanentKeys`, `entryCreatedAtNs` — invisible closure state.
- retrieveReactive outputs are NOT mirrored to retrievalOutput/traceState — observability asymmetry.
- `explain(source → retrievalOutput)` would traverse `source → distill → store → retrieve()` — but `retrieve()` is a function, not a node edge. Gap.

**Performance & memory:**
- **Per store change** (insert/update/delete):
  - tierClassifier: O(N) full-scan.
  - indexer: O(N) re-embed for ALL entries (not just new — line 387 iterates `storeMap`).
  - Combined: O(N) per change. For bursty inserts of K items: O(K × N).
- **Retrieval:** O(|vectorCandidates| + |kg-expansion| + |store|) per call.
- **Memory:**
  - `permanentKeys`, `entryCreatedAtNs` — O(|active|) + O(|permanent|). Closed over for lifetime of the factory.
  - `retrievalOutput` / `traceState` hold last result (ROM).
  - `runRetrieval` allocates candidateMap, ranked array, packed array per call — transient.
- **Reflection:** `fromTimer` subscribes per-factory. Bounded.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo + targeted fixes.** Fix tierClassifier feedback cycle pattern; mirror retrieveReactive to state nodes; document closure state. Keep monolithic `agentMemory` factory.
- **(B) Decompose into `memoryWith*` composers.** Extract memoryWithVectors, memoryWithKG, memoryWithTiers, memoryRetrieval. `agentMemory` becomes thin sugar over the pipeline. Aligns with user's C directive.
- **(C) Replace tierClassifier feedback cycle with a dedicated reactive pattern:**
  - Option C1: introduce a "retention policy" on `ReactiveMapBundle` — the bundle itself enforces size/score cap reactively, no external effect writes back.
  - Option C2: tierClassifier computes a DERIVED set of "keys to archive" and a SIDE-CHANNEL effect subscribes-and-deletes at the boundary (not as a dep).
  - Option C3: do tier classification at EXTRACTION time (inside distill's extractFn wrapper), so archiving happens in the same wave as the insert — no feedback cycle.
- **(D) Promote closure state to reactive nodes.** `permanentKeys` becomes `permanentKeysState: Node<ReadonlySet<string>>`; `entryCreatedAtNs` becomes a `reactiveMap<string, number>`. Everything visible in describe. More allocation; cleaner audit trail.

Recommendation: **A + B + C3** together.
- **A**: fix asymmetric observability (1 batch emit in retrieveReactive's path); document closure state.
- **B**: extract `memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval` composers per user's C directive. `agentMemory` stays as sugar over the pipeline.
- **C3**: move tier classification into the extraction-time pipeline (happens during distill's wave, not after). Kills the feedback cycle without redesigning reactive primitives.

**D (promote closure state)** — defer. Cost not worth it today; becomes relevant if a user complains about "why was X archived?" debuggability.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3/Q6) | Covered by |
|---|---|
| tierClassifier feedback cycle (§7) | C3 — tier classify during extraction wave |
| Closure state invisible in describe | A — document ownership clearly (defer D to future) |
| Asymmetric observability (retrieve vs retrieveReactive) | A — retrieveReactive batch-emits to retrievalOutput/traceState too |
| O(N²) full-scan indexing | Deferred (already tracked in optimizations.md) |
| Scope creep / composition kit | B — memoryWith* composers per user C directive |
| Duplicate `state<unknown>(null)` for missing context | A — hoist to one shared noop state |

**Open questions — requires user call:**
1. **C factoring here too?** Per Unit-4 directive, decompose into `memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval` composers, keep `agentMemory` as sugar. Recommendation: **yes, same directive.** Confirm?
2. **tierClassifier fix approach — C1/C2/C3?**
   - C1: retention-policy on `ReactiveMapBundle` — library-wide change, impacts Unit 6 + any other reactive-map user. Biggest win but biggest scope.
   - C2: derived "keys to archive" + boundary effect — moderate; keeps the effect but breaks the feedback loop.
   - C3: tier classify at extraction time — smallest change, kills the cycle at the source.
   Recommendation: **C3** now; flag C1 as a follow-up candidate for a `ReactiveMapBundle` enhancement (Wave 4 post-1.0 could include it).
3. **Closure state promotion (D)** — defer until debuggability complaint surfaces? Recommendation: **defer.**
4. **`retrieveReactive` → observability state mirror** — batch-emit to retrievalOutput/traceState on every reactive query recompute? Recommendation: **yes** (one-line fix; closes the asymmetry).

#### Decisions locked (2026-04-23)

User chose the bigger-scope cleanups across the board — consistent with "abstract to the right level."

- **Q1: C factoring confirmed.** Extract `memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval` composers. `agentMemory` stays as ergonomic sugar over the pipeline.
- **Q2: C1 — retention policy on `ReactiveMapBundle`.** Library-wide change to `extra/reactive-map.ts`. Eliminates the feedback cycle at the source: the bundle itself enforces score/threshold-based retention on mutations. agentMemory's `tierClassifier` effect retires — the bundle fires an `onArchive(key, value)` callback (or emits on a dedicated archived-topic) that agentMemory wires to the permanent/archive tier.
- **Q3: Promote closure state to reactive nodes (D).** `permanentKeys` becomes `permanentKeysState: Node<ReadonlySet<string>>` (or a `ReactiveMapBundle<string, true>` used as a set). `entryCreatedAtNs` becomes a `reactiveMap<string, number>`. Both visible in `describe()`; debuggability for "why was X archived?" becomes a standard `graph.explain(...)` trace.
- **Q4: Mirror `retrieveReactive` to observability state.** `retrieveReactiveFn` batch-emits to `retrievalOutput` + `traceState` inside its derived fn (or via an accompanying effect). Symmetric observability.

**Cross-library scope flag — C1:**

C1 is a core-library change to `extra/reactive-map.ts`, outside Wave A's ai/harness scope. Scope:
- Extend `ReactiveMapOptions<K, V>` with a `retention?: { score, threshold, onArchive? }` (and/or `score, maxSize` interplay for capped eviction).
- Internal evaluation on every mutation (`.set` / `.setMany` / `.delete` paths): compute score, evaluate threshold, fire `onArchive(key, value)` before deletion.
- Optional: a dedicated `archived: TopicGraph<{key, value}>` sibling node on the bundle so users compose reactively rather than via callback.
- Tests at `src/__tests__/extra/reactive-map-retention.test.ts`.
- Documentation in COMPOSITION-GUIDE — likely its own section alongside §27.
- Impact on existing `ReactiveMapBundle` callers: additive — no behavior change unless `retention` is set.
- **Affects Unit 6** (ToolRegistry) — no retention needed there, but shares the infrastructure. No user-facing change for toolRegistry.

**Implementation-session scope for Unit 7** (substantial):

1. **`extra/reactive-map.ts`** — add `retention: { score, archiveThreshold, maxSize, onArchive? }` option. Internal enforcement on mutations. Optional `archived: TopicGraph<{key, value}>` sibling.
2. **Extract `memoryWithVectors(store, embedFn, opts)`** — new primitive in `patterns/ai/memory/` (file: `memory-vectors.ts`). Wires indexer effect for vectors.
3. **Extract `memoryWithKG(store, entityFn, opts)`** — new primitive (file: `memory-kg.ts`). Wires indexer effect for KG.
4. **Extract `memoryWithTiers(store, opts)`** — new primitive (file: `memory-tiers-composer.ts` or extend existing `tiers.ts`). Uses the new `ReactiveMapBundle.retention` — no feedback-cycle effect.
5. **Extract `memoryRetrieval(store, vectors?, kg?, opts)`** — new primitive (file: `memory-retrieval.ts`). Builds `retrieve` + `retrieveReactive` + observability state; `retrieveReactive` batch-emits to state nodes.
6. **Promote closure state** — `permanentKeysState: Node<ReadonlySet<string>>` (derive from `permanent.entries` bundle keys? or standalone state). `entryCreatedAtNs: reactiveMap<string, number>`. Visible in describe.
7. **`agentMemory` becomes sugar** — thin factory that composes the above. Public API (the AgentMemoryGraph shape) unchanged.
8. **Tests:** existing `agentMemory` tests stay green (public API unchanged); new tests for each extracted composer.

**Cross-unit implications:**
- **Unit 6 (`ToolRegistry`)** — now consumes the enhanced `ReactiveMapBundle` with optional retention (unused here). Internal migration (Unit 6 decision B) proceeds independently.
- **Unit 8 (memory primitives: tiers/admission/retrieval)** — types and helpers used by both agentMemory and the new composers. Review in Unit 8.
- **Unit 9 (`llmExtractor`/`llmConsolidator`)** — consumed by agentMemory's extractor/consolidator resolution. Unchanged shape.
- **Post-1.0 follow-up:** C1's retention API is the foundation. Additional retention modes (TTL-as-node, dependency-based eviction) become future work.

---

### Unit 8 — Memory primitives (`tiers.ts` + `admission.ts` + `retrieval.ts`)

**Scope:** [tiers.ts](../../src/patterns/ai/memory/tiers.ts) (43 LOC), [admission.ts](../../src/patterns/ai/memory/admission.ts) (49 LOC), [retrieval.ts](../../src/patterns/ai/memory/retrieval.ts) (69 LOC). Total ~160 LOC — mostly types.

#### Q1 — Semantics, purpose, implementation

- **`tiers.ts`** — pure type module + one constant:
  - `MemoryTier = "permanent" | "active" | "archived"`.
  - `MemoryTiersOptions<TMem>` — config for the tier classifier (decayRate, maxActive, archiveThreshold, permanentFilter, archiveTier, archiveStorageOptions).
  - `DEFAULT_DECAY_RATE = ln(2) / 7days ≈ 1.14e-6/s` — 7-day half-life.
  - `MemoryTiersBundle<TMem>` — the bundle shape returned by the tier wiring (permanent, activeEntries, archiveHandle, tierOf, markPermanent).
- **`admission.ts`** — "3D admission scoring" predicate helpers:
  - `AdmissionScores = { persistence, structure, personalValue }` — three 0–1 dimensions.
  - `admissionFilter3D(opts)` — returns a `(raw) => boolean` filter. Thresholds on persistence + personalValue; optional `requireStructured`.
  - `defaultAdmissionScorer` — returns `{0.5, 0.5, 0.5}` for all inputs. Default admits everything above the default 0.3 thresholds. Effectively a no-op unless user supplies a real `scoreFn`.
- **`retrieval.ts`** — pure type module:
  - `RetrievalQuery = { text?, vector?, entityIds?, context? }`.
  - `RetrievalPipelineOptions<TMem>` — topK, graphDepth, budget, cost, score, contextOf, contextWeight.
  - `RetrievalEntry<TMem> = { key, value, score, sources, context? }` — `sources: readonly ("vector"|"graph"|"store")[]` is the provenance tag.
  - `RetrievalTrace<TMem>` — causal trace: vectorCandidates → graphExpanded → ranked → packed.

#### Q2 — Semantically correct?

- ✅ `tiers.ts` type shapes correctly describe the tier classifier contract that agentMemory implements.
- ✅ `retrieval.ts` types correctly shape the pipeline — `sources` provenance supports explainability.
- ✅ `admissionFilter3D` correctly applies thresholds.
- ⚠️ **`defaultAdmissionScorer` is a dead default** — all dimensions 0.5 means every input passes the default 0.3 thresholds. Users who don't supply `scoreFn` effectively get "admit all." Misleading default.
- ⚠️ **"3D" abstraction is imposed, not discovered.** The persistence/structure/personalValue triple is one specific mental model (likely borrowed from LLM memory literature). Users with different domain models must either map their scoring into this triple or write their own `(raw) => boolean` — in which case `admissionFilter3D` provides no value.

#### Q3 — Design-invariant violations?

- 🟢 No reactive code in tiers.ts or retrieval.ts — just types. No invariant surface.
- 🟢 `admissionFilter3D` returns a pure function — used as `admissionFilter` option in agentMemory; gets mapped to a `derived` filter by agentMemory itself. Zero invariant concerns.

#### Q4 — Open items (roadmap / optimizations.md)

- Shipped. No explicit items.
- Under Unit 7 reshape, these types are consumed by the new composers (`memoryWithTiers`, `memoryRetrieval`). tiers.ts shrinks; retrieval.ts unchanged.

#### Q5 — Right abstraction? More generic possible?

- **`tiers.ts`** — right abstraction for today's wiring. Under Unit 7 C1 (retention on ReactiveMapBundle) + C factoring, `MemoryTiersOptions` and `MemoryTiersBundle` become input/output shapes for the `memoryWithTiers` composer. Some fields (archiveThreshold, maxActive) migrate to the bundle's `retention` config; agentMemory's `tierClassifier` disappears. Net effect: `tiers.ts` shrinks to just `MemoryTier` + `DEFAULT_DECAY_RATE` + the composer's bundle output shape.
- **`admission.ts`** — `admissionFilter3D` is specialization sugar. Right abstraction would be: a generic `admissionPredicate((raw) => boolean)` primitive (if any at all) + drop the 3D type family. Users write their own predicate or use LLM-backed classification. The "3D" isn't a pattern in the graph sense; it's a doc template.
- **`retrieval.ts`** — right abstraction. `sources` provenance + trace shape are solid primitives. Keep.

#### Q6 — Long-term caveats & maintenance burden

- **Low burden across the unit.** Types change rarely; the tiers types retire into the composer shape after Unit 7 reshape.
- **`admission.ts` is the only real maintenance question.** Is "3D admission" a library primitive, or a user pattern? If the latter, it's library dead weight. Current shipped use: one example in the docstring pointing at `agentMemory`. No in-tree consumers.
- **`tiers.ts` `DEFAULT_DECAY_RATE` is domain-specific** (7-day half-life). Reasonable default; domain apps will override.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check:** none — types + pure predicate. Nothing reactive here to check.

**Perf / memory:** trivial. Types have no runtime cost. `admissionFilter3D` is O(1) per input; wrapped into agentMemory's `derived` filter.

**Simplification pass under Unit 7 reshape:**

- **`tiers.ts`** → migrate `maxActive` / `archiveThreshold` fields to `ReactiveMapBundle.retention` option (per C1). Keep `MemoryTier` + `DEFAULT_DECAY_RATE` + `permanentFilter` + `archiveTier` + `archiveStorageOptions`. ~30 LOC.
- **`admission.ts`** → **drop `admissionFilter3D` + `AdmissionScores` types + `defaultAdmissionScorer`**. Move the 3D pattern to a docs example under `docs/docs-guidance.md` or agentMemory's JSDoc. Users pass `admissionFilter: (raw) => boolean` directly. File retires.
- **`retrieval.ts`** → unchanged. Types are clean and consumed by `memoryRetrieval` composer.

Net effect: ~50 LOC retires; `admission.ts` file deleted; `tiers.ts` shrinks by ~15 LOC; `retrieval.ts` unchanged.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo** — keep all three files unchanged.
- **(B) Under Unit 7 reshape:**
  - `tiers.ts` — retain types, shrink by migrating retention-related fields.
  - `admission.ts` — delete; 3D pattern moves to docs.
  - `retrieval.ts` — unchanged.
- **(C)** — generalize admission to `admissionPredicate(fn)` helper + retain 3D as optional sugar.

Recommendation: **B.** The 3D admission abstraction isn't a reusable primitive; it's a pattern. Library dead weight when users supply their own predicates.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q6) | Covered by |
|---|---|
| `defaultAdmissionScorer` misleading default | B — drop the file; no confusing defaults |
| 3D abstraction imposed vs discovered | B — move to docs pattern; users write own predicates |
| `tiers.ts` vestigial fields after Unit 7 C1 | B — migrate retention fields to ReactiveMapBundle |
| `retrieval.ts` cleanliness | Unchanged |

**Open questions — requires user call:**
1. **Delete `admissionFilter3D` + 3D type family?** Recommendation: **yes** — library dead weight; 3D pattern becomes a docs example. Confirm?
2. **`tiers.ts` post-C1 shape** — migrate `maxActive` / `archiveThreshold` into the `ReactiveMapBundle.retention` config, leave `permanentFilter` + `archiveTier` + `archiveStorageOptions` in `MemoryTiersOptions`. OK?

**Implementation-session scope for Unit 8** (folded into Unit 7 implementation, since they're co-dependent):
1. Delete `admission.ts` (move 3D pattern to docs).
2. Shrink `tiers.ts` — migrate retention fields into the Unit 7 C1 work.
3. Retain `retrieval.ts`.

#### Decisions locked (2026-04-23)

- **Q1: C — generalize admission primitive.**
  - Ship `admissionScored<Dims>(scoreFn, thresholds)` — multi-dimensional generic: scoreFn returns a `Record<string, number>`, thresholds are per-dim minimums. Any dim below threshold → reject. Dims with no threshold are ignored.
  - Retain `admissionFilter3D(opts)` as thin sugar over `admissionScored` with explicit persistence/personalValue/structure dimensions.
  - **Retire `defaultAdmissionScorer`** — always-0.5 is misleading ("admit all" in disguise). Users must supply a real scorer.
- **Q2: tiers.ts migration approved.** Move `maxActive` + `archiveThreshold` into `ReactiveMapBundle.retention` config (Unit 7 C1). Keep `permanentFilter` + `archiveTier` + `archiveStorageOptions` + `decayRate` in `MemoryTiersOptions`.

**Implementation-session scope (revised under C):**
1. Shrink `tiers.ts` — migrate retention fields into Unit 7 C1.
2. Refactor `admission.ts` — ship `admissionScored<Dims>(scoreFn, thresholds)` generic; rewrite `admissionFilter3D` as sugar; retire `defaultAdmissionScorer`.
3. Retain `retrieval.ts`.

---

### Unit 9 — `llmExtractor` + `llmConsolidator` (+ `retrieveFn`)

**Scope:** [memory/llm-memory.ts](../../src/patterns/ai/memory/llm-memory.ts) (147 LOC). Session doc originally scoped `retrieveFn` here too — `retrieveFn` is defined inside [agent-memory.ts](../../src/patterns/ai/memory/agent-memory.ts) (line 557), already covered by Unit 7. Not re-covered here.

#### Q1 — Semantics, purpose, implementation

Both functions return a callback compatible with `distill()`'s extract/consolidate slots:
- **`llmExtractor<TRaw, TMem>(systemPrompt, opts)`** — returns `(raw, existing) => NodeInput<Extraction<TMem>>`. Builds `[{role:system, content: prompt}, {role:user, content: JSON.stringify({input: raw, existingKeys: [...existing.keys()].slice(0, 100)})}]`, invokes adapter, parses JSON response as `Extraction<TMem>`.
- **`llmConsolidator<TMem>(systemPrompt, opts)`** — returns `(entries) => NodeInput<Extraction<TMem>>`. Same pattern but the user content is the full entries array.

Implementation pattern (duplicated across both):
- `producer<Extraction<TMem>>((actions) => { ... })`.
- Inside: manual `subscribe(resolved)` via `fromAny(adapter.invoke(messages, ...))`.
- Message loop: DATA → `JSON.parse` + emit + COMPLETE; ERROR → propagate; COMPLETE → propagate; unknown → forward (spec §1.3.6).
- Teardown: unsubscribe + `active = false` flag.

The two functions are **~95% identical boilerplate** — only the system prompt and user-content shape differ.

#### Q2 — Semantically correct?

- ✅ Uses `fromAny(adapter.invoke(...))` correctly (§5.10 compliant).
- ✅ `temperature: 0` default gives deterministic output.
- ✅ JSON.parse wrapped in try/catch → ERROR on parse failure.
- ✅ Manual message forwarding (§1.3.6) correct — but **redundant** (framework default handles this for derived).
- ⚠️ **95% duplicated body** (~130 LOC between the two functions).
- ⚠️ **Heavy `producer` shape.** Explicit `subscribe` + `active` flag + manual message loop + unsubscribe. A `derived([fromAny(...)], ([resp]) => JSON.parse(resp.content))` would be ~5 LOC and get ERROR/COMPLETE forwarding for free.
- ⚠️ **`actions.emit(parsed); actions.down([[COMPLETE]])` is NOT batched.** Two separate downstream invocations instead of one `actions.down([[DATA, parsed], [COMPLETE]])`. Matters for consumers that care about "emit + complete in one wave."
- ⚠️ **`existingKeys.slice(0, 100)`** — hardcoded cap. Maps with >100 entries partially signal dedup information; silent for larger stores.
- ⚠️ **No retry on parse failure** — LLMs occasionally return malformed JSON (fences, preamble text). Unit 1's `promptNode` had retry logic; consistency here missing.
- ⚠️ **Parse error message lacks raw content preview** — debugging a "failed to parse LLM response as JSON" without seeing the actual content is a needless speed bump.
- ⚠️ **No `stripFences` preprocessing.** LLMs often wrap JSON in ```json fences; the extractor can't even parse them. `promptNode` in Unit 1 uses `stripFences(content)` — consistency missing.

#### Q3 — Design-invariant violations?

- 🟢 §5.10 bridge path correct (`fromAny`).
- 🟡 **Heavy-handed producer boilerplate.** Spec doesn't forbid explicit producers, but the framework provides a simpler path (`derived` + built-in forwarding). Using `producer` for what should be `derived` is an anti-pattern by simplicity standards.
- 🟡 **Manual unknown-message-type forwarding** (§1.3.6) — correct but redundant. `derived` forwards automatically.

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §4.4 "agentic memory"](../../docs/roadmap.md) — both shipped as part of the memory layer.
- No explicit optimization entries.
- **Surfaced this review:**
  - Deduplicate via a shared `llmJsonCall` helper.
  - Switch from `producer` to `derived`.
  - Align with promptNode: stripFences preprocessing, retry on parse failure.
  - Configurable `maxExistingKeys` cap.
  - Batched DATA+COMPLETE emission.

#### Q5 — Right abstraction? More generic possible?

- **Both functions are instances of the same pattern.** Extract a shared `llmJsonCall<TIn, TOut>(systemPrompt, buildUserContent, opts): (input: TIn) => NodeInput<TOut>` primitive:
  - `llmExtractor` = `llmJsonCall` with input `{raw, existingKeys}` and output `Extraction<TMem>`.
  - `llmConsolidator` = `llmJsonCall` with input `entries` and output `Extraction<TMem>`.
- **Is `llmJsonCall` itself a primitive or sugar over `promptNode`?** Unit 1's `promptNode` (recommended shape C+D) with `format: "json"` already does most of this — it takes reactive deps + a prompt template and returns `Node<T | null>` with JSON parsing. But `llmJsonCall` is a one-shot `(input) => NodeInput<T>` factory, used by `distill()` via switchMap mount. Different shape (one-shot vs. reactive-derived).
- **Could we unify?** Yes — `llmJsonCall(sp, buildContent, opts)` can use `promptNode` internally:
  ```ts
  function llmJsonCall<TIn, TOut>(sp, buildContent, opts) {
    return (input: TIn) => {
      const inputState = state(input);
      return promptNode<TOut>(opts.adapter, [inputState],
        (i) => buildContent(i as TIn),
        { systemPrompt: sp, format: "json", ... });
    };
  }
  ```
  - Pros: reuses promptNode's canonical bridge (`fromAny` + `derived(parse)` + meta tagging).
  - Cons: allocates a `state(input)` per call. For one-shot usage inside distill, that's one extra node. Minor.
- **Recommendation:** extract `llmJsonCall` helper; implement it over `promptNode` (leverages Unit 1's shape). `llmExtractor` + `llmConsolidator` become ~10 LOC each.

#### Q6 — Long-term caveats & maintenance burden

- **Current burden is the duplication** — any fix (retry, stripFences, error message improvement, configurable cap) must land twice.
- **Coupling to `promptNode` via the shared helper** aligns these with the rest of the library's LLM surface. Consistency win.
- **`distill` expects `NodeInput<Extraction<TMem>>`** — today producer; tomorrow a derived node wrapping promptNode. No contract change for distill.
- **LLM JSON parsing fragility** — universal concern for all LLM-JSON-output code; better handled centrally in promptNode (Unit 1 recommendations: throw clear error with raw content preview, stripFences preprocessing).

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check — minimal composition:**

```ts
const extract = llmExtractor<RawInput, Memory>("system prompt", { adapter });
const result = extract(rawInput, existingMap);  // NodeInput<Extraction<Memory>>
```

Current topology (inside the producer):
```
adapter.invoke → fromAny → producer (manual subscribe + emit)
```
The producer wraps the subscription imperatively; `describe()` shows one producer node with no visible deps (producer-pattern §24 invisibility).

Proposed shape (via promptNode):
```
inputState → promptNode::messages → promptNode::response (new from Unit 1 D) → promptNode::output (parsed)
```
Clean, visible edges. Inherits Unit 1 C+D shape.

**Performance & memory:**
- **Current:** 1 producer + 1 subscribe handle + closure (`active` flag). Per call: 1 adapter.invoke + 1 JSON.parse + ~3 messages roundtrip.
- **Proposed (via promptNode):** 1 state + 3 derived nodes. Per call: same adapter.invoke + same parse. Marginally more allocation per invocation (~3 small nodes); flat overall because distill's switchMap teardown reclaims them on completion.
- **LOC reduction:** 147 → ~40 LOC (shared helper + 2 thin wrappers). 107 LOC savings.
- **Memory:** one-shot emission + COMPLETE — nothing retained.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo** — 147 LOC, works.
- **(B) Dedupe via `llmJsonCall` helper, stay on `producer`** — ~90 LOC. Less aggressive simplification.
- **(C) Dedupe via `llmJsonCall` helper, switch to `derived` + `fromAny`** — ~50 LOC. Framework default forwarding; cleaner.
- **(D) Rebuild on top of `promptNode` (Unit 1 C+D shape)** — ~40 LOC. Maximum consistency; leverages Unit 1's meta tagging + explainability. Needs Unit 1 shipped first.
- **(E) D + add retry, stripFences, better error messages, configurable cap** — aligns LLM-JSON output everywhere.

Recommendation: **D + E.** Blocking on Unit 1 implementation session; land after.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3/Q6) | Covered by |
|---|---|
| 95% duplicated body | D — shared `llmJsonCall` over promptNode |
| Heavy producer boilerplate | D — promptNode's canonical bridge |
| Manual message forwarding | D — framework default |
| No stripFences | E — promptNode already does it for `format: "json"` |
| No retry on parse failure | E — leverage Unit 1's retry once added (or middleware `withRetry`) |
| Parse error message missing content | E — improve in promptNode centrally |
| Hardcoded `slice(0, 100)` | E — `maxExistingKeys` opt, default 100 |
| Non-batched emit+complete | Resolved by derived framework defaults (terminal emission bundled) |

**Open questions — requires user call:**
1. **D: rebuild on promptNode** — ordering constraint, blocks on Unit 1 implementation. Recommendation: **yes, land Unit 9 in the same or next session after Unit 1 ships.**
2. **E extras** — retry-on-parse-failure, stripFences, configurable `maxExistingKeys`, raw-content-preview in error. Recommendation: **yes for all** — small additions, align the LLM-JSON surface.
3. **Retire `producer` usage entirely here** — switch to derived/promptNode. Confirm?
4. **One-shot vs reactive shape** — under D, the extractor returns a `Node<TOut | null>` wrapping promptNode over `state(input)`. That's reactive-capable (if input were updated the LLM would re-run). distill consumes it via switchMap on its own input, so the state(input) is per-call and stable. Acceptable or wasteful?

#### Decisions locked (2026-04-23)

- **D: rebuild on `promptNode`** confirmed. Blocks on Unit 1 implementation session shipping first.
- **E extras all confirmed:** retry-on-parse-failure (leverages promptNode's retry OR `withRetry` middleware), stripFences preprocessing (inherited from promptNode `format: "json"`), configurable `maxExistingKeys` option (default 100), raw-content-preview in parse error messages.
- **Retire `producer` entirely** in `llm-memory.ts` — switch to derived + promptNode composition.
- **One-shot `state(input)` allocation per call acceptable.** Reclaimed by distill's switchMap teardown on completion. Consistency with promptNode's reactive shape > ~80B/call savings.

**Implementation-session scope for Unit 9** (lands after Unit 1 implementation):
1. Extract `llmJsonCall<TIn, TOut>(systemPrompt, buildUserContent, opts): (input: TIn) => Node<TOut | null>` helper — builds `state(input)`, calls `promptNode` with `format: "json"` + `systemPrompt: sp`, returns the node.
2. Rewrite `llmExtractor` as thin wrapper: builds `{raw, existingKeys: [...existing.keys()].slice(0, opts.maxExistingKeys ?? 100)}`, delegates to `llmJsonCall`.
3. Rewrite `llmConsolidator` similarly.
4. Retire the current `producer`-based implementations (~130 LOC delete).
5. Tests: existing tests stay green (public API unchanged: `(raw, existing) => NodeInput<Extraction<TMem>>`).

**Cross-unit dependency:** Unit 9 ships in the session after Unit 1's promptNode rewrite.

---

### Unit 10 — Adapter layer, core (`types`, `factory`, `capabilities`, `pricing`, `observable`)

**Scope:** [adapters/core/](../../src/patterns/ai/adapters/core/) — 5 files, ~1128 LOC total.

#### Q1 — Semantics, purpose, implementation

- **`types.ts`** (282 LOC) — pure type surface: `ChatMessage`, `ToolCall`, `ToolDefinition`, `LLMResponse`, `StreamDelta` (discriminated object-tagged union), `LLMInvokeOptions`, `LLMAdapter` protocol, `TokenUsage` (+ `InputTokens`/`OutputTokens` disaggregated shapes). Helpers: `sumInputTokens`, `sumOutputTokens`, `emptyUsage`, `isLLMAdapter` discriminator.
- **`factory.ts`** (113 LOC) — `createAdapter({provider, ...})` switch-dispatch factory. Forwards to concrete adapters (`anthropicAdapter`, `openAICompatAdapter`, `googleAdapter`, `dryRunAdapter`, `fallbackAdapter`). Uses `extras: Record<string, unknown>` as escape hatch for provider-specific options not in `CreateAdapterOptions`.
- **`capabilities.ts`** (144 LOC) — `ModelCapabilities` type (id, provider, pricing, limits, features, metadata). `ModelLimits` (contextWindow, rate limits, rpm/rpd/tpm/tpd, concurrentRequests, extensions). `ModelFeatures` (toolUse, vision, reasoning, streaming, promptCache, batchApi). `CapabilitiesRegistry` — Map-backed with **longest-prefix-match lookup** for versioned model names (e.g. `gpt-4` matches `gpt-4-turbo-preview`). Zero shipped data.
- **`pricing.ts`** (341 LOC) — `ModelPricing` type (USD-per-1M rates per token class) + `TieredRate` (threshold-based long-context tiering) + `computePrice(usage, pricing): PriceBreakdown` pure function + per-class breakdown. `sumInputTokens`-axis threshold. `tierMultipliers` for batch/flex/priority. Pluggable registry; zero shipped data.
- **`observable.ts`** (236 LOC) — `observableAdapter(inner)` wraps any adapter and emits `CallStatsEvent` via 5 reactive nodes: `lastCall: Node<CallStatsEvent | null>`, `allCalls: ReactiveLogBundle<CallStatsEvent>` (default logMax 1000), `totalCalls`, `totalInputTokens`, `totalOutputTokens`. Handles Promise/Node/plain-value return shapes for `invoke()`; stream path wraps `for await` in try/catch. `reset()` clears counters + log.

**Design philosophy:** "Library ships shape; user supplies data." No baked-in pricing tables, no capability catalogs, no provider drift. Pluggable registries throughout.

#### Q2 — Semantically correct?

- ✅ Type shapes well-designed — `StreamDelta` as object-tagged union (justified with rationale comment for framework-tuple vs event-payload distinction).
- ✅ `capabilities.lookup` prefix-match handles versioned model names cleanly.
- ✅ `pricing.computePrice` pure + tier-threshold math correct.
- ✅ `observableAdapter.stream()` wraps in try/catch — error branch emits `CallStatsEvent` with `error` field + partial usage.
- ✅ `observableAdapter.invoke()` double-record guard via `recordedOnce` closure — correct for push-on-subscribe semantics on the derived-tap branch.
- ⚠️ **`observableAdapter.invoke()` Promise path has NO error branch.** Line 151-153: `(result as Promise<LLMResponse>).then(recordResp)`. No `.catch` — rejected Promises propagate without emitting a stats event. Inconsistent with `stream()` which correctly records errors. Downstream subscribers to `lastCall` miss invoke failures entirely.
- ⚠️ **`record()` writes 4 state nodes without `batch()`** — each call produces 4 distinct downstream waves (lastCall, totalCalls, totalInputTokens, totalOutputTokens; plus the `allCalls.append`). Subscribers that depend on multiple counters simultaneously see transient intermediate states. `batch(() => record(ev))` collapses them.
- ⚠️ **Counter emission reads `.cache + 1`** (lines 112–114) inside `record()`, which is called from within a derived fn body on the Node-returning path. Self-owned state read inside a reactive fn is §28-sanctioned but gray-zone; closure-mirror pattern would be more explicit.
- ⚠️ **Counter nodes could be derived views** over `allCalls.entries` — `totalCalls = derived([entries], es => es.length)`, etc. Eliminates manual increment; counters self-maintain. O(N) per derivation but logMax 1000 → negligible.
- ⚠️ **Duplicate type re-exports at line 236** — `export type { ChatMessage, LLMAdapter, ... }` duplicates types.ts. Dead code; consumers should import from types.ts.

#### Q3 — Design-invariant violations?

- 🟢 Types are pure — zero invariant surface.
- 🟢 `factory.ts` is imperative dispatch — no reactive layer involved; fine at factory boundary.
- 🟢 `capabilities.ts` imperative registry — sanctioned at the boundary (user-managed static data).
- 🟢 `pricing.ts` pure functions — no invariant surface.
- 🟢 `observable.ts` correctly uses `fromAny` for Node-path bridge; `monotonicNs` for event ordering; `wallClockNs` for attribution.
- 🟡 `observable.ts` Promise path without `.catch` — not a §5.10 violation (bare `.then` is sanctioned at source boundary), but an asymmetry with stream's error path.

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §9.3d "LLM Adapter Layer"](../../docs/roadmap.md) — shipped (core + middleware + providers + routing + presets).
- No explicit core-adapter items in optimizations.md.
- **Surfaced this review:**
  - `observable.invoke()` missing error branch on Promise path.
  - `record()` unbatched 4-emit pattern.
  - Counter-as-derived refactor candidate.
  - Duplicate type re-exports (cleanup).
  - Pricing convenience `pricingFor(adapter, usage)` — minor sugar.

#### Q5 — Right abstraction? More generic possible?

- **types.ts** — right. Token-usage disaggregation (cacheRead, cacheWrite5m/1h, audio, image, video, toolUse, reasoning, prediction) correctly maps every provider's native usage shape. Extensions map for open-ended provider additions. ✅
- **factory.ts** — right dispatcher. Heavy `unknown` + spread for escape-hatch extras is fine; users who want full type safety import concrete adapters.
- **capabilities.ts** — right as imperative static registry. Reactive overlay (`capNode(provider, model): Node<ModelCapabilities | undefined>`) is possible but overkill today — capabilities rarely change at runtime.
- **pricing.ts** — right. Pure function + static pricing registry. Good separation (pricing computation is NOT a reactive concern; it's math).
- **observable.ts** — right shape for a stats bundle. `CallStatsEvent` is the unit of truth; downstream (pricing, budget, dashboards) compose as derived layers. Matches "inverted statistics" design principle.

No factoring opportunities surface — the layering is already clean.

#### Q6 — Long-term caveats & maintenance burden

- **Low burden.** Type modules drift slowly with provider features. `observable.ts` has 2 known cleanups (error branch, batch record). `pricing.ts` is pure math; untouched since last audit.
- **Capability drift risk** — provider feature flags (reasoning, batchApi, promptCache) evolve. Users who maintain their own registries have to track changes. Library correctly refuses to ship baked-in tables — drift becomes user responsibility.
- **`observable.ts` double-record guard** relies on fragile `recordedOnce` closure per invoke. A unit test covering "Node-returning adapter with late subscriber" is necessary to prevent regression. If such a test exists, fine; if not, surface in the implementation session.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check — minimal observableAdapter composition:**

```ts
const base = anthropicAdapter({ apiKey, model: "claude-4-sonnet" });
const { adapter, stats } = observableAdapter(base);
stats.lastCall.subscribe(event => console.log(event));
stats.totalInputTokens.subscribe(n => console.log("tokens", n));
await adapter.invoke([{role:"user", content:"hi"}]);
```

`describe()` shape:

```
adapterStats/lastCall           (state)                    [subscribed]
adapterStats/totalCalls         (state)                    [subscribed]
adapterStats/totalInputTokens   (state)                    [subscribed]
adapterStats/totalOutputTokens  (state)                    [subscribed]
adapterStats/stats              (reactiveLog bundle)
```

**Invisible writes** — `record(ev)` mutates 4 states + appends log from within `.then(recordResp)` or the derived-tap fn. `describe()` shows the state nodes standalone — no edge in from the adapter call. Inherent to the "side-effect wrapping" pattern; unavoidable without restructuring the wrapper to emit through a producer.

**Verdict — clean on the consumer surface; record path is §24 invisible.** Counter-as-derived refactor (Q2 suggestion) would make the edges visible: `totalCalls ← derived([allCalls.entries], es => es.length)`.

**Performance & memory:**
- Per invoke: 1 `record(ev)` = 4 state emits + 1 log append (capped). Under the `batch()` fix: 1 coalesced wave instead of 4.
- Counter-as-derived shape: counters recompute O(N) per log entry added. With logMax 1000, ~1000 entries × sumInput/sumOutput = negligible.
- Log memory: 1000 `CallStatsEvent` objects × ~200B each = ~200KB per adapter instance. Bounded.
- Pricing compute: O(|rate keys|) per call — typically <20 keys. Trivial.
- Capabilities lookup: O(1) exact, O(|provider models|) prefix fallback. Trivial.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo + targeted fixes.** Fix Promise `.catch` asymmetry; wrap `record()` in `batch()`; drop duplicate type re-exports.
- **(B) A + refactor counters to derived views** over `allCalls.entries`. Eliminates manual increment; counters self-maintain; cleaner `describe`. Marginal perf cost.
- **(C) A + add `pricingFor(adapter, usage): PriceBreakdown`** convenience sugar over `capabilities.lookup` + `computePrice`.

Recommendation: **A + B + C.** All three are small, cleanly composable improvements.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3/Q6) | Covered by |
|---|---|
| Promise path missing error branch | A — wrap `.then(recordResp)` in `.then(...).catch(recordErr)` |
| `record()` unbatched 4 emits | A — `batch(() => record(ev))` |
| Duplicate type re-exports | A — delete line 236 |
| Counter increments gray-zone P3 | B — counters as derived views; no `.cache + 1` pattern |
| No `pricingFor(adapter, usage)` convenience | C — add sugar |
| Capability reactive overlay | Deferred — overkill today |
| Double-record guard test coverage | A — ensure test exists or add |

**Open questions — requires user call:**
1. **A+B+C all land together?** Recommendation: **yes** — all small, cleanly composable.
2. **Counter-as-derived refactor (B)** — user-facing API stable (same Node<number> shape) but derive-over-log has a tiny perf cost. Recommendation: **do it** — cleaner semantics, visible topology.
3. **`pricingFor(adapter, usage)` signature** — should it be `(adapter, usage, registry)` explicit registry argument, or `(capabilities, usage)` direct ModelCapabilities? Recommendation: **`(capabilities, usage)`** — pure function signature; user looks up capabilities themselves.
4. **Capability reactive overlay** — defer as "add if asked"? Recommendation: **defer.**

#### Decisions locked (2026-04-23)

- **Q1 (A + B + C):** all three land together.
  - **A:** wrap Promise path in `.then(recordResp).catch(recordErr)` — symmetric with stream's error recording. Wrap `record(ev)` in `batch()` — 4 emits coalesce to 1 wave. Delete duplicate type re-exports at `observable.ts:236`.
  - **B:** refactor counters (`totalCalls`, `totalInputTokens`, `totalOutputTokens`) to derived views over `allCalls.entries`. `totalCalls = derived([entries], es => es.length)`; `totalInputTokens = derived([entries], es => es.reduce((a, e) => a + sumInputTokens(e.usage), 0))`. Eliminates manual `.cache + 1 + emit` pattern; counters self-maintain; visible topology.
  - **C:** ship `pricingFor(capabilities: ModelCapabilities, usage: TokenUsage): PriceBreakdown` convenience. Pure function; users look up capabilities themselves.
- **Q4 (capability reactive overlay) — DO IT.** Back `CapabilitiesRegistry` with `ReactiveMapBundle<string, ModelCapabilities>`. Expose:
  - `register(cap) / remove(p, m)` — same imperative API, delegates to `bundle.set` / `bundle.delete`.
  - `lookup(p, m): ModelCapabilities | undefined` — same imperative fast path (O(1) exact + O(|provider models|) prefix fallback).
  - `lookupNode(p, m): Node<ModelCapabilities | undefined>` — NEW reactive view; derived over bundle's entries + prefix-match logic. Re-emits on register/remove.
  - `entries: Node<readonly ModelCapabilities[]>` — NEW reactive view.
  - Also: `byProvider(p): Node<readonly ModelCapabilities[]>` — reactive slice per provider. Useful for UI ("which models do I have Anthropic registered for?").

**Cross-unit alignment:** the ReactiveMapBundle foundation lands for Unit 6 (ToolRegistry), Unit 7 (C1 retention on the bundle itself), and now Unit 10 (CapabilitiesRegistry). Three consumers of one bundle infrastructure — consistent with "right abstraction" discipline.

**Implementation-session scope for Unit 10** (substantial):
1. `observable.ts`: Promise path `.catch(recordErr)`; `batch(() => record(ev))`; delete line-236 duplicate exports.
2. `observable.ts`: counters as derived views (drop manual increments).
3. `pricing.ts`: ship `pricingFor(capabilities, usage): PriceBreakdown`.
4. `capabilities.ts`: migrate internal `Map<string, ModelCapabilities>` + `indexByProvider` to `ReactiveMapBundle<string, ModelCapabilities>`. Add `lookupNode(p, m)` + `entries` + `byProvider(p)` reactive views. Public `lookup` / `register` / `remove` unchanged signatures.
5. Tests: existing tests stay green; add coverage for `lookupNode` re-emission on register/remove; Promise-path error recording regression test.

**Cross-unit dependency:** Unit 10 can land before or alongside Unit 6. Both use ReactiveMapBundle. Unit 7 C1 (retention policy) is additive — not needed by Unit 10 (capabilities have no retention concern).

---

### Unit 11 — Adapter layer, middleware (9 files)

**Scope:** [adapters/middleware/](../../src/patterns/ai/adapters/middleware/) — `retry.ts` (190), `timeout.ts` (114), `breaker.ts` (63), `dry-run.ts` (80), `rate-limiter.ts` (151), `budget-gate.ts` (320), `replay-cache.ts` (372), `resilient-adapter.ts` (179), `http429-parser.ts` (191). Total ~1669 LOC.

#### Q1 — Semantics, purpose, implementation

All 9 middleware follow the canonical pattern `withX(inner: LLMAdapter, opts) → LLMAdapter | {adapter, bundle}`:

- **`withRetry`** — decorrelated/exp/linear backoff, jitter, abort-aware sleep via `ResettableTimer`. Stream retries only pre-first-token. Default `shouldRetry` predicate handles `LLMTimeoutError`, `AbortError`, `BudgetExhaustedError`, `CircuitOpenError`, HTTP 4xx/5xx, network codes.
- **`withTimeout`** — per-call deadline via linked AbortSignal (`ResettableTimer`). Converts internal-timeout AbortError to `LLMTimeoutError` so retry can distinguish from external abort.
- **`withBreaker`** — reuses extras' `circuitBreaker` primitive. `canExecute()` gate + `recordSuccess/Failure`. Returns `{adapter, breaker}` bundle.
- **`withDryRun`** — reactive boolean toggle via factory-time seed (`enabledNode?.cache` at invoke-time). `keepalive(enabledNode)` keeps cache live. Returns `{adapter, dispose}` bundle.
- **`withRateLimiter`** — bridges to `adaptiveRateLimiter` from extra/. `costFn` pre-call estimate; `recordUsage` post-call delta; `handleError` feeds `parseRateLimitFromError` into limiter's adaptation signal. Optional `limiter` param shares a bundle across wraps.
- **`withBudgetGate`** — O(1) running totals via imperative `state<BudgetTotals>`. `isOpen` derived over totals + caps. Edge-triggered `onExhausted` via subscribe handler with `seeded` + `wasOpen` guards. Records `CallStatsEvent` to a reactiveLog + debits totals on success; stream error path records too.
- **`withReplayCache`** — content-addressed cache over `StorageTier`. sha256 over canonicalJson(messages + invokeOpts). Modes: read / read-strict / write-only / read-write. Concurrent-miss dedup via `singleFromAny`. Optional `captureStreamCadence` + `replaySpeed` for realistic stream replay.
- **`resilientAdapter`** — composes `rateLimit → budget → breaker → timeout → retry → fallback` with documented rationale (innermost rate-limit per-attempt slot, timeout before retry for per-attempt deadlines, etc.). Fallback via two-tier `cascadingLlmAdapter`. Returns bundle with internal handles.
- **`http429-parser`** — pure parser. Normalizes Retry-After, Anthropic/OpenAI/Groq/OpenRouter headers, ISO-8601 resets, error-message regex fallback → `RateLimitSignal`.

#### Q2 — Semantically correct?

- ✅ `withRetry` stream-retry gate (`yieldedAny` flag) correctly prevents token-replay after partial output.
- ✅ `withTimeout` abort-vs-timeout disambiguation correct (`timerFired` + `convertAbortToTimeout`).
- ✅ `withBreaker` reuses the reactive breaker primitive — no state drift.
- ✅ `withDryRun` factory-time seed (§28) pattern clean; `dispose` for keepalive cleanup.
- ✅ `withRateLimiter` adaptation-signal loop closes via `parseRateLimitFromError`.
- ✅ `withBudgetGate` `onExhausted` edge-trigger guards against pre-seeded false-trigger. `EMPTY_TOTALS` frozen; `makeEmptyTotals()` returns fresh mutable object for reset.
- ✅ `withReplayCache` `singleFromAny` correctly dedups concurrent cache misses — avoids duplicate provider spend.
- ✅ `resilientAdapter` composition order correct (rate-limit innermost, timeout-before-retry, etc.).
- ✅ `http429Parser` handles null/missing headers + ISO-8601 vs numeric ambiguity cleanly.
- ⚠️ **Pervasive `Promise.resolve(inner.invoke(...))` wrapper** — retry, timeout, breaker, budget-gate, observable.ts (Unit 10) all do this. Same wart: `fromAny` is the canonical bridge and handles all three NodeInput shapes. The wrapper is unneeded or harmful (Node-shaped returns lose reactivity).
- ⚠️ **`budget-gate.ts` Promise-path has no `.catch`** — rejected invoke Promises don't emit to totals/isOpen/log. Asymmetric with `stream` (which has try/catch + records errors). Same shape as observable.ts missing error branch (Unit 10 A). Callers tracking budget from `totals` miss invoke failures entirely.
- ⚠️ **`recordedOnce` double-record guard duplicated** across observable.ts + budget-gate.ts — same closure-based pattern, not extracted.
- ⚠️ **`CallStatsEvent` construction duplicated** across observable.ts + budget-gate.ts — both build the same event shape with minor variation.
- ⚠️ **Shape-dispatch branch (`PromiseLike | object-with-content | fromAny`) duplicated** across observable.ts + budget-gate.ts + retry/timeout/breaker (Promise.resolve path). ~7 middleware files touch this.
- ⚠️ **Unit 2 B cross-impact on retry `yieldedAny`**: under new delta shape, the first delta might be `thinking` or `usage` before any token. Current code sets `yieldedAny = true` on ANY yield, which would prevent retry even when no user-visible content was produced. Minor — could tighten to "token type only" post-Unit-2.

#### Q3 — Design-invariant violations?

- 🟢 `ResettableTimer` usage across retry/timeout/replay-cache correctly uses the §5.10 escape hatch.
- 🟢 `fromAny` used correctly in rate-limiter (via `firstValueFrom`) and replay-cache.
- 🟢 `withDryRun` factory-time seed (§28) is textbook.
- 🟢 Central timer (`monotonicNs`, `wallClockNs`) used consistently.
- 🟡 **`Promise.resolve(...)` wrappers are not §5.10 violations** (bare `.then` at source boundary is sanctioned) but are anti-pattern-by-simplicity; `fromAny` is the canonical bridge.

#### Q4 — Open items (roadmap / optimizations.md)

- [optimizations.md "`withBudgetGate` onExhausted fires on every blocked attempt, not on the open→closed edge" RESOLVED 2026-04-22](../../docs/optimizations.md) — edge-trigger fix shipped.
- [optimizations.md "`resilientAdapter` should expose `onFallback` / `onExhausted` from `cascadingLlmAdapter`" RESOLVED 2026-04-22](../../docs/optimizations.md) — pass-through shipped.
- [optimizations.md "Rate-limiter sharing across multiple `resilientAdapter` instances" RESOLVED 2026-04-22](../../docs/optimizations.md) — shared `limiter` param shipped.
- [optimizations.md "Developer-defined cache key generator for `withReplayCache` / `fallbackAdapter`" RESOLVED 2026-04-22](../../docs/optimizations.md) — `keyFn(ctx)` shipped.
- **Surfaced this review:**
  - Extract shared shape-dispatch helper (kills 6× `Promise.resolve` wrapper duplication).
  - Extract `adapterWrapper(inner, {invoke, stream})` shell helper (kills the provider/model/capabilities pass-through boilerplate in 9 files).
  - Fix budget-gate Promise-path error recording (same shape as Unit 10 A).
  - Extract `buildCallStats(provider, meta, usage, start): CallStatsEvent` helper.
  - Extract `recordedOnce` derived-tap helper.
  - Consider `resilientAdapter({cache})` option for compositional convenience.
  - Unit 2 B cross-impact on retry `yieldedAny` gate (tighten to token-type only).

#### Q5 — Right abstraction? More generic possible?

- **All 9 middleware are at the right abstraction level** — each has a single responsibility (retry, timeout, breaker, cache, rate-limit, budget, dry-run, resilient-compose, 429-parse). Good decomposition.
- **Under your C-factoring preference:** the **shape-dispatch shell** is the duplicated cross-file concern. Extract two helpers:
  - `adapterWrapper(inner, { invoke, stream })` — builds the `LLMAdapter` with provider/model/capabilities pass-through. Reduces each middleware file's boilerplate by ~20%.
  - `adaptInvokeResult<R>(input: NodeInput<LLMResponse>, onResp: (r) => R): Promise<R> | R | Node<R>` — centralizes the shape-dispatch + `recordedOnce` pattern.
- **`resilientAdapter`** composition order is hardcoded — user who wants different order composes manually. Alternative: `resilientAdapter({order: [...layers]})` for flexibility. **Defer** — the default order is correct for 95% of cases; the rest can compose manually.

#### Q6 — Long-term caveats & maintenance burden

- **Duplication burden is real.** Every Promise-path bug fix must land in 6+ files. Every CallStatsEvent shape change touches 2 files. Every new "Node-returning adapter" concern re-appears.
- **Fix-once-fix-everywhere wins:**
  - `fromAny`-ify the shape dispatch → one helper, 6 files simplified.
  - `adapterWrapper` shell → one helper, 9 files cleaner.
  - `buildCallStats` → one helper, 2 files aligned.
- **Each individual file is otherwise well-designed and tested.** No structural drift.
- **Unit 2 B downstream risk (minor):** under delta-stream changes, retry's `yieldedAny` gate becomes too permissive. Revisit after Unit 2 ships.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check:** each middleware is imperative wrapping — no reactive topology in the middleware itself. But three expose reactive surfaces:
- `withBudgetGate` → `{totals, isOpen, log}` — all visible edges (`isOpen` derived over `totals`; `log` standalone).
- `withRateLimiter` → returns `limiter` bundle (adaptiveRateLimiter internals).
- `withBreaker` → returns `breaker` (CircuitBreaker with reactive state).

Clean. No islands. `withDryRun` consumes reactive `enabled: NodeInput<boolean>` via factory-time seed — `describe()` doesn't show this read (closure), but that's §28 sanctioned.

**Performance & memory:**
- **Per call overhead** — bounded by middleware stack depth. Full `resilientAdapter(rate+budget+breaker+timeout+retry+fallback)` stack: ~6 wraps, each O(1) state checks + emits.
- **budget-gate log**: bounded by `logMax` (default 1000 events × ~200B = ~200KB).
- **replay-cache storage**: bounded by user's chosen `StorageTier`.
- **rate-limiter bundle**: bounded internal state.
- **No hot-path O(N²) traps.** All O(1) per call.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo + targeted fixes.** Fix budget-gate Promise `.catch`. Everything else unchanged.
- **(B) A + extract `adapterWrapper(inner, {invoke, stream})` shell helper + `adaptInvokeResult(input, onResp)` shape-dispatch helper.** Applies to 9 files; major dedup without structural change. Aligns with C-factoring.
- **(C) B + extract `buildCallStats(provider, meta, usage, start)` helper + extract `recordedOnce` derived-tap helper.** Dedups observable.ts + budget-gate.ts overlap. Small additional win.
- **(D) C + `resilientAdapter({cache, order?})` option extensions.** Compositional convenience. Order flexibility.

Recommendation: **B + C** now. **D's `{cache}` option is useful, defer `{order}`.**

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q6) | Covered by |
|---|---|
| Pervasive `Promise.resolve(...)` wrapper | B — `adaptInvokeResult` centralizes |
| Duplicated shape-dispatch branch across 7 files | B — single helper |
| Duplicated provider/model/capabilities pass-through in 9 files | B — `adapterWrapper` |
| `budget-gate` Promise-path missing `.catch` | A (in D) — explicit fix |
| `recordedOnce` double-record guard duplicated | C — extract helper |
| `CallStatsEvent` construction duplicated | C — `buildCallStats` |
| Retry `yieldedAny` cross-impact with Unit 2 B | Defer until Unit 2 lands |
| Missing `resilientAdapter({cache})` | D partial — add cache option |
| `resilientAdapter({order})` flexibility | Deferred — default order fine for 95% |

**Open questions — requires user call:**
1. **B + C (helper extraction)?** Major dedup across 9 files. Recommendation: **yes.**
2. **Add `resilientAdapter({cache})` compositional option?** Users today wire replay-cache outside; option would let them include it in the same call. Recommendation: **yes.**
3. **Unit 2 B cross-impact on retry `yieldedAny`** — address in Unit 2 implementation session or defer? Recommendation: **defer until Unit 2 lands**; revisit then.
4. **Fix budget-gate Promise-path `.catch` (A)** — companion to Unit 10 A fix. Recommendation: **yes** (parallel fix).

#### Decisions locked (2026-04-23)

- **B + C + D's `{cache}` option confirmed.** Extract:
  - `adapterWrapper(inner, { invoke, stream }): LLMAdapter` — shell helper; kills provider/model/capabilities pass-through boilerplate in 9 files.
  - `adaptInvokeResult<R>(input: NodeInput<LLMResponse>, onResp: (r) => R): Promise<R> | R | Node<R>` — centralizes shape-dispatch + `recordedOnce` guard. Kills 6× `Promise.resolve(inner.invoke(...))` wrapper duplication.
  - `buildCallStats(provider, meta, usage, startNs): CallStatsEvent` — dedups observable.ts + budget-gate.ts overlap.
  - `resilientAdapter({cache: WithReplayCacheOptions})` — compositional cache option in the resilient stack.
- **Q3 deferred** — retry `yieldedAny` cross-impact with Unit 2 B's delta-stream changes. Revisit after Unit 2 lands.
- **Q4 fix:** budget-gate Promise-path `.catch(recordErr)` parallel with Unit 10 A observable.ts fix.

#### Architectural answers (2026-04-23)

- **Wrapper form vs reactive composition:** confirmed **right hybrid today.**
  - Wrappers = imperative call-boundary decoration.
  - Reactive bundles = cross-adapter shared state (`limiter`, `breaker`, `totals`, `isOpen`).
  - Reactive opts already exist where they matter (`withDryRun`'s `enabled: NodeInput<boolean>`, `withRateLimiter`'s `rpm/tpm/limiter: NodeInput/bundle`).
  - Moving the CALL FLOW into reactive graph adds per-call wave overhead for little gain.
  - **Describe visibility (2026-04-23 user directive — promoted from deferred to IN SCOPE):** every middleware wrap stamps `meta.middlewareLayer: "withRetry" | "withTimeout" | ...` on the returned adapter (via an optional `meta` sidecar attached to the LLMAdapter object, OR via a wrap-side effect that registers the layer with a describe-visible node). Concrete shape tracked in implementation session; requirement is that a call-boundary `adapter.describe()` (or a new `describeAdapterStack(adapter)` helper) enumerates the layers bottom-up so users can inspect the resilient stack the same way they inspect graph topology.
- **`fallbackAdapter` ↔ `withReplayCache` substrate overlap:** design smell acknowledged. **Locked: C — extract `contentAddressedCache(storage, keyFn, mode)` internal helper.** Keep both public APIs (middleware vs provider-as-tier distinction is meaningfully different UX); dedup internal implementation so the two can't drift.
  - `fallbackAdapter`'s divergent features (`onMiss: "respond"`, canned degrade, `provider: "fallback"` label) wrap the shared substrate.
  - `withReplayCache`'s divergent features (stream cadence capture, keyPrefix) wrap the shared substrate.
  - Internal helper lives at `patterns/ai/adapters/_internal/content-addressed-cache.ts` (or similar).
  - If post-1.0 we discover users never use both independently, revisit B (unify).

**Implementation-session scope for Unit 11:**
1. Extract `adapterWrapper` + `adaptInvokeResult` + `buildCallStats` helpers (new file: `patterns/ai/adapters/_internal/wrappers.ts` or similar internal location).
2. Migrate 9 middleware files to use the helpers. Drop `Promise.resolve(...)` wrappers.
3. Fix `budget-gate` Promise-path `.catch(recordErr)` — records CallStatsEvent with error on rejected Promises.
4. Add `resilientAdapter({cache?: WithReplayCacheOptions})` option — inserts withReplayCache as outermost layer (or specified position).
5. Extract `contentAddressedCache(storage, keyFn, mode)` internal helper shared by `withReplayCache` + `fallbackAdapter`. Migrate both to consume it.
6. **Add `meta.middlewareLayer` stamping + `describeAdapterStack(adapter)` helper** per Q1 user directive (promoted from deferred to in-scope). Each `withX(...)` wrap attaches `layer: "withRetry"` metadata and the helper walks the chain.
7. Defer: retry `yieldedAny` tightening (post-Unit-2).

**Cross-unit dependency:**
- Unit 11 is largely self-contained; can land after Units 1+10 ship (which define the helper patterns these helpers generalize).
- Unit 12 (providers) unaffected by Unit 11 changes since providers implement `LLMAdapter` directly without the wrapper shell.

---

### Unit 12 — Adapter layer, providers (5 files)

**Scope:** [adapters/providers/](../../src/patterns/ai/adapters/providers/) — `anthropic.ts` (556), `google.ts` (447), `openai-compat.ts` (553), `dry-run.ts` (144), `fallback.ts` (400), plus `fallback-node.ts` (175 — Node-only filesystem branch). Total ~2275 LOC.

#### Q1 — Semantics, purpose, implementation

Each provider implements `LLMAdapter` with a consistent structure:
- `XAdapterOptions` interface — apiKey/model/baseURL/headers/sdk/fetchImpl.
- `XSdkLike` interface — duck-typed SDK shape for optional delegation.
- Response/usage type interfaces (provider-native shapes).
- Public factory: `xAdapter(opts) → LLMAdapter`, branches on `opts.sdk`:
  - SDK-backed path: `sdkBackedX(opts)`.
  - Fetch-backed path: `fetchBackedX(opts)` with SSE parsing.
- Private mappers: `toXRequest()`, `toXMessage()`, `toXTool()`, `mapUsage()`, `toLLMResponse()`.
- SSE helpers (openai-compat + google + anthropic): `parseSSE`, `parseSSEBlock`, `findSSEBoundary`.
- `makeHttpError(resp)` builder for structured HTTP errors.

**Provider-specific highlights:**
- **`anthropic`**: cache_creation tiering (ephemeral_5m vs 1h + legacy `cache_creation_input_tokens`), `server_tool_use.web_search_requests` → `auxiliary.webSearchRequests`, thinking-token `{type:"enabled", budget_tokens}`.
- **`openai-compat`**: one impl for 6 presets (openai / openrouter / groq / ollama / deepseek / xai) via `resolveConfig(opts)`; `bodyExtras` passthrough for OpenRouter routing.
- **`google`**: Gemini per-modality usage (audio/image/video), `functionDeclarations` tool shape.
- **`dry-run`**: deterministic fake; `ResettableTimer` for simulated latency + abort-aware sleep; emits `{type:"token"}` + `{type:"usage"}` + `{type:"finish"}` deltas (already Unit-2-B-shape).
- **`fallback`**: fixture-based provider — sha256 content-addressed lookup over `StorageTier`. Modes: `onMiss: "throw" | "respond"`. Record mode wraps a real adapter + persists `{request, response}` pairs. `fallback-node.ts` adds filesystem fixturesDir for Node-only.

#### Q2 — Semantically correct?

- ✅ All three real providers handle SDK + fetch paths symmetrically. Abort signal threaded into both.
- ✅ Usage mapping preserves provider-specific token classes without loss (`input.cacheWrite5m`, `auxiliary.webSearchRequests`, Gemini per-modality).
- ✅ SSE parsers handle partial chunks + multi-event boundaries correctly (`findSSEBoundary` double-newline detection).
- ✅ `dry-run` streams correctly (token → usage → finish delta sequence).
- ✅ `fallback.ts` `degradedResponse` + `normalizeRespondResult` correctly handle the "miss → canned response" case.
- ✅ `fallback.ts` record mode shares the same sha256 key format as `withReplayCache` — fixtures interop.
- ⚠️ **SSE parsing duplicated across openai-compat + google + anthropic.** `parseSSE`, `parseSSEBlock`, `findSSEBoundary` — same algorithm. ~70 LOC × 3 files = ~210 LOC duplicated.
- ⚠️ **`makeHttpError(resp, provider?)` duplicated** across 3 providers. Same shape: read body, build Error with `.status + .headers + .message` so `http429-parser` can consume. ~20 LOC × 3.
- ⚠️ **`fallback.ts` substrate overlap with `withReplayCache`** — already covered by Unit 11 decision (extract `contentAddressedCache` internal helper).
- ⚠️ **SDK-backed path abort-signal threading** — each of the 3 providers does `sdk.messages.create(params, {signal})` or similar. Uniform-looking but easy to drift if a provider SDK changes its signal API. No shared "SDK-call bridge" helper.
- ⚠️ **`dry-run`**: `usageFn` default uses `msgs.reduce` over content length; for image/audio messages (TypeScript doesn't have `content` as string for those yet, but future-proofing) might behave unexpectedly. Minor.

#### Q3 — Design-invariant violations?

- 🟢 `ResettableTimer` used correctly in dry-run + fallback's optional delay.
- 🟢 Central timer (`monotonicNs`) used in anthropic's latency tracking.
- 🟢 No raw Promises beyond necessary boundary bridging.
- 🟢 All 3 providers handle abort signal correctly on both paths.
- 🟡 SSE parsers use `async function*` + `ReadableStream.getReader()` — sanctioned source boundary (§5.10 escape hatch). No violation, but 3 copies of the same boundary implementation.

#### Q4 — Open items (roadmap / optimizations.md)

- [roadmap.md §9.3d "LLM Adapter Layer"](../../docs/roadmap.md) — shipped (providers + middleware + routing + presets).
- [optimizations.md "`fallbackAdapter` fixtures API — three fields instead of one union" RESOLVED 2026-04-21](../../docs/optimizations.md) — shipped.
- [optimizations.md "`fallbackAdapter` + `withReplayCache` directory commingling — auto-namespace" RESOLVED 2026-04-21](../../docs/optimizations.md) — shipped.
- [optimizations.md "Node-only imports leaking into browser bundles via `patterns/ai`" RESOLVED 2026-04-22](../../docs/optimizations.md) — fallback.ts vs fallback-node.ts split.
- [optimizations.md "`fallbackAdapter` — library provider with `provider: \"fallback\"`" RESOLVED 2026-04-21](../../docs/optimizations.md) — shipped.
- **Surfaced this review:**
  - Extract shared `parseSSE` helper at `adapters/_internal/sse.ts`.
  - Extract shared `makeHttpError(resp, provider): Promise<Error>` builder at `adapters/_internal/http-error.ts`.
  - Extract `contentAddressedCache` helper (already locked in Unit 11) — used by `fallback.ts` + `withReplayCache`.

#### Q5 — Right abstraction? More generic possible?

- **Providers are intrinsically specific.** Translation between canonical `ChatMessage`/`LLMInvokeOptions`/`LLMResponse`/`TokenUsage` and provider-native shapes is the job. Cannot be generalized without losing provider fidelity.
- **`openai-compat.ts` already generalizes 6 providers** via presets — the right abstraction for the OpenAI-compat ecosystem.
- **SSE + HTTP error shaping are protocol-generic.** Extract to shared internal helpers without restructuring public surface.
- **`fallback.ts` is the one structural question** — `fallbackAdapter({onMiss: "throw"}) = withReplayCache(dryRunAdapter, {mode: "read-strict"}) + label`? Unit 11's decision keeps both public APIs (UX distinction) and dedups the substrate internally. Keep.
- **No factoring opportunities beyond internal helpers.** Provider translation logic must stay per-provider.

#### Q6 — Long-term caveats & maintenance burden

- **Provider-drift risk.** Each provider evolves (new delta types, new usage classes, new tier APIs). Library correctly refuses to ship baked-in tables; still, adapters must track provider protocol changes.
- **SSE duplication is the only structural burden.** Any SSE parser fix lands in 3 files today; with `_internal/sse.ts` it lands once.
- **`fetchBackedX` vs `sdkBackedX` asymmetry risk.** Two code paths per provider. New features (structured output, cache hints) have to be wired in both. Shared test coverage across the two paths is necessary.
- **`dry-run.ts` should track Unit 2 B changes.** Already emits token/usage/finish deltas with the right `type` discriminators. Under Unit 2 B's delta-log design, dry-run needs `seq` + `ts` stamping too. Minor — one line per yield.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check:** providers are imperative `invoke`/`stream` factories. No graph topology inside. `adapter.invoke(msgs, opts) → Promise<LLMResponse>` — call-boundary shape. No reactive state, no subscribers. Clean.

**Performance & memory:**
- Per invoke: 1 fetch or 1 SDK call. O(1) state.
- Per stream: one async iterator + SSE parser buffer. Bounded by stream length.
- Usage mapping: O(1) per call.
- `fallback.ts` fixture lookup: one storage read per call. O(1) storage access.
- No hot-path traps.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo.** All 5 providers as-is. Works. Duplication across SSE + HTTP error.
- **(B) A + extract `adapters/_internal/sse.ts`** (parseSSE, parseSSEBlock, findSSEBoundary). Migrate all 3 SSE-using providers to consume. ~140-210 LOC dedup.
- **(C) B + extract `adapters/_internal/http-error.ts`** (`makeHttpError(resp, provider): Promise<Error>`). ~60 LOC dedup; standardizes the error shape that http429-parser already consumes.
- **(D) C + extract `contentAddressedCache(storage, keyFn, mode)`** — already locked in Unit 11. Migrate `fallback.ts`'s fixture lookup + write paths to consume.

Recommendation: **B + C + D.** All three are pure internal extractions; public API unchanged.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q6) | Covered by |
|---|---|
| SSE parsing duplicated across 3 providers | B — `_internal/sse.ts` |
| `makeHttpError` duplicated across 3 providers | C — `_internal/http-error.ts` |
| `fallback.ts` substrate overlap with `withReplayCache` | D (Unit 11) — `contentAddressedCache` helper |
| Provider-drift risk | Unavoidable; tests are the mitigation |
| SDK vs fetch path asymmetry | Not covered (defer — tests cover) |
| `dry-run` Unit 2 B seq+ts stamping | Covered when Unit 2 ships (minor update) |

**Open questions — requires user call:**
1. **B + C + D (SSE + HTTP error + contentAddressedCache extractions)?** All internal, no public API change. Recommendation: **yes.**
2. **SDK vs fetch path consolidation** — any opportunity? Probably not — SDK shapes differ enough per provider. Recommendation: **leave alone; tests cover.**
3. **`dry-run` Unit 2 B alignment** — add `seq` + `ts` stamping when Unit 2 lands? Recommendation: **yes** (1 line per yield, stamp at delta emission).

#### Decisions locked (2026-04-23)

- **B + C + D confirmed.**
- **SSE location — REUSE existing `src/extra/adapters.ts` `fromSSE`.** Corrected 2026-04-23 after user pointed out `fromSSE` + `toSSE` already exist (lines 607, 865 of `src/extra/adapters.ts`). **Revised extraction plan:**
  - Extract a new **pure async-iterator helper** `parseSSEStream<T>(source: ReadableStream<Uint8Array> | Response | AsyncIterable<Uint8Array>, opts?: {parse?}): AsyncGenerator<SSEEvent<T>>` from `fromSSE`'s producer body.
  - Export `parseSSEStream` alongside `fromSSE` in `src/extra/adapters.ts` (same module).
  - Refactor `fromSSE` to internally pump from `parseSSEStream` (deduplicates the parser).
  - Provider SSE parsers (anthropic/openai-compat/google) drop their local `parseSSE` / `parseSSEBlock` / `findSSEBoundary` and import `parseSSEStream`.
  - **Bonus win:** providers inherit extras' complete SSE spec coverage (retry, multiline data, comments) — they currently have a subset.
- **HTTP error helper — `src/extra/http-error.ts`** (universal tier). Companion to existing `fromHTTP`/`fromHTTPStream`/`toHTTP` in `src/extra/adapters.ts` — error builder is orthogonal (pure function; doesn't need to drag in the HTTP source surface). Exports `makeHttpError(resp: Response, provider?: string): Promise<Error>` conforming to `HttpErrorLike` `{status, headers, message}` shape — consumed downstream by `http429-parser`. Pure function; zero deps beyond `Response`/`Headers`. Verified no pre-existing error builder in extras today.
- **SDK vs fetch consolidation** — leave alone; tests cover.
- **dry-run Unit 2 B alignment** — yes, `seq` + `ts` stamping; lands alongside Unit 2's streaming rewrite.
- **`contentAddressedCache`** — per Unit 11 decision. Location: `patterns/ai/adapters/_internal/content-addressed-cache.ts` (stays LLM-specific since keyed on ChatMessage + LLMInvokeOptions shape).

#### Cross-cutting finding: eval adapter stack drift (2026-04-23)

**Discovery:** [evals/lib/llm-client.ts](../../evals/lib/llm-client.ts) (489 LOC) defines a parallel adapter stack (`AnthropicProvider`, `OpenAICompatibleProvider`, `GoogleProvider`) plus eval-specific [replay-cache.ts](../../evals/lib/replay-cache.ts) (108), [rate-limiter.ts](../../evals/lib/rate-limiter.ts) (570), [budget-gate.ts](../../evals/lib/budget-gate.ts) (128), [dry-run-provider.ts](../../evals/lib/dry-run-provider.ts) (42). **Total ~1668 LOC of parallel adapter infrastructure duplicating `src/patterns/ai/adapters/`.**

**Divergences from main adapters:**
- **Preset count:** eval's `OpenAICompatibleProvider` covers 4 presets (openai / ollama / openrouter / groq); main `openai-compat.ts` covers 6 (+ deepseek + xai). Eval can still reach deepseek/xai via `EVAL_*_BASE_URL` env vars (all OpenAI-compat under the hood) but not via named preset.
- **Google SDK mismatch:** eval imports `@google/genai` (newer unified Google AI SDK); main `google.ts` uses `@google/generative-ai` (older). Both functional; long-term should consolidate on `@google/genai`.
- **Provider interface shape:** eval uses `LLMProvider.generate(LLMRequest) → LLMResponse` (imperative; no streaming, no tools); main uses canonical `LLMAdapter.invoke/stream` with full `ChatMessage`/`ToolDefinition`/`TokenUsage` shape.

**Why it exists:** eval's adapter stack (roadmap §9.1) predates the §9.3d main adapter layer. Never migrated; divergence calcified.

**Implication for Unit 12:** out-of-scope for this unit's implementation session. Flagged as **cross-cutting follow-up tasks** added to optimizations.md candidates:
1. **Eval adapter stack migration (DEFERRED per 2026-04-23 user directive):** retire `evals/lib/llm-client.ts` + eval-specific rate-limiter/replay-cache/budget-gate in favor of `createAdapter` + `resilientAdapter` + `withReplayCache` from the main adapter layer. Reduces ~1500+ LOC of duplicate infrastructure; aligns eval with main adapter features (streaming, tool calls, canonical types). Not blocking Wave A work.
2. **Google SDK consolidation (CONFIRMED in-scope per 2026-04-23 user directive):** migrate `src/patterns/ai/adapters/providers/google.ts` from `@google/generative-ai` → `@google/genai` (unified Google AI SDK). Eval already uses the newer SDK. Can land independently from eval migration.
3. **Eval-coverage audit result (completed 2026-04-23):** verified the library already covers every eval adapter capability — anthropic + openai-compat (6 presets superset of eval's 4) + google + rate-limiter + budget-gate + replay-cache + dry-run. **No missing adapters to add to library.** The "add eval adapters to library" directive is satisfied by existing library surface modulo the Google SDK modernization in (2).

**Implementation-session scope for Unit 12:**
1. Extract `src/extra/sse.ts` (parseSSE, parseSSEBlock, findSSEBoundary) — universal tier; ~80 LOC new file.
2. Extract `src/extra/http-error.ts` (`makeHttpError(resp, provider?)`) — universal tier; ~30 LOC new file.
3. Migrate anthropic.ts + openai-compat.ts + google.ts to consume both helpers. ~200 LOC removed across the 3 files.
4. Extract `contentAddressedCache` (Unit 11 coordination); migrate fallback.ts to consume.
5. Defer: dry-run Unit 2 B `seq`+`ts` stamping (lands with Unit 2).
6. **Flag eval-adapter-stack migration and Google SDK consolidation** — add entries to optimizations.md; NOT in this session's scope.

**Cross-unit dependencies:**
- Unit 12 extractions are independent of Units 1/10/11 (different files; no shared state).
- Can land before, during, or after Unit 11 — no ordering constraint.
- `contentAddressedCache` extraction coordinates with Unit 11's `withReplayCache` rewrite.
- Eval migration is a separate, non-Wave-A task.

---

### Unit 13 — Adapter layer, routing (`cascading` + `presets` + `browser-presets`)

**Scope:** [cascading.ts](../../src/patterns/ai/adapters/routing/cascading.ts) (181 LOC), [presets.ts](../../src/patterns/ai/adapters/routing/presets.ts) (25 LOC), [browser-presets.ts](../../src/patterns/ai/adapters/routing/browser-presets.ts) (113 LOC). Total ~319 LOC.

#### Q1 — Semantics, purpose, implementation

- **`cascadingLlmAdapter(tiers, opts)`** — N-tier fallback adapter. Structural peer to `cascadingCache` + `Graph.attachStorage`: ordered list, first-success wins. Per-tier optional `breaker` + `filter`. Invoke: try tiers in order; on error/breaker-open fall through; success returns `{...resp, metadata: {tier: name}}`. Stream: commits on first yielded delta; before first delta can retry on next tier (`streamRetryBeforeFirstChunk: true` default); post-first-delta errors propagate. Exhaustion: throws `AllTiersExhaustedError` with `{skipped, failed}` report (separate collections distinguish "filter rejected" / "breaker open" vs "tier ran and threw"). `onFallback(from, to, err)` + `onExhausted(report)` callbacks.
- **`presets.ts`** — exports `dryRunPreset()` only. Just returns `dryRunAdapter()` with no options. Node-safe entry.
- **`browser-presets.ts`** — three meaningful presets (exported via `patterns/ai/browser` subpath): `cloudFirstPreset`, `localFirstPreset`, `offlinePreset`. All three build a `cascadingLlmAdapter` with tiers from WebLLM + Chrome Nano + `createAdapter` (for cloud/Ollama). Chrome Nano tier always carries a `filter: (_, iOpts) => !iOpts?.tools` because Chrome Nano doesn't do tool use.

#### Q2 — Semantically correct?

- ✅ Invoke cascade correctly tries in order; breaker/filter checks precede attempt.
- ✅ Success path stamps `metadata.tier: name` — visible provenance.
- ✅ `onFallback` fires only when a subsequent tier exists (line 131 `if (next)`).
- ✅ Stream commitment semantic clean: once `yieldedAny`, error propagates without retrying; no synthetic `{type:"finish"}` injected. Consumers handle.
- ✅ `onExhausted` NOT called on stream post-first-chunk errors (that's a single-tier commitment failure, not cascade exhaustion).
- ✅ `AllTiersExhaustedError` preserves both `skipped` and `failed` collections — error taxonomy useful for observability.
- ⚠️ **`Promise.resolve(t.adapter.invoke(...))` wrapper** (cascading.ts:122) — same wart as Unit 11 middleware. Covered by Unit 11's `adaptInvokeResult` helper.
- ⚠️ **`presets.ts` is vestigial** — single function `dryRunPreset()` = `dryRunAdapter()` with no added value. All meaningful cascades migrated to `browser-presets.ts`. The file adds a module without meaningful content.
- ⚠️ **`browser-presets.ts` tier-array type cast** (`as Parameters<typeof cascadingLlmAdapter>[0][number]`) at lines 47/88/110 is ugly but works. TypeScript struggles with heterogeneous tier arrays; clean fix would be a helper `tier(name, adapter, opts?) → AdapterTier`. Trivial.

#### Q3 — Design-invariant violations?

- 🟢 No raw async beyond necessary bridging.
- 🟢 No polling, no imperative triggers.
- 🟡 `onFallback` / `onExhausted` are imperative callbacks — sanctioned at API boundary. Could be made reactive (emit to `Node<CascadeEvent>`) but no caller demand.

#### Q4 — Open items (roadmap / optimizations.md)

- [optimizations.md "`fallbackAdapter` — library provider" RESOLVED 2026-04-21](../../docs/optimizations.md) — cascadingLlmAdapter is the composition target for fallbackAdapter.
- [optimizations.md "`resilientAdapter` should expose `onFallback` / `onExhausted` from `cascadingLlmAdapter`" RESOLVED 2026-04-22](../../docs/optimizations.md) — pass-through shipped in Unit 11's resilient-adapter.
- **Surfaced this review:**
  - `presets.ts` is vestigial — delete candidate.
  - `browser-presets.ts` tier-cast ugliness — trivial helper.
  - Cascading's `Promise.resolve` wart — Unit 11 helper covers.

#### Q5 — Right abstraction? More generic possible?

- **`cascadingLlmAdapter` is the right primitive.** Structural peer to other "ordered list, first-success-wins" patterns in the library (`cascadingCache`, `attachStorage` tier list). Consistent shape.
- **`presets.ts` is unnecessary** — `dryRunPreset()` provides no value over direct `dryRunAdapter()` import. Delete.
- **`browser-presets.ts` is right sugar** — three concrete cascades that users would otherwise reconstruct. Keep.
- **Generalization candidate:** a `tier(name, adapter, {breaker?, filter?})` helper to clean up the tier-array type cast. Trivial; add when touching the file.

#### Q6 — Long-term caveats & maintenance burden

- **Low burden.** cascading.ts is 181 LOC of clean iteration. presets/browser-presets are thin compositions.
- **Stream commitment semantic is the one subtle piece** — well-documented in the JSDoc. Any future change (e.g. "synthetic finish delta on stream error") needs to preserve the commitment invariant.
- **`presets.ts` deletion** is pre-1.0 safe — it's a single, purposeless export. Consumers should import `dryRunAdapter` from the providers barrel.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check:** cascading adapter is imperative call-boundary. No reactive topology inside. Per-tier breakers have reactive state (exposed via CircuitBreaker bundle passed in `opts.breaker`). Clean.

`describe()` on the wrapped adapter: nothing to see (imperative wrapping). Under Unit 11's `meta.middlewareLayer` + `describeAdapterStack(adapter)` helper, cascading would register itself as a "cascade" layer with child-tier names. Natural fit.

**Performance & memory:**
- Per invoke: worst case N tier attempts (filter + breaker + invoke per tier). O(N) per call.
- Per stream: same order; first yielding tier commits.
- `CascadeExhaustionReport`: two small collections (skipped array + failed Map). Bounded by tier count.
- No closure state beyond `resolved` array at factory time.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo + Unit 11 helper migration.** Cascading consumes `adaptInvokeResult` to retire `Promise.resolve` wart. No other changes.
- **(B) A + delete `presets.ts`** (vestigial `dryRunPreset`).
- **(C) B + add `tier(name, adapter, opts?)` helper** to clean the type casts in browser-presets.ts.
- **(D) C + make `onFallback`/`onExhausted` emit to reactive `Node<CascadeEvent>`** — defer; no caller demand.

Recommendation: **A + B + C.** Minimal, clean.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2) | Covered by |
|---|---|
| `Promise.resolve` wrapper wart | A — Unit 11 `adaptInvokeResult` helper |
| `presets.ts` vestigial | B — delete |
| `browser-presets.ts` type-cast ugliness | C — `tier()` helper |
| Reactive callback surface (future) | D — deferred; no demand |

**Open questions — requires user call:**
1. **Delete `presets.ts`?** Pre-1.0 safe; consumers who use `dryRunPreset()` migrate to direct `dryRunAdapter()`. Recommendation: **yes.**
2. **Add `tier(name, adapter, opts?)` helper?** Cleans up `as Parameters<...>` casts in browser-presets.ts. Trivial. Recommendation: **yes.**
3. **Reactive callback surface (D)** — defer? Recommendation: **defer.**

#### Decisions locked (2026-04-23)

- **A + B + C confirmed** (pending user OK).
- **Implementation-session scope:**
  1. `cascading.ts`: migrate `Promise.resolve(t.adapter.invoke(...))` to Unit 11's `adaptInvokeResult` helper once it ships.
  2. Delete `presets.ts`. Consumers using `dryRunPreset()` migrate to direct import. Update barrel.
  3. Add `tier(name: string, adapter: LLMAdapter, opts?: {breaker?, filter?})` helper in `cascading.ts` (or export from an internal shared spot). Migrate `browser-presets.ts` to use it.
  4. Migrate cascading to participate in `meta.middlewareLayer` + `describeAdapterStack(adapter)` (Unit 11 scope) — register "cascade" layer + child-tier names.
  5. Defer: reactive callback surface (D).

**Cross-unit dependencies:**
- Unit 13 migrates after Unit 11 ships (`adaptInvokeResult` + `describeAdapterStack`).
- No other dependencies.

---

### Unit 14 — `frozenContext` + Wave A cross-cutting consolidation

**Scope:** [prompts/frozen-context.ts](../../src/patterns/ai/prompts/frozen-context.ts) (122 LOC) + `firstDataFromNode` migration per Unit 1 deferral + full Wave A cross-cutting findings consolidation.

#### Q1 — Semantics, purpose, implementation (`frozenContext`)

`frozenContext(source, {refreshTrigger?, name?})` — prefix-cache-friendly snapshot. Freezes a reactive source into a stable value that downstream `promptNode` compositions see unchanged between explicit refresh events. Rationale: LLM providers' prefix-cache hits drop when any reactive change (agent memory, stage) re-renders the system prompt; `frozenContext` trades slight staleness for high cache-hit rate.

Two paths, both using raw `nodeFactory`:
- **Single-shot** (no trigger): `[src]` dep; latches after first emit via `ctx.store.emitted`. INVALIDATE cleanup resets the latch so `graph.signal([[INVALIDATE]])` forces re-materialization.
- **Refresh-on-trigger**: `[src, trigger]` deps; emits source value only when trigger dep fires this wave (uses `data[1]?.length > 0` gate + `ctx.prevData[0]` fallback for initial-activation pair per §2.7).

Returns `Node<T | null>` with `initial: null`.

#### Q2 — Semantically correct? (frozenContext)

- ✅ Trigger-wave gating correctly discriminates source-only drift from trigger emission.
- ✅ INVALIDATE latch reset properly handles graph-wide flush semantics (§20 cleanup-shape).
- ✅ Raw `nodeFactory` use is justified (per-dep wave inspection `derived` can't do).
- ✅ `prevData[0]` fallback captures the initial activation pair where source + trigger arrive as separate waves (§2.7-aware).
- ⚠️ **Domain-null ambiguity:** `Node<T | null>` conflates "not yet emitted" with "source emitted null." Minor — context objects rarely are domain-valid null. Document or use SENTINEL if important.
- ⚠️ **JSDoc says "never refreshes" without trigger** — but INVALIDATE-as-refresh works in practice. Minor documentation gap; clarify.

#### Q3 — Invariant violations? (frozenContext)

- 🟢 §7, §24, §28, §20 (ctx.store + cleanup shape) all correctly applied.
- 🟢 No raw async, no imperative triggers, no closure state outside `ctx.store`.
- 🟢 Describe-visible: `[source] → frozenContext` or `[source, trigger] → frozenContext`. Clean edges.

#### Q4 — Open items (frozenContext)

- [roadmap.md §4.4](../../docs/roadmap.md) — shipped.
- No explicit items in optimizations.md.
- Surfaced: JSDoc clarification on INVALIDATE-as-refresh semantic.

#### Q5 — Right abstraction? (frozenContext)

Right primitive. Purpose-built for a real problem (prefix cache efficiency). Two-path implementation (single-shot + refresh-on-trigger) is the minimal complete API.

**Generalization candidate:** `frozenContext` as a special case of `sample(source, trigger)` (RxJS sample). The library already has similar shapes in extras but not exactly `sample`. Keep `frozenContext` as the named idiom — its domain framing ("frozen for prefix caching") is load-bearing and users search for that name.

#### Q6 — Long-term caveats (frozenContext)

Low burden. 122 LOC, well-designed, narrow scope.

#### Q7 — Simplify / reactive / composable + perf/memory (frozenContext)

**Topology check — minimal composition:**

```ts
const memory = state({userFacts: [...]});
const stage = state("triage");
const frozen = frozenContext(memory, { refreshTrigger: stage, name: "ctx" });
frozen.subscribe(() => {});
```

`describe()`:
```
memory       (state)     -> ctx
stage        (state)     -> ctx
ctx          (derived)   [frozenContext]
```

Clean, no islands. `explain(memory → ctx)` closes. Trigger-wave gating invisible in topology but documented in JSDoc.

**Perf/memory:** O(1) per wave. `ctx.store.emitted` latch is one boolean. No retained state beyond latest emission.

#### Q8-Q9 — Recommendation (frozenContext)

**Status quo** — no changes needed except a 1-line JSDoc clarification on INVALIDATE-as-refresh. Defer to implementation session.

---

### Wave A cross-cutting consolidation (2026-04-23)

**14 units reviewed, spanning ~9600 LOC of primitives + ~2300 LOC of adapters + ~1500 LOC of middleware + auxiliary types.**

#### Cross-cutting patterns — extractions in scope across Wave A

| Pattern | Units affected | Extraction target |
|---|---|---|
| `Promise.resolve(adapter.invoke(...))` wart + shape-dispatch branching | 1, 4, 11 (retry/timeout/breaker/budget-gate/observable), 13 | `adaptInvokeResult(input, onResp)` helper in `patterns/ai/adapters/_internal/wrappers.ts` |
| `LLMAdapter` provider/model/capabilities pass-through shell | 11 (9 middleware), 13 | `adapterWrapper(inner, {invoke, stream})` helper |
| `CallStatsEvent` construction + `recordedOnce` double-record guard | 10 (observable), 11 (budget-gate) | `buildCallStats(...)` + `recordedOnce(...)` helpers |
| SSE parsing across providers | 12 (anthropic/openai-compat/google) | Extract `parseSSEStream(source)` as pure async-iterator from `src/extra/adapters.ts` `fromSSE` internals |
| HTTP error shaping across providers | 12 | New `src/extra/http-error.ts` `makeHttpError(resp, provider?)` |
| Content-addressed caching substrate | 11 (withReplayCache), 12 (fallbackAdapter) | `contentAddressedCache(storage, keyFn, mode)` in `patterns/ai/adapters/_internal/` |
| `ReactiveMapBundle` as keyed-registry storage | 6 (ToolRegistry), 10 (CapabilitiesRegistry), 7 (agentMemory C1 retention) | Extend `reactiveMap` in `src/extra/reactive-map.ts` with optional `retention: {score, archiveThreshold, maxSize, onArchive?}` config |
| Closure-mirror pattern (§28 factory-time seed) | 4 (agentLoop: latestTurn, latestAborted, latestMessages, latestSchemas — all four symmetric) | Internal consistency in agentLoop; no extraction needed |
| `awaitSettled` lacking fromNow / per-run identity | 4 (agentLoop `_runVersion` workaround) | Add `awaitSettled(source, {skipCurrent: true})` option in `src/extra/sources.ts` |
| `meta.middlewareLayer` + `describeAdapterStack(adapter)` | 11 (9 middleware), 13 (cascading) | `describeAdapterStack` helper in `patterns/ai/adapters/_internal/` or `src/extra/` depending on reuse scope |

#### Extraction destination audit (2026-04-23 — post-review reclassification)

Three helpers originally scoped to `adapters/_internal/` are actually protocol-generic and belong in `src/extra/`:

| Helper | Original target | Revised target | Rationale |
|---|---|---|---|
| `recordedOnce` derived-tap guard | `adapters/_internal/wrappers.ts` | **`src/extra/operators.ts`** as generic `onFirstData(source, fn)` / `tapFirst(source, fn)` | Generic pattern: "wrap a NodeInput with a side-effect callback, guard against re-subscription double-fire." Nothing LLM-specific; any reactive consumer that wants "run this once on first DATA, ignore replays" benefits. Keeps LLM middleware thin. |
| `contentAddressedCache` | `adapters/_internal/content-addressed-cache.ts` | **Split:** generic `contentAddressedStorage(storage, keyFn, mode)` → `src/extra/content-addressed-storage.ts`; LLM-specific keyFn wrapper stays in `adapters/_internal/` | Substrate is generic (canonicalJson + sha256 over StorageTier with read/write/read-strict modes). Only the default keyFn shape (ChatMessage + LLMInvokeOptions) is LLM-specific. Future users — memoized function calls, embedding caches, any content-addressable storage — benefit from the generic primitive. |
| `nodeSignal(abortedNode): AbortSignal` | `adapters/_internal` (Unit 4) | **`src/extra/sources.ts`** (companion to `fromAny`) | Bridges a reactive `Node<boolean>` to a browser-standard `AbortSignal` that fires on `true`. Useful for ANY async boundary taking a signal (fetch, streams, child processes, timers). Zero LLM coupling. |

**Three helpers confirmed staying in `adapters/_internal/`:** `adapterWrapper` (LLMAdapter shape), `adaptInvokeResult` (LLMResponse typed), `buildCallStats` (CallStatsEvent specific), `describeAdapterStack` (walks adapter chain), LLM-specific `llmJsonCall` stays in memory/, `tier()` stays in routing/.

**Revised Session 1 "Foundation" scope:**
- `src/extra/reactive-map.ts` — add `retention` option (Unit 7 C1).
- `src/extra/adapters.ts` — extract `parseSSEStream` (Unit 12).
- `src/extra/http-error.ts` — new file (Unit 12).
- `src/extra/sources.ts` — add `awaitSettled({skipCurrent})` (Unit 4) + `nodeSignal(abortedNode)` helper (Unit 4, relocated).
- `src/extra/content-addressed-storage.ts` — new file, generic substrate (Unit 11 + 12 shared).
- `src/extra/operators.ts` — add `onFirstData(source, fn)` / `tapFirst(source, fn)` (relocated from Unit 10/11 `recordedOnce`).

#### `firstDataFromNode` migration (Unit 14 commitment)

**Scope:** 4 callers — `resolveToolHandlerResult` in `_internal.ts` (called by ToolRegistry.execute → Unit 6), `suggest-strategy.ts` + `graph-from-spec.ts` (graph-integration — Wave C), plus the self-referential definition.

**Migration shape:** each caller becomes a reactive compose. Example — `ToolRegistry.execute(name, args) → Promise<unknown>` currently calls `resolveToolHandlerResult(tool.handler(args))`. Reactive-compose version returns a `Node<unknown>` wrapping `fromAny(tool.handler(args))` + user bridges externally via `firstValueFrom` at the API boundary.

**Complication:** `ToolRegistry.execute` is an imperative boundary API used by external consumers. Full reactive migration breaks the imperative contract. **Compromise:** extract the reactive core (`executeReactive(name, args) → Node<unknown>`), keep `execute(name, args) → Promise<unknown>` as thin imperative sugar using `firstValueFrom`. Users get both; boundary users unaffected; reactive users have a composable path.

**Per-caller decisions:**
- **`ToolRegistry` (Unit 6):** ship `executeReactive(name, args): Node<unknown>` alongside existing `execute(name, args): Promise<unknown>`. Migrate Unit 4's `executeToolReactively` (now `toolExecution` primitive per C factoring) to consume `executeReactive` directly. Drops `firstDataFromNode` from Unit 6's surface.
- **`suggest-strategy` + `graph-from-spec` (Wave C Unit 23–24):** imperative-to-reactive migration for these graph-integration consumers. Defer design to Wave C; cross-reference this decision.
- **`resolveToolHandlerResult`:** retains `firstDataFromNode` internally — sanctioned boundary bridge (§28). No further migration needed.

Net `firstDataFromNode` usage: stays only as the `resolveToolHandlerResult` boundary path. New reactive surface (`executeReactive`) is preferred.

#### Cross-unit implementation ordering

Dependencies map across the 14 units:

1. **Foundation layer (can land first, parallel):**
   - `src/extra/reactive-map.ts` — add `retention` option (Unit 7 C1).
   - `src/extra/adapters.ts` — extract `parseSSEStream` (Unit 12).
   - `src/extra/http-error.ts` — new file (Unit 12).
   - `src/extra/sources.ts` — add `awaitSettled({skipCurrent})` (Unit 4).

2. **Adapter-layer helpers (lands after foundation; enables middleware/providers):**
   - Unit 11: extract `adapterWrapper`, `adaptInvokeResult`, `buildCallStats`, `recordedOnce`, `describeAdapterStack`, `meta.middlewareLayer` stamps.
   - Unit 12: migrate providers to `parseSSEStream` + `makeHttpError`; Google SDK `@google/generative-ai` → `@google/genai`; fallbackAdapter + withReplayCache consume `contentAddressedCache`.
   - Unit 13: cascadingLlmAdapter consumes `adaptInvokeResult` + `tier()` helper; delete vestigial `presets.ts`.

3. **Primitives layer (parallel where possible):**
   - Unit 1 (promptNode C+D + abort option) — before Unit 4 and Unit 9.
   - Unit 2 (streamingPromptNode B-shape + deltaTopic + accumulatedText) — before Unit 3.
   - Unit 3 (extractors migration) — after Unit 2.
   - Unit 5 (handoff/toolSelector) — 1-line JSDoc; can land anytime.
   - Unit 6 (ToolRegistry → ReactiveMapBundle; add executeReactive) — after foundation layer.
   - Unit 10 (observable fixes + CapabilitiesRegistry reactive overlay + pricingFor) — after foundation layer.

4. **Higher-level factoring (lands after primitives):**
   - Unit 4 (agentLoop → compose promptNode + toolExecution; drift cleanup; closure-mirror symmetry) — after Unit 1 + Unit 6.
   - Unit 7 (memoryWith* composers; C1 retention consumption; closure-state promotion) — after foundation layer + Unit 6.
   - Unit 8 (tiers shrink + admission refactor) — with Unit 7.
   - Unit 9 (llmExtractor → llmJsonCall via promptNode) — after Unit 1.
   - Unit 14 (firstDataFromNode migration; frozenContext JSDoc touch) — after Unit 6.

**Critical path:** foundation → adapter helpers → primitives → higher-level factoring. Estimated **3–5 implementation sessions** depending on batching.

#### Total scope estimate (approx)

| Layer | LOC delta |
|---|---|
| `src/extra/` (reactive-map retention, adapters SSE extract, http-error new, sources awaitSettled) | ~300 LOC added |
| `src/patterns/ai/adapters/_internal/` (wrappers + contentAddressedCache + describeAdapterStack) | ~250 LOC added |
| `src/patterns/ai/adapters/middleware/` (9 files migrate to helpers) | ~300 LOC net reduction |
| `src/patterns/ai/adapters/providers/` (3 providers + fallback migration + Google SDK) | ~250 LOC net reduction |
| `src/patterns/ai/adapters/routing/` | ~30 LOC reduction |
| `src/patterns/ai/prompts/` (promptNode + streaming rewrite) | ~300 LOC net reduction |
| `src/patterns/ai/extractors/` (migration to accumulatedText / deltaTopic) | ~100 LOC net reduction |
| `src/patterns/ai/agents/` (agentLoop factoring + toolExecution new) | ~200 LOC net reduction |
| `src/patterns/ai/memory/` (agentMemory composers + tiers shrink + admission refactor + llmExtractor refactor) | ~200 LOC net reduction |
| Tests | ~500 LOC added |
| **Net:** | **~−600 LOC** of primary-surface code + ~1000 LOC of new helpers/tests |

Wave A implementation reduces the `patterns/ai/` primary surface by ~600 LOC while introducing shared helpers that eliminate ~2000 LOC of duplicated code across the tree.

#### Outstanding design questions (none blocking implementation)

1. **`agentLoop` as `harnessLoop` sugar (option B from Unit 4):** deferred to post-Wave-B session. Harness review (Units 15–22) should evaluate whether the extracted `promptNode` + `toolExecution` primitives unify the two loops' composition.
2. **Eval adapter stack migration:** deferred per user directive. Library already covers eval adapter capabilities; migration is purely eval→library direction.
3. **Capability reactive overlay in further use cases:** add when a second caller (beyond Wave A) surfaces.
4. **Stream `{token, offset}` design ambiguity post Unit 2 B:** not applicable — Unit 2 B subsumes the concern (no `accumulated` stored; seq = offset).

#### Implementation-session sequencing recommendation

**Session 1 — Foundation:**
- `src/extra/reactive-map.ts` retention
- `src/extra/adapters.ts` parseSSEStream
- `src/extra/http-error.ts` new
- `src/extra/sources.ts` awaitSettled skipCurrent
- Tests for each
- **Exit criteria:** 2037+ existing tests still pass; new feature tests cover each extraction.

**Session 2 — Adapter helpers + migrations:**
- `patterns/ai/adapters/_internal/wrappers.ts` (adapterWrapper, adaptInvokeResult, buildCallStats, recordedOnce, describeAdapterStack)
- `patterns/ai/adapters/_internal/content-addressed-cache.ts`
- Migrate middleware (9 files) to helpers
- Migrate providers to parseSSEStream + makeHttpError; Google SDK swap
- Migrate fallbackAdapter + withReplayCache to contentAddressedCache
- Migrate cascadingLlmAdapter; delete presets.ts
- Unit 10 observable fixes + capabilities overlay
- **Exit criteria:** all Unit 10/11/12/13 implementation-session scopes green.

**Session 3 — Primitives:**
- Unit 1 promptNode C+D + abort option
- Unit 2 streamingPromptNode B-shape + deltaTopic + accumulatedText
- Unit 3 extractors migration to deltaTopic + accumulatedText
- Unit 5 JSDoc touch
- Unit 6 ToolRegistry → ReactiveMapBundle + executeReactive
- **Exit criteria:** Unit 1/2/3/5/6 green.

**Session 4 — Higher-level factoring:**
- Unit 4 agentLoop → compose promptNode + toolExecution + closure-mirror symmetry
- Unit 7 memoryWith* composers + C1 retention + closure-state promotion
- Unit 8 tiers shrink + admission refactor
- Unit 9 llmExtractor → llmJsonCall
- Unit 14 firstDataFromNode migration touches (ToolRegistry executeReactive already in Session 3; finalize references)
- Unit 14 frozenContext JSDoc touch
- **Exit criteria:** Wave A fully implemented; all primary tests green; new composers have coverage.

---

### Wave A status

- **2026-04-23:** all 14 units reviewed, findings locked. Ready for implementation sessions.
- **Implementation scheduled:** 3–5 sessions per the sequencing above. User opens separate implementation sessions to execute.
- **Wave B (harness composition) + Wave C (adjacent surfaces) NOT blocked by Wave A implementation** — can run in parallel if user prioritizes.

### Wave sequencing guidance (2026-04-23 user question)

**Q:** Go through Wave B + C before implementation, or wave-by-wave (review → implement → review next)?

**Recommendation: review Wave B BEFORE any Wave A implementation; Wave C is flexible.**

Reasoning:
- **Wave B is tightly coupled to Wave A's `promptNode` + `toolExecution` primitives.** Wave A explicitly flagged "agentLoop as `harnessLoop` sugar (option B)" as pending Wave B review. Implementing Wave A's agentLoop factoring before Wave B could force rework if harness's review reshapes the shared abstraction.
- **Wave B also folds in `gate()` primitive review** (Units 17–18) where Unit 2's `gatedStream` is deferred. Consolidation decisions (extract shared utils, unify cancel semantics) aren't made yet.
- **Wave C is loosely coupled.** `refine-loop`, `graphspec`, `surface/` are consumers of core primitives — their findings typically don't reshape the core.

**Concrete sequence:**
1. Review Wave B (11 units: harness types + 7-stage loop + strategy/bridge + refine-executor/eval-verifier + trace/profile).
2. Reconcile Wave A ↔ Wave B findings — may adjust Unit 4's agentLoop scope and cross-reference unified primitives.
3. Implement Waves A+B as one coordinated effort (session sequence from this doc extended with B's implementation items).
4. Review + implement Wave C when convenient.

**Alternative for faster Wave A value:** implement the pure-extras "Foundation" session (reactive-map retention, parseSSEStream, http-error, awaitSettled skipCurrent, nodeSignal, content-addressed-storage, onFirstData) since these are universal primitives with no harness coupling. Then review Wave B before touching anything in `patterns/ai/` specifically. Lowest-risk early-value split.

---

---

---

## Wave B — Harness composition audit

_Same structure. Fold findings that cross Wave A/B boundaries here with back-refs._

### Unit 15 — `types.ts` (harness wiring types)

**Scope:** [src/patterns/harness/types.ts](../../src/patterns/harness/types.ts) (320 LOC). Covers: intake/triage/execute/verify data shapes, enums (`IntakeSource`, `Severity`, `RootCause`, `Intervention`, `QueueRoute`, `ErrorClass`), ordered constants (`QUEUE_NAMES`, `DEFAULT_SEVERITY_WEIGHTS`, `DEFAULT_DECAY_RATE`, `DEFAULT_QUEUE_CONFIGS`), helpers (`strategyKey`, `defaultErrorClassifier`), and the plug-in contracts (`HarnessExecutor`, `HarnessVerifier`, `HarnessLoopOptions`).

#### Q1 — Semantics, purpose, implementation

- **Enums as string-literal unions.** `IntakeSource`, `Severity`, `RootCause`, `Intervention`, `QueueRoute`, `ErrorClass` are all closed unions — extensibility only via source edit (no registry, no `extends`).
- **`IntakeItem`** ([types.ts:58](../../src/patterns/harness/types.ts:58)) — uniform shape for all intake sources. Private-ish `_reingestions?: number` counter item-carried through the loop; incremented at [loop.ts:479](../../src/patterns/harness/loop.ts:479).
- **`TriagedItem extends IntakeItem`** — adds classifier output (`rootCause`, `intervention`, `route`, `priority`, `triageReasoning`) plus `_retries?: number` (item-carried fast-retry count).
- **Strategy model** — `StrategyEntry` + `StrategyKey` template literal type `${RootCause}→${Intervention}`. `strategyKey()` helper is the one place the join char (`→`) is declared; any code constructing keys outside this helper risks drift.
- **Execute shapes** — `ExecuteOutput` ({ outcome, detail, artifact? }) is what a plug-in emits; `ExecutionResult` is what the harness assembles downstream (adds `item`). `artifact?: unknown` is the escape hatch that lets `refineExecutor` carry the converged candidate into `evalVerifier` (Unit 21).
- **`ErrorClassifier`** — pure fn `(result) => "self-correctable" | "structural"`. Default at [types.ts:143](../../src/patterns/harness/types.ts:143) is a **substring match** on `detail.toLowerCase()` against five keywords (`parse | json | config | validation | syntax`) — anything else is structural.
- **`VerifyResult` vs `VerifyOutput`** — same split as execute: the plug-in produces `VerifyOutput` ({ verified, findings, errorClass? }), the harness wraps it into `VerifyResult` (adds `item` + `execution`).
- **Priority signals** — config bag only; actual scoring lives in `strategy.ts`'s `priorityScore` (Unit 19). `DEFAULT_DECAY_RATE = Math.LN2 / (7 * 24 * 3600)` — module-level eval; ~7-day half-life.
- **Queue configs** — 4 default routes have differing `gated` flags; `backlog` carries `startOpen: false` even though it's not `gated` (noise — `startOpen` only matters when gated).
- **Pluggable slots** — `HarnessExecutor` / `HarnessVerifier` are function types `(input) => Node<...>`. Rules 1–4 for executors live in JSDoc at [types.ts:234–246](../../src/patterns/harness/types.ts:234) (emit once per completed run, switchMap on supersede, don't bypass `input.cache` via a state mirror, don't fire on arrival).
- **`HarnessLoopOptions.adapter: unknown`** — deliberately typed as `unknown` with the comment "kept as unknown to avoid circular dep" ([types.ts:266](../../src/patterns/harness/types.ts:266)). Callers narrow at the consumption site (`loop.ts:221 as LLMAdapter`).

#### Q2 — Semantically correct?

- ✅ `strategyKey()` and `StrategyKey` template literal agree on the `→` join char — single source of truth.
- ✅ `QUEUE_NAMES` is `as const` — downstream iteration order (e.g. `loop.ts:229`) is stable.
- ✅ `_reingestions` / `_retries` are item-carried per-item counters; combined with the `totalRetries` / `totalReingestions` circuit-breaker states in `loop.ts` gives both local + global caps.
- ⚠️ **`defaultErrorClassifier` is a substring match.** False positives trivially: `detail = "Parsed successfully after retry"` or `detail = "configuration complete"` both classify as `self-correctable`. False negatives: a real JSON parse error phrased as "invalid output" or "malformed" classifies as `structural`. No regex word boundaries. The harness's fast-retry budget hinges on this classifier — ten `detail = "validation passed"` results that happen to fail verify would each consume a `self-correctable` retry slot.
- ⚠️ **`ExecuteOutput.artifact: unknown`** — deliberate escape hatch, but typing `artifact` as `unknown` forces every consumer (evalVerifier, user toOutput mappers, observability tooling) to cast. A generic `ExecuteOutput<A = unknown>` would preserve the escape hatch while letting `refineExecutor<T>` flow `T` through to `evalVerifier`'s `extractArtifact` without the `as T` cast at [eval-verifier.ts:107](../../src/patterns/harness/eval-verifier.ts:107).
- ⚠️ **`HarnessLoopOptions.adapter: unknown`** — the "circular dep" it dodges is `types.ts` importing from `patterns/ai`. The actual dep graph has `loop.ts` importing from `patterns/ai` just fine. `types.ts` could `import type { LLMAdapter } from "../ai/index.js"` — a type-only import doesn't create a runtime cycle. Current shape requires every caller to silently re-assert the type.
- ⚠️ **`triagePrompt` / `executePrompt` / `verifyPrompt` typed as `string | (...args: unknown[]) => string`.** The actual callsite for triage is `(pair: [IntakeItem, StrategySnapshot]) => string`; for execute it's `(item: TriagedItem) => string`; for verify it's `(ctxPair: [ExecuteOutput|null, TriagedItem|null]) => string`. Users writing a custom prompt function get zero IDE help and no compile error on wrong shapes. Rule-4 misuse surfaces only at runtime.
- ⚠️ **Ergonomic contradiction between `executePrompt` + `executor`.** JSDoc says "Ignored when `executor` is set" ([types.ts:275](../../src/patterns/harness/types.ts:275)). Types permit both. Users who pass both get silent ignore of the prompt string with no warning.
- ⚠️ **`HarnessVerifier` tuple shape leaks `withLatestFrom` wiring.** The verifier receives `Node<[ExecuteOutput | null, TriagedItem | null]>` — an authored tuple reflecting the harness's internal pairing choice. A cleaner contract would be `(exec: Node<ExecuteOutput | null>, item: Node<TriagedItem | null>) => Node<VerifyOutput | null>` with the harness wiring `withLatestFrom` internally.
- ⚠️ **`_reingestions` / `_retries` naming collision risk.** LLMs that see the JSON-stringified item in the triage prompt can round-trip the `_retries` field. The optimizations.md "Router spread order defaults to intake-wins" entry (2026-04-23) is exactly this class of bug — LLM returning `_reingestions` in classification silently clobbered the counter until the spread order was flipped. Pre-1.0 rename to `$retries` / `$reingestions` (unlikely to survive JSON round-trip) is low-risk insurance.
- ⚠️ **`DEFAULT_QUEUE_CONFIGS.backlog.startOpen: false`** is meaningless (backlog is `gated: false`; `startOpen` is the gate's initial state). Not a bug — just noise that invites "does backlog get a gate?" confusion.

#### Q3 — Design-invariant violations?

- 🟢 **§5.8–§5.11 all clean** — pure-type file, no runtime. `DEFAULT_DECAY_RATE` is a constant config, not a timestamp; central-timer rule N/A.
- 🟡 **§5.12 developer-friendly APIs** — `adapter: unknown` and `(...args: unknown[]) => string` prompt signatures push type erosion onto callers. The JSDoc carries the real contract; the type system doesn't. `HarnessVerifier`'s tuple shape exposes `withLatestFrom` wiring — a protocol detail leaking into the public domain surface, against the §5.12 "protocol internals never surface" spirit (the spec says "`DIRTY`, `RESOLVED`, bitmask" specifically but the intent generalizes).
- 🟡 **COMPOSITION-GUIDE §3 null sentinels** — the `_retries?: number` / `_reingestions?: number` optional numbers with undefined-as-missing are fine on their own, but the arithmetic at `loop.ts:445` (`item._retries ?? 0`) + round-trip risk (Q2 above) mean a retry surviving an LLM round-trip silently resets to 0.

#### Q4 — Open items (roadmap / optimizations.md)

- [optimizations.md "Router spread order defaults to intake-wins (done 2026-04-23, QA)"](../../docs/optimizations.md) — the `_reingestions` / `_retries` field-collision fix lives in loop.ts, not types.ts. A typeshift (rename or brand) would neutralize the whole class.
- [optimizations.md "Harness `executeAndVerify` unified slot"](../../docs/optimizations.md) — would add a third `HarnessLoopOptions` field (`executeAndVerify?: (input) => Node<VerifyResult | null>`), shape similar to current executor/verifier types. Types file would grow ~8 LOC.
- [optimizations.md "Harness executor/verifier dev-mode sanity check"](../../docs/optimizations.md) — no type-level change; adds a `debug?: boolean` field and runtime counter.
- **Not in optimizations.md yet — candidates for this review:**
  - `ExecuteOutput<A>` generic for typed-artifact pass-through (Q2).
  - Rename `_retries` / `_reingestions` to a brand or `$`-prefix (Q2 / §3).
  - Typed-prompt signatures (`(item: TriagedItem) => string` etc.) (Q2).
  - `HarnessVerifier` shape without the tuple leak (Q2).
  - `adapter` field typed as `LLMAdapter` via type-only import (Q2).
  - `defaultErrorClassifier` tightened with regex word boundaries or dropped in favor of an opt-in match (Q2).

#### Q5 — Right abstraction? More generic possible?

- **Right level.** A dedicated `types.ts` for the harness is the right pattern — every other `patterns/*/` folder does the same, and cross-file type reuse is the point.
- **Over-sharing concern.** `types.ts` currently mixes (a) domain types that every consumer needs (IntakeItem, TriagedItem, VerifyResult), (b) plug-in contracts that only executor/verifier authors care about, and (c) configuration defaults. Could split into `types.ts` (a+b) + `defaults.ts` (c), but 320 LOC isn't unwieldy and the re-export surface is single.
- **More generic possible.** `IntakeSource` / `RootCause` / `Intervention` unions are harness-specific; some user wants to add a `"schema"` intake source or `"test-gen"` intervention. Two shapes:
  - Keep as closed unions, require pre-1.0 edit for additions.
  - Widen to `IntakeSource = string` with a branded `KnownIntakeSource` re-export. Pro: user extensibility. Con: `DEFAULT_QUEUE_CONFIGS` / triage prompts break down — the closed set is a feature for the default behaviors.
  - **Middle:** `IntakeSource = KnownIntakeSource | (string & {})` — preserves IDE autocomplete on the known set while allowing custom strings. Same pattern TypeScript uses for HTMLTagName. Low-risk, backwards-compatible extension.

#### Q6 — Right long-term solution? Caveats / maintenance burden

- **`adapter: unknown` will bite eventually.** Every new harness feature that wants to read the adapter's capabilities has to re-cast. When the adapter type gains new fields (tools? middleware stack introspection?), `loop.ts:221` silently compiles with stale assumptions.
- **`defaultErrorClassifier` is the scariest piece of the file.** It silently decides retry budget. 12 months from now someone will debug "why did my harness retry 30 times on a structural bug?" and trace it to `detail.includes("validation")`. Replace with an explicit classifier-by-regex or require callers to supply one (breaking change, pre-1.0).
- **`_retries` / `_reingestions` naming** — the mitigating router spread order fix is load-bearing. If a future refactor reorders that spread, the whole reingestion cap breaks silently. Brand-type or `$`-prefix removes the class entirely.
- **`ExecuteOutput.artifact: unknown`** — low burden today (one consumer: evalVerifier). Burden grows linearly with escape-hatch consumers. Generic at introduction is almost free; retrofitting later breaks every consumer.
- **Closed enums** — `RootCause` / `Intervention` are the strategy-model keys. Changing them (adding variants) means the strategy-model cache file format also changes. Lock as closed for the pre-1.0 baseline.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Proposed simpler shape (illustrative):**

```ts
// types.ts
import type { LLMAdapter } from "../ai/index.js";  // type-only, no cycle

export interface ExecuteOutput<A = unknown> {
  outcome: "success" | "failure" | "partial";
  detail: string;
  artifact?: A;
}

export type HarnessVerifier<A = unknown> = (
  exec: Node<ExecuteOutput<A> | null>,
  item: Node<TriagedItem | null>,
) => Node<VerifyOutput | null>;
// Implementation wires withLatestFrom internally in loop.ts; callers never see the tuple.

export interface HarnessLoopOptions<A = unknown> {
  adapter: LLMAdapter;           // was: unknown
  triagePrompt?: string | ((pair: readonly [IntakeItem, StrategySnapshot]) => string);
  executePrompt?: string | ((item: TriagedItem) => string);
  verifyPrompt?: string | ((ctxPair: readonly [ExecuteOutput<A> | null, TriagedItem | null]) => string);
  executor?: HarnessExecutor<A>;
  verifier?: HarnessVerifier<A>;
  // ... rest
}

export interface IntakeItem {
  // ... existing
  $reingestions?: number;  // was: _reingestions
}
export interface TriagedItem extends IntakeItem {
  // ... existing
  $retries?: number;       // was: _retries
}
```

**Deltas:** `adapter` typed via type-only import. `ExecuteOutput<A>` generic threads artifact type end-to-end. `HarnessVerifier<A>` takes two nodes, hides tuple internally. Prompt signatures typed. `$retries` / `$reingestions` rename survives LLM round-trips (no ergonomic JSON keyshape).

**Topology check.** A types file participates in no runtime graph, so the "islands / explain" check is N/A — flag as the precedent for other type-only modules across this review. The indirect topology impact is through `defaultErrorClassifier`: a false-positive `self-correctable` classification produces a retry edge (`fastRetry` → `retryTopic` → `executeInput`) that wouldn't otherwise exist. If the classifier misfires, `describe()` shows the retry edge taken even though the failure was structural — the topology is correct but the data flowing through it isn't. Flag in Q9 coverage.

**Performance & memory footprint:**
- **Current:** `DEFAULT_SEVERITY_WEIGHTS` / `DEFAULT_QUEUE_CONFIGS` / `DEFAULT_DECAY_RATE` are module-singletons; zero per-harness cost. `defaultErrorClassifier` allocates a lowercase copy of `detail` and runs 5 `.includes` checks — O(n) in detail length, called once per failed-verify wave.
- **Recommended:** identical module cost; error classifier micro-perf change is noise (maybe one regex alloc per call vs 5 `.includes`).

#### Q8 — Alternative implementations (A/B/C…)

- **(A) Status quo.** Pros: no churn. Cons: every Q2/Q6 concern lingers.
- **(B) Type-only import for `LLMAdapter`, leave everything else.** Pros: 1 LOC change, removes the "circular dep" myth. Cons: doesn't address the prompt-signature, artifact-generic, or tuple-leak issues.
- **(C) `ExecuteOutput<A>` generic + `HarnessVerifier<A>` + typed prompts.** Pros: end-to-end artifact type, IDE help on prompt fns, verifier shape doesn't leak `withLatestFrom`. Cons: breaking-change for `refineExecutor<T>` / `evalVerifier<T>` (need to update generics site-local; pre-1.0 OK). Signature of `harnessLoop` acquires a generic parameter that threads through `HarnessGraph<A>`.
- **(D) Rename `_retries` / `_reingestions` to `$retries` / `$reingestions`.** Pros: removes LLM round-trip collision class. Cons: breaking change on serialized `IntakeItem` / `TriagedItem` (pre-1.0 OK, no known persistent consumers).
- **(E) Tighten `defaultErrorClassifier`.** Pros: retry budget doesn't misfire on coincidental keywords. Sub-options: (E1) regex word-boundaries; (E2) require callers to supply a classifier (breaking); (E3) drop the default entirely and make `errorClassifier` required. **(E1) is the pragmatic middle.**
- **(F) `IntakeSource` etc. widened to `Known | (string & {})`.** Pros: user extensibility without losing IDE autocomplete. Cons: closed-world reasoning in defaults / prompts breaks subtly — an unknown `IntakeSource` doesn't have a `DEFAULT_QUEUE_CONFIG` implication (not a mapping today, so moot), but prompts that branch on source may miss cases. Defer.
- **(G) Split `types.ts` into `types.ts` + `defaults.ts`.** Pros: clearer read. Cons: import churn with no behavior change. Defer.

**Recommendation: B + C + D + E1.** Together: type-only adapter import, artifact generic, tuple-free verifier contract, typed prompts, `$`-prefix rename, regex-hardened classifier. Single coherent type-layer cleanup pass; enables Unit 16–22 reviews to reference stable types.

#### Q9 — Does the recommendation cover the concerns?

| Concern (from Q2/Q3/Q6) | Covered by |
|---|---|
| `adapter: unknown` forces casts everywhere | B — type-only import of `LLMAdapter` |
| Prompt signatures erase real arg shapes | C — typed prompt fns with readonly tuples |
| `executePrompt` + `executor` silent-ignore | C — JSDoc stays authoritative; consider a runtime warn in the loop factory (orthogonal) |
| `ExecuteOutput.artifact: unknown` forces downstream casts | C — `ExecuteOutput<A>` generic threads `T` through `refineExecutor<T>` → `evalVerifier<T>` |
| `HarnessVerifier` tuple-leak of withLatestFrom wiring | C — two-node contract, harness wires internally |
| `_retries` / `_reingestions` LLM round-trip collision | D — `$`-prefix keys unlikely to survive JSON round-trip |
| `defaultErrorClassifier` substring false positives/negatives | E1 — regex word boundaries |
| `backlog.startOpen: false` meaningless flag | (trim-only; unaddressed by B/C/D/E1 — drop in same change) |
| Protocol-detail leakage (§5.12) | C — verifier tuple removed |

**Open question — requires user call:**

1. **Artifact generic rollout scope.** `HarnessLoopOptions<A>` + `HarnessGraph<A>` + `refineExecutor<T>` all need to thread `A = T`. Breaking change across 3–4 files; do we land it as one coherent type-layer change or defer to the evalVerifier/refineExecutor unit sessions?
2. **Closed unions vs `Known | (string & {})`.** Option F kept off the recommendation. Confirm — is user-extensible `IntakeSource` / `Intervention` a v0 nice-to-have or truly pre-1.0 scope creep?
3. **`defaultErrorClassifier` — keep the default at all?** Option E3 says drop the default and make `errorClassifier` required. Pre-1.0 policy allows. Do we lean ergonomic (E1) or strict (E3)?

#### Decisions locked (2026-04-23)

- **Recommendation B + C + D + E1 + F + G accepted.** Scope for the Unit 15 implementation pass:
  - **B** — `import type { LLMAdapter } from "../ai/index.js"` in `types.ts`; `HarnessLoopOptions.adapter: LLMAdapter` (drop the `unknown`).
  - **C** — `ExecuteOutput<A = unknown>` generic; thread `A` through `HarnessExecutor<A>` / `HarnessVerifier<A>` / `HarnessLoopOptions<A>` / `HarnessGraph<A>`; two-node `HarnessVerifier` (`exec: Node<ExecuteOutput<A> | null>, item: Node<TriagedItem | null>`) with the harness wiring `withLatestFrom` internally in `loop.ts`. Typed prompt signatures (readonly tuples for pair-shaped prompts). Update `refineExecutor<T>` / `evalVerifier<T>` call sites in the same change so the generic is coherent end-to-end — no half-threaded state.
  - **D** — rename `_retries` → `$retries` and `_reingestions` → `$reingestions` on `IntakeItem` / `TriagedItem`; update all `loop.ts` arithmetic sites (`item._retries ?? 0` etc.). `$`-prefix survives JSON round-trip less readily than `_` and makes the intent "framework-only field" visible.
  - **E1** — tighten `defaultErrorClassifier` with regex word boundaries: `/\b(parse|json|config|validation|syntax)\b/i.test(result.detail)`. Keep the default; retry policy stays ergonomic for zero-config use. Document the caveat in JSDoc: "regex-word-boundary match — custom classifier required for domain-specific failure modes."
  - **F** — `type IntakeSource = "eval" | "test" | "human" | "code-change" | "hypothesis" | "parity" | (string & {})`. Preserves IDE autocomplete on the known set while letting user-supplied string sources pass through. Apply ONLY to `IntakeSource` — `RootCause` / `Intervention` stay closed (they are the `StrategyKey` template literal inputs; widening breaks the finite-keyspace property the strategy model depends on). `QueueRoute` also stays closed (iterated via `QUEUE_NAMES` for gate/queue topic construction).
  - **G** — split `types.ts` (320 LOC) into `types.ts` (domain types + plug-in contracts) + `defaults.ts` (runtime constants + helpers: `QUEUE_NAMES`, `DEFAULT_SEVERITY_WEIGHTS`, `DEFAULT_DECAY_RATE`, `DEFAULT_QUEUE_CONFIGS`, `strategyKey`, `defaultErrorClassifier`). Public barrel `index.ts` continues to re-export everything, so external consumers see no change.
- **Trim-only fix folded into the same change:** drop `DEFAULT_QUEUE_CONFIGS.backlog.startOpen: false` — meaningless on a non-gated route.
- **Not in scope for this pass:** `executePrompt` + `executor` runtime silent-ignore warn (orthogonal, tracked as a separate opt-in dev-mode check per optimizations.md). Artifact generic rollout lands as one coherent change across `types.ts` + `loop.ts` + `refine-executor.ts` + `eval-verifier.ts` + `strategy.ts` — scheduled alongside the Unit 21 implementation session so the generic is validated by the two main consumers in the same diff.

---

### Unit 16 — TRIAGE + QUEUE stages in `loop.ts`

**Scope:** [src/patterns/harness/loop.ts](../../src/patterns/harness/loop.ts) lines 235–302 (intake topic, strategy-backed triage prompt, 4-queue router). Covers: `intake` TopicGraph, `strategy = strategyModel()`, `triageInput = withLatestFrom(intake.latest, strategy.node)`, `triageNode` via `promptNode`, 4 `queueTopics`, `routerInput = withLatestFrom(triageNode, triageInput)`, router effect with `{...classification, ...intakeItem}` spread, queue `.publish()`. Default triage prompt (`DEFAULT_TRIAGE_PROMPT`) at [loop.ts:44–59](../../src/patterns/harness/loop.ts:44).

#### Q1 — Semantics, purpose, implementation

- **Stage 1 INTAKE.** `intake = new TopicGraph<IntakeItem>("intake", { retainedLimit })`. `TopicGraph.latest` is the reactive source; `.publish()` is the imperative boundary entry point.
- **Strategy feedback.** `strategy = strategyModel()` creates the strategy bundle (Unit 19). `strategy.node` is a `Node<StrategySnapshot>` re-derived when `strategy.record()` mutates the internal `reactiveMap`.
- **TRIAGE stage.** `triageInput = withLatestFrom(intake.latest, strategy.node)` — intake.latest is the *primary* (fires the wave), strategy.node is *secondary* (sampled at wave time). This is the explicit break of the feedback cycle: when verify → strategy.record → strategy.node fires, triage is **not** re-triggered.
- **Prompt function** ([loop.ts:254–263](../../src/patterns/harness/loop.ts:254)) — receives the withLatestFrom pair `[item, strategy]`. Returns `""` when `!item` — leverages `promptNode`'s SENTINEL gate (COMPOSITION-GUIDE §8) to skip the LLM call during RESOLVED / activation-null waves.
- **`triageNode = promptNode<TriagedItem>(adapter, [triageInput], prompt, { name: "triage", format: "json", retries: 1 })`** — the LLM returns JSON matching a subset of `TriagedItem` (`rootCause`, `intervention`, `route`, `priority`, `triageReasoning`).
- **Stage 3 QUEUE.** `queueTopics` = `Map<QueueRoute, TopicGraph<TriagedItem>>`, 4 entries keyed by `QUEUE_NAMES`.
- **Router.** `routerInput = withLatestFrom(triageNode, triageInput)` — triage result primary, triageInput `[item, strategy]` secondary. Sampling `triageInput` (not `intake.latest`) is load-bearing: if a newer intake arrives during the LLM call, `triageInput` still holds the pair that *triggered* this triage.
- **Router effect** ([loop.ts:284–300](../../src/patterns/harness/loop.ts:284)) — spreads `{...classification, ...intakeItem}` so intake fields override any collision with LLM-returned fields; calls `queueTopics.get(merged.route)?.publish(merged)`. Subscribe keepalive at [loop.ts:301](../../src/patterns/harness/loop.ts:301); registered as disposer at [loop.ts:505](../../src/patterns/harness/loop.ts:505).

#### Q2 — Semantically correct?

- ✅ **Feedback-cycle break via `withLatestFrom`** is textbook COMPOSITION-GUIDE §7. Strategy updates never re-trigger triage; only fresh intake does. Verify-record-strategy loop stays half-open as intended.
- ✅ **`withLatestFrom(triageNode, triageInput)` pairs correctly.** The sampling of `triageInput` (not `intake.latest`) preserves the triggering item even if a newer intake arrives mid-LLM-call. Load-bearing; noted in the source comment at [loop.ts:280–282](../../src/patterns/harness/loop.ts:280).
- ✅ **Intake-wins spread order** ({...classification, ...intakeItem}) per the 2026-04-23 fix in optimizations.md. Any stray `_reingestions` from the LLM is overwritten by the real intake value — mitigates the LLM-round-trip collision class flagged in Unit 15 Q2.
- ✅ **`classification?.route` guard at [loop.ts:290](../../src/patterns/harness/loop.ts:290)** — a null/undefined classification (LLM error → promptNode emits null; format:"json" parse failure absorbed) skips the publish instead of publishing garbage.
- ⚠️ **Router effect performs `topic.publish(merged)` — imperative write.** Semantically this is a sanctioned "source-boundary publish" (COMPOSITION-GUIDE §5.9 permits imperative at external boundaries). BUT the 4 queue topics are *internal* to the harness graph, not external boundaries. This is the classic pagerduty-demo pattern: the routing decision becomes invisible to `describe()` / `explain()` — the queue topics appear as islands with zero in-edges from the triage subgraph.
- ⚠️ **`router.subscribe(() => {})` is the activation keepalive.** Required by COMPOSITION-GUIDE §1 (effect needs subscriber to fire). The disposer path is registered, but the semantic contract is: the effect runs whenever `routerInput` settles. If a consumer *also* subscribes to `routerInput` or any of its observed ancestors, the effect is no longer uniquely keepalive-driven — still fine, just a latent coupling.
- ⚠️ **Triage's `retries: 1` on `promptNode`.** Wave A Unit 1 flagged this duplicate path: promptNode's in-built retries overlap with `withRetry` middleware. Same duplication here. Cross-ref: when Wave A Unit 1 C+D lands (remove `retries` option), this call site must switch to `withRetry(adapter, { attempts: 2 })` at adapter construction.
- ⚠️ **Large prompts from JSON.stringify of StrategySnapshot.** As strategy grows (one entry per `rootCause × intervention` = 6×6 = 36 entries max, bounded), the prompt includes the full map on every triage. Bounded max → fine, but each triage re-inlines ~1-2KB of strategy JSON on every call. Cache-unfriendly if the adapter has replay caching, because the cache key changes on every strategy record.
- ⚠️ **No priority re-ordering inside queues.** `queueTopics.get(merged.route).publish(merged)` appends to a FIFO topic. The `priority` field is computed by the LLM (0-100) and written into `TriagedItem` but is never used to reorder pending queue items. The `priorityScore` function (Unit 19) exists but is not wired into any queue-consumption site. This is a spec-vs-code gap that §5.12 dev-friendly-API cares about: users seeing `priority: number` in a TriagedItem assume it drives order.
- ⚠️ **Queue-route mismatch silently drops items.** `queueTopics.get(merged.route)` returns undefined for any route not in `QUEUE_NAMES`. The LLM returning `"route": "urgent"` triggers the optional chain and the item vanishes with no log, no audit entry, no retry. Combined with Unit 15 Q2 `QueueRoute` closed-union, the risk is bounded but silent.

#### Q3 — Design-invariant violations?

- 🟡 **§5.9 imperative triggers — router effect `.publish()` is gray-zone.** TopicGraph.publish is the sanctioned imperative boundary, matching how Unit 20's `createIntakeBridge` / `evalIntakeBridge` publish. The gray-zone cost is purely explainability: the edge from `router` to `queue/<route>` is invisible in `describe()`. Pagerduty-class island.
- 🟢 **§5.7 / §5.8 / §5.10 / §5.11** — no polling, no raw async, TopicGraph handles timestamps internally. Clean.
- 🟡 **COMPOSITION-GUIDE §28 factory-time seed** — `queueTopics` is a factory-time Map, read from the router effect body. Sanctioned pattern ("closure-captured immutable map" §28). Confirmed clean.
- 🟢 **§5.12 dev-friendly** — the user-visible surface (`harness.intake.publish(item)`) is minimal and clear.

#### Q4 — Open items (roadmap / optimizations.md)

- [optimizations.md "Router spread order defaults to intake-wins (done 2026-04-23, QA)"](../../docs/optimizations.md) — load-bearing for this unit; Unit 15 Q2 proposed a brand-rename that would neutralize the need.
- [optimizations.md "Harness executor/verifier dev-mode sanity check"](../../docs/optimizations.md) — not this unit's concern (applies to EXECUTE/VERIFY), but the same dev-mode approach could assert "unknown queue route" here with ≈5 LOC.
- roadmap §9.0 — "7-stage loop" is the spec; TRIAGE + QUEUE are shipped.
- **Not in optimizations.md yet — candidates for this review:**
  - Router as reactive `stratify` instead of imperative publish (explainability fix).
  - Priority-ordered queue consumption (`priority` field is unused).
  - Unknown-route silent-drop → throw or route to a dead-letter queue.
  - Dev-mode route validation (known-union check).
  - Strategy-snapshot prompt inlining → compression / last-N / summary instead of full JSON stringify.

#### Q5 — Right abstraction? More generic possible?

- **Right level.** The 3 stages (intake / triage / queue) have clear reactive boundaries; no factoring into sub-factories needed at this scale.
- **More generic possible — the router.** Today the router effect is 15 LOC of `for-each-queue, publish-if-match`. Generalized: a `stratify(triageNode, (item) => item.route)` would produce one derived node per known route, each feeding a thin per-queue `effect([...], publish)`. Topology would show `triage → stratify/auto-fix → queue/auto-fix::latest` as real edges. The per-queue effect is still imperative, but the *routing decision* becomes a visible reactive node — auditor can `explain(intake, queue/auto-fix)` and see the chain.
- **Even more generic — `TopicBridgeGraph` / `MessagingHubGraph`** from patterns/messaging. These exist for multi-keyed fan-out and would replace the whole router with a reactive hub subscription. Worth a unit-20 cross-ref; check whether the messaging hub's API matches harness's route-determination shape.

#### Q6 — Right long-term solution? Caveats / maintenance burden

- **The router is the single biggest maintenance liability in this unit.** 3 future "bug fixes" predictably land here:
  - "route field renamed; silent drop" (mitigate: closed-union guard).
  - "stray LLM field clobbered an intake field" (already hit once, now mitigated by spread order — but a future field rename could re-expose).
  - "why isn't my high-priority item being picked up first?" (`priority` is decorative).
  Each of these is a router refactor. A reactive `stratify` shape lets `describe()` + `explain()` surface the routing decision, which makes future debugging tractable.
- **Strategy-snapshot prompt inlining** will grow with catalog strategy recording. Today 36 max entries; if the strategy model expands (e.g., adds per-affectsArea facets), this becomes the dominant prompt cost. Compression recipe needed eventually.
- **Per-intake triage LLM call cost** — every intake item triggers one triage LLM call. Batching would reduce cost but breaks the per-item triage-reasoning audit trail. Accept as a cost of the 7-stage loop shape.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Proposed simpler shape (illustrative — makes router reactive-visible):**

```ts
import { stratify } from "../../extra/stratify.js";

// ... existing intake / strategy / triageInput / triageNode ...

// Drop the effect-based router. Instead:
const routed = derived<TriagedItem | null>(
  [routerInput as Node<unknown>],
  ([pair]) => {
    if (pair == null) return null;
    const [classification, triagePair] = pair as [TriagedItem | null, [IntakeItem | null, StrategySnapshot] | null];
    if (!classification?.route) return null;
    const intakeItem = triagePair?.[0];
    if (!intakeItem) return null;
    return { ...classification, ...intakeItem };
  },
  { name: "triage::merged" },
);

// stratify produces one Node<TriagedItem | null> per known route.
const byRoute = stratify(routed, (it) => it?.route ?? "__skip__", QUEUE_NAMES);

for (const route of QUEUE_NAMES) {
  const src = byRoute.get(route);
  if (!src) continue;
  const topic = queueTopics.get(route)!;
  effect([src as Node<unknown>], ([item]) => {
    if (item == null) return;
    topic.publish(item as TriagedItem);
  }, { name: `queue/${route}/sink` }).subscribe(() => {});
}
```

**Deltas:**
- Router splits into `routed` (derived merge, visible in describe), `byRoute` (stratify fan-out, visible), `queue/<route>/sink` (thin per-queue effect).
- `explain(intake, queue/auto-fix::latest)` now walks `intake → triage → triage::merged → stratify::auto-fix → queue/auto-fix/sink → queue/auto-fix::latest`. Every node on the chain is named; no invisible edges.
- Unknown route falls into `"__skip__"` bucket — no silent drop; surfaces as a known "unrouted" topology sink that can be observed for alerts.

**Topology check — minimal composition (current shape):**

```ts
const mockAdapter = { invoke: async () => ({ content: JSON.stringify({ rootCause:"composition", intervention:"template", route:"auto-fix", priority:50, triageReasoning:"test" }) }) };
const h = harnessLoop("t", { adapter: mockAdapter });
h.intake.publish({ source:"eval", summary:"x", evidence:"y", affectsAreas:["a"] });
```

`describe({ format: "ascii" })` (current shape) will show (abridged):

```
intake::latest         -> triageInput (withLatestFrom)
strategy (snapshot)    -> triageInput (secondary)
triageInput            -> triage::messages -> <triage-switchMap-product> = triageNode
triageNode             -> routerInput (withLatestFrom)
triageInput            -> routerInput (secondary)
routerInput            -> router (effect)
                             (NO visible edge to queue topics)
queue/auto-fix::latest       (island — no in-edge from any named node)
queue/needs-decision::latest (island)
queue/investigation::latest  (island)
queue/backlog::latest        (island)
```

`explain(intake::latest, queue/auto-fix::latest)`: **fails** — no path. The router's `topic.publish()` is an imperative write that doesn't register as a reactive edge.

**Verdict: ISLANDS — 4 queue topics disconnected from triage.** Pagerduty-class failure. Proposed `stratify`-based fix in the simpler-shape sketch above eliminates them.

**Performance & memory footprint:**
- **Current:** 4 TopicGraph mounts (per-route retained buffers, each `retainedLimit=1000` → max 4000 retained items), 1 triage `promptNode` (2 nodes: messagesNode + switchMap product), 2 `withLatestFrom` products, 1 router effect + keepalive subscription. Per intake: 1 LLM call, 1 prompt string allocation (strategy JSON size + item JSON size).
- **Recommended (stratify shape):** +1 `derived` (routed merge, ~1 alloc per wave), +1 stratify node per route (4 extra reactive nodes), +4 thin effects. Net +8 nodes, same TopicGraph mounts. Per-wave extra cost: `stratify` is a multiplex derived — O(1) per wave. Hot-path ≈ identical.
- **Strategy prompt cost scales with strategy size.** 36 entries × ~80 bytes JSON ≈ 3KB max per triage prompt — acceptable today; revisit if strategy model expands.

#### Q8 — Alternative implementations (A/B/C…)

- **(A) Status quo — imperative `topic.publish` inside router effect.** Pros: smallest code. Cons: 4 queue islands, priority unused, unknown-route silent drop.
- **(B) `stratify` the router into reactive fan-out; keep per-queue thin imperative sink.** Pros: reactive topology closes islands; explain() walks end-to-end; unknown routes surface as an observable sink. Cons: 15 LOC more; thin imperative sinks are still imperative but the routing decision is no longer hidden.
- **(C) Full reactive via `TopicBridgeGraph` / messaging hub.** Pros: canonical harness-of-harness pattern (messaging is the protocol primitive). Cons: requires a cross-pattern API shape audit (does messaging hub accept a string-keyed router? Is the retained-item semantic identical?). Deferred until Unit 20 (bridge.ts) confirms shape.
- **(D) Priority-ordered queues.** Orthogonal to routing — replace TopicGraph with a priority-ordered variant (or add a `priorityOrdered: true` flag on TopicGraph). Out of scope for this unit; candidate for a messaging-layer enhancement.
- **(E) Throw / dead-letter unknown routes.** Orthogonal patch to A or B; adds an `unroutedTopic = new TopicGraph("queue/__unrouted")` and sends anything without a matching route there. Subscribable for alerting.

**Recommendation: B + E.** Together: stratify-based router with `__skip__` surfaced as a dead-letter topic. Explainability closes, unknown-route visibility, priority-ordered queues deferred to a queue-layer change.

#### Q9 — Does the recommendation cover the concerns?

| Concern (from Q2/Q3/Q6) | Covered by |
|---|---|
| 4 queue topics appear as islands in describe/explain | B — stratify makes routing a reactive edge |
| Unknown-route silent drop | E — dead-letter `__unrouted` topic |
| Router effect §5.9 gray-zone (imperative publish) | B — imperative publish is now a thin sink under a visible stratify edge; gray-zone narrows but remains |
| `priority` field is decorative | (D, deferred — queue-layer change, not this unit) |
| Strategy JSON prompt cost grows | (prompt compression; not this unit — Wave B cross-cutting or Unit 19) |
| `retries: 1` on triage promptNode duplicates `withRetry` | Wave A Unit 1 C+D — remove promptNode retries, switch to adapter middleware here |
| LLM-round-trip field collision (`_reingestions`) | Unit 15 D (`$`-prefix rename); this unit's spread-order fix is belt-and-suspenders |

**Open question — requires user call:**

1. **Stratify vs messaging-hub router.** B vs C. C is more canonical but depends on messaging-hub API fit (pending Unit 20). Pick B as the pragmatic default or wait for Unit 20 to resolve?
2. **Dead-letter `__unrouted` topic surfaces.** Should the HarnessGraph expose `unrouted: TopicGraph<TriagedItem>` publicly for alerting wiring, or keep it as an internal mount surfaced only via `describe()`?
3. **Priority-ordered queue — is this the unit that owns it, or a messaging-layer change?** Recommendation is messaging-layer (out of scope) but user may prefer an inline priorityHeap in harness for v1.

#### Decisions locked (2026-04-23)

**Q8 router shape — ~~B (stratify)~~ → C (hub+TopicBridgeGraph), upgraded at Unit 20.**
~~Adopt the `stratify`-based reactive router now.~~ **Superseded by Unit 20 C decision:** use `MessagingHubGraph` + `topicBridge` per route. Routing is data (topic name), not code. See Unit 20 decisions for the canonical shape.

Original stratify sketch (for reference; no longer the implementation target). Corrected API (actual signature: `stratify(name, source, rules, opts)`):

```ts
import { stratify } from "../../extra/stratify.js";

const routerGraph = stratify<TriagedItem>(
  "router",
  routed as Node<TriagedItem>,
  [
    ...QUEUE_NAMES.map((route) => ({
      name: route,
      classify: (it: TriagedItem) => it?.route === route,
    })),
    {
      name: "__unrouted",
      classify: (it: TriagedItem) => !QUEUE_NAMES.includes(it?.route as QueueRoute),
    },
  ],
);
```

Re-evaluate option C (messaging-hub canonical shape) at Unit 20 when `bridge.ts` is reviewed — prefer canonical shape if the API fit is clean.

**Dead-letter `unrouted` visibility — expose publicly.**
`HarnessGraph` grows a `unrouted: TopicGraph<TriagedItem>` field, backed by the `__unrouted` branch of the stratify graph. Consumers can `harness.unrouted.latest` for alerting without needing `describe()` internals.

**Priority-ordered queues — defer.**
`priority: number` on `TriagedItem` is currently decorative — the queue consumption order ignores it. Defer to a messaging-layer enhancement session. Add to `docs/optimizations.md`:
> `priority: number` on TriagedItem is decorative — wire to queue ordering (priority-heap TopicGraph variant or `priorityOrdered: true` flag on TopicGraph).

---

### Unit 17 — GATE stage in `loop.ts` + `gate()` primitive

**Scope:** [`loop.ts:303–321`](../../src/patterns/harness/loop.ts) (GATE stage wiring) + [`orchestration/index.ts:244–438`](../../src/patterns/orchestration/index.ts) (`gate()` primitive + `GateController<T>`).

#### Decisions locked (2026-04-23)

**B — Fix double-registration via `gateGraph.mount`.**
Replace `gateGraph.add(topic.latest, { name: "${route}/source" })` with `gateGraph.mount("queue/${route}", topic)` in the GATE stage. The queue topic's latest node is then resolved by its canonical path `queue/${route}::latest` in `gateGraph`, eliminating the duplicate-path node that appeared in both the topic subgraph and gateGraph.

```ts
// Before:
gateGraph.add(topic.latest as Node<unknown>, { name: `${route}/source` });
const ctrl = gate<TriagedItem>(gateGraph, `${route}/gate`, `${route}/source`, opts);

// After:
gateGraph.mount(`queue/${route}`, topic);
const ctrl = gate<TriagedItem>(gateGraph, `${route}/gate`, `queue/${route}::latest`, opts);
```

**C — Add `lastRejected: Node<T | null>` to `GateController`.**
`reject()` emits the rejected item to a `state<T | null>(null)` node before discarding from the queue. Consumers can subscribe for audit wiring. Initial value null; null = no rejection yet.

**D — No rename.** Keep `gatedStream` as-is. The naming proximity to `gate()` is tolerable — `gatedStream` is scoped to `patterns/ai/prompts/` and `gate()` to `patterns/orchestration/`; module path provides sufficient disambiguation.

**Open items added to `docs/optimizations.md`:**
- `gate()` maxPending defaults to Infinity — consider a finite default for production harness use.
- `reject()` observable gap closed by C above.

---

### Unit 18 — EXECUTE + VERIFY + fast-retry + REFLECT in `loop.ts`

**Scope:** [`loop.ts:322–525`](../../src/patterns/harness/loop.ts) — `retryTopic`, `executeInput` merge, `executor(executeInput)`, `executeContextNode`, `verifier(executeContextNode)`, `verifyContext`, `fastRetry` raw node, REFLECT (inline), `HarnessGraph` assembly.

#### Decisions locked (2026-04-23)

**B+C — Register anonymous nodes + add reflect derived.**
Add to `harnessLoop` assembly section:

```ts
harness.add(executeInput as Node<unknown>,       { name: "execute::input" });
harness.add(executeContextNode as Node<unknown>, { name: "execute::context" });
harness.add(verifyContext as Node<unknown>,      { name: "verify::context" });
harness.add(fastRetry as Node<unknown>,          { name: "verify::dispatch" });

const reflectNode = derived(
  [fastRetry as Node<unknown>],
  () => null,
  { name: "reflect" },
);
harness.add(reflectNode as Node<unknown>, { name: "reflect" });
```

Closes `explain(execute, verify)`, `explain(triage, execute)`, and `explain(verify, reflect)`. Surfaces the 7th stage in `harnessTrace`.

**D — Refactor `fastRetry` fn into named private sub-functions.** `assembleResults`, `handleVerified`, `handleRetry`, `handleReingestion` within the same file. No behavior change. Deferred to the same implementation session as B+C.

**E — Reactive retry/reingestion writes (derived + thin effect) — post-1.0.** File in `docs/optimizations.md`:
> `fastRetry` imperative publishes (`retryTopic.publish`, `intake.publish`) are invisible in `explain()`. Correct shape: a `derived` producing `{ kind, item }` + three thin registered effects. Deferred post-1.0.

**`_retries` / `_reingestions` rename** (Unit 15 D) and **`retries:1` removal** (Wave A Unit 1 C+D) pending implementation.

---

### Unit 18b — `fastRetry` deep-dive

**Scope:** [`loop.ts:395–483`](../../src/patterns/harness/loop.ts) — the `fastRetry` raw node and its three-way branching logic.

#### Decisions locked (2026-04-23)

**B — Sub-function extraction.** Refactor `fastRetry` fn body into named private functions: `assembleResults`, `handleVerified`, `handleRetry`, `handleStructural`. Same reactive node, same topology. No behavior change. Preserves the fast-retry benefit (the short-circuit path is in the topology — `retryTopic.latest → merge → executeInput` — not in the fn body).

**C — Fix `source` + `severity` on reingestion.**
```ts
// Before:
source: "eval",
severity: "high",

// After:
source: item.source,
severity: item.severity ?? "high",
```
Lives in `handleStructural` (or `handleReingestion`) after B extraction. `"reingestion"` as a dedicated `IntakeSource` value deferred — open union from Unit 15 F means it can be added later without a type change.

**D — Null-execRaw guard before assembly.**
```ts
if (!execRaw) {
  handleStructural(
    makeVerifyResult(vo, { item, outcome: "failure", detail: "executor returned null" }),
    item,
  );
  return;
}
```
Closes the `detail:"unknown"` audit gap when the executor returns null (parse failure / LLM timeout).

**E — Fix `errorClassifier` context: pass `execRaw.outcome` instead of hardcoded `"failure"`.**
```ts
// Before:
errorClassifier({ item, outcome: "failure", detail: vr.findings.join("; ") })

// After:
errorClassifier({ item, outcome: execRaw.outcome, detail: vr.findings.join("; ") })
```
Correct semantics for custom classifiers that branch on `result.outcome`.

**Q3 question 3 — `strategy.record` not called on retry path: confirmed intentional.** Record only terminal outcomes (verified=true or structural failure); intermediate retry attempts do not penalize the intervention.

---

### Unit 19 — `strategy.ts`

**Scope:** [`src/patterns/harness/strategy.ts`](../../src/patterns/harness/strategy.ts) (167 LOC) — `strategyModel()` + `priorityScore()`.

#### Decisions locked (2026-04-24)

**B — JSDoc clarifications.**
- `priorityScore`: add note "Score reflects age as of last reactive update, not current wall time. Pass a `fromTimer`-driven node as a dep if live age decay is required."
- `priorityScore`: add note "This utility does NOT override the `priority` field set by the TRIAGE LLM. For queue ordering, see the priority-ordered queue open item in `docs/optimizations.md`."

**C — Rename `_map` → `strategyMap`.** Closure variable; the underscore implies "private field on an object" which is misleading here.

**2 — Wire `priorityScore` optionally in `harnessLoop`.**
When `opts.priority` is set (already exists as `PrioritySignals`), the harness wires one `priorityScore` node per queue and exposes them on `HarnessGraph`:

```ts
readonly priorityScores?: ReadonlyMap<QueueRoute, Node<number>>;
```

`lastInteractionNs` is an internal `state(monotonicNs())` seeded at factory time. Expose `harness.touch()` (or `harness.interaction()`) to bump it imperatively on human interaction. Alternatively, accept `opts.lastInteractionNs?: Node<number>` for caller-supplied tracking. Exact shape to be decided at implementation time — flag as open question in the implementation session.

**3 — Strategy persistence deferred to storage session (roadmap §9.0+).** `strategyModel(opts?: { initial?: StrategySnapshot })` seed API is the target shape.

---

### Unit 20 — `bridge.ts`

**Scope:** [`src/patterns/harness/bridge.ts`](../../src/patterns/harness/bridge.ts) (466 LOC) — `createIntakeBridge`, `evalIntakeBridge`, `evalSource`, `beforeAfterCompare`, `affectedTaskFilter`, `codeChangeBridge`, `notifyEffect`.

#### Decisions locked (2026-04-24)

**C — Hub + TopicBridgeGraph canonical shape. Supersedes Unit 16 B (stratify).**

Replace the current 4 standalone `TopicGraph` queues + imperative router effect with:
1. One `MessagingHubGraph` as the queue hub (`messagingHub("queues", { defaultTopicOptions: { retainedLimit } })`).
2. One `TopicGraph<TriagedItem>("triage-output")` after the triage merge step.
3. One `topicBridge` per route with a `map` filter:
   ```ts
   for (const route of QUEUE_NAMES) {
     topicBridge(`bridge/${route}`, triageOutput, queueHub.topic<TriagedItem>(route), {
       map: (item) => item.route === route ? item : undefined,
     });
   }
   topicBridge("bridge/__unrouted", triageOutput, queueHub.topic<TriagedItem>("__unrouted"), {
     map: (item) => !(QUEUE_NAMES as readonly string[]).includes(item.route) ? item : undefined,
   });
   ```
4. Remove the `stratify`-based router from Unit 16 B — superseded. Routing is data (topic name), not code (stratify classify fns).

`explain(triage, queues/auto-fix::latest)` walks every edge reactively. All islands closed.

**`HarnessGraph.queues` → `MessagingHubGraph` directly.**
Pre-1.0, no backward compat. Replace `queues: ReadonlyMap<QueueRoute, TopicGraph<TriagedItem>>` with `queues: MessagingHubGraph`. Callers access queue topics via `harness.queues.topic<TriagedItem>("auto-fix")`. `harness.unrouted` becomes `harness.queues.topic<TriagedItem>("__unrouted")`.

**D — JobFlow claim/ack/nack for EXECUTE stage — same implementation session as C.**
Replace `merge(queueTopics.latest)` with `JobQueueGraph`-style claim/ack/nack semantics per route. Gives priority ordering + proper retry via `nack`. Changes executor interface from `Node<TriagedItem | null>` to a claim-based contract. Exact shape to be decided at implementation time.

**Prior bridge.ts fixes retained from first pass:**
- B — `affectedTaskFilter` ghost node fix (plain-array closure constant).
- C — `evalIntakeBridge` `affectsAreas` configurable via `EvalIntakeBridgeOptions`.
- D — `notifyEffect` `onError` callback on `NotifyEffectOptions`.

---

### Unit 21 — `refine-executor.ts` + `eval-verifier.ts`

**Scope:** [`refine-executor.ts`](../../src/patterns/harness/refine-executor.ts) (169 LOC) + [`eval-verifier.ts`](../../src/patterns/harness/eval-verifier.ts) (184 LOC).

#### Decisions locked (2026-04-24)

**B — Name filter nodes for describe() clarity.**
Both factories use `filter(input, ...)` and `filter(raw, ...)` creating anonymous nodes. Name them `${name}/gate-in` and `${name}/gate-out`. If `filter` doesn't accept a name option, wrap in a named `derived`.

**C — Type-safe `harnessEvalPair<T>` factory. Same implementation session.**
```ts
function harnessEvalPair<T>(config: {
  seedFrom: (item: TriagedItem) => T;
  evaluator: Evaluator<T>;
  strategy: RefineStrategy<T>;
  datasetFor: (item: TriagedItem) => readonly DatasetItem[];
  threshold?: number;
  refine?: Omit<RefineLoopOptions, "dataset" | "name">;
}): { executor: HarnessExecutor; verifier: HarnessVerifier }
```
Shares the evaluator and enforces matching `T` between executor and verifier. Prevents wrong-typed artifact cast errors.

**Hub model executor interface: confirmed unchanged.** The claim pump from Unit 20 D feeds a reactive `Node<TriagedItem | null>` — the `HarnessExecutor` type stays `(input: Node<TriagedItem | null>) => Node<ExecuteOutput | null>`. The claim/ack boundary sits between queue and executor input, not inside the executor.

---

### Unit 22 — `trace.ts` + `profile.ts`

**Scope:** [`trace.ts`](../../src/patterns/harness/trace.ts) (199 LOC) + [`profile.ts`](../../src/patterns/harness/profile.ts) (63 LOC).

#### Decisions locked (2026-04-24)

**B — Mechanical path updates for hub model + REFLECT label.**
- Add `reflect: "REFLECT"` to `buildStageLabels` after Unit 18 C (reflect node) lands.
- Keep `strategy: "STRATEGY"` as distinct label — STRATEGY is the model, REFLECT is the recording action.
- Update queue paths `queue/<route>::latest` → `queues/<route>::latest` after Unit 20 C (hub) lands.
- Update `harnessProfile` to iterate `harness.queues.topicNames()` instead of `harness.queues.entries()`.
- Validate gate path format (`gates::${route}/gate` vs `gates/${route}/gate`) against actual mount structure after Unit 17 B lands.

**C — `HarnessGraph.stageNodes()` method for path decoupling.**
Primary stage nodes only (7 stages): intake, triage, queue/\*, gate/\*, execute, verify, reflect, strategy. Does NOT include anonymous intermediaries (`execute::input`, `verify::context`, etc.). ~15 LOC on HarnessGraph.

`buildStageLabels` and `harnessProfile` read from `stageNodes()` instead of hardcoding mount paths. Decouples inspection tools from mount structure — hub migration, gate remounting, or future stage additions don't require trace/profile code changes.

**JSDoc note on `harnessProfile`:** add "Returns a point-in-time snapshot. `.cache` reads are not transactional — values may reflect mid-batch state if called during a reactive wave."

---

## Wave B cross-cutting consolidation

**Scope:** After Units 15–22 completed. Two cross-cutting questions raised by the user.

---

### Q1 — Unified hub scope (intake + retryTopic + verifyResults)

**Question:** Unit 20 moved routing queues to a `MessagingHubGraph`. Should `intake`, `retryTopic` (fast-retry re-injection), and `verifyResults` (verify output buffer) also join the same hub?

**Alternatives:**
- **(A) One hub for all reactive-wire-crossing topics.** `HarnessGraph.hub: MessagingHubGraph` covers: `intake`, `queues/<route>` (four routing queues), `retry` (fast-retry re-entry), `verify-results`. Sugar getters preserve the existing access API (`get intake() { return this.hub.topic<IntakeItem>("intake"); }`). One hub cluster in `describe()`. `explain(intake, queues/auto-fix)` walks every bridge edge reactively.
- **(B) Hub covers queues only.** Keep `intake` as a standalone `TopicGraph`, `retryTopic` and `verifyResults` as internal named topics. Rationale: intake is a user-facing entry point; hub is for internal routing.

**Decision locked (2026-04-24): Option A.** One hub, all reactive-wire-crossing topics unified. Rationale mirrors Unit 20: routing is data (topic name), not code (imperative publish dispatch). Every cross-stage write becomes a bridge edge in `describe()`/`explain()`. Sugar getters on `HarnessGraph` preserve backward-compatible access patterns. `HarnessGraph.hub: MessagingHubGraph` is the single topology surface for the entire harness.

**Implementation scope:** Same session as Unit 20 C. Update `harnessLoop` to create one `messagingHub("harness", ...)` and register intake/retry/verify-results/queues as topics. Update `harnessProfile` and `harnessTrace` path references accordingly (covered by Unit 22 B `stageNodes()` decoupling).

---

### Q2 — `agentLoop` tool-call lifecycle and `JobQueueGraph`

**Question:** Should the `agentLoop` tool-call execution lifecycle use `JobQueueGraph` (claim/ack/nack) instead of the current parallel-batch `switchMap + derived(calls.map(executeToolReactively))`?

See 9-question review below.

---

### Unit B-CC — `agentLoop` tool-call lifecycle review

**Scope:** [`src/patterns/ai/agents/agent-loop.ts`](../../src/patterns/ai/agents/agent-loop.ts) (702 LOC) — specifically the tool-call pipeline: `toolCallsNode` (lines 330–351), `gatedToolCallsNode` intercept splice (lines 356–359), `toolResultsNode` (lines 381–409), and `executeToolReactively` (lines 640–669).

#### Q1 — Semantics, purpose, implementation

**Tool-call pipeline (per LLM response):**
1. **`toolCallsNode`** (line 330) — raw `node([lastResponseState, statusNode])`: emits `DATA(calls)` only when `status === "acting"` AND response has tool calls; otherwise emits `RESOLVED`. Gating on `status` (not on `lastResponseState` alone) prevents stale re-trigger when `lastResponse` updates while status has already moved on. The `RESOLVED`-vs-`DATA([])` choice is documented and load-bearing (line 323–329): `DATA([])` would cause `switchMap` to re-dispatch its inner on every idle wave.
2. **`gatedToolCallsNode`** (line 356–359) — optional reactive splice via `interceptToolCalls`. Identity transform when not set. `agent.toolCalls` exposes the post-intercept view. Per JSDoc at lines 42–61: filter, gate, or throttle tool calls via a pure reactive composition — the intercept appears as a real edge in `describe()`.
3. **`toolResultsNode`** (line 381) — `switchMap(gatedToolCallsNode, calls => derived(calls.map(executeToolReactively), ...))`. Every call in the batch executes **in parallel** inside the `derived`. The inner `derived([perCall[0], perCall[1], ...])` waits for ALL to settle before emitting the result array (fan-out → fan-in).
4. **`executeToolReactively`** (line 640) — per-call `retrySource({count:1}) + rescue`. Each call is independently retried once on ERROR; on terminal ERROR, `rescue` converts it to a JSON-shaped `{error: string}` `ToolResult` so the LLM sees the failure and decides next steps. No inter-call dependency.
5. **`effResults`** effect (line 466) — when `toolResultsNode` settles with a full batch: `batch(() => { statusNode.emit(nextStatus); chat.appendToolResult(r.id, r.content) })`. Status emits before chat mutations (ordering discipline documented at lines 463–465).

**Abort lifecycle:**
- `_currentAbortController` (line 139) — minted per `switchMap` project in `llmResponse` (line 275–276). Threaded into `adapter.invoke({ signal })` AND `fromAny(..., { signal })`. `effAbort` effect (line 482) aborts it reactively when `abortedNode` flips true. Cleared in `run()`'s `finally` (line 607).
- Design is async-boundary pattern: the AbortController lives at the exact source boundary where the Promise is created. One controller per LLM call. The reactive `aborted` node drives it; no external caller touches the controller.

#### Q2 — Semantically correct?

- ✅ `toolCallsNode` `RESOLVED`-vs-`DATA([])` gate prevents spurious switchMap re-dispatch on idle waves (documented at lines 323–329).
- ✅ `switchMap(gatedToolCallsNode)` cancels the prior inner `derived` when a new tool-call batch arrives (supersede semantics). Correct under multi-turn where one turn's tool results could still be in-flight when status re-transitions.
- ✅ Parallel fan-out via `derived(calls.map(executeToolReactively))` is correct — tool calls within a single LLM turn are independent and safe to execute concurrently.
- ✅ `executeToolReactively` `retrySource({count:1}) + rescue` gives 2-attempt semantics + graceful LLM-visible error, consistent with the documented reactive-retry pattern.
- ✅ `effResults` abort guard (`if (latestAborted) return`) is correct defense-in-depth — catches the case where `aborted` flipped between the Promise resolve and the effect firing.
- ✅ `_runVersion` stamp on `_terminalResult` prevents stale resolution when `run()` is called on a recycled agent instance.
- ⚠️ **`Promise.resolve(adapter.invoke(...))` at line 281** — same §5.10 gray-zone flagged in Unit 11 (nine middleware files). `fromAny(adapter.invoke(...))` handles all three `NodeInput<T>` shapes (`Promise | Node | raw`) without the manual `Promise.resolve()` wrapper. The current shape loses Node-returning adapter reactivity (same stale-`.cache` risk as `promptNode` pre-fix).
- ⚠️ **`toolCallsNode`, `toolResultsNode`, `promptInput`, `llmResponse`, `_terminalResult` not `add()`-ed to the graph.** They appear in `describe()` through dep-traversal (reactive edges are still visible), but they are NOT path-addressable for `observe(path)` calls. A user who writes `agent.observe("toolCalls")` gets a miss. Contrast: `status`, `turn`, `aborted` ARE explicitly `add()`-ed (lines 164, 171, 179).
- ⚠️ **`_currentAbortController` is a class field, not a node** — abort controller lifecycle is invisible to `describe()`. This is expected (it's at the async boundary), but means users can't introspect whether an abort signal is currently armed via the graph inspection tools.

#### Q3 — Design-invariant violations?

- 🟡 **§5.10 raw-async** — `Promise.resolve(adapter.invoke(...))` at line 281. See Q2. Not a full violation (adapter.invoke MAY return a Promise legitimately) but `fromAny` is the canonical bridge.
- 🟢 **COMPOSITION-GUIDE §28 factory-time seed** — `latestTurn` / `latestAborted` closure mirrors are textbook §28. Subscribe once at construction; read synchronously in effects. The comment at lines 183–202 explicitly documents the FIFO-drain staleness invariant.
- 🟢 **§5.8 no polling** — no timer-based loops.
- 🟢 **§5.9 no imperative triggers** — `run()` is a sanctioned `awaitSettled` boundary bridge (compare `firstDataFromNode`). The `status.emit("thinking")` at line 586 is the one-shot kick at the reactive source boundary — not a polling trigger.
- 🟢 **COMPOSITION-GUIDE §7 feedback-cycle break** — `lastResponseState` mirror (line 317) breaks the drain-ordering issue where `_terminalResult`'s dep on `llmResponse` would see stale prevData during the effResponse batch. The ordering discipline (comments lines 411–431) is documented and load-bearing.
- 🟢 **`effAbort` is a reactive effect** — abort is driven by `abortedNode`, not a timer or callback. External AbortSignal wires through `this.aborted.emit(true)` at the listener boundary (line 593) — clean.
- 🟡 **Intermediate nodes not `add()`-ed** (Q2 above). Not a §5-series violation but against the spirit of §5.12 "developer-friendly APIs" — a user inspecting the graph can't observe intermediate stages by path.

#### Q4 — Open items (roadmap / optimizations.md)

- [optimizations.md "switchMap-inner teardown hardening for `refineExecutor` / `evalVerifier`"](../../docs/optimizations.md) — same inner-derived lifecycle concern applies to `toolResultsNode`'s inner `derived(perCall, …)`. If `gatedToolCallsNode` emits a new batch while the previous inner `derived` is still active (long-running tool calls), `switchMap` cancels the prior inner. Verify teardown cleans up all `executeToolReactively` nodes.
- **Not yet in optimizations.md — candidates surfaced this review:**
  - `Promise.resolve(adapter.invoke(...))` → `fromAny` (§5.10 gray-zone, cross-cutting with Unit 11 + Unit 1).
  - `add()` explicit registration for intermediate pipeline nodes (`promptInput`, `llmResponse`, `toolCallsNode`, `toolResultsNode`, `_terminalResult`) — path-addressable observe.

#### Q5 — Right abstraction? More generic possible?

- **`executeToolReactively` is correctly scoped.** Per-call `retrySource + rescue` is the right unit — independent of other calls, consistent retry contract, error surfaces as LLM-visible tool content. No factoring opportunity.
- **`toolCallsNode` gate logic** (status-check + calls-check) is 20 LOC in a raw `node()`. Could be rewritten as `derived([lastResponseState, statusNode], ([resp, stat]) => stat === "acting" && resp?.toolCalls?.length ? resp.toolCalls : null)` — simpler, but loses the explicit `RESOLVED`-vs-`DATA([])` documentation. Keep as-is; the rawness is deliberate and documented.
- **`interceptToolCalls` splice** — correct abstraction. Pure reactive transform, audit-visible, single composition point. The splice is where `gate()` / `throttle()` / `policy` nodes attach. This is the right pattern for COMPOSITION-GUIDE §31 "interception is security."
- **Parallelism granularity** — current: all calls in one turn execute in parallel. No alternative (e.g. sequential, priority-ordered) is needed for the standard single-agent model. If a use case demanded sequential execution (rate-limiting, ordered side-effects), `interceptToolCalls` with a serializing operator is the right hook — no core change needed.

#### Q6 — Right long-term solution? Caveats / maintenance burden

- **`Promise.resolve(adapter.invoke(...))`** — same maintenance burden as Unit 11: every future NodeInput shape change surfaces here. `fromAny` eliminates the branch entirely.
- **No intermediate `add()` registrations** — a future user writing an `observe`-based harness dashboard (e.g. `agent.observe("toolCalls")`) will get a silent path-miss. The topology check (Q7) confirms nodes ARE visible through dep traversal (not islands), but only by traversal, not by name-path. Registering them is 5 × 1 LOC.
- **`_currentAbortController` field** — clean today. The risk is a future contributor who sees the field and tries to move it to a `state()` node (adding reactive tracking). If they do that correctly, great. If they add it as a `state` but forget to clear it on teardown, it becomes a persistent observable. The existing pattern (plain field, cleared in `run()` finally) is the safer choice — no reactive overhead for a value that has no downstream subscribers.
- **`latestTurn` / `latestAborted` mirrors** — the FIFO-drain ordering invariant is correct and documented. Risk: a future refactor that un-batches `turnNode.emit` inside `effResponse` would silently regress the invariant. The comment at lines 199–202 calls this out explicitly; keep the warning.

#### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check — minimal composition:**

```ts
const agent = agentLoop("test", { adapter: mockAdapter, tools: [myTool] });
agent.status.subscribe(() => {});
agent.toolCalls.subscribe(() => {});
agent.toolResults.subscribe(() => {});
await agent.run("do something");
```

`describe()` on the agent graph (representative):

```
status                (state, meta.ai)           -> promptInput, toolCalls, toolResults::batch
turn                  (state, meta.ai)
aborted               (state, meta.ai)           -> promptInput
lastResponse          (state, meta.ai)           -> toolCalls
promptInput           (derived, meta.ai)         -> llmResponse
llmResponse           (switchMap product)        -> (effResponse sink)
toolCalls             (derived, meta.ai)         -> toolResults
toolResults::batch    (derived)                  [subscribed]
terminalResult        (derived, meta.ai)
chat/...              (subgraph cluster)
tools/...             (subgraph cluster)
```

`explain(status → toolResults::batch)`: `status → toolCalls → toolResults::batch`. Clean chain. `explain(status → llmResponse)`: `status → promptInput → llmResponse`. Clean chain. **No islands.**

The `_terminalResult` and intermediate nodes appear through traversal but are not path-addressable. **Verdict: clean topology — all nodes linked, explain walks correctly. No islands. Gap: intermediate nodes not `add()`-ed → not observe()-able by path.**

**Performance & memory:**
- Per tool-call batch: N parallel `retrySource + rescue` chains. Each chain: 1 `retrySource` (internal `state` + operator) + 1 `derived` (onSuccess) + 1 `rescue` node = ~3 nodes per call. Torn down when `switchMap` re-dispatches.
- Batch derived: 1 `derived([perCall[0]...perCall[N]])` — N deps. Recomputes on each perCall settlement. For N=10 calls: 10 × 3 = 30 transient nodes + 1 derived fan-in. All torn down on batch completion.
- `_terminalResult`: 2 deps (`statusNode`, `lastResponseState`). O(1). Retained for agent lifetime.
- Memory retained per agent instance: 5 state/derived nodes (`status`, `turn`, `aborted`, `lastResponse`, `_terminalResult`) + 3 keepalives + 2 closure mirrors. Very lightweight.
- No unbounded growth. Tool-call batch nodes are transient (switchMap inner lifecycle).

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo — no code change.** Pros: working, well-documented, no churn. Cons: `Promise.resolve()` wrapper, intermediate nodes not path-addressable.
- **(B) A + replace `Promise.resolve(adapter.invoke(...))` with `fromAny(adapter.invoke(...))`.** Pros: removes §5.10 gray-zone, handles Node-returning adapters correctly, consistent with Unit 1 C + Unit 11 A recommendations. Cons: minimal — same behavior for all shipped adapters; fixes a latent bug.
- **(C) B + `add()` intermediate nodes with their existing names (`promptInput`, `llmResponse`, `toolCalls` [already done via `this.toolCalls`], `toolResultsNode`, `_terminalResult`).** Pros: path-addressable `observe()`, richer `describe()` clustering. Cons: trivial (5 × 1 LOC); minor: `toolCalls` is already a public property so the path is already named — check whether it's auto-registered via the property assignment.
- **(D) Use `JobQueueGraph` for tool-call execution.** `JobQueueGraph` is a sequential claim/ack/nack single-worker pattern. Tool calls in a single LLM turn execute in **parallel** (fan-out) — `JobQueueGraph` is fundamentally mismatched: it processes one job at a time, has no batch fan-in primitive, and its nack semantics (re-queue for next worker) don't match `rescue`'s LLM-feedback semantics (convert error to tool result content). **Not applicable.** The existing `switchMap + derived(calls.map(executeToolReactively))` is the correct shape for parallel batch execution.

**Recommendation: B + C.** `fromAny` bridge + explicit `add()` for intermediate nodes. No structural change to the tool-call lifecycle — the existing parallel batch pattern is correct.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3/Q6) | Covered by |
|---|---|
| `Promise.resolve(adapter.invoke(...))` §5.10 gray-zone | B — `fromAny(adapter.invoke(...))` |
| Node-returning adapter loses reactivity | B — `fromAny` handles all three NodeInput shapes |
| Intermediate nodes not path-addressable via `observe()` | C — explicit `add()` registrations |
| `_currentAbortController` not visible in describe() | Not addressed — expected (async boundary field; no reactive downstream) |
| `latestTurn` staleness on un-batched emit | Not addressed — not a current bug; comment at lines 199–202 is the guard |
| JobQueueGraph applicability | D — NOT applicable; existing parallel pattern is correct |

**JobQueueGraph decision:** Does NOT apply to the agentLoop tool-call lifecycle. The parallel fan-out/fan-in batch model (`derived(calls.map(executeToolReactively))`) is correct, purpose-fit, and compositionally clean. `JobQueueGraph` is the right primitive for sequential single-worker queue patterns (e.g. the EXECUTE stage's claim/ack/nack per Unit 20 D) — not for intra-turn tool parallelism.

#### Decisions locked (2026-04-24)

- **B + C adopted.**
  - **B:** Replace `Promise.resolve(adapter.invoke(...))` at line 281 with `fromAny(adapter.invoke(...))` directly. Same semantics for all shipped adapters; fixes latent Node-returning adapter stale-cache risk; consistent with Unit 1 C + Unit 11 A.
  - **C:** Explicitly `add()` `promptInput`, `llmResponse`, `toolResultsNode`, and `_terminalResult` to the `AgentLoopGraph` with their existing `name` + `describeKind` + `meta` options. `toolCallsNode` is already accessible as `this.toolCalls` — verify it gets `add()`-ed via the property assignment or add explicitly.
- **JobQueueGraph — NOT applicable.** The parallel tool-call batch pattern (`switchMap + derived(calls.map(executeToolReactively))`) is the correct shape. No change to the tool-call lifecycle.
- **MessagingHubGraph for tool-call routing — NOT applicable at this level.** Hub excels at routing-as-data for static topics (harness queues, intake, retryTopic). For tool calls, the bottleneck is fan-in: `derived([perCall[0]...perCall[N]])` waits for exactly N dynamic results and emits the ordered batch — hub has no "collect exactly N items from dynamic topics" primitive. The `ToolRegistry` already does name-based dispatch (`tools.execute(call.name, args)` over a `ReactiveMapBundle<string, ToolDefinition>` per Unit 6), so tool-type routing is already data-driven. A hub layer would add topic-visible routing but duplicate `ToolRegistry`'s dispatch role without solving the fan-in problem.
- **`_currentAbortController`** — keep as a class field at the async boundary. Not a node. No change.
- **Implementation scope:** B + C are small targeted fixes (~10 LOC total). Land in the same implementation session as Unit 5 (agentLoop structural improvements) or as a standalone patch.

---

## Wave C — Adjacent surfaces

### Unit 23 — `refine-loop/index.ts` (1,108 LOC)

#### Q1 — Semantics, purpose, implementation

Reactive optimization loop: GENERATE → EVALUATE → ANALYZE → DECIDE. Extends `Graph` so `describe()`, `explain()`, `observe()`, `snapshot()`, `attachStorage()` all inherit. Two built-in strategies: `blindVariation` (random search) and `errorCritique` (ProTeGi-style critique-driven). 4 TopicGraphs expose each stage as a subscribable log. Factory returns `RefineLoopGraph<T> extends Graph`.

Files: `src/patterns/refine-loop/index.ts` (1,108 LOC), `src/__tests__/patterns/refine-loop.test.ts` (879 LOC).

#### Q2 — Semantically correct?

🟢 Clean. Specific observations:

- **`decideEffect` de-duplication** (line 637–640): `lastDecidedIteration` closure guards against re-firing when multiple deps settle in the same wave. Sound — effect subscribed once.
- **Convergence dual-path** (lines 601–614 vs. 632–672): derived convergence nodes for `describe()` visibility; inline cache reads in `decideEffect` for the actual gate. Avoids the feedback cycle that would arise if `decideEffect` declared `convergedNode` as a dep (it writes `historyState` which `patienceNode` / `minDeltaNode` read).
- **`resume()` cache read** (line 760): reads `statusState.cache` outside the reactive graph — safe; `resume()` is a user entry point, not a node fn.
- **C23-2 (low):** `errorCritique`'s `pickBest` uses optional `candidateIndex` on `EvalResult` for multi-candidate scoring; absent → scores against candidate 0. Worth a JSDoc note on `Evaluator<T>`.

#### Q3 — Design-invariant violations?

🟢 Clean against COMPOSITION-GUIDE + spec §5.8–5.12:

- **§7 Feedback cycles:** None — closure reads (`latestStrategy`, `latestFeedback`, `latestPrevCandidates`) avoid reactive cycles.
- **§28 Factory-time seed:** Lines 375–395 — canonical implementation.
- **§32 Nested-drain state-mirror:** Lines 711–731 — `lastFeedbackState.emit()` before `iterationTrigger.emit()` inside `batch()`.
- **§5.10:** `switchMap` wraps async `strategy.generate()` — sanctioned async boundary.
- **§5.8/5.9:** No polling, no imperative triggers outside node fns.

**Island finding:** Each effect publishes to its TopicGraph imperatively via closure-held `topic.publish()`. `explain(candidates, generate::latest)` cannot walk through `generateEffect` because the edge is invisible. Same pattern that drove the Wave B hub decision for harness intake/retry/verifyResults.

#### Q4 — Open items

- `refineExecutor` (Composition E) — roadmap §9.8, unblocked
- Persistent re-seed / reset surface — `docs/optimizations.md` (opened 2026-04-23)
- C23-2: JSDoc on `Evaluator<T>` re `candidateIndex` (new, low)

#### Q5 — Right abstraction?

🟢 Yes. Universal loop with pluggable strategy is the correct level. `RefineLoopGraph extends Graph` is the right inheritance shape.

#### Q6 — Long-term maintenance burden

🟡 Moderate. Three closure variables (`latestStrategy`, `latestFeedback`, `latestPrevCandidates`) + convergence dual-path require readers to understand §28 and §32. Both patterns are documented in COMPOSITION-GUIDE; consistent with `stratify`, `budgetGate`, `distill`, `verifiable`. Acceptable.

#### Q7 — Topology check + perf/memory

**Current shape (pre-hub):** All nodes registered via `g.add()`. No anonymous nodes. But 4 TopicGraphs are written to via imperative `topic.publish()` inside effects — invisible edges.

**Post-hub shape:** Every stage edge becomes a `topicBridge` → visible in `explain()`. `describe()` shows one hub cluster instead of 4 standalone mounts.

**Perf/memory:** O(1) framework overhead per iteration. History grows linearly — bounded by `maxIterations`. `switchMap` cancels in-flight async generation cleanly.

#### Q8 — Alternative implementations

| | A: Status quo (4 standalone TopicGraphs) | **B: Hub + derived event nodes + bridges** |
|---|---|---|
| `explain()` walks stage edges | ❌ — imperative publish invisible | ✅ — bridge edges reactive |
| Consistency with harness | ❌ — harness uses hub | ✅ |
| Complexity delta | Baseline | +1 hub, +4 derived, +4 bridges, −4 imperative publishes in effects |
| §32 batch ordering | Preserved (effects unchanged minus publish) | Preserved (derives compute event; effect keeps state-mirror only) |

#### Q9 — Recommendation and coverage

**Option B.** Conversion shape:

```ts
const hub = messagingHub("stages");

// Split: derived computes event (visible edge) + bridge carries to hub
const generateEvent = derived([candidatesNode, iterationTrigger], ([cands, iter]) => ({
  iteration: iter as number, candidates: cands as readonly T[], ...
}), { name: "generate-event" });
topicBridge("bridge/generate", generateEvent, hub.topic<GenerateEvent<T>>("generate"));

// Effect retains ONLY the state-mirror work (prevCandidatesState)
const generateEffect = effect([candidatesNode], ([cands]) => {
  prevCandidatesState.emit(cands as readonly T[]);
}, { name: "generate-mirror" });
```

Repeat for evaluate, analyze, decide. `decideEffect` keeps all state-mirror + convergence work; its event emission moves to a `decideEvent` derived node + bridge.

| Finding | Covered by Option B? |
|---|---|
| Invisible topic publish edges (Q3) | ✅ |
| §28 factory-time seed (Q3) | ✅ unchanged |
| §32 state-mirror batch ordering (Q3) | ✅ effects slimmed, ordering preserved |
| `explain()` stage walkability (Q7) | ✅ |
| Consistency with harness hub (Q8) | ✅ |
| C23-2 JSDoc (Q2) | S follow-up |

#### Decisions locked (2026-04-24)

**Option B — Hub + derived event nodes + bridges.**

Replace 4 standalone TopicGraphs with one `messagingHub("stages")`. Split each stage effect into:
1. A `derived` node that computes the stage event (reactive — visible edge in `explain()`).
2. A `topicBridge` from the derived → hub stage topic.
3. A slimmed effect retaining only state-mirror / convergence work (no `topic.publish()` calls).

`decideEffect` keeps all batch-ordered state-mirror writes (`bestState`, `scoreState`, `historyState`, `budgetState`, `lastFeedbackState`, `iterationTrigger`) — §32 ordering invariant is preserved because the state-mirror batch ordering lives in the effect, not in the event derived.

`RefineLoopGraph` accessor `generateTopic`, `evaluateTopic`, `analyzeTopic`, `decideTopic` → `hub.topic<GenerateEvent<T>>("generate")` etc. (breaking change — pre-1.0, no shim).

**Hub scope:** Wave B hub decision was `harnessLoop` only. `refineLoop` gets its own `messagingHub("stages")` — separate instance, separate graph, separate `describe()` cluster.

**Implementation scope:** M. Same session as Wave B hub work (harness `MessagingHubGraph`) if convenient, or separate session.

---

### Unit 24 — `graphspec/index.ts` + `surface/` + `graph-integration/`

#### Q1 — Semantics, purpose, implementation

Three related layers:

1. **`graphspec/index.ts`** (1,499 LOC) — GraphSpec validation, compilation (spec → Graph), decompilation (Graph → spec), diffing, `llmCompose`, `llmRefine`. Test: `src/__tests__/patterns/graphspec.test.ts` (619 LOC).
2. **`surface/`** (744 LOC, 5 files) — Thin projection for MCP/CLI: `createGraph`, `runReduction`, snapshot CRUD, `SurfaceError`. Test: `src/__tests__/patterns/surface.test.ts` (336 LOC).
3. **`graph-integration/`** — `graphFromSpec` (NL → Graph via LLM), `suggestStrategy` (Graph → StrategyPlan via LLM). Imperative async wrappers; identified as pending reactive migration in Wave A Unit 14.

#### Q2 — Semantically correct?

**graphspec:** 🟡 Three findings:

- **C24-1 (medium):** `compileSpec` silently creates no-op placeholders when catalog entries are missing (`producer(() => {})`, `derived(deps, vals => vals[0])`). Add `opts.strict` mode (or `opts.onMissing: "error" | "warn" | "placeholder"`, default `"placeholder"`) to surface missing entries as errors rather than silent identity substitutions.
- **C24-2 (low):** `decompileGraph` structural fingerprinting fallback (lines 989–1084) merges two templates with identical node/edge structure into one. JSDoc the limitation.
- **C24-3 (low):** `validateSpec` does not warn when feedback `from` refers to an effect-only node (no output). Add a warning (not error).

**surface:** 🟢 Clean.

- **C24-4 (low):** `runReduction` `shouldUnsub` deferred-unsubscribe pattern (reduce.ts lines 100–112, 163–166) is correct but subtle. Inline comment explaining sync-settle ordering invariant.
- **C24-5:** `.cache` read before `unsub()` in reduce.ts line 131 — correct, respects RAM-cache rule, tested.
- **C24-6:** `setTimeout` in reduce.ts line 190 — call-boundary timeout guard, §5.10 sanctioned.

**graph-integration:** 🟡 Two findings:

- **C24-8 (high — correctness):** `graphFromSpec` uses `Graph.fromSnapshot()` (line 113) to construct graphs from LLM output, bypassing catalog validation, template expansion, and feedback wiring. Should route through `compileSpec(parsedSpec, opts)` to get full validation for free. The `llmCompose` → `compileSpec` → `createGraph` pipeline in surface already does this correctly — `graphFromSpec` predates it.
- **C24-7 (medium):** Wave A Unit 14 committed to reactive migration for `graphFromSpec` and `suggestStrategy` (both call `adapter.invoke()` → `resolveToolHandlerResult()` → return). Ship `graphFromSpecReactive(input: NodeInput<string>, adapter) → Node<Graph>` and `suggestStrategyReactive(graph: Node<Graph>, problem: NodeInput<string>, adapter) → Node<StrategyPlan>` alongside imperative versions for harness composition.

#### Q3 — Design-invariant violations?

**graphspec:** 🟢 No violations. Compilation is pure imperative transformation; all protocol invariants live inside the sugar constructors (`state()`, `derived()`, `effect()`) called during compile.

**surface:** 🟢 No violations. `runReduction` subscribes before pushing (correct §2.2 ordering). Snapshot operations reuse `StorageTier` substrate (no new wire format).

**graph-integration:** 🟡 C24-8 is a correctness gap (validation bypass), not a protocol invariant violation.

**Hub eligibility:** None. `graphspec` and `surface` produce no reactive topology of their own. `graph-integration` is imperative async — when reactive alternatives ship (C24-7), they will be `switchMap` + `fromAny` single-output nodes, not fan-out routing. Hub model does not apply.

#### Q4 — Open items

- Treatment E catalog subsetting — roadmap §9.1.4
- `refineExecutor` — roadmap §9.8, unblocked by `refineLoop` hub conversion
- C24-1: `compileSpec` `opts.strict` (new, medium)
- C24-7: Reactive `graphFromSpec`/`suggestStrategy` alternatives (new, medium — Unit 14 commitment)
- C24-8: `graphFromSpec` → `compileSpec` (new, high — correctness)

#### Q5 — Right abstraction?

🟢 All three layers at correct abstraction levels. `graphspec` is the compile/decompile/compose pipeline. `surface` is the correct thin MCP/CLI projection. `graph-integration` is correctly positioned but `graphFromSpec` needs the C24-8 plumbing fix.

#### Q6 — Long-term maintenance burden

🟡 `graphspec/index.ts` at 1,499 LOC is approaching the split threshold. If Treatment E (catalog subsetting) or further compose features land, consider splitting into `compile.ts`, `decompile.ts`, `diff.ts`, `compose.ts`. Not urgent.

#### Q7 — Topology check + perf/memory

**graphspec `compileSpec`:** No anonymous nodes — all named per spec. Unresolved deps throw at line 703–706. O(N²) worst case for deferred resolution (acceptable for spec sizes <100 nodes). O(N) for meta-recovery decompile path.

**surface `runReduction`:** Graph created, used, destroyed in `finally`. No leaks. O(1) framework overhead.

**graph-integration:** Imperative — no graph topology of their own.

#### Q8 — Alternative implementations

| | C24-8A: Status quo (`Graph.fromSnapshot`) | **C24-8B: Route through `compileSpec`** |
|---|---|---|
| Catalog validation | ❌ Bypassed | ✅ Full |
| Template expansion | ❌ Bypassed | ✅ |
| Feedback wiring | ❌ Bypassed | ✅ |
| Migration cost | — | S (swap one call) |

| | C24-7A: Imperative only | **C24-7B: Add reactive alternatives** |
|---|---|---|
| Harness composition | ❌ Requires `await` at boundary | ✅ `switchMap` + `fromAny` |
| CLI/MCP use | ✅ | ✅ (imperative versions stay) |
| Unit 14 commitment | ❌ | ✅ |

#### Q9 — Recommendation and coverage

| Item | Q | Alt | Effort | Priority |
|---|---|---|---|---|
| C24-8: `graphFromSpec` → `compileSpec` | Q2, Q3 | B | S | **High** |
| C24-1: `compileSpec` `opts.strict` | Q2, Q5 | — | S | Medium |
| C24-7: Reactive `graphFromSpec`/`suggestStrategy` | Q3, Q5 | B | M | Medium |
| C24-2: JSDoc on fingerprinting limitation | Q2 | — | S | Low |
| C24-3: `validateSpec` effect-node feedback warning | Q2 | — | S | Low |
| C24-4: `runReduction` sync-settle comment | Q2 | — | S | Low |
| C23-2: JSDoc on `Evaluator<T>` `candidateIndex` | Q2 | — | S | Low |

#### Decisions locked (2026-04-24)

**C24-8: `graphFromSpec` → `compileSpec`.** Replace `Graph.fromSnapshot(parsed)` with `compileSpec(parsed as GraphSpec, opts)` in `graph-integration/graph-from-spec.ts`. Gains validation, template expansion, feedback wiring. S effort, high priority — correctness fix.

**C24-1: `compileSpec` `opts.strict` mode.** Add `opts.onMissing?: "error" | "warn" | "placeholder"` (default `"placeholder"` for backward compat). When `"error"`: throw `SurfaceError("catalog-error", ...)` listing all missing fn/source catalog entries. When `"warn"`: collect warnings in the returned validation result. Medium priority.

**C24-7: Reactive alternatives.** Ship `graphFromSpecReactive` and `suggestStrategyReactive` as `Node`-returning wrappers (unit 14 commitment). Imperative originals stay. Medium priority — schedule with Unit 14 implementation session.

**C24-2/3/4 + C23-2:** JSDoc and comment additions. Low priority — land as part of the implementation session for whichever unit touches the file.

**Hub model for Unit 24:** Does not apply. No fan-out routing topology. No hub conversion.

---

### Wave C cross-cutting: Hub eligibility audit (A+B+C)

Prompted by the refineLoop finding, all Wave A and B units were re-scanned for the TopicGraph-publish-in-effect pattern.

**Result: Hub model applies only to TopicGraph-publish-in-effects. Wave A and B hub scope is unchanged.**

| Category | Pattern | Hub applies? | Disposition |
|---|---|---|---|
| TopicGraph publish in effects | Effect → closure-held topic (routing/stage log) | ✅ | Wave B: harness (decided). Wave C: refineLoop (decided, Option B). |
| State-mirror writes (§32) | Effect → closure-held state, batch-ordered | ❌ | Wave A agentLoop: `add()` intermediate nodes for visibility; edges stay invisible (§32 sanctioned). Converting to derived→bridge would break batch ordering. |
| Async stream writes | Producer → stream topic inside async generator | ❌ | `streamingPromptNode`: sanctioned source-layer async boundary (§5.10). Single-topic, not routing. |
| Adapter call-boundary | Wrapper → counters/logs outside graph | ❌ | `observable.ts`, `budget-gate.ts`: outside the reactive graph entirely. |
| External system mutations | Effect → vector DB / KG / store | ❌ | Terminal side-effects — correct effect shape. |
| User-facing imperative API | Public method → state emit | ❌ | `ToolRegistry.register()`: intentionally imperative entry point. |
| `ctx.store` | Per-node persistent state | ❌ | §20 sanctioned. |

**No new hub candidates in Wave A or B.** All imperative-publish patterns outside `harnessLoop` and `refineLoop` are either sanctioned patterns, call-boundary instrumentation, or terminal side-effects — not topic routing.

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
- **2026-04-23:** Wave 0 shipped (commit `d161af1 feat: split ai`). `src/patterns/ai/` carved into `prompts/`, `agents/`, `memory/`, `extractors/`, `graph-integration/`, `safety/`, `adapters/` folders plus `_internal.ts`.
- **2026-04-23:** **Wave A review complete.** All 14 units reviewed per the 9-question format. Findings locked. Implementation scope estimated at 3–5 sessions. See "Wave A cross-cutting consolidation" section above for sequencing.
- **2026-04-23:** **Wave B.1 complete (Units 15–16).** INTAKE/TRIAGE/QUEUE stages reviewed. Key findings: `$`-prefix counter rename, `ExecuteOutput<A>` generic, `IntakeSource` widened to open union, `types.ts` + `defaults.ts` split, `stratify`-based reactive router (closes 4 queue-topic islands), `unrouted` exposed publicly. Decisions locked; implementation deferred to Wave A execution session.
- **2026-04-24:** **Wave B.2 complete (Units 17–18 + 18b).** GATE/EXECUTE/VERIFY/REFLECT + `gate()` primitive reviewed. Key findings: `gateGraph.mount` replaces double-registration, `GateController.lastRejected` added, 5 anonymous nodes registered in harness (closes explain gaps), reflect stage node added, `fastRetry` deep-dive (B+C+D+E): sub-function extraction + 3 correctness fixes (source/severity on reingestion, null-execRaw guard, errorClassifier outcome). Post-1.0: reactive retry/reingestion writes.
- **2026-04-24:** **Wave B.3 complete (Units 19–20).** Strategy model clean (JSDoc + rename). Bridge factories all hub-compatible without signature changes. **Key architectural decision:** upgrade Unit 16 B (stratify router) → Unit 20 C (hub + TopicBridgeGraph). Routing is data (topic name), not code. `HarnessGraph.queues` becomes `MessagingHubGraph` directly. JobFlow claim/ack/nack for EXECUTE in same implementation session.
- **2026-04-24:** **Wave B.4 complete (Units 21–22).** `refineExecutor` + `evalVerifier` clean topology (no islands). Named filter nodes for describe() clarity. Type-safe `harnessEvalPair<T>` factory. `trace.ts` + `profile.ts`: add REFLECT label, `stageNodes()` method for path decoupling, JSDoc snapshot caveat on `harnessProfile`.
- **2026-04-24:** **Wave B review complete.** All 8 units (15–22) reviewed. Decisions locked. Key architectural decisions: hub+TopicBridgeGraph canonical shape (supersedes stratify), `HarnessGraph.queues` → `MessagingHubGraph`, JobFlow claim/ack/nack for EXECUTE, `fastRetry` sub-function extraction + 3 correctness fixes, 5 anonymous nodes registered in harness, reflect stage node added. Wave C (adjacent surfaces) pending.
- **2026-04-24:** **Wave B cross-cutting consolidation complete.** Q1: unified hub scope — one `MessagingHubGraph` for all reactive-wire-crossing topics (intake + queues + retryTopic + verifyResults). Q2: agentLoop tool-call lifecycle — `JobQueueGraph` does NOT apply (parallel batch pattern is correct); B+C adopted (`fromAny` bridge + explicit `add()` for intermediate nodes). Wave C (adjacent surfaces) pending.
- **2026-04-24:** **Wave C review complete.** Units 23 (refineLoop) + 24 (graphspec/surface/graph-integration) reviewed. Key decisions: refineLoop Option B (hub + derived event nodes + publish effects), C24-8 `graphFromSpec` → `compileSpec` (HIGH correctness), C24-1 `opts.onMissing`, C24-7 reactive variants. Decisions locked.
- **2026-04-24:** **Partial implementation shipped** (unplanned — Unit 23 + C24-8 only). `src/patterns/refine-loop/index.ts`: 4 standalone TopicGraphs → `messagingHub("stages")`; generate/evaluate/analyze stages split into derived event node + publish effect (+ mirror effect for generate); decideEffect publish target updated to `hubDecideTopic`. `src/patterns/ai/graph-integration/graph-from-spec.ts`: `Graph.fromSnapshot` → `compileSpec`; system prompt updated to `GraphSpec` format (`initial` not `value`, `deps` in nodes, no `edges` array); `build` option removed, `catalog` option added. Tests updated; all 2081 pass. Remaining implementation items below.

**Remaining implementation (dedicated session):**
- **C24-1** (S, medium): add `opts.onMissing?: "error" | "warn" | "placeholder"` to `compileSpec` in `src/patterns/graphspec/index.ts` (default `"placeholder"`).
- **C24-7** (M, medium): add `graphFromSpecReactive(input: NodeInput<string>, adapter) → Node<Graph>` and `suggestStrategyReactive(graph: Node<Graph>, problem: NodeInput<string>, adapter) → Node<StrategyPlan>` in `src/patterns/ai/graph-integration/`.
- **JSDoc / comments** (S, low): C23-2 `Evaluator<T>` JSDoc re `candidateIndex`, C24-2 `decompileGraph` structural-fingerprinting caveat, C24-3 `validateSpec` effect-node feedback warning, C24-4 `runReduction` sync-settle comment.
