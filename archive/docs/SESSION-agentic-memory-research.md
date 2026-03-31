---
SESSION: agentic-memory-research
DATE: March 31, 2026
TOPIC: Agentic Memory SOTA Research Synthesis + Default Strategy Design for agentMemory()
ORIGIN: Adapted from callbag-recharge research (~/src/callbag-recharge/src/archive/docs/SESSION-agentic-memory-research.md, March 17–26 2026) and user-provided notes on advanced memory write mechanisms (March 31 2026)
---

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

## FILES CHANGED

- This file created: `archive/docs/SESSION-agentic-memory-research.md`
- Updated: `archive/docs/DESIGN-ARCHIVE-INDEX.md` (new entry)
- Updated: `docs/roadmap.md` (Phase 4.4 refined with default strategy)

---END SESSION---
