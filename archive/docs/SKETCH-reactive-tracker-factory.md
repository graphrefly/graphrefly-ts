# Sketch: `tracker()` Graph Factory

> Design sketch — not implementation. References session `SESSION-reactive-issue-tracker-design.md`.

---

## Top-Level API

```typescript
import { tracker, type TrackerOptions } from '@graphrefly/graphrefly-ts'

const t = tracker('my-project', {
  // Where to persist between sessions
  checkpoint: new FileCheckpointAdapter('./tracker.json'),

  // LLM adapter for extraction/summarization/parity checks
  llm: anthropicAdapter({ model: 'claude-sonnet-4-20250514' }),

  // Token budget for the compact memory view
  memoryBudget: 2000,

  // Max memories before consolidation triggers
  consolidationThreshold: 50,

  // Trace log ring buffer size
  traceSize: 200,
})
```

**Returns:** `TrackerBundle` — a `Graph` plus imperative methods.

```typescript
interface TrackerBundle {
  graph: Graph

  // ── Issue CRUD ──
  file(id: string, issue: IssueInput): void
  update(id: string, patch: Partial<IssueInput>): void
  close(id: string, resolution?: string): void    // triggers verify
  defer(id: string, reason: string): void
  remove(id: string): void
  issue(id: string): Node<Issue>                   // the live node
  issues(filter?: IssueFilter): Issue[]            // snapshot query

  // ── Findings ──
  ingest(finding: FindingInput): void              // append to log
  ingest(findings: FindingInput[]): void           // batch append

  // ── Verification ──
  verify(id: string): Node<VerifyResult>           // trigger manual verify
  verifyAffected(files: string[]): void            // re-verify by file overlap
  reverify(): void                                 // re-verify all non-deferred

  // ── Memory ──
  memories(context?: WorkContext): CompactMemory[]  // budgeted, ranked
  memorize(memory: MemoryInput): void               // manual memory add
  forget(key: string): void                         // manual evict

  // ── Introspection (delegates to Graph) ──
  describe(opts?: DescribeOpts): GraphDescribeOutput
  annotate(id: string, reason: string): void
  traceLog(): TraceEntry[]
  diff(before: Snapshot, after: Snapshot): DiffResult

  // ── Persistence ──
  save(): void
  restore(): boolean
}
```

---

## Internal Graph Topology

```
tracker (Graph: "my-project")
│
├── issues::                          ── issue collection ──
│   ├── issues::bug/batch-drain       state<Issue>
│   │   └── meta.verified             state<VerifyResult | null>
│   ├── issues::inv/no-promise-api    state<Issue>
│   │   └── meta.verified             state<VerifyResult | null>
│   ├── issues::parity/py-batch       state<Issue>
│   │   └── meta.verified             state<VerifyResult | null>
│   └── ...
│
├── findings::log                     reactiveLog<Finding>    ── append-only ──
│
├── memory::                          ── memory layer ──
│   ├── memory::store                 reactiveMap<string, Memory>
│   ├── memory::extractor             effect: findings::log.tail → LLM → store
│   ├── memory::stale-filter          derived: watches store + all meta.verified
│   ├── memory::consolidator          effect: store.size > threshold → LLM merge
│   └── memory::compact-view          derived: store × context → ranked, packed
│
├── signals::                         ── external triggers ──
│   ├── signals::code-changed         state<CodeChange>
│   └── signals::work-context         state<WorkContext>
│
├── views::                           ── computed views ──
│   ├── views::affected               derived: code-changed → issue[] by affects
│   ├── views::priority-queue         derived: all issues → sorted by impact
│   ├── views::invariant-health       derived: invariant issues → holds/violations
│   └── views::parity-status          derived: parity issues → in-sync/drifted
│
└── effects::                         ── side effects ──
    ├── effects::auto-verify          effect: issue status → 'fixed' → run verify
    ├── effects::regression-check     effect: views::affected → re-verify each
    ├── effects::auto-save            effect: any mutation → checkpoint.save()
    └── effects::notify               effect: regressions/violations → annotate
```

---

## Issue Lifecycle (State Machine)

```
                    file()
                      │
                      ▼
                   ┌──────┐
          ┌───────│ open  │◄──────────────────────┐
          │       └───┬───┘                        │
          │           │                            │
     defer()     close() or                   regression
          │      AI submits fix                detected
          ▼           │                            │
    ┌──────────┐      ▼                            │
    │ deferred │   ┌───────┐   verify()     ┌──────┴─────┐
    └──────────┘   │ fixed │──────────────►│  verifying  │
                   └───────┘               └──────┬──────┘
                                                  │
                                    ┌─────────────┴─────────────┐
                                    │                           │
                                    ▼                           ▼
                              ┌──────────┐               ┌──────────┐
                              │ verified │               │   open   │
                              │ (proof)  │               │ (failed) │
                              └──────────┘               └──────────┘
```

**Key:** `verified` requires evidence. `fixed` is a claim. The graph enforces the distinction.

---

## Wiring Detail: How Verification Works

```typescript
// Inside tracker() factory — simplified
function wireAutoVerify(graph: Graph, issueId: string) {
  const issueNode = graph.node(`issues::${issueId}`)
  const verifiedMeta = issueNode.meta.verified  // state<VerifyResult | null>

  // When status changes to 'fixed', auto-verify
  effect([issueNode], (issue) => {
    if (issue.status !== 'fixed') return
    if (!issue.verify) {
      // No verifier — stay at 'fixed', can't auto-promote
      return
    }

    // Transition to 'verifying'
    graph.set(`issues::${issueId}`, { ...issue, status: 'verifying' })

    // Run verifier (async — result writes back via producer pattern)
    const verifyNode = producer((_d, a) => {
      issue.verify!().then(result => {
        a.emit(result)
        a.down([[COMPLETE]])
      }).catch(err => {
        a.down([[ERROR, err]])
      })
    })

    // When verify result arrives, update issue + meta
    effect([verifyNode], (result: VerifyResult) => {
      verifiedMeta.set(result)
      const current = issueNode.get()
      if (result.holds) {
        graph.set(`issues::${issueId}`, { ...current, status: 'verified' })
        graph.annotate(`issues::${issueId}`,
          `Verified (${result.method}): ${result.evidence.slice(0, 100)}`)
      } else {
        graph.set(`issues::${issueId}`, { ...current, status: 'open' })
        graph.annotate(`issues::${issueId}`,
          `Verification FAILED: ${result.evidence.slice(0, 200)}`)
      }
    })
  })
}
```

---

## Wiring Detail: Memory Distillation

```typescript
// Inside tracker() factory — simplified
function wireMemoryLayer(graph: Graph, opts: TrackerOptions) {
  const findingsLog = graph.resolve('findings::log')   // reactiveLog
  const memoryStore = graph.resolve('memory::store')    // reactiveMap
  const workContext  = graph.resolve('signals::work-context')

  // ── Extractor: new findings → distilled memories ──
  //
  // Watches the tail of the findings log.
  // On new findings, asks LLM to extract compact lessons.
  // Deduplicates against existing memories.
  //
  effect([findingsLog.tail(5)], async (recentFindings) => {
    if (recentFindings.length === 0) return

    const existing = memoryStore.entries()
    const extraction = await opts.llm.call({
      system: `You are a memory extractor. Given new findings and existing memories,
        extract ONLY non-obvious, actionable lessons. Each memory:
        - RULE: one sentence
        - WHY: the incident or reasoning
        - WHEN TO APPLY: trigger condition
        Skip anything already in existing memories. Skip obvious things.`,
      input: { newFindings: recentFindings, existingMemories: existing },
    })

    batch(() => {
      for (const mem of extraction.memories) {
        memoryStore.set(mem.key, {
          ...mem,
          extractedAt: Date.now(),
          sourceIssues: mem.sourceIssues,
          hitCount: 0,
        })
      }
    })
  })

  // ── Stale filter: evict memories whose source issues are all verified ──
  //
  // Exception: 'pitfall' and 'invariant' type memories survive verification
  // because the lesson outlives the specific bug.
  //
  // Uses derived (not effect) — the staleness check is a pure computation.
  //
  const allVerifiedIds = derived(
    [/* all meta.verified nodes */],
    (...results) => new Set(
      results
        .filter(r => r?.holds === true)
        .map((_, i) => issueIds[i])
    )
  )

  effect([allVerifiedIds, memoryStore.node], (verified, _) => {
    for (const [key, mem] of memoryStore.entries()) {
      if (mem.type === 'pitfall' || mem.type === 'invariant') continue
      if (mem.sourceIssues.every(id => verified.has(id))) {
        memoryStore.delete(key)  // or archive
      }
    }
  })

  // ── Compact view: budget-aware, context-sensitive ranking ──
  //
  // This is the node that gets read at session start.
  // It packs the most relevant memories into the token budget.
  //
  const compactView = derived(
    [memoryStore.node, workContext],
    (storeSnapshot, ctx) => {
      const scored = []
      for (const [key, mem] of Object.entries(storeSnapshot)) {
        scored.push({
          key,
          ...mem,
          relevance: scoreRelevance(mem, ctx),
        })
      }
      scored.sort((a, b) => b.relevance - a.relevance)
      return packIntoBudget(scored, opts.memoryBudget)
    }
  )

  graph.add('memory::compact-view', compactView)
}

// ── Relevance scoring ──
function scoreRelevance(mem: Memory, ctx: WorkContext): number {
  let score = 0

  // Type weight: pitfalls and invariants always score high
  const typeWeight = { pitfall: 1.0, invariant: 0.9, semantic: 0.7,
                       parity: 0.6, decision: 0.5, coverage: 0.3 }
  score += (typeWeight[mem.type] ?? 0.3) * 40

  // Area overlap: does the memory touch files/areas we're working on?
  const areaOverlap = mem.affects?.filter(a =>
    ctx.filesTouched?.some(f => f.includes(a)) ||
    ctx.areas?.includes(a)
  ).length ?? 0
  score += Math.min(areaOverlap * 20, 40)

  // Recency: recently extracted memories get a small boost
  const daysSinceExtract = (Date.now() - mem.extractedAt) / 86400000
  score += Math.max(0, 10 - daysSinceExtract)  // decays over 10 days

  // Hit count: memories that have been useful get promoted
  score += Math.min(mem.hitCount * 5, 15)

  return score
}

// ── Budget packing (greedy knapsack) ──
function packIntoBudget(
  sorted: ScoredMemory[],
  maxTokens: number
): CompactMemory[] {
  const result: CompactMemory[] = []
  let tokens = 0
  for (const mem of sorted) {
    const cost = estimateTokens(mem.rule + mem.why + mem.whenToApply)
    if (tokens + cost > maxTokens) continue  // skip, try next (smaller)
    result.push({
      key: mem.key,
      type: mem.type,
      rule: mem.rule,
      why: mem.why,
      whenToApply: mem.whenToApply,
      relevance: mem.relevance,
    })
    tokens += cost
  }
  return result
}
```

---

## Wiring Detail: Consolidation

```typescript
// Triggered when memory count exceeds threshold
effect([memoryStore.size], async (size) => {
  if (size <= opts.consolidationThreshold) return

  const all = memoryStore.entries()
  const clusters = await opts.llm.call({
    system: `Group these memories by topic. For clusters of 3+,
      merge into one consolidated memory. Preserve WHY and WHEN TO APPLY.
      Return: { consolidated: Memory[], unchanged: string[] }`,
    input: { memories: all },
  })

  batch(() => {
    for (const cluster of clusters.consolidated) {
      // Remove sources
      for (const sourceKey of cluster.sourceKeys) {
        memoryStore.delete(sourceKey)
      }
      // Add consolidated
      memoryStore.set(cluster.key, {
        ...cluster.memory,
        consolidatedFrom: cluster.sourceKeys,
        extractedAt: Date.now(),
        hitCount: Math.max(...cluster.sourceHitCounts),
      })
    }
  })
})
```

---

## Type Definitions

```typescript
interface IssueInput {
  title: string
  kind: 'bug' | 'invariant' | 'parity' | 'coverage' | 'semantics' | 'feature'
  severity: 'critical' | 'high' | 'medium' | 'low'
  verify?: () => Promise<VerifyResult>
  relatedTo?: string[]
  affects?: string[]
  blockedBy?: string[]
  description?: string
}

interface Issue extends IssueInput {
  status: 'open' | 'fixed' | 'verifying' | 'verified' | 'deferred' | 'wontfix'
  filedAt: number
  findings: Finding[]
}

interface Finding {
  source: 'ai' | 'human' | 'test' | 'lint'
  timestamp: number
  summary: string
  detail: string
  resolution?: 'applied' | 'deferred' | 'rejected'
  relatedCommit?: string
}

interface VerifyResult {
  holds: boolean
  evidence: string
  confidence: number
  checkedAt: number
  method: 'test' | 'grep' | 'llm' | 'manual'
}

interface Memory {
  type: 'pitfall' | 'invariant' | 'semantic' | 'parity' | 'decision' | 'coverage'
  rule: string          // one sentence: the fact/rule
  why: string           // one sentence: the reasoning/incident
  whenToApply: string   // one sentence: trigger condition
  sourceIssues: string[]
  affects?: string[]
  extractedAt: number
  hitCount: number
  confidence: number
  consolidatedFrom?: string[]
}

interface CompactMemory {
  key: string
  type: Memory['type']
  rule: string
  why: string
  whenToApply: string
  relevance: number
}

interface WorkContext {
  filesTouched?: string[]
  areas?: string[]           // 'core', 'operators', 'graph', 'resilience', ...
  phase?: string             // 'phase-3', 'phase-4', ...
  intent?: string            // free-text: "fixing batch drain", "adding mergeMap concurrent"
}

interface CodeChange {
  files: string[]
  commit: string
  timestamp: number
}

interface IssueFilter {
  status?: Issue['status'] | Issue['status'][]
  kind?: Issue['kind'] | Issue['kind'][]
  severity?: Issue['severity'] | Issue['severity'][]
  affects?: string   // issues affecting this area
  predicate?: (issue: Issue) => boolean
}

interface TrackerOptions {
  checkpoint?: CheckpointAdapter
  llm?: LLMAdapter
  memoryBudget?: number             // default 2000 tokens
  consolidationThreshold?: number   // default 50 memories
  traceSize?: number                // default 200
  autoSave?: boolean                // default true
  autoVerifyOnFix?: boolean         // default true
}

interface LLMAdapter {
  call(request: { system: string; input: unknown }): Promise<unknown>
}
```
