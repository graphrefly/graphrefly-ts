---
SESSION: reactive-issue-tracker-design
DATE: March 30, 2026
TOPIC: Designing a reactive issue tracker / agentic knowledge graph — dogfooding graphrefly-ts to solve its own project management pain
REPO: graphrefly-ts (primary), graphrefly-py (parity scope)
---

## CONTEXT

Maintaining graphrefly-ts involves tracking a combinatorial explosion of concerns:

- **Roadmap items** across 7 phases, many with sub-items and cross-phase dependencies
- **Bugs and findings** from a 16-batch audit (`docs/audit-plan.md`, `docs/batch-review/`)
- **Design invariants** (e.g. "no Promise in public API", "DIRTY before DATA", "batch drain partial-apply") that must hold across code changes
- **RxJS/callbag parity** — do operators match expected semantics from predecessor and RxJS?
- **Cross-repo parity** — do TS and Python implementations agree on behavior per spec decisions?
- **Pitfall relationships** — which bugs relate to which invariants? Which fix might break which semantics?
- **AI context loss** — each new Claude session re-discovers the same findings; humans can't hold the full picture either

No existing tool (Linear, GitHub Issues, Notion) models these as **live, verifiable, interconnected assertions**. They model them as status fields on flat cards.

---

## KEY INSIGHT: Issues Are Live Assertions, Not Status Cards

### The problem with status-based tracking

Marking an issue "done" answers: "did someone work on this?" It does NOT answer:
- Does the invariant still hold after subsequent code changes?
- Does the fix match the spec?
- Does the RxJS counterpart behave the same way?
- Did the Python port get the same fix?
- Did fixing issue A break invariant B?

### The graphrefly model: every issue carries a verifier

An issue is a `state` node whose value includes a `verify()` function — a testable assertion about the codebase. The graph doesn't trust "fixed"; it re-runs the verifier and transitions to "verified" only on evidence.

When code changes (detected via file watcher or git hook), the graph identifies which issues are **affected** (via `affects` metadata mapping files/areas to issues) and re-verifies them. A regression reopens the issue automatically.

---

## DATA MODEL

### Issue node

```typescript
interface Issue {
  title: string
  status: 'open' | 'fixed' | 'verified' | 'deferred' | 'wontfix'
  kind: 'bug' | 'invariant' | 'parity' | 'coverage' | 'semantics' | 'feature'
  severity: 'critical' | 'high' | 'medium' | 'low'
  verify?: () => Promise<VerifyResult>   // the live assertion
  relatedTo: string[]                    // other issue IDs (bidirectional)
  affects: string[]                      // areas/invariants this touches
  blockedBy: string[]                    // must be verified before this can be
  findings: Finding[]                    // append-only log of AI/human findings
}

interface Finding {
  source: 'ai' | 'human' | 'test' | 'lint'
  timestamp: number
  summary: string
  detail: string           // full evidence
  resolution?: 'applied' | 'deferred' | 'rejected'
  relatedCommit?: string
}

interface VerifyResult {
  holds: boolean
  evidence: string
  confidence: number       // 0-1 (1.0 for test-based, lower for LLM-based)
  checkedAt: number
  method: 'test' | 'grep' | 'llm' | 'manual'
}
```

### Issue kinds and their verifiers

| Kind | What it tracks | Typical verifier |
|------|---------------|------------------|
| `bug` | Something broken | Run specific test, check it passes |
| `invariant` | Design rule that must hold globally | Grep codebase for violations + run related tests |
| `parity` | TS ↔ Py or GraphReFly ↔ RxJS agreement | LLM comparison of two code paths, or paired test run |
| `coverage` | Missing test or doc | Check test file for matching describe/it block |
| `semantics` | Operator behavior contract | Run operator test suite, compare output with RxJS spec |
| `feature` | New functionality | Run feature tests, check exports exist |

### Graph topology

```
signal/code-changed ──────────────────────────────────┐
                                                      │
inv/no-promise-api ◄── bug/sqlite-adapter-promise     │
                   ◄── bug/idb-refactor               │
                                                      ▼
parity/mergeMap-concurrent ◄── semantics/rxjs-compat  affected-issues (derived)
                                                      │
parity/py-batch-drain ◄── inv/batch-drain-semantics   │
                                                      ▼
                                               re-verify (effect)
                                                      │
                                                      ▼
                                               summary (derived, LLM)
                                                      │
                                                      ▼
                                               traceLog (annotations)
```

---

## INTERACTION SCENARIOS

### Scenario 1: AI submits findings (partial)

AI runs batch-14 audit, finds "mergeMap lacks concurrent param."

```
1. AI creates issue node:
   graph.add('parity/mergeMap-concurrent', state({
     status: 'open', kind: 'parity',
     verify: () => grepAndTest('operators.ts', 'concurrent', 'mergeMap'),
     affects: ['semantics/rxjs-compat'],
     findings: [{ source: 'ai', summary: 'mergeMap missing concurrent param...' }]
   }))

2. Downstream derived nodes recompute:
   - semantics/rxjs-compat.holds becomes false (a child is open)
   - summary node asks LLM: "new open parity issue, what's the impact?"
   - traceLog records the annotation
```

### Scenario 2: AI submits a fix

AI adds `concurrent` option to mergeMap and marks the issue fixed.

```
1. graph.set('parity/mergeMap-concurrent', { ...issue, status: 'fixed' })

2. Effect triggers: issue.verify() runs
   - Greps operators.ts for 'concurrent' → found
   - Runs test 'mergeMap.*concurrent' → passes
   → status transitions to 'verified'
   → semantics/rxjs-compat recomputes — if all children verified, holds=true

3. If verify() fails:
   → status stays 'open'
   → annotation: "Fix attempted but verification failed: [evidence]"
   → LLM effect: "what might be wrong? related issues?"
```

### Scenario 3: Code change causes regression

Someone edits `src/extra/operators.ts` — git hook fires.

```
1. graph.set('signal/code-changed', { files: ['src/extra/operators.ts'], commit: 'abc123' })

2. affected-issues (derived) recomputes:
   - Scans all issues where affects includes 'operators' or 'extra/*'
   - Returns: ['parity/mergeMap-concurrent', 'semantics/switchMap-teardown', ...]

3. re-verify (effect) runs verify() on each affected issue:
   - mergeMap-concurrent: test still passes → no change
   - switchMap-teardown: test FAILS → status: 'open', annotation: "REGRESSION after abc123"

4. Cascade:
   - inv/operator-semantics.holds becomes false
   - summary recomputes: "Regression in switchMap teardown after commit abc123"
   - Related issues flagged: "switchMap-teardown relatedTo concatMap-teardown — check that too"
```

### Scenario 4: Design invariant check

"Does the no-Promise invariant still hold?"

```
1. inv/no-promise-api is a derived node watching all Promise-related issues:
   derived([sqliteIssue, idbIssue, adapterAuditIssue], (...issues) => ({
     holds: issues.every(i => i.status === 'verified'),
     violations: issues.filter(i => i.status !== 'verified'),
   }))

2. It also has its own verifier:
   verify: () => grepCodebase('Promise<', { exclude: 'node_modules,test' })
   → If grep finds Promise<T> in public API signatures, holds=false
   → Lists exact file:line violations

3. The invariant node doesn't just check issue statuses —
   it independently verifies the codebase, catching violations
   that no one filed an issue for.
```

### Scenario 5: Cross-repo parity check

"Does Python batch drain match TypeScript?"

```
1. parity/py-batch-drain has:
   verify: async () => {
     const ts = readFile('src/core/batch.ts')
     const py = readFile('~/src/graphrefly-py/src/core/batch.py')
     return llm.compare(ts, py, 'decision C1: partial drain semantics')
   }

2. When TS batch.ts changes → code-changed fires → re-verify
3. When Py batch.py changes → separate file watcher → re-verify
4. Drift detected → annotation with specific diff
5. Related issues auto-flagged: "batch drain changed in TS,
   check py-batch-parity and decision-C1-partial-drain"
```

### Scenario 6: "What should I work on next?"

```
1. priority-queue (derived) watches all open issues:
   - Sort by: severity, blocker count, affected invariant count
   - Issues blocking other issues bubble up
   - Issues with failed verification get priority boost

2. next-action (derived, LLM-assisted):
   - Given the priority queue + recent traceLog
   - "You should fix switchMap-teardown first because it blocks
     3 other operator semantics issues and regressed in the last commit"
```

---

## WHAT GRAPHREFLY OFFERS BEYOND LINEAR/NOTION/GITHUB

### 1. Reactive propagation (vs. manual updates)
Linear: you close an issue, then manually check if the parent epic is done.
GraphReFly: closing an issue triggers recomputation of every derived view — invariant checks, summaries, priority queues — automatically.

### 2. Live verification (vs. trust-based status)
GitHub: "status: closed" means someone clicked a button.
GraphReFly: "status: verified" means a verifier function ran and produced evidence. The graph doesn't trust labels.

### 3. Regression detection (vs. stale tickets)
Notion: a "done" ticket stays done forever, even if the code regresses.
GraphReFly: code changes trigger re-verification. Regressions reopen issues automatically with evidence.

### 4. Typed relationships with semantic meaning (vs. flat links)
Linear: "relates to" is a dumb link.
GraphReFly: `affects`, `blockedBy`, `relatedTo` are typed edges that derived nodes reason over. "What invariants break if I change this?" is a graph query, not a human memory exercise.

### 5. AI-native observability (vs. API polling)
GitHub: AI must poll the API, parse JSON, reconstruct context.
GraphReFly: AI subscribes via `observe()`, gets pushed updates, can `annotate()` reasoning, and the `traceLog()` preserves why decisions were made across sessions.

### 6. Computation as first-class (vs. views/filters)
Notion: you can filter a database view by status.
GraphReFly: you can compute "does this invariant hold?" as a derived node that runs actual code (tests, grep, LLM analysis). Views aren't just filters — they're computations.

### 7. Cross-system coherence (vs. tool sprawl)
Typical setup: issues in Linear, tests in CI, docs in Notion, chat in Slack.
GraphReFly: the graph IS the system. Test results, issue status, invariant checks, AI reasoning traces — all nodes in one reactive topology.

---

## MISSING PIECES (LIBRARY GAPS)

See [updated table](#missing-pieces-library-gaps--updated) below Pattern 8 for the full list including memory-related gaps.

---

## PATTERN 8: MEMORY DISTILLATION — THE LEARNING LOOP

### The problem

Findings accumulate (16 audit batches, session logs, scattered annotations). But raw findings are verbose — batch-11 alone is 200+ lines. No human or AI reads all of them before each work session. The non-obvious lessons ("batch drain must not clear the queue during nested throw" — decision A4) get buried alongside obvious ones ("add tests for X").

The fundamental tension: **constantly updating knowledge** vs. **limited attention budget**.

What's needed is a **distillation pipeline** — raw findings flow in, compact memories flow out, and only the memories are loaded into each new session's context.

### Memory taxonomy

Not all knowledge is equal. Different kinds decay at different rates and serve different purposes:

| Memory type | Example | Decay rate | Load priority |
|------------|---------|------------|---------------|
| **Pitfall** | "batch drain must not clear queue during nested throw (decision A4)" | Very slow — until code is rewritten | Always load |
| **Invariant** | "no Promise<T> in public API signatures" | Slow — until explicitly revoked | Always load |
| **Semantic rule** | "switchMap tears down inner before subscribing new; outer COMPLETE waits for active inner" | Slow — until operator rewrite | Load when touching that operator |
| **Parity note** | "TS merge([a,b]) vs Py merge(a,b) — intentional divergence" | Medium — until APIs change | Load when doing cross-repo work |
| **Decision rationale** | "chose partial-drain (decision C1) over fail-fast because orphaned deferrals are worse than partial state" | Slow — context for future debates | Load when someone questions the decision |
| **Stale finding** | "batch-11: missing resetOnTeardown test" — then someone adds the test | **Expires** when issue is verified | Auto-evict |

### The distillation graph

```
                    ┌─────────────────────┐
                    │ raw findings ingest  │ ← AI batches, human notes, test failures
                    │ (reactiveLog)        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ extract (effect+LLM) │ ← "What non-obvious lessons are here?"
                    │                     │   "What's already known? What's new?"
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
          ┌─────────────┐      ┌──────────────┐
          │ memory store │      │ stale filter  │
          │ (reactiveMap │      │ (derived)     │ ← watches issue verification
          │  with TTL)   │      │               │   evicts memories whose source
          └──────┬──────┘      │               │   issue is now verified
                 │              └───────────────┘
                 │
                 ▼
          ┌─────────────┐
          │ compact view │ ← "Give me the 20 most important memories
          │ (derived)    │    that fit in 2000 tokens, ranked by
          │              │    relevance to what I'm about to touch"
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │ session      │ ← This is what gets loaded into each new
          │ context      │    AI session or shown to a human at
          │ (snapshot)   │    start of work
          └─────────────┘
```

### Key mechanisms

#### 1. Extraction: raw findings → compact memories

When a new finding is ingested (AI submits batch results, test fails, human writes a note), an effect triggers:

```typescript
// The extractor watches the raw findings log
effect([findingsLog.tail], async (newFindings) => {
  // Ask LLM: "Given these new findings and the existing memory store,
  // what compact lessons should be saved? What's already known?
  // What's truly new and non-obvious?"
  const extraction = await llm.extract({
    newFindings,
    existingMemories: memoryStore.entries(),
    prompt: `Extract compact, actionable memories. Each memory should be:
      - One sentence for the rule/fact
      - One sentence for WHY (the reasoning or incident)
      - One sentence for WHEN TO APPLY (trigger condition)
      Skip anything already covered by existing memories.
      Skip obvious things that any competent dev would know.
      Focus on things that are SURPRISING or COUNTERINTUITIVE.`
  })

  for (const mem of extraction.memories) {
    memoryStore.set(mem.key, {
      ...mem,
      sourceIssues: mem.sourceIssues,  // link back to issues
      extractedAt: Date.now(),
      confidence: mem.confidence,
    })
  }
})
```

#### 2. Staleness: auto-evict when source issue is verified

A memory like "missing resetOnTeardown test" is only useful while the test is missing. Once someone adds the test and the issue verifies, the memory is stale.

```typescript
// Stale filter: watches memory store + issue verification
const staleFilter = derived([memoryStore.entries, ...allVerifiedNodes],
  (memories, ...verified) => {
    for (const [key, mem] of memories) {
      // If ALL source issues for this memory are verified,
      // the memory has served its purpose
      if (mem.sourceIssues.every(id => isVerified(id))) {
        memoryStore.delete(key)  // or move to archive
      }
    }
  }
)
```

#### 3. Budgeted context: fit within attention limits

The critical constraint: an AI session has ~4000 tokens of "memory budget" at most. A human has maybe 5 minutes of reading patience. You can't load everything.

```typescript
// Compact view: ranked, budgeted, context-aware
const compactView = derived(
  [memoryStore.entries, currentWorkContext],
  (memories, context) => {
    // Score each memory by relevance to current work
    const scored = memories.map(([key, mem]) => ({
      ...mem,
      relevance: scoreRelevance(mem, context),
      // Higher score if:
      //   - memory.type is 'pitfall' or 'invariant' (high-value)
      //   - memory touches files/areas in context.filesTouched
      //   - memory was extracted recently (might be forgotten)
      //   - memory has low confidence (needs human review)
    }))

    // Pack into token budget
    return packIntoBudget(
      scored.sort((a, b) => b.relevance - a.relevance),
      { maxTokens: 2000 }
    )
  }
)
```

#### 4. Consolidation: merge related memories over time

As memories accumulate, related ones should merge rather than duplicate:

```typescript
// Periodic consolidation effect
effect([memoryStore.size], async (size) => {
  if (size > CONSOLIDATION_THRESHOLD) {
    const clusters = await llm.cluster(memoryStore.entries(), {
      prompt: `Group these memories by topic. For each cluster of 3+,
        produce one consolidated memory that captures all the lessons.
        Preserve the WHY and WHEN TO APPLY from each.
        Drop redundancies.`
    })
    for (const cluster of clusters) {
      // Replace N memories with 1 consolidated memory
      for (const old of cluster.sources) memoryStore.delete(old.key)
      memoryStore.set(cluster.key, cluster.consolidated)
    }
  }
})
```

### The attention budget problem — in detail

This is the core design challenge. Three forces in tension:

```
COMPLETENESS ←——→ COMPACTNESS ←——→ FRESHNESS
(don't miss          (fit in            (prioritize
 anything)            2000 tokens)       recent over
                                         stale)
```

**Naive approaches fail:**
- **Load everything:** blows context window, AI ignores most of it
- **Load recent only:** misses old pitfalls that are still relevant
- **Load by type only:** misses cross-type connections (a pitfall related to a parity note)

**The graph approach:**
- Each memory is a node with typed edges to issues, other memories, and code areas
- `compactView` is a derived node that runs a **packing algorithm**: maximize relevance within a token budget
- The packing is **context-sensitive**: what you're about to work on determines what memories load
- Memories that haven't been "hit" (their source area hasn't been touched) in N sessions get demoted
- Memories that prevented a mistake (agent was about to do X, memory said "don't", agent adjusted) get promoted

### Example: a memory lifecycle

```
Day 1: batch-8 audit finds "reactive log bounds check off by one"
  → Finding ingested into findingsLog
  → Extractor produces memory:
    KEY: pitfall/reactive-log-off-by-one
    RULE: reactiveLog slice() is exclusive on end index, unlike Array.slice
    WHY: batch-8 found bounds check mismatch; callbag-recharge had same bug
    WHEN: when using reactiveLog.slice() or implementing log consumers
    SOURCE ISSUES: [bug/reactive-log-bounds]
    CONFIDENCE: 1.0

Day 3: someone fixes the bounds check, test passes, issue verified
  → staleFilter detects: source issue verified
  → BUT the memory is type 'pitfall', not just 'coverage'
  → Decision: KEEP the memory (the lesson "slice is exclusive" is valuable
    even after the fix, because someone might reintroduce it)
  → Downgrade confidence to 0.7 (less urgent, still useful)

Day 14: no one has touched reactiveLog in 11 days
  → relevance score drops due to recency decay
  → memory falls below budget cut in compactView
  → Still in store, just not loaded into session context

Day 30: someone edits reactive-log.ts
  → currentWorkContext includes 'reactive-log'
  → memory relevance spikes back up
  → loaded into session context: "Remember: slice() is exclusive on end"

Day 60: consolidation runs
  → This memory clusters with 2 other reactiveLog memories
  → Consolidated: "reactiveLog pitfalls: (1) slice exclusive end,
    (2) append during iteration copies, (3) TTL eviction is lazy not eager"
```

---

## MISSING PIECES (LIBRARY GAPS) — UPDATED

| Need | Current state | What to build |
|------|--------------|---------------|
| Dynamic issue collection | Manual `graph.add()` per issue | `collection()` factory (Phase 4.3) — add/remove/query pattern |
| Async verify → write back | `effect` + manual `set()` | `verifiable()` pattern — bundles issue state + verify result + auto-re-verify effect |
| File/git watcher as source | Not built | `fromFSWatch()` or `fromGitHook()` producer |
| LLM as verifier/summarizer | Not built | `fromLLM()` adapter (Phase 4.4) — producer that calls an LLM API |
| Transitive dependency query | `describe()` gives edges | `graph.reachable(name, direction)` utility |
| Persistent issue storage | `checkpoint` exists | Wire checkpoint to auto-save on mutation |
| CLI/MCP for agent interaction | Not built | Tool that reads/writes graph nodes from Claude Code sessions |
| Memory extraction from findings | Not built | `distill()` effect — watches findingsLog, calls LLM, writes to memoryStore |
| Budgeted context packing | Not built | `compactView()` derived — rank by relevance × recency, pack into token budget |
| Memory staleness/eviction | `reactiveMap` has TTL | Extend with verification-aware eviction (keep pitfalls even when source issue verified) |
| Memory consolidation | Not built | Periodic `consolidate()` effect — LLM clusters and merges related memories |
| Context-sensitive relevance | Not built | Scoring function: memory relevance to `currentWorkContext` (files, phase, area) |
| Memory promotion/demotion | Not built | Track "memory hit" events — promote memories that prevented mistakes, demote unused |

---

## REJECTED ALTERNATIVES

### "Just use GitHub Issues + CI"
- CI runs ALL tests, not targeted re-verification of specific invariants
- No reactive propagation — closing an issue doesn't recompute anything
- No LLM-in-the-loop for semantic checks (parity, invariant reasoning)
- No cross-repo coherence without custom GitHub Actions

### "Build a custom app on top of Linear API"
- Adds a dependency on Linear's data model (flat issues, basic relations)
- Still status-based, not assertion-based
- Can't embed computation (test runs, grep, LLM calls) in the issue itself

### "Just be more disciplined with markdown files"
- This is what we're doing now. It doesn't scale.
- Each new AI session re-reads everything and still misses connections
- No automatic regression detection

---

## KEY INSIGHTS

1. **The fundamental unit isn't a "ticket" — it's a verifiable assertion.** Every issue should be able to answer "am I still true?" programmatically.

2. **"Fixed" is not "verified."** The graph must distinguish between "someone worked on this" and "evidence confirms the fix holds."

3. **Regression detection is the killer feature.** No existing tool automatically reopens issues when code changes invalidate previous fixes.

4. **The graph eats its own dog food.** Using graphrefly-ts to manage graphrefly-ts development is the strongest possible validation of the library's primitives.

5. **Cross-repo parity is a graph problem.** TS and Python implementations are nodes; spec decisions are invariant nodes; parity is a derived computation over both.

6. **AI memory is just `observe()` + `annotate()`.** The agent subscribes to the graph, gets pushed relevant changes, annotates its reasoning, and the trace persists across sessions.

7. **Raw findings are not memory. Distilled lessons are.** The graph needs a distillation pipeline: ingest → extract → store → evict stale → consolidate → pack into budget. Without this, every session re-reads hundreds of lines and still misses the non-obvious stuff.

8. **The attention budget is the binding constraint.** Completeness, compactness, and freshness are in tension. The graph resolves this by making context packing a derived computation — scored by relevance to current work, packed into a token budget, automatically refreshed as work context changes.

9. **Memories have lifecycles independent of issues.** A pitfall memory ("slice is exclusive on end") outlives the bug that discovered it. A coverage memory ("missing test for X") expires when the test exists. The eviction policy must be type-aware, not just age-based.

---

## FILES

- This file: `archive/docs/SESSION-reactive-issue-tracker-design.md`
- Referenced: `docs/roadmap.md` (Phase 4.3-4.4 gaps), `docs/batch-review/batch-11.md` (example findings), `docs/batch-review/batch-14.md` (parity examples), `docs/optimizations.md` (cross-repo decisions)
