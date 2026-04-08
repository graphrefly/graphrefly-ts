---
SESSION: mid-level-harness-blocks
DATE: April 8, 2026
TOPIC: Mid-level composed building blocks for harness requirements — bridging primitives and harnessLoop(), GitHub org profile README
REPO: graphrefly-ts (primary)
---

## CONTEXT

The GitHub organization profile README (`graphrefly/.github/profile/README.md`) lists 8 harness engineering requirements with scattered primitives in the "How" column. Brainstorming revealed a missing **mid-level layer** between raw primitives and `harnessLoop()` — composed blocks that power users can use to build custom harness variants.

Additionally, the `graphLens()` concept emerged as the observability block: reactive summaries of graph health, topology, flow, and causality — structured data that LLMs or UIs can render, but the library itself never generates natural language.

---

## PART 1: THE THREE-LAYER API STACK

### Layer 1: Primitives (exists)

`retry`, `backoff`, `withBreaker`, `timeout`, `budgetGate`, `describe()`, `observe()`, `trace()`, `gate`, `valve`, `policy()`, `autoCheckpoint`, `snapshot`, `restore`, `decay()`, `distill()`, `explainPath`, etc.

### Layer 2: Mid-level composed blocks (NEW — this session)

| Block | Composes | Developer thinks... |
|---|---|---|
| **`resilientPipeline()`** | retry + backoff + withBreaker + timeout + budgetGate | "I want this step to not blow up" |
| **`graphLens()`** | describe + observe + flow stats + health + explainPath | "I want to see what's happening and why" |
| **`guardedExecution()`** | ABAC + policy + policyFromRules + scoped describe | "I want to control who can do what" |
| **`persistentState()`** | autoCheckpoint + snapshot + restore | "I want to survive restarts" |

`agentMemory()` already covers context & state at the AI layer.
`gate` is already a clean standalone for human governance.
Eval harness and strategy model are their own domain.

### Layer 3: `harnessLoop()` (exists, §9.0)

One call, all 8 requirements covered. Uses Layer 2 blocks internally. Sensible defaults.

---

## PART 2: graphLens() DESIGN

### The key insight: observability as nodes, not external tools

The library produces **structured, reactive data**. An LLM or UI renders it. The library never generates natural language — that's LLM work.

### API

```typescript
const lens = graphLens(graph)

lens.topology   // Node<TopologyStats>
lens.health     // Node<HealthReport>
lens.flow       // Node<FlowStats>
lens.why(node)  // Node<CausalChain> — reactive explainPath
```

### Data shapes

```typescript
interface TopologyStats {
  nodeCount: number
  edgeCount: number
  sources: string[]      // entry points (no deps)
  sinks: string[]        // terminal nodes (no dependents)
  depth: number          // longest path
  hasCycles: boolean
}

interface HealthReport {
  ok: boolean
  problems: Array<{
    node: string
    status: NodeStatus
    since: bigint           // monotonicNs
    upstreamCause?: string  // which upstream caused this
  }>
}

interface FlowStats {
  perNode: Map<string, {
    throughput: number      // messages/sec (rolling window)
    lastUpdate: bigint      // monotonicNs
    staleSince?: bigint     // null if fresh; set when no update in N × expected interval
  }>
  bottlenecks: string[]    // nodes where downstream waiting, upstream hasn't pushed
}

// why(node) returns:
interface CausalChain {
  steps: Array<{
    node: string
    value: unknown
    changedAt: bigint
    reason: 'dependency' | 'direct' | 'propagation'
  }>
}
```

### What makes this a real pattern

1. **Reactive** — `lens.health` pushes when something goes wrong. Wire to effect, gate, agentMemory.
2. **Composable** — each field is a node. Feed into gate ("pause when health degrades"), dashboard, alert.
3. **Bridge between describe() and human understanding** — `describe()` gives `{ nodes: { fetcher: { status: 'errored' } } }`. `lens.health` gives structured `{ node: 'fetcher', status: 'errored', since: ..., upstreamCause: 'api' }`.
4. **`why(node)` is live** — reactive explainPath subscription, not one-shot query. Causal chain updates as graph evolves.

### Implementation

Composition of existing pieces: `describe()` feeds derived node for topology/health, `observe()` feeds flow stats with rolling window, `explainPath` (§9.2) feeds `why()`. The lens is a small subgraph riding on the target graph via `bridge()`.

---

## PART 3: OTHER MID-LEVEL BLOCKS

### resilientPipeline()

```typescript
const step = resilientPipeline(graph, targetNode, {
  retry: { max: 3 },
  backoff: { strategy: 'exponential', base: 1000 },
  breaker: { threshold: 5, resetAfter: 30_000 },
  timeout: 10_000,
  budget: { maxTokens: 50_000 },
})
```

Today developers manually compose `retry(backoff(withBreaker(...)))` and need to know the nesting order. This block handles the correct ordering (rateLimiter → breaker → retry → timeout → fallback → cache feedback → status) — the same ordering discovered during eval runs (T5/T8a/T8b).

### guardedExecution()

```typescript
const guarded = guardedExecution(graph, subgraph, {
  actor: currentUser,
  policies: [
    allow('read', '*'),
    deny('write', 'system:*'),
    allow('execute', 'tools:safe:*'),
  ],
  budget: { maxCost: 1.00 },
})
```

Combines ABAC + policy rules + budgetGate into one composable safety layer. Wraps any subgraph. Returns scoped describe (actor sees only what they're allowed to).

### persistentState()

```typescript
const persistent = persistentState(graph, {
  store: sqliteStore('./data/checkpoint.db'),
  debounce: 500,
  incremental: true,   // uses Graph.diff() for delta checkpoints
})
// persistent.save()    — manual trigger
// persistent.restore() — on startup
// auto-saves on settlement (messageTier >= 2)
```

Bundles autoCheckpoint + snapshot + restore + incremental diff. The developer doesn't need to know about settlement tiers or debounce strategies.

---

## PART 4: DESIGN DECISIONS

### Natural language is never the library's job

The library computes structured facts reactively. The LLM narrates them. Clean separation. `graphLens()` returns typed data, never strings meant for human reading. A UI or LLM converts `{ node: 'fetcher', status: 'errored', upstreamCause: 'api' }` into "fetcher has been errored for 12 minutes because the upstream API returned 503."

### Why these four blocks and not eight

The 8 harness requirements don't map 1:1 to building blocks. Execution boundary and policy/safety overlap (both are `guardedExecution`). Observability needs a composed lens, not just wrappers. Verification and continuous improvement are domain-specific (eval harness, strategy model) — not generalizable mid-level blocks. Human governance (`gate`) is already clean.

### Relationship to existing roadmap

- `resilientPipeline()` subsumes the `resilientFetch` template work (§9.1b) — the template becomes an instance of the general block
- `graphLens()` depends on `explainPath` (§9.2) for `why()`, but topology/health/flow work without it
- `guardedExecution()` depends on Actor/Guard (Phase 1.5, done) + `policyEnforcer` (§9.2)
- `persistentState()` depends on autoCheckpoint (Phase 1.4b, done) + Graph.diff() (done)
- `harnessLoop()` (§9.0) should use these blocks internally rather than wiring primitives directly

---

## PART 5: ORG PROFILE README

Created `graphrefly/.github` repository with `profile/README.md` displayed on the organization overview page. Content covers:

- Pain-point-first framing (fragile agents, stale state, unexplainable errors)
- The core bet (long-running human+LLM reactive co-operation)
- Architecture at a glance (NL → GraphSpec → Flow → Run → Persist → Explain)
- Harness engineering 8-requirement coverage table
- Links to all 3 repos (spec, TS, Python)
- Key concepts, "why not plain functions", target audience

**Decision:** Spec repo (`graphrefly/graphrefly`) stays separate from `.github`. The profile README links to repos, doesn't contain them. Spec is independently clonable for other language implementations.

---

## KEY INSIGHTS

1. **Three-layer API stack** — primitives (power users wire anything), mid-level blocks (developers compose custom harnesses), harnessLoop (one call, all 8 requirements). The mid-level was missing.

2. **graphLens() is observability-as-nodes.** Not an external dashboard — reactive derived nodes that ride on the target graph. Composable with gates, alerts, memory. The library computes structured facts; LLMs/UIs render them.

3. **Four natural blocks, not eight.** The 8 requirements cluster into: resilience, observability, access control, persistence. Plus existing standalone blocks (agentMemory, gate, eval, strategy model).

4. **No natural language in the library.** Strong separation: library → structured data, LLM → narration. This keeps the library model-agnostic and testable.

5. **resilientPipeline() encodes hard-won ordering knowledge.** The correct nesting order (rateLimiter → breaker → retry → timeout → fallback) was discovered through eval failures. The block saves every developer from rediscovering it.

---

## PROPOSED ROADMAP ITEMS

See §9.0b in roadmap — Mid-Level Harness Blocks, slotted between §9.0 (primitives/wiring) and Wave 1 (eval story).

---

## FILES CHANGED

- `graphrefly/.github/profile/README.md` — created (org profile)
- `archive/docs/SESSION-mid-level-harness-blocks.md` — this file
- `archive/docs/design-archive-index.jsonl` — index entry added
- `docs/roadmap.md` — §9.0b added

---END SESSION---
