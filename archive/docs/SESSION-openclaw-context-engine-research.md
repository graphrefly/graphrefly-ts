---
SESSION: openclaw-context-engine-research
DATE: April 9, 2026
TOPIC: OpenClaw Context Engine plugin analysis, integration fit, testing strategy for reactive agent memory
REPO: graphrefly-ts (primary), graphrefly-py (parity scope)
---

## CONTEXT

Research into OpenClaw's pluggable Context Engine (`plugins.slots.contextEngine`, shipped v2026.3.7) revealed a high-leverage integration point for GraphReFly's reactive memory patterns. OpenClaw (250k+ GitHub stars, 20+ messaging platforms) exposes a single-slot plugin interface that controls how agent context is assembled, budgeted, and compacted for every LLM call. The existing plugin ecosystem (Lossless Claw, graph-memory, ClawMem, MemOS Cloud, OpenViking, Contexto, ClawXContext) is entirely static/imperative — none have reactive propagation, budget-aware ranking, or automatic consolidation.

**Source material:**
- OpenHarness (HKUDS) repo analysis — NLAH paper (arXiv 2603.25723), 7-element decomposition, "solved-set replacer" finding
- OpenClaw official docs: `docs/concepts/context-engine.md`
- OpenClaw architecture book: DeepWiki `coolclaws/openclaw-book` (4-layer defense system)
- Third-party guides: theaiagentsbro.com, zread.ai, shareuhack.com
- Existing plugins: Martian-Engineering/lossless-claw, adoresever/graph-memory, yoloshii/ClawMem, MemTensor/MemOS-Cloud-OpenClaw-Plugin, volcengine/OpenViking, ekailabs/contexto, OpenBMB/EdgeClaw
- GraphReFly internal: `archive/docs/SKETCH-reactive-tracker-factory.md` (memory layer design), `archive/docs/SESSION-harness-engineering-strategy.md` (infiltration strategy)

---

## PART 1: OPENCLAW CONTEXT ENGINE ARCHITECTURE

### 4-Layer Defense System (built-in, always on)

| Layer | Trigger | What it does |
|---|---|---|
| Context Window Guard | Pre-API call | Blocks request if tokens exceed model limit; triggers failover to larger-window model |
| Tool Result Guard | Post-tool execution | Truncates or compacts oversized tool outputs before they enter history |
| Compaction | Reactive (overflow error) | Extra LLM call to summarize older turns; rewrites session file |
| Context Pruning | Proactive (opt-in) | Pre-request memory-only pruning |

### Pluggable ContextEngine Slot (`plugins.slots.contextEngine`)

Replaces the legacy context policy with custom logic across three lifecycle hooks:

1. **Selection** — which candidate context is eligible, in what priority order
2. **Budgeting** — enforce token limits while protecting high-value instructions
3. **Compaction** — how older context gets compressed for continuity

Without any plugin installed, the system defaults to `LegacyContextEngine` — zero behavioral change on upgrade.

### Existing Plugin Ecosystem (all static/imperative)

| Plugin | Approach | Weakness from GraphReFly perspective |
|---|---|---|
| Lossless Claw (Martian Engineering) | Preserves full detail, avoids lossy summarization | No ranking, no budget-awareness, no staleness eviction |
| graph-memory (adoresever) | Triple extraction, 75% compression claim | Static triples, no reactive propagation, no consolidation |
| ClawMem (yoloshii) | On-device hybrid RAG search | RAG retrieval, not reactive; no live staleness tracking |
| MemOS Cloud (MemTensor) | Recall-before-exec + save-after-run | Cloud-dependent, no local reactive loop |
| OpenViking (Volcengine) | Long-term memory backend | Storage backend, not context policy |
| Contexto (ekailabs) | "Context graph engine" visualization | Visualization focus, not context selection policy |
| ClawXContext (OpenBMB/EdgeClaw) | Edge-cloud, long-session stability | Session stability, not intelligent ranking |

**Key observation:** Every existing plugin is either a storage backend, a compression strategy, or a visualization tool. None of them do what GraphReFly's reactive memory layer does: live relevance scoring, automatic staleness eviction, LLM-driven consolidation, and budget-aware packing — all as a reactive graph that re-computes when context changes.

---

## PART 2: GRAPHREFLY ↔ OPENCLAW CONTEXT ENGINE MAPPING

### How reactive memory maps to the 3-hook interface

| OpenClaw Hook | GraphReFly Component | Source (tracker sketch) |
|---|---|---|
| **Selection** | `memory::compact-view` — `scoreRelevance()` ranks memories by type weight, area overlap, recency, hit count. Returns highest-relevance candidates first. | `SKETCH-reactive-tracker-factory.md` lines 267-310 |
| **Budgeting** | `packIntoBudget()` — greedy knapsack: iterate scored memories, estimate tokens, skip if over budget, pack until full. | `SKETCH-reactive-tracker-factory.md` lines 312-333 |
| **Compaction** | `memory::stale-filter` (evict memories whose sources are all verified) + `memory::consolidator` (LLM-driven merge when count > threshold). | `SKETCH-reactive-tracker-factory.md` lines 244-260 (stale-filter), 341-368 (consolidation) |

### What GraphReFly adds that no existing plugin has

1. **Reactive propagation** — when a source issue is verified, memories derived from it are automatically evicted (stale-filter). No polling, no manual cleanup.
2. **Context-sensitive ranking** — `scoreRelevance(mem, workContext)` scores against current work area, not static weights. The compact view re-computes when work context changes.
3. **Automatic consolidation** — when memory count exceeds threshold, LLM merges clusters of 3+. Existing plugins only append or delete.
4. **Budget-aware packing** — greedy knapsack respects token budget, includes the most relevant memories, skips expensive low-relevance ones. Existing plugins truncate linearly.
5. **Hit-count promotion** — memories that prove useful get promoted over time.
6. **Type-aware survival** — `pitfall` and `invariant` memories survive verification because the lesson outlives the bug.

---

## PART 3: INTEGRATION DESIGN

### Package: `@graphrefly/openclaw-context-engine`

```typescript
// Plugin entry point — implements OpenClaw ContextEngine interface
import { createContextEngine } from '@graphrefly/openclaw-context-engine'

export default {
  name: 'graphrefly-context-engine',
  version: '0.1.0',
  slots: {
    contextEngine: createContextEngine({
      // Token budget for the reactive memory view
      memoryBudget: 4000,

      // Max memories before LLM consolidation triggers
      consolidationThreshold: 50,

      // LLM adapter for consolidation/extraction
      llm: 'default',  // uses OpenClaw's configured model

      // Persistence path (relative to workspace)
      statePath: '.graphrefly/context-state.json',

      // Work context signal: which files/areas are active
      workContextFrom: 'session',  // 'session' | 'git' | 'manual'
    }),
  },
}
```

### Internal graph topology (runs inside the plugin)

```
graphrefly-context-engine (Graph)
│
├── memory::store              reactiveMap<string, Memory>
├── memory::extractor          effect: new turns → LLM → extract lessons
├── memory::stale-filter       derived: watches verified items → evicts
├── memory::consolidator       effect: store.size > threshold → LLM merge
├── memory::compact-view       derived: store × workContext → ranked, packed
│
├── signals::work-context      state<WorkContext>  (from session/git)
├── signals::turn-history      state<Turn[]>       (from OpenClaw session)
│
└── persistence::checkpoint    effect: any mutation → save to statePath
```

### Hook implementation sketch

```typescript
function createContextEngine(opts: GraphReflyContextEngineOpts): ContextEngine {
  // Boot the internal graph once, persist across turns
  const graph = buildMemoryGraph(opts)

  return {
    // Hook 1: Selection — decide what context candidates are eligible
    async select(candidates, session) {
      // Update work context signal from session state
      graph.set('signals::work-context', deriveWorkContext(session))

      // Feed recent turns into the extractor
      graph.set('signals::turn-history', session.recentTurns)

      // Wait for reactive propagation to settle
      await graph.settled()

      // Return ranked memories as additional context candidates
      const memories = graph.get('memory::compact-view')
      return [
        ...candidates,
        ...memories.map(m => ({
          role: 'system',
          content: formatMemory(m),
          priority: m.relevance,
          source: 'graphrefly',
        })),
      ]
    },

    // Hook 2: Budgeting — enforce token limits
    budget(selected, tokenLimit) {
      // GraphReFly memories already budget-packed via packIntoBudget
      // Let OpenClaw handle its own budgeting for non-GraphReFly items
      // GraphReFly items self-report their token cost
      return selected
    },

    // Hook 3: Compaction — compress older context
    async compact(history, budget) {
      // Instead of lossy LLM summarization, extract lessons into memory store
      const oldTurns = history.slice(0, -10)  // keep last 10 verbatim
      const recentTurns = history.slice(-10)

      // Feed old turns through the memory extractor
      graph.set('signals::turn-history', oldTurns)
      await graph.settled()

      // Return only recent turns — old knowledge is now in reactive memory
      return recentTurns
    },
  }
}
```

---

## PART 4: TESTING STRATEGY

### Testing goals

1. **Memory extraction works** — new turns produce relevant memories
2. **Budget packing respects limits** — never exceeds token budget
3. **Staleness eviction works** — resolved items cause memory eviction
4. **Consolidation works** — high memory count triggers LLM merge
5. **Context quality improves** — agent makes better decisions with reactive memory vs legacy
6. **No regression** — OpenClaw's default behavior is preserved when GraphReFly adds context

### Tier 1: Unit tests (no LLM, no OpenClaw — pure GraphReFly)

These test the reactive memory graph in isolation.

```typescript
// test: memory::compact-view respects budget
describe('packIntoBudget', () => {
  it('never exceeds token budget', () => {
    const memories = generateScoredMemories(100)
    const packed = packIntoBudget(memories, 2000)
    const totalTokens = packed.reduce((sum, m) => sum + estimateTokens(m), 0)
    expect(totalTokens).toBeLessThanOrEqual(2000)
  })

  it('includes highest-relevance memories first', () => {
    const memories = generateScoredMemories(10)
    const packed = packIntoBudget(memories, 500)
    // First packed memory should have highest relevance
    for (let i = 1; i < packed.length; i++) {
      expect(packed[i - 1].relevance).toBeGreaterThanOrEqual(packed[i].relevance)
    }
  })
})

// test: stale-filter evicts memories whose sources are all verified
describe('stale-filter', () => {
  it('evicts memories when all source issues are verified', () => {
    const graph = buildMemoryGraph({ /* ... */ })
    // Add a memory linked to issue-1
    graph.get('memory::store').set('lesson-1', {
      type: 'semantic',
      sourceIssues: ['issue-1'],
      /* ... */
    })
    // Verify issue-1
    graph.set('meta::issue-1::verified', { holds: true })
    // Memory should be evicted
    expect(graph.get('memory::store').has('lesson-1')).toBe(false)
  })

  it('preserves pitfall memories even when sources verified', () => {
    const graph = buildMemoryGraph({ /* ... */ })
    graph.get('memory::store').set('pitfall-1', {
      type: 'pitfall',  // survives verification
      sourceIssues: ['issue-1'],
      /* ... */
    })
    graph.set('meta::issue-1::verified', { holds: true })
    expect(graph.get('memory::store').has('pitfall-1')).toBe(true)
  })
})

// test: relevance scoring
describe('scoreRelevance', () => {
  it('boosts memories matching current work area', () => {
    const mem = { type: 'semantic', affects: ['src/core/'] }
    const ctx = { filesTouched: ['src/core/node.ts'], areas: ['core'] }
    const score = scoreRelevance(mem, ctx)

    const ctxOther = { filesTouched: ['src/extra/ops.ts'], areas: ['extra'] }
    const scoreOther = scoreRelevance(mem, ctxOther)

    expect(score).toBeGreaterThan(scoreOther)
  })
})
```

### Tier 2: Integration tests (with LLM mock, no OpenClaw)

Test the full reactive graph with a mock LLM adapter.

```typescript
describe('memory extraction pipeline', () => {
  it('extracts memories from new findings', async () => {
    const mockLLM = createMockLLM({
      extractResponse: {
        memories: [
          { key: 'lesson-1', rule: 'Always validate...', why: 'Bug found...',
            whenToApply: 'When writing validators', type: 'semantic',
            sourceIssues: ['bug-1'] },
        ],
      },
    })

    const graph = buildMemoryGraph({ llm: mockLLM, memoryBudget: 2000 })

    // Simulate new findings arriving
    graph.resolve('findings::log').append({
      source: 'test', summary: 'Validator missed edge case',
      detail: '...', timestamp: Date.now(),
    })

    await graph.settled()

    expect(graph.get('memory::store').has('lesson-1')).toBe(true)
    expect(mockLLM.callCount).toBe(1)
  })

  it('consolidates when threshold exceeded', async () => {
    const mockLLM = createMockLLM({
      consolidateResponse: {
        consolidated: [{ key: 'merged-1', memory: { /* ... */ }, sourceKeys: ['a', 'b', 'c'] }],
        unchanged: [],
      },
    })

    const graph = buildMemoryGraph({
      llm: mockLLM,
      consolidationThreshold: 5,
    })

    // Add 6 memories to exceed threshold
    const store = graph.resolve('memory::store')
    for (let i = 0; i < 6; i++) {
      store.set(`mem-${i}`, { type: 'semantic', /* ... */ })
    }

    await graph.settled()

    // Should have called consolidation
    expect(mockLLM.lastCall?.system).toContain('Group these memories')
  })
})
```

### Tier 3: OpenClaw integration tests (with real OpenClaw, mock LLM)

Test that the plugin correctly implements the ContextEngine interface.

```typescript
describe('OpenClaw ContextEngine integration', () => {
  let engine: ContextEngine

  beforeEach(() => {
    engine = createContextEngine({
      memoryBudget: 2000,
      consolidationThreshold: 50,
      llm: createMockLLM(),
      statePath: tmpdir() + '/test-state.json',
      workContextFrom: 'manual',
    })
  })

  // Selection hook
  it('adds GraphReFly memories to candidate list', async () => {
    const candidates = [
      { role: 'system', content: 'You are helpful.', priority: 100 },
    ]
    const session = mockSession({ recentTurns: sampleTurns })
    const result = await engine.select(candidates, session)

    // Original candidates preserved
    expect(result.length).toBeGreaterThanOrEqual(candidates.length)
    // GraphReFly memories appended
    const grMemories = result.filter(c => c.source === 'graphrefly')
    expect(grMemories.length).toBeGreaterThanOrEqual(0)  // may be 0 on first call
  })

  // Compaction hook
  it('extracts lessons instead of lossy summarization', async () => {
    const history = generateTurnHistory(50)
    const compacted = await engine.compact(history, 8000)

    // Only recent turns returned
    expect(compacted.length).toBeLessThan(history.length)
    // Old knowledge captured in memory store (not lost)
    // On next select(), these memories will appear
    const candidates = []
    const session = mockSession({ recentTurns: compacted })
    const selected = await engine.select(candidates, session)
    const grMemories = selected.filter(c => c.source === 'graphrefly')
    // If the old turns contained meaningful lessons, they should be extracted
    // (depends on mock LLM behavior)
  })

  // Persistence
  it('survives restart', async () => {
    // Feed turns, let extraction happen
    const session = mockSession({ recentTurns: sampleTurns })
    await engine.select([], session)
    await engine.compact(generateTurnHistory(20), 8000)

    // Create new engine from same state path
    const engine2 = createContextEngine({
      ...opts,
      statePath: engine.opts.statePath,
    })

    const selected = await engine2.select([], session)
    const grMemories = selected.filter(c => c.source === 'graphrefly')
    // Memories from previous engine should be loaded
  })
})
```

### Tier 4: End-to-end quality tests (with real LLM, real OpenClaw session)

These are expensive — run manually or in CI on a schedule, not per-commit.

```typescript
describe('E2E: context quality improvement', () => {
  // Compare agent behavior with and without GraphReFly context engine
  // over a multi-turn coding session.

  it('agent recalls earlier decisions better with reactive memory', async () => {
    const scenario = [
      { user: 'Create a user authentication module with JWT' },
      { user: 'Add rate limiting to the auth endpoints' },
      { user: 'Now add OAuth2 support' },
      // ... 20+ turns establishing context ...
      { user: 'What rate limiting strategy did we use for auth?' },
    ]

    // Run with legacy engine
    const legacyResult = await runScenario(scenario, { contextEngine: 'legacy' })

    // Run with GraphReFly engine
    const grResult = await runScenario(scenario, { contextEngine: 'graphrefly' })

    // Score: does the agent correctly recall the rate limiting decision?
    // Use LLM-as-judge or string matching depending on precision needs
    const legacyScore = await scoreRecall(legacyResult.lastResponse, 'rate limiting')
    const grScore = await scoreRecall(grResult.lastResponse, 'rate limiting')

    console.log(`Legacy recall: ${legacyScore}, GraphReFly recall: ${grScore}`)
    // Not asserting > because single runs are noisy
    // Aggregate over 10+ runs for statistical significance
  })

  it('agent avoids repeating mistakes after lesson extraction', async () => {
    const scenario = [
      { user: 'Write a function to parse CSV files' },
      // Agent writes buggy parser (no quote handling)
      { user: 'This fails on quoted fields with commas. Fix it.' },
      // Agent fixes
      // ... later in same or new session ...
      { user: 'Write a function to parse TSV files' },
    ]

    // With reactive memory, the lesson "handle quoted fields" should persist
    // and apply to the TSV parser without being told
    const grResult = await runScenario(scenario, { contextEngine: 'graphrefly' })

    // Check if TSV parser handles quoted fields proactively
    const handlesQuotes = grResult.lastCode.includes('quote') ||
                          grResult.lastCode.includes('"')
    expect(handlesQuotes).toBe(true)
  })
})
```

### Tier 5: Regression tests (GraphReFly must not degrade OpenClaw defaults)

```typescript
describe('Regression: no degradation of default behavior', () => {
  it('empty memory store passes through all candidates unchanged', async () => {
    const engine = createContextEngine({ /* fresh, no state */ })
    const candidates = generateCandidates(10)
    const result = await engine.select(candidates, mockSession())
    // All original candidates present and unmodified
    for (const c of candidates) {
      expect(result).toContainEqual(c)
    }
  })

  it('compaction preserves recent turns exactly', async () => {
    const engine = createContextEngine({ /* ... */ })
    const history = generateTurnHistory(30)
    const compacted = await engine.compact(history, 8000)
    const lastTen = history.slice(-10)
    // Last 10 turns must be bit-for-bit identical
    expect(compacted.slice(-10)).toEqual(lastTen)
  })

  it('total token count stays within OpenClaw budget', async () => {
    const engine = createContextEngine({ memoryBudget: 2000 })
    // Simulate many turns to fill memory
    for (let i = 0; i < 100; i++) {
      await engine.select([], mockSession({ recentTurns: [sampleTurn(i)] }))
    }
    const selected = await engine.select([], mockSession())
    const grTokens = selected
      .filter(c => c.source === 'graphrefly')
      .reduce((sum, c) => sum + estimateTokens(c.content), 0)
    expect(grTokens).toBeLessThanOrEqual(2000)
  })
})
```

### Testing metrics to track

| Metric | How to measure | Target |
|---|---|---|
| Memory extraction precision | Manual review of extracted memories vs source turns | >80% relevant |
| Budget compliance | Automated: total tokens vs budget limit | 100% (hard constraint) |
| Staleness eviction rate | Count evicted vs expected evictions | >95% |
| Consolidation ratio | Memories before/after consolidation | 3:1 or better |
| Context recall (E2E) | LLM-as-judge scoring on 20-turn scenarios | >legacy baseline |
| Regression rate | Default behavior tests passing | 100% |
| Cold start latency | Time from plugin load to first select() response | <100ms |
| Persistence integrity | State file load → memory count match | 100% |

---

## PART 5: ROADMAP PLACEMENT

### Decision: Wave 2 (§9.3b), not Wave 3

**Rationale:**
1. Lower build effort than MCP Server — 3 hooks vs 6 tools
2. Higher distribution — all OpenClaw users vs MCP-client subset
3. Deeper integration — controls what the agent remembers, not just what tools it has
4. Proves the reactive memory thesis more directly than any other integration
5. Existing reactive memory design (`SKETCH-reactive-tracker-factory.md`) maps 1:1 to the 3-hook interface

**Dependency:** requires `memory::compact-view`, `scoreRelevance`, `packIntoBudget` from the memory layer. Does NOT require `explainPath` (§9.2) or full tracker factory.

### Added to roadmap

New §9.3b in Wave 2, after §9.3 (MCP Server):

```
#### 9.3b — OpenClaw Context Engine Plugin (`@graphrefly/openclaw-context-engine`)

- [ ] Implement ContextEngine 3-hook interface (select, budget, compact)
- [ ] Reactive memory graph: store, extractor, stale-filter, consolidator, compact-view
- [ ] Work context signal from OpenClaw session state
- [ ] Persistence via autoCheckpoint to workspace `.graphrefly/` dir
- [ ] Unit tests: packIntoBudget, scoreRelevance, stale-filter, consolidation
- [ ] Integration tests: ContextEngine interface compliance
- [ ] Regression tests: no degradation of default OpenClaw behavior
- [ ] Publish to npm as `@graphrefly/openclaw-context-engine`
- [ ] OpenClaw plugin registry submission
```

### Updated infiltration priority table

| Priority | Entry point | Target audience | Why |
|---|---|---|---|
| **1** | **MCP Server** | All MCP clients | Universal reach |
| **1b** | **OpenClaw Context Engine** | All OpenClaw users (250k+) | Deeper integration, proves reactive memory. Lower effort than MCP. |
| **2** | Workspace bridge (`fromWorkspace()`) | File-based agents | Zero agent code changes |
| **3** | LangGraph adapter | LangChain ecosystem | Largest ecosystem |

---

## PART 6: OPENHARNESS RESEARCH NOTES (BACKGROUND)

### What OpenHarness (HKUDS) taught us

OpenHarness (arXiv 2603.25723) formalizes harness engineering as "Natural-Language Agent Harnesses" (NLAHs) with 7 elements: contracts, roles, stage structure, adapters/scripts, state semantics, failure taxonomy, file-backed state. Key findings:

1. **"Solved-set replacer"** — more harness modules don't uniformly improve; they redistribute which problems get solved (110/125 agreed on SWE-bench between full and minimal harness)
2. **Three-layer separation** — harness (multi-step orchestration) / context engineering (single-call prompt) / runtime (generic infra)
3. **File-backed durable state** as first-class harness concern — validates autoCheckpoint approach

### What we learned (not competitive positioning)

- GraphReFly's reactive memory is architecturally a generation ahead of both OpenHarness (static markdown files) and existing OpenClaw plugins (all static/imperative)
- The "solved-set replacer" finding cautions against assuming more complexity = better; our eval should track per-issue success patterns, not just aggregate scores
- Focus on what's architecturally unreachable from imperative loops: reactive propagation, automatic staleness eviction, budget-aware consolidation

---

## FILES CHANGED

- `docs/roadmap.md` — added §9.3b (OpenClaw Context Engine Plugin) to Wave 2
- `archive/docs/SESSION-openclaw-context-engine-research.md` — this file
- `archive/docs/design-archive-index.jsonl` — index entry added
