---
SESSION: DS-14.6-A-multi-agent-context-architecture
DATE: 2026-05-05
TOPIC: Multi-agent topology dual-track (static spawnable + dynamic actorPool), tagged context substrate with per-view rendering, heterogeneous debate as patterns preset, subgraph-level write-isolation reframe grounded in Rust port architecture. Triggered by external multi-agent landscape research (Anthropic / Cognition / Stanford MAD / Joel Leibo lineage); locked the GraphReFly position against the engineering-narrative consensus and parked the population-emergence research lineage. Generates DS-14.6.A (tagged context 9Q walk, deferred to dedicated session) and four implementation deltas landing in Phase 14.5.
REPO: graphrefly-ts (TS-primary; PY parity post-substrate)
SUPERSEDES: none
---

## CONTEXT

This session was triggered by user-supplied research on two Xiaohongshu posts about multi-agent design (JiachenYu's "single-agent often beats multi-agent at equal token budget" with the alphasignal 5-branch decision tree, and a long essay on Joel Leibo's 10-year multi-agent-as-social-systems research arc). The user remembered Anthropic's framing that **the primary purpose of agent decomposition is context isolation, not functional division** and wanted to revisit an earlier conversation that had gone stale now that main has progressed (Phase 13 closed 2026-05-01; DS-14.5.A locked 2026-05-04; Phase 14 changeset substrate locked 2026-05-05; Rust port architecture session 2026-05-02–05).

External research confirmed the user's recall is accurate and surfaced two additional signals: Cognition's April 2026 reversal from "Don't Build Multi-Agents" (June 2025) to "Multi-Agents: What's Actually Working" (writes single-threaded; multi-agent for intelligence not actions); and the Stanford "Stop Overvaluing Multi-Agent Debate" position paper (arXiv 2502.08788, Feb 2025) finding model heterogeneity is the universal antidote to homogeneous-debate test-time scaling.

The conversation produced two reframes (subgraph-level writes, per-view tagged context) and locked ten design decisions (L1–L10) covering the multi-agent + context architecture for Phase 14.5. The Joel Leibo / Concordia research lineage was explicitly parked — n≥1 agents are still the active engineering problem.

**Source materials:**
- 2026-05-05 conversation transcript (this session)
- Two Xiaohongshu posts user pasted (JiachenYu single-vs-multi + alphasignal decision tree; Joel Leibo essay)
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) (June 2025) and [Multi-Agents: What's Actually Working](https://cognition.ai/blog/multi-agents-working) (April 2026)
- [Stanford — Stop Overvaluing Multi-Agent Debate](https://arxiv.org/html/2502.08788v3) (Zhang/Cui/Chen et al., arXiv 2502.08788, Feb 2025)
- [Ashery/Aiello/Baronchelli — Emergent social conventions and collective bias in LLM populations](https://www.science.org/doi/10.1126/sciadv.adu9368) (Science Advances 11(20):eadu9368, May 2025)
- [Centola et al. — Experimental evidence for tipping points in social convention](https://www.science.org/doi/10.1126/science.aas8827) (Science 360:1116–1119, 2018)
- [`SESSION-multi-agent-gap-analysis.md`](SESSION-multi-agent-gap-analysis.md) — G1–G10 unit slate (Phase 13 source)
- [`SESSION-human-llm-intervention-primitives.md`](SESSION-human-llm-intervention-primitives.md) — hub + envelope substrate
- [`SESSION-DS-14.5-A-narrative-reframe.md`](SESSION-DS-14.5-A-narrative-reframe.md) — `meta.owner` + L0–L3 ownership staircase + spec-as-projection
- [`SESSION-DS-14-changesets-design.md`](SESSION-DS-14-changesets-design.md) — `mutate(act, opts)` + `BaseChange<T>`
- [`SESSION-rust-port-architecture.md`](SESSION-rust-port-architecture.md) — §10.17 Policy-as-data + Subgraph-as-enforcement-boundary; Part 8 threading wins; §10.16 versioning unified with mutate

---

## PART 1: REFRAME — TWO PILLARS

### Reframe A: Subgraph-level write isolation (not system-wide single-write)

Cognition's April 2026 *"writes stay single-threaded"* lock is the right principle but the wrong granularity. GraphReFly's existing substrate (DS-14.5.A `meta.owner` + Actor/Guard ABAC + L0–L3 staircase) already enforces it at the **subgraph boundary**, not at the system level. Multiple agents can write concurrently as long as they own different subgraphs.

The Rust port architecture session (`SESSION-rust-port-architecture.md` §10.17 + Part 8) confirms this is mechanically sound:

- **Per-subgraph `parking_lot::ReentrantMutex`** — `&mut Subgraph` acquisition checks policy; different subgraphs run in true parallel on different OS threads.
- **Hub topic is itself a subgraph** — concurrent publishes serialize on the hub's own lock; reads via cursor are wait-free against `imbl` persistent collection snapshots.
- **Policy is data (not closure)** — serializable, content-addressable, comparable; ownership claim IS a policy mutation; no separate guard plumbing.
- **Atomic version counter** (`AtomicU64::fetch_add`) — Phase 14 op-log version increments are single-CPU-instruction operations.

So the only honest concern remaining is **logical** conflict — two agents writing semantically incompatible context to a shared pool, even though the writes are mechanically serialized. Locked direction (L2 below): rely on tag schema + cursor ack to make logical conflicts explicitly visible (diff appears in pool; cursor sees two versions); do not add additional structural constraint pre-1.0.

### Reframe B: Per-view tagged context (not per-agent context window)

Anthropic's *"each subagent has its own context window"* is correct as engineering practice but treats context as opaque per-agent state. GraphReFly's reactive substrate (hub + reactive map + subscriptions with cursor) lets context itself become **tagged + reactive + addressable**. The win is making compression decisions deterministic data instead of asking the LLM to summarize itself:

- **Routing is mechanical** (pure tag comparison, zero LLM): `compressible: true` → goes to LLM compressor; `compressible: false` → truncate / reference / evict.
- **LLM only does actual semantic compression** — pre-filtered by tag schema. The waste in traditional summarization (LLM deciding what's important, what topic, whether to keep) is replaced by `importance: number` + `topic: string` + `compressible: boolean` tags.
- **Multiple compression tiers cached per (entry-id, target-tier)** — same entry rendered to tier-2 by two views shares the same cached LLM call.
- **Tier is per-view rendering, not per-entry state** — pool stores immutable tier-0 originals; each view materializes its own filtered + compressed slice. Same entry can appear at tier-0 in agent A's view (active task) and tier-2 in agent B's view (background reference) simultaneously.

---

## PART 2: L1–L10 DESIGN LOCKS (2026-05-05)

| # | Lock |
|---|---|
| **L1** | Joel Leibo / Concordia / population-emergence research lineage **dropped from scope**. n≥1 agents are still the active engineering problem; population-scale emergence (N≥100 with convention formation, ~25% Centola tipping per Ashery et al. 2025) is parked indefinitely. Do not bend Wave 2 narrative or substrate primitives toward this. Re-evaluate only if a research user / academic adoption signal explicitly asks. |
| **L2** | Write isolation = **subgraph-level**, not system-wide. Mechanical conflicts (race, torn read, lost update) are impossible by Rust core construction (per-subgraph mutex + atomic version + persistent collection snapshot). Domain-layer logical conflicts handled via **(a) no additional structural constraint** — tag schema + cursor ack make conflicts explicitly visible. Defer (b) `meta.shared: "ro" \| "rw" \| "claim-required"` and (c) hub-publish schema validation until empirical signal surfaces. |
| **L3** | Tagged context pool: `ContextEntry<T> = { payload: T; tags: Tag[]; importance: number; compressible: boolean; topic: string }` — **no `tier` field on the entry**. Pool stores immutable tier-0 originals + tag index; pool itself is a `MessagingHubGraph` topic with retention. |
| **L4** | **Per-view rendering** (option (b) over option (a) global pressure). Each agent / topic / consumer holds its own `ContextView = { filter; pressure: Node<number>; budgetTokens: number; rules: CompressionRule[] }`. View materializes a `Node<RenderedEntry[]>` reactive product. Tier is rendering target, not entry state. |
| **L5** | LLM in tagged context: routing rules are **pure data**; LLM only fires for `action: "llm-summary"` (or similar `llm-*` rule). No-LLM strategies: `truncate`, `evict`, `reference` (replace with id/hash). Cache key: `(entry-id, target-tier)` shared across all views asking for the same tier of the same entry. |
| **L6** | Eviction: **view-local default** (rule with `action: "evict"` makes the view skip the entry); **pool-global GC explicit** via separate `poolGC({ olderThanNs?, importanceBelow?, ... })` policy. Two independent mechanisms — view filtering vs pool retention. |
| **L7** | Multi-agent topology = **dual-track**: <br>**(a) Static `spawnable()`** (Phase 13 shipped): agent IS subgraph; topology reflects agent set; `describe()` visible; suitable when agent identities are pre-known / catalogued. <br>**(b) Dynamic `actorPool()`** (new patterns preset, Phase 14.5): agent is **actor identity + cursor + tool closure**, NOT a subgraph; topology only reflects pool / todo-list / hub collections; agent count drifts at runtime; suitable for "every agent may decide to spawn N more helpers" recursive-fanout scenarios. |
| **L8** | `actorPool()` and `spawnable()` share **the same design session** (this one, plus a follow-up implementation-design walk). May co-locate in the same file (`patterns/harness/presets.ts` likely) or split — implementation-time decision. The shared session ensures the spawnable-vs-actorPool selection guidance lands as one coherent COMPOSITION-GUIDE-PATTERNS section. |
| **L9** | **Heterogeneous debate as patterns preset** (`patterns/ai/debate/`), not a recipe. Closed reasoning loop — no tool execution, no side effects, no persistent state beyond transcript — so state space is an order of magnitude smaller than open task loops (harness / agent). Stanford MAD finding (Zhang et al., model heterogeneity = universal antidote) is the design thesis: participants get different model adapters + different role prompts. Termination: `fixedRounds \| until-converge \| { until: Node<boolean> }`. Pure composition over `agent()` + `topic` + `derived` — no new substrate primitive. |
| **L10** | Tagged context substrate placement: **patterns / extras layer, not core**. Schema (`ContextEntry`, `ContextView`, `CompressionRule`) is data, not closure (cf. Rust port §10.17 Policy-as-data). Open **DS-14.6.A 9Q walk** as a dedicated follow-up session before implementation; this session locks the shape but defers the 9Q. DS-14.6.A lands in **Phase 14.5**. |

---

## PART 3: SHAPE SKETCHES (NON-NORMATIVE)

The following sketches are illustrative; DS-14.6.A's 9Q walk will refine signatures, edge cases, and exact slot placement.

### Tagged context substrate

```ts
// Pure data — no closures. Serializable, CID-able.
type ContextEntry<T> = {
  payload: T;
  tags: readonly Tag[];
  importance: number;       // 0..1
  compressible: boolean;
  topic: string;
};

type CompressionRule =
  | { match: RuleMatch; action: "evict" }
  | { match: RuleMatch; action: "truncate"; maxChars: number }
  | { match: RuleMatch; action: "reference" }                       // replace with id/hash
  | { match: RuleMatch; action: "llm-summary"; toTier: 1 | 2 | 3 }; // only this crosses to LLM

type RuleMatch = {
  topic?: string | RegExp;
  tagsAny?: readonly Tag[];
  importanceMin?: number;
  importanceMax?: number;
  compressible?: boolean;
};

// Pool: immutable tier-0 store (a hub topic with retention)
function taggedContextPool<T>(parent: Graph, opts: {
  topic: string;
  retention?: RetentionPolicy;
  llmCompressor?: NodeInput<LLMAdapter>;  // optional; required only if any rule uses "llm-summary"
}): TaggedContextPoolBundle<T>;

// View: per-consumer reactive rendering
function renderContextView<T>(
  pool: TaggedContextPoolBundle<T>,
  view: {
    filter: (e: ContextEntry<T>) => boolean;
    pressure: Node<number>;        // 0..1; rule fires when pressure > rule.threshold
    budgetTokens: number;
    rules: readonly CompressionRule[];
    tokenizer?: (s: string) => number;
  },
): Node<readonly RenderedEntry<T>[]>;
```

### actorPool() preset

```ts
function actorPool<TTool extends ToolDefinition>(parent: Graph, opts: {
  contextPool: TaggedContextPoolBundle<unknown>;
  todoTopic: TopicGraph<Todo>;
  toolRegistry: ToolRegistryGraph<TTool>;
  spawnNewActor: (req: SpawnRequest) => ActorId;        // factory
  defaultViewRules?: readonly CompressionRule[];
  budget?: NodeInput<readonly BudgetConstraint[]>;
  depthCap?: number;
}): {
  attachActor(spec: ActorSpec): ActorHandle;
  contextTopic: TopicGraph<ContextEntry<unknown>>;
  todos: TopicGraph<Todo>;
  active: Node<ReadonlyMap<ActorId, ActorState>>;       // currently running actors
  graph: ActorPoolGraph;                                 // class extends Graph
};

type ActorHandle = {
  id: ActorId;
  context: Node<readonly RenderedEntry<unknown>[]>;     // this actor's compressed view
  cursor: SubscriptionGraph<Todo>;                      // pulls assigned todos
  publish: (entry: ContextEntry<unknown>) => void;      // writes back to pool with actor stamp
  enqueueTodo: (t: Todo) => void;                       // adds to shared todo list
  status: Node<"idle" | "running" | "blocked" | "done">;
  release: () => void;
};
```

### heterogeneousDebate() preset

```ts
function heterogeneousDebate(parent: Graph, opts: {
  question: NodeInput<string>;
  participants: readonly {
    adapter: NodeInput<LLMAdapter>;
    role: string;                              // "advocate" | "skeptic" | "synthesizer" | custom
    systemPrompt: string;
  }[];
  rounds: number | "until-converge" | { until: Node<boolean> };
  output: "transcript" | "synthesizer-final" | { project: (transcript: Turn[]) => unknown };
  budget?: NodeInput<readonly BudgetConstraint[]>;
}): {
  transcript: Node<readonly Turn[]>;
  result: Node<unknown>;
  status: Node<"running" | "converged" | "max-rounds" | "error">;
  graph: DebateGraph;                          // class extends Graph
};
```

---

## PART 4: IMPLEMENTATION DELTAS

| # | Work | Size | Phase | Dep |
|---|---|---|---|---|
| 1 | DS-14.6.A — tagged context substrate 9Q walk (dedicated follow-up session) | S design | 14.5 | None (this doc captures the shape; 9Q refines) |
| 2 | `taggedContextPool` + `renderContextView` + `tierCompress` operator family | M | 14.5 | (1) |
| 3 | `actorPool()` patterns preset + spawnable-vs-actorPool selection guidance in COMPOSITION-GUIDE-PATTERNS | M | 14.5 | (2) |
| 4 | Multi-writer worked example test (concurrent subgraphs + per-view tagged context + cross-view cache hit) | S | 14.5 | (2), (3) |
| 5 | `heterogeneousDebate()` preset in `patterns/ai/debate/` + Stanford MAD heterogeneity citation in JSDoc | M | 14.5 | None |
| 6 | Wave 2 launch copy upgrade — "Anthropic + Cognition reconciled" framing (subgraph-level isolation + per-view compressed context) | S | 16 §9.x | (2), (3), (4), (5) |

**Sequencing note:** (1) → (2) → (3,4,5) parallel → (6). DS-14.6.A 9Q walk must precede (2) implementation; (3) and (5) can run in parallel once (2) lands.

---

## PART 5: COMPETITIVE FRAMING (POST-LOCK)

| Project | Approach | Where GraphReFly differs (post-L1–L10) |
|---|---|---|
| **Anthropic Claude (orchestrator-subagent)** | Subagents have separate context windows; context isolation is the explicit headline | GraphReFly makes the boundary structural (subgraph mount; describe-visible) AND addressable (per-view tagged context replaces opaque per-agent windows) |
| **Cognition / Devin (April 2026 stance)** | Writes single-threaded; multi-agent for intelligence not actions | GraphReFly enforces single-threaded writes **per subgraph** (more granular); concurrent agents on different subgraphs are first-class via `meta.owner` + Actor/Guard |
| **Stanford MAD critique** | Same-model debate is test-time-scaling-as-debate; heterogeneity is the universal antidote | `heterogeneousDebate()` preset bakes the antidote in; participants are different model adapters + role prompts. Does NOT ship same-model MAD as a primitive. |
| **LangGraph** | Imperative supervisor returns next-agent-name; topology reflects either agent set OR dynamic routing, not both | `spawnable()` (static) for catalogued agent sets; `actorPool()` (dynamic) for runtime-fanout — neither requires imperative supervisor. `describe()` shows pool/todo/hub structure; agents drift inside |
| **Joel Leibo / Concordia** | Multi-agent-as-social-systems research methodology | **Out of scope per L1.** GraphReFly does not engage population-emergence; n≥1 engineering remains the focus. |

**Headline competitive claim** (for Wave 2 copy, gated on (2)+(3)+(4)+(5) landing): *"Anthropic says agents need isolated context; Cognition says writes must be single-threaded; Stanford says debate without model heterogeneity is wasted compute. GraphReFly enforces all three structurally — subgraph-level write isolation (concurrent agents per subgraph), per-view tagged context (mechanical compression routing, LLM only for actual semantic work), and heterogeneous-only debate as a first-class preset."*

---

## PART 6: DISCUSSION RESOLUTION TRAIL

The conversation walked through several open questions; the resolutions are captured here for future reference (so the lock list above can stay terse).

| Question (asked-during-session) | Resolution |
|---|---|
| Wave 2 launch copy: lead with reversal-reconciliation pitch or hold defensive? | Lead, but only after (2)+(3)+(4)+(5) ship — copy needs substrate backing. Captured as delta #6. |
| Tagged context: primitive or recipe? | Primitive (data schema) but lives in patterns/extras layer, not core. Per L10 + Rust port §10.17 alignment (data-not-closure). |
| Pressure: global or per-view? | Per-view (L4). Eliminates the entry-level `tier` field; tier becomes rendering target; cache shares across views by `(entry-id, target-tier)`. |
| Eviction: view-local or pool-global? | Both, distinct mechanisms (L6). View-local is a rule action; pool-global is a separate retention policy. |
| Subgraph-level vs system-wide write isolation: stronger constraint warranted? | No (L2 option (a)). Rust core mechanical guarantees + tag schema + cursor ack make logical conflicts explicitly visible without preemptive structural constraint. Re-visit if empirical signal surfaces. |
| Heterogeneous debate: recipe or preset? | Preset (L9). Closed reasoning loop is simpler than open task loop; warrants a named factory with termination semantics. |
| Population-emergence (Leibo lineage): pursue or park? | Park indefinitely (L1). n≥1 engineering still active. |
| `actorPool` vs `spawnable`: same session, same file? | Same session (this doc); file co-location is implementation-time call (L8). |
| DS-14.6.A landing phase? | Phase 14.5 (L10). |

---

## PART 7: CROSS-REFS

- **Triggering conversation:** 2026-05-05 session (this file).
- **Phase 14.5 home:** [`docs/implementation-plan.md`](../../docs/implementation-plan.md) §14.5 (existing residuals section; deltas #1–#5 from PART 4 land as new sub-sections).
- **Multi-agent gap analysis (G1–G10):** [`SESSION-multi-agent-gap-analysis.md`](SESSION-multi-agent-gap-analysis.md) — `spawnable()` shipped per Phase 13 closes G3+G4; `actorPool()` is the dynamic-fanout complement that the original gap-analysis didn't envision.
- **Hub + envelope substrate:** [`SESSION-human-llm-intervention-primitives.md`](SESSION-human-llm-intervention-primitives.md) — `Message<T>` envelope + standard topic constants (`SPAWNS_TOPIC` / `PROMPTS_TOPIC` / etc.) carry over; `actorPool` adds context-pool + todo-list as topic conventions.
- **Ownership protocol:** [`SESSION-DS-14.5-A-narrative-reframe.md`](SESSION-DS-14.5-A-narrative-reframe.md) L5–L8 — `meta.owner` + L0–L3 staircase + `validateOwnership` PR lint. This session's L2 (subgraph-level write isolation) builds directly on it.
- **Changeset substrate:** [`SESSION-DS-14-changesets-design.md`](SESSION-DS-14-changesets-design.md) — `mutate(act, opts)` + `BaseChange<T>`; tagged context pool's mutations ride the same changeset machinery.
- **Rust port architecture:** [`SESSION-rust-port-architecture.md`](SESSION-rust-port-architecture.md) §10.17 (Policy-as-data + Subgraph-as-enforcement-boundary) and Part 8 (per-subgraph mutex + AtomicU64 version + wait-free cursor reads) — provide the mechanical guarantee that justifies L2's "no additional structural constraint" lean.
- **External (research validation):**
  - [Anthropic — Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
  - [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) / [Multi-Agents Working](https://cognition.ai/blog/multi-agents-working)
  - [Stop Overvaluing Multi-Agent Debate (arXiv 2502.08788)](https://arxiv.org/html/2502.08788v3)
  - [Ashery/Aiello/Baronchelli — Emergent social conventions in LLM populations (Science Advances 2025)](https://www.science.org/doi/10.1126/sciadv.adu9368)
  - [Centola — Tipping points in social convention (Science 2018)](https://www.science.org/doi/10.1126/science.aas8827)
- **Memory references:** `project_universal_reduction_layer.md`, `project_harness_engineering_strategy.md`, `project_harness_closed_loop_gap.md`.

---

## STATUS

- L1–L10 locked 2026-05-05.
- DS-14.6.A 9Q walk awaiting `/dev-dispatch` invocation per `feedback_no_implement_without_approval`.
- Implementation deltas #1–#6 awaiting explicit user start signal.
- This session-doc PR carries documentation only; no substrate code touched.
