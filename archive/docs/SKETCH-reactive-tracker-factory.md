# Sketch: `tracker()` Graph Factory + `verifiable()` + `distill()`

> Design sketch — not implementation. References session `SESSION-reactive-issue-tracker-design.md`.
> Updated: March 30, 2026 — revised `verifiable()` (fully reactive, no imperative trigger) and `distill()` (abstract pattern, LLM-agnostic) per design review.

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

---

## `verifiable()` — Detailed Design

### Principle: Fully Reactive, No Imperative Surface

The original sketch had `reverify()` as an imperative method. This violates the design
invariant: public API returns `Node<T>`, `Graph`, `void`, or plain sync value — never an
imperative trigger that spawns side effects outside the graph.

Instead: **re-verification is a reactive signal**. The trigger to re-verify is itself a
`NodeInput` — a node, a promise, an iterable, whatever. When the trigger fires, the
verifier runs. This makes the entire verification lifecycle part of the graph topology,
observable, and introspectable via `describe()`.

### Signature

```typescript
function verifiable<T>(
  source: NodeInput<T>,
  verifyFn: (value: T) => NodeInput<VerifyResult>,
  opts?: VerifiableOptions,
): VerifiableBundle<T>

interface VerifiableOptions extends NodeOptions {
  /** Trigger re-verification. Each emission from trigger re-runs verifyFn. */
  trigger?: NodeInput<unknown>

  /** Re-verify whenever source value changes. Default: false. */
  autoVerify?: boolean

  /** Initial VerifyResult to seed the verified companion. Default: null. */
  initialVerified?: VerifyResult | null

  /** Custom equals for source value (inherited from NodeOptions). */
  equals?: (a: unknown, b: unknown) => boolean
}

interface VerifiableBundle<T> {
  /** The source value node (coerced via fromAny). */
  node: Node<T>

  /** Companion: latest verification result. null = never verified. */
  verified: Node<VerifyResult | null>

  /**
   * Trigger node (if trigger was provided or autoVerify is true).
   * Useful for wiring into larger graphs: connect another signal
   * to this node to trigger re-verification reactively.
   */
  trigger: Node<unknown> | null
}
```

### Why Not `initialValue` in Opts?

The first argument `source: NodeInput<T>` already covers this via `fromAny`:

```typescript
// Plain value → of(42) → state-like node
verifiable(42, checkRange)

// Existing node → passed through
verifiable(myStateNode, checkRange)

// Promise → fromPromise
verifiable(fetchConfig(), validateConfig)

// AsyncIterable → fromAsyncIter
verifiable(eventStream, checkInvariant)
```

`NodeInput<T>` IS the initial value when it's a scalar. No need for a separate
`initialValue` option — that would create ambiguity about which one wins.

### Why Not `dynamicNode`?

The dep set for verifiable is **static and known at construction**:

- `sourceNode` (coerced from `source: NodeInput<T>`)
- `triggerNode` (coerced from `opts.trigger: NodeInput<unknown>`, if provided)

The verifier function may be async and may internally read other nodes, but the
**verifiable node itself** doesn't need to track deps at runtime. The verifier's
result flows back through a companion node, not through dynamic dep rewiring.

Where `dynamicNode` WOULD matter: if the verifier itself needs to watch different
nodes depending on the current value. Example: "if issue.kind is 'parity', watch
both TS and Py nodes; if 'invariant', watch only TS." But this is better modeled
as the **caller** constructing the right verifier function with the right deps,
not as dynamicNode inside verifiable. Keep verifiable simple; let the caller compose.

Exception: if we later add a `verifiable` variant where the verifier function
receives a `get()` proxy (like dynamicNode's tracking fn), that would use
dynamicNode under the hood. But that's a future extension, not the base case.

### Internal Wiring

```typescript
function verifiable<T>(
  source: NodeInput<T>,
  verifyFn: (value: T) => NodeInput<VerifyResult>,
  opts?: VerifiableOptions,
): VerifiableBundle<T> {
  const sourceNode = fromAny(source)
  const verifiedState = state<VerifyResult | null>(opts?.initialVerified ?? null)

  // Build trigger: explicit trigger, autoVerify on source change, or both
  let triggerNode: Node<unknown> | null = null

  if (opts?.trigger && opts?.autoVerify) {
    // Both: merge explicit trigger + source changes
    triggerNode = merge([fromAny(opts.trigger), sourceNode])
  } else if (opts?.trigger) {
    triggerNode = fromAny(opts.trigger)
  } else if (opts?.autoVerify) {
    triggerNode = sourceNode  // source IS the trigger
  }

  if (triggerNode) {
    // switchMap pattern: when trigger fires, cancel previous verification,
    // start new one. verifyFn returns NodeInput<VerifyResult> — could be
    // a Promise, a Node, a plain value. fromAny coerces it.
    const verifyStream = switchMap(triggerNode, () => {
      const currentValue = sourceNode.get()
      return verifyFn(currentValue as T)
    })

    // Write verification results to the companion state.
    // effect() is the side-effect bridge: reactive in, imperative write out.
    effect([verifyStream], (result) => {
      verifiedState.set(result)
    })
  }

  return {
    node: sourceNode,
    verified: verifiedState,
    trigger: triggerNode,
  }
}
```

### Key Design Decision: `switchMap` for Verification

Why `switchMap` and not `flatMap`/`concatMap`?

- **switchMap**: if a new trigger fires while verification is in-flight, cancel the
  old one and start fresh. This is correct for verification — you always want the
  result for the **latest** value, not a stale one.
- **concatMap**: would queue verifications. Wrong — if the value changed 3 times,
  you don't need results for the first two.
- **exhaustMap**: would drop triggers while busy. Wrong — you'd miss re-verifying
  the latest value.

### Key Design Decision: `verifyFn` returns `NodeInput<VerifyResult>`

Not `Promise<VerifyResult>`. Not `VerifyResult`. `NodeInput<VerifyResult>`.

This means the verifier can be:
- **Sync**: `(v) => { holds: v > 0, evidence: 'positive', ... }` → plain value → `of()`
- **Async**: `(v) => fetchAndCheck(v)` → Promise → `fromPromise()`
- **Streaming**: `(v) => progressiveCheck(v)` → AsyncIterable → `fromAsyncIter()`
- **Reactive**: `(v) => someOtherNode` → Node passthrough

The `fromAny` coercion inside `switchMap`'s project handles all cases. No special
casing. The verifier is just another `NodeInput` — same pattern as `switchMap`'s
project function.

### Usage Examples

```typescript
// 1. Test-based verification with file-change trigger
const issueNode = state({ title: 'batch drain error', status: 'fixed' })
const codeChanged = state<CodeChange>({ files: [], commit: '' })

const { node, verified } = verifiable(
  issueNode,
  (issue) => runTest('src/__tests__/core/protocol.test.ts', 'batch drain'),
  { trigger: codeChanged }
)

// verified is null until codeChanged fires, then holds VerifyResult

// 2. Auto-verify on every source change
const config = state({ maxRetries: 3, timeout: 5000 })
const { verified: configValid } = verifiable(
  config,
  (cfg) => ({
    holds: cfg.maxRetries > 0 && cfg.timeout > 0,
    evidence: 'bounds check',
    confidence: 1,
    checkedAt: Date.now(),
    method: 'manual' as const,
  }),
  { autoVerify: true }
)

// 3. LLM-based parity check
const tsCode = state(readFileSync('src/core/batch.ts', 'utf8'))
const pyCode = state(readFileSync('../graphrefly-py/src/core/batch.py', 'utf8'))

const { verified: parity } = verifiable(
  derived([tsCode, pyCode], (ts, py) => ({ ts, py })),
  ({ ts, py }) => llmCompare(ts, py, 'decision C1 semantics'),
  { trigger: codeChanged, autoVerify: false }
)
```

### Where in the Codebase

`src/extra/verifiable.ts` — same level as `resilience.ts`. It composes `state`,
`switchMap`, `effect`, `fromAny`, `merge`. No new primitives needed.

---

## `distill()` — Detailed Design

### Principle: Abstract the Pattern, Not the LLM

`distill()` is the general pattern for: **watch a stream → extract/transform → store
in a budget-constrained reactive map → evict stale → consolidate → produce a
budgeted view**.

The LLM is just one possible extractor. The pattern works with:
- LLM extraction (structured or unstructured output)
- Rule-based extraction (regex patterns, AST analysis)
- Human curation (manual add/remove)
- Hybrid (LLM proposes, human approves)

The key abstraction: **`extractFn`** and **`consolidateFn`** are `NodeInput`-returning
functions — same pattern as `verifiable`'s `verifyFn`. They can be sync, async,
or reactive. An LLM call is just a Promise. A rule-based extractor is sync. Both
coerce through `fromAny`.

### Signature

```typescript
function distill<TRaw, TMem>(
  source: Node<TRaw>,
  extractFn: (raw: TRaw, existing: Map<string, TMem>) => NodeInput<Extraction<TMem>>,
  opts?: DistillOptions<TMem>,
): DistillBundle<TMem>

interface Extraction<TMem> {
  /** New memories to add/update. */
  upsert: Array<{ key: string; value: TMem }>
  /** Keys to remove (extractor detected duplicates or superseded entries). */
  remove?: string[]
}

interface DistillOptions<TMem> {
  /** Score a memory's relevance given current context. Higher = load first. */
  score: (mem: TMem, context: unknown) => number

  /** Estimate token cost of a memory for budget packing. */
  cost: (mem: TMem) => number

  /** Max total token cost for the compact view. Default: 2000. */
  budget?: number

  /** Predicate: should this memory be evicted? Checked reactively. */
  evict?: (key: string, mem: TMem) => NodeInput<boolean>

  /** Merge N memories into fewer. Optional — no consolidation if absent. */
  consolidate?: (entries: Map<string, TMem>) => NodeInput<Extraction<TMem>>

  /** Trigger consolidation. If absent, consolidation is manual. */
  consolidateTrigger?: NodeInput<unknown>

  /** Context node for relevance scoring. Changes re-rank the compact view. */
  context?: NodeInput<unknown>

  /** Underlying reactiveMap options (TTL, capacity, etc.). */
  mapOptions?: ReactiveMapOptions
}

interface DistillBundle<TMem> {
  /** The memory store. Full access for manual add/remove. */
  store: ReactiveMapBundle<string, TMem>

  /** Budgeted, ranked view. Recomputes when store or context changes. */
  compact: Node<Array<{ key: string; value: TMem; score: number }>>

  /** Number of memories in store. */
  size: Node<number>
}
```

### Why This Shape?

**`extractFn` receives `existing`**: so it can deduplicate. The extractor sees what's
already in the store and can skip known lessons. For LLMs, this means including
existing memories in the prompt. For rule-based extractors, this means checking a
set.

**`score` and `cost` are caller-provided**: the pattern doesn't know what a "token"
is or what "relevance" means for your domain. The tracker factory provides these.
A non-LLM use case (e.g., caching hot config values) would have different score/cost.

**`evict` returns `NodeInput<boolean>`**: eviction can be reactive. For the tracker,
this means "evict when all source issues are verified" — which is a derived node
computation, not a static check. The `NodeInput` return type lets the eviction
condition itself be async or reactive.

**`consolidate` is optional and triggered**: not every use case needs it. When present,
it's triggered by `consolidateTrigger` (could be a timer, a size threshold node,
or a manual signal). Same fully-reactive pattern.

### Internal Wiring

```typescript
function distill<TRaw, TMem>(
  source: Node<TRaw>,
  extractFn: (raw: TRaw, existing: Map<string, TMem>) => NodeInput<Extraction<TMem>>,
  opts: DistillOptions<TMem>,
): DistillBundle<TMem> {
  // 1. Memory store — reactive map with optional TTL/capacity
  const store = reactiveMap<string, TMem>(opts.mapOptions ?? {})

  // 2. Extraction: source emits → extractFn → upsert/remove in store
  //    switchMap: new source emission cancels in-flight extraction
  const extraction = switchMap(source, (raw) => {
    const snapshot = new Map(store.entries())
    return extractFn(raw, snapshot)
  })

  effect([extraction], (result: Extraction<TMem>) => {
    batch(() => {
      for (const { key, value } of result.upsert) {
        store.set(key, value)
      }
      for (const key of result.remove ?? []) {
        store.delete(key)
      }
    })
  })

  // 3. Eviction: if opts.evict provided, watch store changes and evict
  if (opts.evict) {
    effect([store.node], () => {
      for (const [key, mem] of store.entries()) {
        // evict returns NodeInput<boolean> — could be sync or async
        const shouldEvictNode = fromAny(opts.evict!(key, mem))
        // Subscribe temporarily to get the answer
        // (In practice, this would use a more efficient pattern —
        //  perhaps a derived that maps over entries)
        effect([shouldEvictNode], (shouldEvict) => {
          if (shouldEvict) store.delete(key)
        })
      }
    })
  }

  // 4. Consolidation: when trigger fires, run consolidateFn
  if (opts.consolidate && opts.consolidateTrigger) {
    const triggerNode = fromAny(opts.consolidateTrigger)
    const consolidated = switchMap(triggerNode, () => {
      return opts.consolidate!(new Map(store.entries()))
    })
    effect([consolidated], (result: Extraction<TMem>) => {
      batch(() => {
        for (const key of result.remove ?? []) store.delete(key)
        for (const { key, value } of result.upsert) store.set(key, value)
      })
    })
  }

  // 5. Compact view: score × budget packing, context-sensitive
  const contextNode = opts.context ? fromAny(opts.context) : state(null)
  const budget = opts.budget ?? 2000

  const compact = derived([store.node, contextNode], (snapshot, ctx) => {
    const scored: Array<{ key: string; value: TMem; score: number; cost: number }> = []
    for (const [key, value] of Object.entries(snapshot as Record<string, TMem>)) {
      scored.push({
        key,
        value,
        score: opts.score(value, ctx),
        cost: opts.cost(value),
      })
    }
    scored.sort((a, b) => b.score - a.score)

    // Greedy knapsack
    const packed: Array<{ key: string; value: TMem; score: number }> = []
    let remaining = budget
    for (const item of scored) {
      if (item.cost <= remaining) {
        packed.push({ key: item.key, value: item.value, score: item.score })
        remaining -= item.cost
      }
      // Don't break — a cheaper item later might still fit
    }
    return packed
  })

  return { store, compact, size: store.size }
}
```

### The Eviction Problem: `dynamicNode` Might Actually Be Needed Here

The eviction wiring above has a subtle issue. The eviction check for each memory
is itself reactive (e.g., "evict when source issue is verified" depends on a
`meta.verified` node that changes over time). The set of memories is also dynamic
(new ones added, old ones removed).

This means: the **set of nodes being watched for eviction changes at runtime**. This
IS the `dynamicNode` use case — deps discovered during execution, re-tracked on
each recompute.

```typescript
// This is more accurate:
const evictionChecker = dynamicNode((get) => {
  const entries = get(store.node)  // re-track when store changes
  const toEvict: string[] = []
  for (const [key, mem] of Object.entries(entries)) {
    // Each evict() call might return a Node — get() tracks it as a dep
    const evictNode = fromAny(opts.evict!(key, mem as TMem))
    if (get(evictNode)) {
      toEvict.push(key)
    }
  }
  return toEvict
})

effect([evictionChecker], (toEvict) => {
  batch(() => { for (const key of toEvict) store.delete(key) })
})
```

With `dynamicNode`, when the store changes (new memory added), the eviction
checker re-runs and discovers new eviction-condition nodes. When those condition
nodes fire (issue gets verified), the checker re-runs and evicts. No manual
subscription management.

**This is the strongest argument for dynamicNode inside distill() — not inside
verifiable().** Verifiable has static deps. Distill has a dynamic set of memories,
each with its own reactive eviction condition.

### Where in the Roadmap?

`distill()` straddles two phases:

- **The abstract pattern** (reactiveMap + extraction effect + budget packing + eviction):
  this is a **data structure composition** — Phase 3.2 level. It uses `reactiveMap`,
  `switchMap`, `effect`, `derived`, `dynamicNode`. All existing primitives.

- **The LLM-specific extractors/consolidators**: these are **adapters** that produce
  the `extractFn` and `consolidateFn`. They belong with Phase 4.4 (AI surface) because
  they know about prompt engineering, structured output, token estimation.

Proposal:

```
Phase 3.2b — Composite data patterns
  - [ ] distill(source, extractFn, opts) — budget-constrained reactive memory store
  - [ ] verifiable(source, verifyFn, opts) — value + verification companion

Phase 4.4 — AI surface
  - [ ] fromLLM(prompt, opts) — LLM as reactive source
  - [ ] llmExtractor(systemPrompt, opts) → extractFn for distill()
  - [ ] llmConsolidator(systemPrompt, opts) → consolidateFn for distill()
  - [ ] agentMemory() → Graph — composes distill() + tracker-specific scoring/eviction
```

This way `distill()` is a general-purpose primitive (like `reactiveMap` is), and the
LLM-specific pieces layer on top. Someone could use `distill()` with a pure regex
extractor and never touch an LLM.

### LLM-Agnostic Extraction: The System Prompt Concatenation Pattern

Even when using an LLM, the adapter doesn't need structured output. The contract is:

```typescript
type ExtractFn<TRaw, TMem> =
  (raw: TRaw, existing: Map<string, TMem>) => NodeInput<Extraction<TMem>>
```

For an LLM that only returns text:

```typescript
function llmExtractor<TMem>(
  llm: LLMAdapter,
  opts: { systemPrompt: string; parse: (text: string) => Extraction<TMem> }
): ExtractFn<string, TMem> {
  return (raw, existing) => {
    // Concatenate system prompt + existing memories + new input
    const prompt = [
      opts.systemPrompt,
      `\n\nExisting memories (${existing.size}):\n`,
      [...existing.entries()].map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n'),
      `\n\nNew findings:\n${raw}`,
      `\n\nRespond with memories to add/update and keys to remove.`
    ].join('')

    // Returns Promise<Extraction<TMem>> — fromAny coerces to Node
    return llm.call({ system: prompt, input: raw })
      .then(response => opts.parse(response as string))
  }
}
```

The `parse` function handles whatever format the LLM outputs — JSON, markdown,
whatever. The `distill()` pattern doesn't care. It just sees `NodeInput<Extraction<TMem>>`.

For structured-output-capable LLMs, `parse` is trivial (JSON.parse). For others,
it's a regex/heuristic parser. Either way, the distill pattern is the same.

---

## `fromFSWatch()` — File System Watcher as Reactive Source

### The Need

The tracker's regression detection relies on knowing when files change. Currently
the codebase has `fromEvent` (DOM events) and `fromTimer`/`fromCron`, but no file
system watcher.

### Signature

```typescript
function fromFSWatch(
  paths: string | string[],
  opts?: FSWatchOptions,
): Node<FSEvent>

interface FSWatchOptions extends NodeOptions {
  /** Watch recursively. Default: true. */
  recursive?: boolean

  /** Debounce ms — coalesce rapid file saves. Default: 100. */
  debounce?: number

  /** Glob patterns to include. Default: all. */
  include?: string[]

  /** Glob patterns to exclude. Default: ['node_modules', '.git', 'dist']. */
  exclude?: string[]
}

interface FSEvent {
  type: 'change' | 'rename' | 'create' | 'delete'
  path: string
  timestamp: number
}
```

### Internal Shape

```typescript
function fromFSWatch(
  paths: string | string[],
  opts?: FSWatchOptions,
): Node<FSEvent> {
  const pathList = Array.isArray(paths) ? paths : [paths]
  const debounceMs = opts?.debounce ?? 100

  return producer((_deps, actions) => {
    // Use Node.js fs.watch (or chokidar if available)
    const watchers = pathList.map(p =>
      fs.watch(p, { recursive: opts?.recursive ?? true }, (eventType, filename) => {
        if (!filename) return
        if (shouldExclude(filename, opts?.exclude)) return
        if (opts?.include && !shouldInclude(filename, opts.include)) return
        // Debounce is handled by wrapping in the library's own debounce operator
        // OR using an internal setTimeout coalescing here
        actions.emit({
          type: eventType as FSEvent['type'],
          path: path.resolve(p, filename),
          timestamp: Date.now(),
        })
      })
    )

    // Cleanup: close all watchers
    return () => { for (const w of watchers) w.close() }
  }, opts)
}
```

### Design Notes

- **Debounce built-in vs. composable?** Built-in. File watchers are noisy (editors
  write temp files, save triggers multiple events). A 100ms default debounce is
  almost always wanted. The caller can override to 0 if they need raw events, or
  pipe through the library's `debounce()` for finer control.

- **chokidar vs. fs.watch?** Start with `fs.watch` (zero deps). `fs.watch` is
  unreliable on some platforms (Linux recursive, macOS rename events), but good
  enough for the common case. A future `fromChokidar()` adapter can wrap chokidar
  for production use. Or make chokidar an optional peer dep.

- **Node.js only.** This is inherently server-side. Browser equivalent would be
  `fromFileSystemAccess()` wrapping the File System Access API — separate adapter.

- **Cleanup via producer pattern.** The returned cleanup function closes all watchers
  when the node is unsubscribed (lazy connect/disconnect). No leaked watchers.

### Where in Roadmap

Phase 5.2 (Adapters) — alongside `fromHTTP`, `fromWebSocket`, etc. These are all
environment-specific sources that wrap platform APIs.

---

## `fromGitHook()` — Git Hook as Reactive Source

### The Need

More structured than `fromFSWatch`. Instead of "file X changed", you get
"commit abc123 touched files [X, Y, Z] with message M". This is what the tracker's
`signal/code-changed` node should be wired to.

### Signature

```typescript
function fromGitHook(
  repoPath: string,
  opts?: GitHookOptions,
): Node<GitEvent>

interface GitHookOptions extends NodeOptions {
  /** Which hooks to listen for. Default: ['post-commit', 'post-merge']. */
  hooks?: GitHookType[]

  /** Polling fallback interval (ms) if hook installation fails. Default: 5000. */
  pollInterval?: number
}

type GitHookType = 'post-commit' | 'post-merge' | 'post-checkout' | 'post-rewrite'

interface GitEvent {
  hook: GitHookType
  commit: string           // HEAD sha
  files: string[]          // changed files (from git diff)
  message: string          // commit message
  timestamp: number
  author: string
}
```

### Two Strategies

**Strategy A: Hook scripts.** Install actual git hook scripts under `.git/hooks/`
that signal the running process (via IPC, file write, or HTTP). Pros: instant,
event-driven. Cons: modifies `.git/hooks/`, conflicts with existing hooks (husky,
lefthook, etc.).

**Strategy B: Polling.** `fromTimer` + `git log --since=<last-check>` on each tick.
Pros: zero side effects, works with any hook manager. Cons: latency up to
`pollInterval`, shell subprocess overhead.

**Recommendation: Strategy B as default, Strategy A as opt-in.**

```typescript
function fromGitHook(
  repoPath: string,
  opts?: GitHookOptions,
): Node<GitEvent> {
  let lastSeen = ''

  return producer((_deps, actions) => {
    const interval = opts?.pollInterval ?? 5000

    const check = () => {
      const head = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()
      if (head === lastSeen) return

      const files = execSync(
        `git diff --name-only ${lastSeen || 'HEAD~1'}..HEAD`,
        { cwd: repoPath }
      ).toString().trim().split('\n').filter(Boolean)

      const message = execSync(
        'git log -1 --format=%s',
        { cwd: repoPath }
      ).toString().trim()

      const author = execSync(
        'git log -1 --format=%an',
        { cwd: repoPath }
      ).toString().trim()

      lastSeen = head
      actions.emit({
        hook: 'post-commit',  // inferred
        commit: head,
        files,
        message,
        timestamp: Date.now(),
        author,
      })
    }

    // Initial check
    lastSeen = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim()

    const timer = setInterval(check, interval)
    return () => clearInterval(timer)
  }, opts)
}
```

### Design Notes

- **Why not just `fromFSWatch` on `.git/`?** Watching `.git/` is fragile — git writes
  many internal files (index, FETCH_HEAD, etc.) that aren't user-facing changes.
  `fromGitHook` gives structured `GitEvent` objects, not raw file events.

- **Cross-repo.** For the tracker's parity use case, you'd wire two `fromGitHook`
  nodes — one for `graphrefly-ts`, one for `graphrefly-py`. Each feeds into the
  tracker's `signal/code-changed` via `merge()`.

- **Python parity.** Same design, using `subprocess.run(['git', ...])` and
  `threading.Timer` for polling. Or `asyncio` timer with `from_awaitable`.

### Where in Roadmap

Phase 5.2 (Adapters) — alongside `fromFSWatch`. Both are environment-specific sources.

---

## `graph.reachable()` — Transitive Node Reachability

### What Exists Today

`describe()` returns:
- `nodes[path].deps: string[]` — direct upstream dependencies (constructor deps)
- `edges: { from, to }[]` — explicit wires added via `graph.connect()`

There's a private `_graphsReachableViaMounts()` that walks mount hierarchy, but
nothing public that walks **node-level** dependency or edge graphs transitively.

`Graph.diff()` compares two snapshots structurally but doesn't traverse relationships.

### The Gap

"What nodes are transitively affected if `core::batch` changes?" requires:
1. Find `core::batch` in `describe().nodes`
2. Find all nodes where `deps` includes `core::batch` (direct downstreams)
3. Recursively find their downstreams
4. Also follow explicit `edges` in the forward direction

This is a BFS/DFS over the describe output. It's ~15 lines of code. The question
is whether it belongs on `Graph` or as a standalone utility.

### Recommendation: Standalone Utility, Not a Graph Method

```typescript
function reachable(
  described: GraphDescribeOutput,
  from: string,
  direction: 'upstream' | 'downstream',
  opts?: { maxDepth?: number }
): string[]
```

**Why utility, not method:**
- `describe()` already snapshots the topology. `reachable` is a pure function over
  that snapshot — no need for internal access.
- Works with filtered `describe()` output (guard-scoped, filter-scoped).
- Can be used on `Graph.diff()` results, saved snapshots, or cross-graph merges.
- Doesn't add surface area to the Graph class (which is already large).
- Testable in isolation without constructing a graph.

### Implementation

```typescript
function reachable(
  described: GraphDescribeOutput,
  from: string,
  direction: 'upstream' | 'downstream',
  opts?: { maxDepth?: number },
): string[] {
  const maxDepth = opts?.maxDepth ?? Infinity

  // Build adjacency from describe output
  // deps: child depends on parent → parent is upstream of child
  // edges: from → to (explicit wires, same direction as connect())
  const adj = new Map<string, Set<string>>()

  for (const [path, node] of Object.entries(described.nodes)) {
    if (direction === 'upstream') {
      // path's upstream = its deps + edges pointing TO path
      adj.set(path, new Set(node.deps))
    } else {
      // For downstream: invert deps (path is downstream of each dep)
      for (const dep of node.deps) {
        if (!adj.has(dep)) adj.set(dep, new Set())
        adj.get(dep)!.add(path)
      }
    }
  }

  // Add explicit edges
  for (const { from: f, to: t } of described.edges) {
    if (direction === 'downstream') {
      if (!adj.has(f)) adj.set(f, new Set())
      adj.get(f)!.add(t)
    } else {
      if (!adj.has(t)) adj.set(t, new Set())
      adj.get(t)!.add(f)
    }
  }

  // BFS
  const visited = new Set<string>()
  const queue: Array<[string, number]> = [[from, 0]]
  visited.add(from)

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!
    if (depth >= maxDepth) continue
    const neighbors = adj.get(current)
    if (!neighbors) continue
    for (const next of neighbors) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push([next, depth + 1])
      }
    }
  }

  visited.delete(from)  // exclude the starting node
  return [...visited].sort()
}
```

### Is It Worth Adding?

Yes. Three reasons:

1. **The tracker needs it.** "What issues are affected by this code change?" is
   `reachable(describe(), changedNode, 'downstream')`. Core to regression detection.

2. **AI debugging needs it.** "Why did this node recompute?" is
   `reachable(describe(), suspectNode, 'upstream')`. Shows the causal chain.

3. **It's tiny but non-obvious.** Building the inverted adjacency from `deps` + `edges`
   is the tricky part. Users would get it wrong (forget edges, forget to invert deps
   for downstream). Better to provide it.

### Where in Roadmap

Phase 3.3 (Inspector) under "Graph queries (extend `describe`)" — it's a query over
describe output, same family as `Graph.diff()` and `describe({ filter })`.
