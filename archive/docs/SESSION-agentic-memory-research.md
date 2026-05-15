---
SESSION: agentic-memory-research
DATE: March 31, 2026
TOPIC: Agentic Memory SOTA Research Synthesis + Default Strategy Design for agentMemory()
ORIGIN: Adapted from callbag-recharge research (~/src/callbag-recharge/src/archive/docs/SESSION-agentic-memory-research.md, March 17–26 2026) and user-provided notes on advanced memory write mechanisms (March 31 2026)
---

> **2026-05-13 update — superseded for substrate design by [SESSION-DS-14.7-reactive-fact-store.md](SESSION-DS-14.7-reactive-fact-store.md) (LOCKED).** Triggered by Hassabis YC × DeepMind Startup School talk (2026-04-29, continual learning + REM-replay framing) + MEME paper ([arXiv:2605.12477](https://arxiv.org/abs/2605.12477), Cascade L2 = 3% / Absence L3 = 1% on default config across 6 systems). DS-14.7 formalizes the static-topology `reactiveFactStore<T>()` pattern that supplies the MEME L2/L3 + continual-learning substrate, superseding Part 6 "Second Half" §"opportunity #1" (outcome-feedback gap). The SOTA landscape + four advanced write strategies below remain the canonical research record.

## KEY DISCUSSION

### Goal

Synthesize SOTA agentic memory research, AI tool full-chain analysis, and advanced memory write strategies into a concrete default strategy for `agentMemory()` (Phase 4.4). All primitives are already shipped — this session designs the composition layer.

---

## PART 1: SOTA LANDSCAPE (Summary from Predecessor Research)

### Leading Architectures (March 2026)

| System | Key Innovation | Memory Model |
|--------|---------------|--------------|
| **Letta (MemGPT)** | Self-editing memory via tool calls | Core (in-context) + Recall (conversational) + Archival (long-term) |
| **Mem0 / Mem0g** | Hybrid vector + incremental graph | Two-phase extraction pipeline; 91% p95 latency reduction vs full-history |
| **Zep/Graphiti** | Temporal knowledge graphs | Neo4j-backed; tracks fact evolution over time |
| **Cognee** | Dual-index (every graph node has embedding) | Knowledge graph + vector store duality |
| **MemOS** | Memory as first-class OS resource | MemCube abstraction; activation/working/archival tiers |
| **MAGMA** | Four parallel graphs per memory item | Semantic + temporal + causal + entity; intent-adaptive retrieval |
| **A-Mem** | Zettelkasten-style atomic notes | Agent-driven linking; memory evolution triggers historical updates |
| **OpenViking** | Filesystem-shaped context DB | L0/L1/L2 progressive loading; hierarchical retrieval |

### Memory Types (CoALA Taxonomy)

- **Working Memory:** Active scratchpad (context window). Every framework: conversation buffer + system prompt.
- **Episodic Memory:** Records of specific experiences. Generative Agents scoring, A-Mem atomic notes.
- **Semantic Memory:** Factual knowledge, entity relationships. Knowledge graphs, vector stores.
- **Procedural Memory:** Learned workflows, tool usage patterns. AGENTS.md files, skill learning.

### Critical Gap: No Reactive Memory

**No existing agent memory system uses reactive/push-based state management.** All are pull-based (query → retrieve → return). GraphReFly's push-based dirty tracking + incremental computation is a genuinely novel contribution.

### Performance: In-Process Beats Redis

| Access Pattern | Latency | vs Redis localhost |
|---|---|---|
| In-process `state.get()` | ~10 ns | **10,000x faster** |
| Signal propagation | ~10-100 ns | **1,000x faster** |
| In-process HNSW vector search | ~1-10 μs | **10-100x faster** |
| Redis localhost (TCP) | ~50-500 μs | baseline |

---

## PART 2: ADVANCED MEMORY WRITE STRATEGIES

Source: user-provided notes on advanced agent memory write mechanisms (March 31, 2026).

### Strategy 1: Three-Dimensional Filtering Funnel (三维筛选漏斗)

Filter incoming information across three dimensions before writing to memory:

1. **Persistence** — Is this ephemeral (current turn only) or durable (cross-session)?
2. **Structure** — Is this raw text or structured (entities, relations, facts)?
3. **Personalization value** — Is this generic knowledge (skip) or user/context-specific (keep)?

**GraphReFly mapping:** This is the `extractFn` logic in `distill()`. The three dimensions become scoring criteria in the extraction function. For `llmExtractor`, encode them in the system prompt. For rule-based extractors, encode as filter predicates.

**Default strategy:** `agentMemory()` ships a default `admissionFilter` that scores on all three dimensions:
```
admit = persistence >= "session" AND (structured OR personalValue > threshold)
```

### Strategy 2: GraphRAG Architecture (Mixed Graph + Vector)

Hybrid storage: entity-relationships in a graph database, combined with vector retrieval to reduce hallucination and logic loss.

**GraphReFly mapping:** Already shipped as separate primitives:
- `knowledgeGraph()` (Phase 4.3) — entity + relation storage with adjacency queries
- `vectorIndex()` (Phase 4.3) — HNSW similarity search
- `reactiveMap` (Phase 3.2) — KV with TTL/LRU

**Default strategy:** `agentMemory()` composes all three:
- Entities extracted by `llmExtractor` → `knowledgeGraph` (structured relations)
- Entity embeddings → `vectorIndex` (semantic search)
- Raw memories → `reactiveMap` via `distill()` (budget-constrained compact view)
- Retrieval: vector search → expand via graph adjacency → rank by `decay()` score

### Strategy 3: Dynamic Reflection Mechanism (动态反思机制)

Agent periodically summarizes and reflects on memories, distilling scattered information into higher-dimensional insights.

**GraphReFly mapping:** Exactly `distill()` `consolidateFn` + `consolidateTrigger`:
- `consolidateTrigger` fires on timer or size threshold
- `consolidateFn` receives all entries, returns merged/summarized memories
- `llmConsolidator` (Phase 4.4) wraps an LLM for the reflection step

**Default strategy:** `agentMemory()` ships with:
- **Local consolidation** on every extraction (dedup + merge similar)
- **Periodic reflection** via `consolidateTrigger: fromTimer(intervalMs)` — LLM clusters related memories, produces higher-level insights
- **Reflection depth tracking** via `meta.consolidation_count` — memories that survive multiple consolidations are likely important

### Strategy 4: Hot/Cold Tiered Storage with Forgetting (冷热分级存储)

Core profile permanently stored; secondary logs have forgetting mechanisms to balance cost and experience.

**GraphReFly mapping:** All primitives exist:
- **Hot tier:** `reactiveMap` with short TTL + LRU, accessed via `distill()` compact view
- **Cold tier:** `checkpoint` adapter (SQLite/file) via `autoCheckpoint`
- **Decay:** `decay(baseScore, ageSeconds, ratePerSecond, minScore)` — exponential forgetting
- **Permanent tier:** Entries with `permanent: true` flag bypass eviction

**Default strategy:** `agentMemory()` ships three tiers:
1. **Core profile** (`permanent: true`) — user identity, preferences, long-term goals. Never evicted.
2. **Active memories** — recent interactions, current context. `decay()` with 7-day half-life (OpenViking formula: `sigmoid(log1p(access_count)) * exp_decay(age, 7d)`).
3. **Archived** — low-score memories persisted to checkpoint adapter, evicted from in-memory store. Retrievable on-demand via vector search against cold store.

---

## PART 3: DEFAULT agentMemory() STRATEGY

### Composition

```
agentMemory(name, opts?) → Graph
├── distill(source, llmExtractor, {
│     score: decayScore,
│     cost: tokenCost,
│     budget: opts.budget ?? 2000,
│     context: opts.context,
│     evict: tierBasedEviction,
│     consolidate: llmConsolidator,
│     consolidateTrigger: fromTimer(opts.consolidateInterval ?? 300_000),
│   })
├── knowledgeGraph(name + "::entities")  — entity-relation store
├── vectorIndex({ dimensions, backend })  — semantic retrieval
├── collection(name + "::profiles", { permanent: true })  — core profile tier
└── autoCheckpoint(adapter)  — cold tier persistence
```

### Retrieval Pipeline (Default)

1. **Admit** — 3D filter (persistence × structure × personal value)
2. **Extract** — `llmExtractor` or rule-based → entities to `knowledgeGraph`, embeddings to `vectorIndex`, memories to `distill`
3. **Retrieve** — vector search → graph expansion → `decay()` ranking → budget packing
4. **Reflect** — periodic `llmConsolidator` merges scattered facts into insights
5. **Forget** — `decay()` drops below threshold → evict from hot tier → archive to cold tier or delete

### What's Pluggable (Advanced Users)

| Component | Default | Override |
|---|---|---|
| `extractFn` | `llmExtractor(systemPrompt)` | Any `(raw, existing) => Extraction` |
| `consolidateFn` | `llmConsolidator(systemPrompt)` | Any `(entries) => Extraction` |
| `score` | `decay()` + OpenViking formula | Any `(mem, context) => number` |
| `cost` | Token count estimate | Any `(mem) => number` |
| `admissionFilter` | 3D funnel | Any `(candidate) => boolean` |
| `retrievalStrategy` | Vector → graph expand → rank | Any custom pipeline |
| `tiers` | 3-tier (permanent/active/archived) | Custom tier config |

### What's NOT Pluggable (Invariants)

- Reactive propagation — memory changes push downstream (context views auto-invalidate)
- Budget constraint — compact view always respects token budget
- Observability — `describe()`, `observe()`, `spy()` always work on the memory graph
- In-process — no external service dependency in default path

---

## PART 4: PAIN POINTS THIS SOLVES

(From predecessor research — translated to GraphReFly terms)

1. **Context assembly is O(n) every turn** → `derived()` caches assembled context; O(1) for unchanged deps
2. **No diamond-safe coordination** → Two-phase push (DIRTY → DATA) ensures memory retrieval + context update + token counting + persistence fire exactly once, in order
3. **No cancellation composition** → `switchMap` in `distill()` auto-cancels stale extractions when new input arrives
4. **No observability into state graph** → `describe()` + `observe({ causal: true })` answers "why did this memory surface?"
5. **Memory is passive, not reactive** → Preference change → `derived()` context invalidates → downstream LLM call re-triggers

---

## PART 5: WHAT WE DO THAT OTHERS CANNOT

1. **Reactive/push-based memory.** All others are pull-only. Memory score changes push downstream — cached context views auto-invalidate.
2. **In-process, zero-serialization.** `state.get()` ~10ns vs Mem0/OpenViking HTTP/IPC ~50-500μs.
3. **Diamond-safe multi-memory updates.** Two-phase DIRTY→DATA guarantees consistent derived views.
4. **Transport agnosticism.** Same memory graph works with SSE, WebSocket, terminal, MCP.
5. **First-class observability.** "Why did this memory surface?" is answerable via `observe({ causal: true })`.

---

## KEY INSIGHTS

1. The four advanced strategies (3D funnel, GraphRAG, reflection, hot/cold tiers) map cleanly onto existing GraphReFly primitives. No new core concepts needed.
2. `agentMemory()` is a composition layer, not a new primitive — it wires `distill()` + `knowledgeGraph()` + `vectorIndex()` + `collection()` + `decay()` + `autoCheckpoint()`.
3. The default strategy should be opinionated (ship the OpenViking decay formula, 3-tier storage, periodic reflection) but every component is overridable.
4. LLM extraction/consolidation lives in `llmExtractor`/`llmConsolidator` (userland adapters), never inside core primitives.
5. OpenViking's L0/L1/L2 progressive loading maps to `derived()` chains — leaf summaries aggregate into parent summaries. Worth considering as a retrieval optimization in `agentMemory()`.

---

## PART 6: LEARNED MEMORY — THE "SECOND HALF" PARADIGM SHIFT (April 2026)

Source: Xiaohongshu discussion thread + two key papers (user-provided, April 30 2026).

### Context: The "Second Half" Thesis

The field is shifting from *handcrafted memory heuristics* to *learned memory policies*. The core claim: **memory should not be designed by engineers — it should be trained end-to-end with the agent so the agent learns how to do memory better.**

Two papers crystallize this:

### Paper 1: "Rethinking Memory Mechanisms of Foundation Agents in the Second Half: A Survey"

**Authors:** Wei-Chieh Huang et al. (60 authors, Salesforce AI Research, UIUC, UCLA, etc.)
**arXiv:** 2602.06052 (Jan 2026, v3 Feb 2026)
**Scope:** 218 papers surveyed across 2023Q1–2025Q4

**Three-dimensional taxonomy:**

| Dimension | Categories |
|---|---|
| **Memory substrate** | Internal (in-weights) vs External (retrieval stores) |
| **Cognitive mechanism** | Episodic, Semantic, Sensory, Working, Procedural |
| **Memory subject** | Agent-centric vs User-centric |

**Critical section — §5 "Memory Learning Policy" — three paradigms:**

1. **Prompt-based** (static rules or dynamic reflection): Memory operations encoded as natural language instructions. Includes static schemas (MemGPT, A-Mem, Zep) and dynamic self-correction (Reflexion, WebCoach). Interpretable but lacks credit assignment — cannot optimize long-term memory quality.

2. **Fine-tuning** (parameterized policies): Memory policies baked into model weights via SFT. Approaches include internalizing memory content itself (MEMORYLLM), learning retrieval interfaces (Memory3), and hierarchical organization (separating long-tail from core knowledge). More stable but frozen after training.

3. **Reinforcement learning** (the frontier): Memory operations become learnable actions optimized by task reward. Three scopes:
   - **Step-level:** Atomic memory ops (add/update/delete/skip) as RL actions. Memory-R1 defines explicit memory action spaces; MemAgent learns what to write under capacity constraints; Mem-α frames memory construction itself as sequential decision-making.
   - **Trajectory-level:** Compact memory representations learned via delayed reward. Summarization/compression as policy decisions evaluated through future outcomes. InftyThink+ and IterResearch treat memory state as part of the Markov state.
   - **Cross-episode:** Experience distilled into transferable decision knowledge across episodes. Graph-based experience abstraction, reflective retrieval policies (Retroformer, Memento), shared multi-agent memory (MAICC).

**Key quote from the survey:** *"Only long-term and cross-episode reward signals can determine which memories should persist, adapt, or be revised by the memory policy."*

### Paper 2: "InftyThink+: Effective and Efficient Infinite-Horizon Reasoning via Reinforcement Learning"

**Authors:** Yuchen Yan et al. (Zhejiang University, ZJU-REAL lab)
**arXiv:** 2602.06960 (Feb 2026)
**Code:** github.com/ZJU-REAL/InftyThink-Plus

**Core idea:** Agent produces periodic *summaries* during reasoning as a form of working memory. The agent learns **when** to summarize, **what** to preserve, and **how** to resume reasoning — all via end-to-end RL, not fixed heuristics.

**Architecture:**
```
Reason (segment) → Summarize (compress) → Continue (from summary) → ... (iterate)
```

**Training:** Two-stage — SFT cold-start teaches the summarization pattern, then trajectory-level RL optimizes the full iterative reasoning trajectory.

**Results:** +21% accuracy on AIME24 vs baseline, reduced inference latency, better OOD generalization. The model evolves three capabilities:
1. **When to summarize** — strategic timing, not fixed intervals
2. **How to summarize** — learned compression, not template extraction
3. **How to continue from summary** — Markov chain-style reasoning where each step only sees the summary, not the full history

**Connection to xiaohongshu comment:** The commenter noted this aligns with the survey's thesis — memory operations should emerge from training, not be handcrafted. InftyThink+ is a concrete proof: RL-trained summarization outperforms fixed-heuristic summarization.

### What This Means for GraphReFly's agentMemory()

**Current design (Parts 1-5 above):** Our `agentMemory()` is a *handcrafted composition* — we ship fixed strategies (3D funnel, decay formula, periodic consolidation) with pluggable overrides. This is squarely in the survey's **Paradigm 1 (prompt/rule-based)** — powerful, interpretable, but not learning from outcomes.

**The gap:** We don't have a feedback loop where memory quality feeds back into memory policy. Our `consolidateFn`, `admissionFilter`, and `score` are static or prompt-tuned — they don't improve as the agent uses them.

**Opportunities (ordered by feasibility):**

1. **Reactive reward signal (low-hanging fruit, fits existing architecture):**
   - Add an `outcome` source node to `agentMemory()` that receives task success/failure signals
   - Wire `outcome` → `derived()` that adjusts `decay()` parameters or `admissionFilter` thresholds
   - This is still rule-based but uses reactive propagation to make rules adaptive
   - **GraphReFly advantage:** push-based propagation means policy adjustments propagate instantly to all downstream views — no polling

2. **Memory-as-action-space (medium, requires promptNode integration):**
   - Model memory operations (admit/evict/consolidate/skip) as explicit actions in a `promptNode` harness loop
   - The harness VERIFY stage evaluates memory quality via downstream task performance
   - REFLECT stage updates memory strategy
   - Maps to Memory-R1 / Mem-α pattern but using our reactive harness instead of external RL framework
   - **GraphReFly advantage:** harness loop already has EXECUTE→VERIFY→REFLECT; memory ops fit naturally as actions

3. **Learned summarization (aspirational, requires model training):**
   - InftyThink+ shows that RL-trained summarization beats fixed heuristics
   - Our `llmConsolidator` could be replaced by a fine-tuned model that learned consolidation through trajectory-level RL
   - We don't train models, but we can provide the **training harness** — reactive graph that logs (memory state, action, outcome) trajectories for external RL training
   - **GraphReFly advantage:** `observe()` + `spy()` already capture full causal traces — ideal training data for memory RL

4. **Cross-episode memory evolution (long-term):**
   - The survey's §5.3.3 describes memory policies that improve across episodes
   - Our `autoCheckpoint` + `knowledgeGraph` already persist cross-session
   - Missing piece: a cross-session reward signal that tells the memory system "this remembered fact was useful 3 sessions later"
   - Could instrument via `observe()` on retrieval hits correlated with task success

### Key Takeaway

**The handcrafted vs learned memory debate mirrors the handcrafted vs learned features debate in computer vision (SIFT → CNN).** The "second half" thesis is that memory heuristics will follow the same trajectory — today's carefully designed memory pipelines will be replaced by end-to-end learned memory policies.

**GraphReFly's position:** We are *not* an RL training framework and should not try to be one. But we can be the **reactive substrate** on which learned memory policies execute. Our advantages (push-based propagation, causal observability, diamond-safe coordination, in-process speed) are *orthogonal* to whether the memory policy is handcrafted or learned. The reactive graph is the execution layer; the policy can come from rules, prompts, or RL — and our architecture supports all three without structural changes.

**Concrete next step:** Add an `outcome` feedback node to `agentMemory()` (opportunity #1) as the first step toward adaptive memory. This is pure composition — no new primitives needed — and creates the reward signal infrastructure that opportunities #2-4 build on.

---

## FILES CHANGED

- This file updated: `archive/docs/SESSION-agentic-memory-research.md` (added Part 6)

---END SESSION---
