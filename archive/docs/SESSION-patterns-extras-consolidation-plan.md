# Session — Patterns & Extras Consolidation Plan

**Date:** 2026-04-27
**Trigger:** Post-audit walk-through consolidation. User directive: "揉碎" (break apart and re-form) the exported API surface to minimize what users must memorize, ensure orthogonality at the building-block level, and clearly separate building blocks from opinionated presets.

**Precedent sessions:**
- `SESSION-ai-harness-module-review.md` (24-unit AI/harness review)
- `SESSION-public-face-blocks-review.md` (memory/guarded-execution/resilient-pipeline/lens review)
- `SESSION-harness-trends-graphrefly-positioning.md` (harness engineering trends + positioning)

---

## Core Principle: Two-Layer Separation

The library's core value is **composability**. An opinionated combination (e.g. `harnessLoop`) must never be presented as THE way to use the library. Users need to see the orthogonal building blocks first, presets second.

```
patterns/<domain>/
  ├── index.ts          ← building blocks (orthogonal primitives, user composes freely)
  └── presets.ts         ← sugar (opinionated combinations, study/use/modify/ignore)
```

**Boundary test:** "If I remove this preset, can users still build the same thing from building blocks?" If yes → preset. If no → building block.

---

## 1. Building Blocks to Promote to extra/

**Principle:** If a function is used by 2+ unrelated pattern domains and has zero domain-specific semantics, it belongs in extra/.

### Promote from patterns/_internal/ → extra/mutation/

| Symbol | Current location | Used by | Rationale |
|--------|-----------------|---------|-----------|
| `lightMutation` | patterns/_internal/imperative-audit.ts | cqrs, job-queue, memory, messaging, orchestration | Generic audited state mutation wrapper |
| `wrapMutation` | patterns/_internal/imperative-audit.ts | cqrs, process, orchestration | Multi-step mutation with rollback |
| `BaseAuditRecord` | patterns/_internal/imperative-audit.ts | cqrs, job-queue, memory, orchestration, process | Generic audit record type |
| `createAuditLog` | patterns/_internal/imperative-audit.ts | cqrs, job-queue, memory, orchestration, process, audit, lens | Audit log factory for any Graph |
| `tryIncrementBounded` | patterns/_internal/index.ts | harness, reduction | Bounded counter utility |

### Promote from patterns/_internal/ → extra/ (top-level helpers)

| Symbol | Current location | Used by | Target |
|--------|-----------------|---------|--------|
| `domainMeta()` | patterns/_internal/index.ts | 11 patterns | extra/meta.ts or fold into extra/index.ts |
| `keepalive()` | patterns/_internal/index.ts | 11 patterns | extra/keepalive.ts (subscription management utility) |

### Promote from patterns/ → extra/

| Symbol | Current location | Used by | Target |
|--------|-----------------|---------|--------|
| `decay()` | patterns/memory/index.ts | memory, harness | extra/utils/decay.ts (pure 12-LOC math function) |
| `budgetGate()` | patterns/reduction/index.ts | resilient-pipeline, harness | extra/resilience/ (numeric constraint gate — alongside retry, breaker, rateLimiter) |

### After promotion, patterns/_internal/ retains only:

- AI-specific: `aiMeta`, `adapterWrapper`, `withLayer`, `stripFences`, `isNodeLike`, `resolveToolHandlerResult`, `contentAddressedCache` (LLM-specific key function)
- Layout-specific: `emitToMeta`
- Tracking: `trackingKey` (harness-only)

---

## 2. extra/ Folder Reorganization

### Current state

41 files flat in one directory + utils/ + worker/. Key problem files:
- `operators.ts` — 2,608 LOC, 48 exported functions
- `sources.ts` — 1,327 LOC
- `adapters.ts` — 4,594 LOC
- `resilience.ts` — 1,071 LOC

### Proposed structure

```
src/extra/
├── index.ts                          — public barrel (re-exports by category)
├── browser.ts                        — browser-only re-exports
├── node.ts                           — node-only re-exports
│
├── operators/                        — Node<T> → Node<T> transforms (from operators.ts 2608 LOC)
│   ├── transform.ts                  — map, filter, scan, reduce, distinctUntilChanged, pairwise
│   ├── take.ts                       — take, skip, takeWhile, takeUntil, first, last, find, elementAt
│   ├── combine.ts                    — combine/combineLatest, withLatestFrom, merge, zip, concat, race
│   ├── higher-order.ts              — switchMap, exhaustMap, concatMap, mergeMap/flatMap
│   ├── time.ts                       — delay, debounce/debounceTime, throttle/throttleTime, sample, audit, interval
│   ├── buffer.ts                     — buffer, bufferCount, bufferTime, window, windowCount, windowTime
│   ├── control.ts                    — valve, rescue/catchError, pausable, repeat, tap, onFirstData/tapFirst, timeout
│   └── index.ts                      — barrel re-export
│
├── sources/                           — external world → Node<T> (from sources.ts 1327 LOC + sources-fs.ts + git-hook.ts)
│   ├── async.ts                       — fromPromise, fromAsyncIter, fromAny, singleFromAny/singleNodeFromAny
│   ├── iter.ts                        — fromIter, of, empty, never
│   ├── event.ts                       — fromEvent, fromTimer, fromRaf, fromCron
│   ├── fs.ts                          — fromFSWatch (node-only)
│   ├── git.ts                         — fromGitHook (node-only)
│   ├── settled.ts                     — awaitSettled, nodeSignal
│   └── index.ts
│
├── resilience/                        — fault tolerance (from resilience.ts 1071 LOC + backoff.ts + adaptive-rate-limiter.ts + budgetGate from reduction)
│   ├── retry.ts                       — retry (source + factory modes)
│   ├── breaker.ts                     — circuitBreaker, CircuitBreaker, withBreaker, CircuitOpenError
│   ├── rate-limiter.ts                — rateLimiter, adaptiveRateLimiter, tokenBucket
│   ├── budget-gate.ts                 — budgetGate (promoted from patterns/reduction)
│   ├── fallback.ts                    — fallback
│   ├── status.ts                      — withStatus, StatusValue
│   ├── backoff.ts                     — constant, linear, exponential, fibonacci, decorrelatedJitter, withMaxAttempts, resolveBackoffPreset, NS_PER_MS, NS_PER_SEC
│   └── index.ts
│
├── data-structures/                   — reactive collections (from reactive-*.ts files)
│   ├── reactive-map.ts                — reactiveMap (+ retention option)
│   ├── reactive-list.ts               — reactiveList
│   ├── reactive-log.ts                — reactiveLog, mergeReactiveLogs
│   ├── reactive-index.ts              — reactiveIndex
│   └── index.ts
│
├── io/                                — network & transport (from adapters.ts 4594 LOC + http-error.ts)
│   ├── http.ts                        — fromHTTP, toHTTP, HTTPBundle, FromHTTPOptions, ToHTTPOptions
│   ├── websocket.ts                   — fromWebSocket, WebSocketLike, WebSocketRegister
│   ├── webhook.ts                     — fromWebhook, WebhookRegister
│   ├── sse.ts                         — toSSE, toSSEBytes, toReadableStream, parseSSEStream, SSEEvent, ToSSEOptions
│   ├── sink.ts                        — reactiveSink (from reactive-sink.ts 746 LOC)
│   ├── http-error.ts                  — makeHttpError
│   └── index.ts
│
├── storage/                           — persistence tiers (from storage-*.ts files)
│   ├── core.ts                        — StorageHandle, stableJsonString, sortJsonValue
│   ├── tiers.ts                       — snapshotStorage, appendLogStorage, kvStorage, memoryBackend, Codec, jsonCodec
│   ├── tiers-node.ts                  — fileBackend, sqliteBackend, fileSnapshot, etc. (node-only)
│   ├── tiers-browser.ts              — indexedDbBackend, fromIDBRequest, fromIDBTransaction (browser-only)
│   ├── content-addressed.ts           — contentAddressedStorage, canonicalJson
│   ├── cascading-cache.ts             — cascadingCache, lru
│   └── index.ts
│
├── composition/                       — graph-level composition helpers
│   ├── composite.ts                   — verifiable, distill
│   ├── external-register.ts           — externalProducer, externalBundle
│   ├── stratify.ts                    — stratify
│   ├── observable.ts                  — toObservable
│   ├── pubsub.ts                      — pubsub (PubSubHub)
│   ├── backpressure.ts                — createWatermarkController
│   └── index.ts
│
├── mutation/                          — audited state mutation (promoted from patterns/_internal)
│   ├── index.ts                       — lightMutation, wrapMutation, BaseAuditRecord, createAuditLog, tryIncrementBounded
│   └── (types co-located)
│
├── meta.ts                            — domainMeta, keepalive (promoted from patterns/_internal)
│
├── worker/                            — (unchanged — already well-structured)
│   ├── bridge.ts, protocol.ts, self.ts, transport.ts, index.ts
│
├── utils/                             — pure utilities
│   ├── ring-buffer.ts                 — RingBuffer
│   ├── sizeof.ts                      — sizeof, SIZEOF_SYMBOL
│   ├── decay.ts                       — decay (promoted from patterns/memory — 12 LOC pure math)
│   └── cron.ts                        — parseCron, matchesCron (from extra/cron.ts)
│
└── timer.ts                           — ResettableTimer (internal, used by retry/debounce/throttle)
```

### Migration summary

| Old file | New location | LOC |
|----------|-------------|-----|
| operators.ts (2,608) | operators/ (7 files) | Same total, ~350-400 each |
| sources.ts (1,327) + sources-fs.ts + git-hook.ts | sources/ (7 files) | Same total |
| adapters.ts (4,594) | io/ (6 files) | Same total |
| resilience.ts (1,071) + backoff.ts + adaptive-rate-limiter.ts | resilience/ (8 files) | + budgetGate |
| reactive-*.ts (5 files, 2,722) | data-structures/ (5 files) | Same |
| storage-*.ts (6 files, 1,237) | storage/ (7 files) | Same |
| composite.ts + external-register.ts + stratify.ts + observable.ts + pubsub.ts + backpressure.ts | composition/ (7 files) | Same |
| patterns/_internal/imperative-audit.ts | mutation/ (1 file) | Promoted |
| patterns/_internal/index.ts (domainMeta, keepalive) | meta.ts | Promoted |

---

## 3. Naming Convention Rules

### Rule 1: Layer prefix convention

| Layer | Convention | Examples |
|-------|-----------|---------|
| extra/ operators | Verb or RxJS-aligned name | `map`, `filter`, `retry`, `timeout` |
| extra/ sources | `from` + source type | `fromTimer`, `fromEvent`, `fromPromise` |
| extra/ sinks | `to` + target type | `toHTTP`, `toSSE`, `toObservable` |
| extra/ data structures | `reactive` + structure | `reactiveMap`, `reactiveList`, `reactiveLog` |
| extra/ resilience | The resilience concept | `retry`, `circuitBreaker`, `rateLimiter`, `fallback`, `budgetGate` |
| patterns/ building blocks | The domain concept | `topic`, `cqrs`, `collection`, `promptNode` |
| patterns/ presets | Compound name = composition | `resilientPipeline`, `agentMemory`, `harnessLoop` |

### Rule 2: Gate-family disambiguation

All "block/allow flow" functions hint at the gating dimension:

| Current | Renamed | Gating dimension |
|---------|---------|-----------------|
| `valve` | `valve` | ✅ boolean switch |
| `gate` (in orchestration) | `approvalGate` | Human judgment (approve/reject/modify) |
| `budgetGate` | `budgetGate` | ✅ numeric constraint |
| `policyEnforcer` | `policyGate` | ABAC rule evaluation |

### Rule 3: Error-handling family

| Current | Renamed | Semantics |
|---------|---------|-----------|
| `rescue` / `catchError` | `rescue` (keep alias `catchError`) | ERROR → DATA value conversion (no re-attempt) |
| `fallback` | `fallback` | ERROR → static/computed replacement (no re-attempt) |
| `retry` | `retry` | Re-attempt the same operation N times |
| (new — needs implementation) | `classifyError` | ERROR → classifier → named output routes |

`classifyError` is the only genuinely new function needed (§"errorRouter" proposal from the harness trends session). Shape: `classifyError(source, classifierFn)` returns `{ routes: Record<string, Node<T>> }`. Internally: `rescue` intercepts ERROR, `classifierFn` categorizes, downstream nodes per route. Lives in `extra/resilience/`.

### Rule 4: Collection family

| Current | Renamed | Rationale |
|---------|---------|-----------|
| `lightCollection` | **delete** — fold into `collection` | `collection({ ranked: false })` is the "light" mode |
| `collection` | `collection` | ✅ keyed reactive store with optional ranking + decay |
| `vectorIndex` | `vectorIndex` | ✅ distinct index type (similarity search) |
| `knowledgeGraph` | `knowledgeGraph` | ✅ distinct index type (entity-relation adjacency) |

### Rule 5: LLM-call family

| Current | Renamed | Rationale |
|---------|---------|-----------|
| `fromLLM` | **delete** — merge into `promptNode` with options | Alias with different defaults; confusing duplication |
| `promptNode` | `promptNode` | ✅ single LLM call → `Node<T>` |
| `streamingPromptNode` | `streamingPromptNode` | ✅ streaming variant |
| `promptCall` | `promptCall` | ✅ returns `(input) => Node<T>` factory (for memory extractors etc.) |

### Rule 6: Scoring/feedback family

| Current | Renamed | Rationale |
|---------|---------|-----------|
| `feedback` | `feedback` | ✅ output → score → signal loop |
| `scorer` | `scorer` | ✅ score + rank |
| `funnel` | `funnel` | ✅ multi-stage filter |
| `effectivenessTracker` | → demote to harness preset | Only consumer is harness strategy model |

### Rule 7: Disambiguation candidates

| Current | Renamed | Why |
|---------|---------|-----|
| `stratify` (extra/) | `stratify` | ✅ clear — route by classification |
| `classify` (orchestration/) | `classify` | ✅ clear — PipelineGraph method, different context |
| No collision — `stratify` is a standalone operator, `classify` is a PipelineGraph method. Both stay. |

---

## 4. Scope Boundaries Per Folder

### Core layer (no changes proposed)

**`src/core/`** — Protocol primitives.
- **Contains:** Message types, `node()`, `batch()`, sugar constructors (state, derived, producer, effect), clock, config, actor/guard.
- **Rule:** Zero imports from extra/ or patterns/. If something in extra/ needs a core concept, the concept should move to core/.
- **Boundary test:** "Is this required to define or run a single node?" If yes → core.

**`src/graph/`** — Graph container.
- **Contains:** Graph class, describe/observe/diff/snapshot/restore, codec, profile, sizeof.
- **Rule:** Imports from core/ only.
- **Boundary test:** "Does this manage a collection of nodes?" If yes → graph.

### Extra layer (reorganized)

**`src/extra/operators/`** — `Node<T> → Node<T>` transforms.
- **Charter:** Pure reactive operators. Every export takes one or more Nodes and returns a Node. No Graph. No domain concepts.
- **What goes in:** Any stateless or internally-stateful transform that doesn't care what data flows through.
- **What doesn't:** Anything that creates nodes from external sources (→ sources/), persists state (→ storage/), or implies a domain (→ patterns/).
- **Naming:** RxJS-aligned where applicable. Verb form.

**`src/extra/sources/`** — External world → `Node<T>`.
- **Charter:** Bridge non-reactive inputs into the reactive graph.
- **What goes in:** `from*` factories that wrap Promises, iterables, timers, DOM events, filesystem events, git hooks.
- **What doesn't:** Network I/O with bidirectional communication (→ io/). Anything that needs Graph (→ composition/).
- **Naming:** `from<Source>` convention. `of`, `empty`, `never` as special cases.

**`src/extra/io/`** — Network & transport.
- **Charter:** Wire protocol adapters for HTTP, WebSocket, SSE, webhooks, sinks.
- **What goes in:** Anything that sends or receives data over a network boundary.
- **What doesn't:** Filesystem (→ sources/fs.ts). In-process pubsub (→ composition/).
- **Naming:** `from<Protocol>` for inbound, `to<Protocol>` for outbound.

**`src/extra/resilience/`** — Fault tolerance.
- **Charter:** Make unreliable operations reliable. All `Node<T> → Node<T>` wrapping.
- **What goes in:** retry, breaker, rate limiter, budget gate, timeout, fallback, backoff strategies, status wrapping, `classifyError`.
- **What doesn't:** Domain-specific error handling (→ patterns/). Human judgment gates (→ patterns/orchestration `approvalGate`).
- **Naming:** The resilience pattern name. No prefix needed.

**`src/extra/data-structures/`** — Reactive collections.
- **Charter:** Graph-backed keyed/ordered/indexed stores with pluggable backends.
- **What goes in:** `reactiveMap`, `reactiveList`, `reactiveLog`, `reactiveIndex`.
- **What doesn't:** Domain-specific stores like `collection` (has ranking + decay → patterns/memory), `vectorIndex` (has similarity search → patterns/memory), `knowledgeGraph` (has adjacency → patterns/memory).
- **Naming:** `reactive<Structure>`.
- **Relationship to patterns/:** Domain stores in patterns/ USE these as their internal substrate.

**`src/extra/storage/`** — Persistence tiers.
- **Charter:** Read/write to durable storage. Backend-pluggable (memory, file, SQLite, IndexedDB).
- **What goes in:** `snapshotStorage`, `appendLogStorage`, `kvStorage`, codecs, content-addressed storage, cascading cache.
- **What doesn't:** Graph-aware persistence (→ Graph.attachStorage). Domain-specific checkpoint logic.
- **Naming:** `<type>Storage` for tier factories. `<backend>Backend` for backend implementations.

**`src/extra/composition/`** — Graph-level composition helpers.
- **Charter:** Things that compose or bridge multiple nodes/graphs but don't fit operators or sources.
- **What goes in:** `verifiable`, `distill`, `stratify`, `externalProducer`, `externalBundle`, `toObservable`, `pubsub`, `backpressure`.
- **What doesn't:** Domain-specific compositions (→ patterns/).
- **Naming:** Descriptive of the composition pattern.

**`src/extra/mutation/`** — Audited state changes.
- **Charter:** Wrap imperative mutations with audit trail, rollback, and bounded constraints.
- **What goes in:** `lightMutation`, `wrapMutation`, `BaseAuditRecord`, `createAuditLog`, `tryIncrementBounded`.
- **What doesn't:** Domain-specific mutation logic (each pattern uses these as infrastructure).
- **Naming:** Mutation-related.

### Patterns layer

**`src/patterns/<domain>/index.ts`** — Building blocks.
- **Charter:** Orthogonal primitives for the domain. Each export is independently useful and composable.
- **What goes in:** Functions that represent a single, well-defined domain concept. Can be used standalone or combined with other blocks.
- **What doesn't:** Multi-block compositions with opinionated defaults → presets.ts.
- **Boundary test:** "Does this function wire together 3+ other building blocks internally?" If yes → preset.

**`src/patterns/<domain>/presets.ts`** — Opinionated compositions.
- **Charter:** Convenient, well-tested compositions of building blocks. Users can study the source to understand how blocks compose, then build their own.
- **What goes in:** Functions that compose multiple building blocks with sensible defaults.
- **What doesn't:** Novel functionality that can't be achieved by composing existing blocks.
- **Naming:** Compound name describing what the composition achieves.

### Building blocks vs presets inventory

**Building blocks (patterns/ index.ts exports):**

| Domain | Building blocks |
|--------|----------------|
| messaging | `topic`, `hub`, `subscription`, `topicBridge`, `jobQueue` |
| orchestration | `pipelineGraph` (includes `approvalGate`, `classify`, `catch` as methods) |
| cqrs | `cqrs` (event store + aggregate + projection), `processManager` (state machine + compensation) |
| reduction | `feedback`, `funnel`, `scorer` |
| memory (in patterns/memory or ai/memory) | `collection`, `vectorIndex`, `knowledgeGraph` |
| ai/prompts | `promptNode`, `streamingPromptNode`, `promptCall`, `gatedStream`, `streamExtractor` |
| ai/agents | `toolRegistry`, `handoff`, `toolSelector`, `chatStream` |
| ai/safety | `contentGate`, `redactor` |
| ai/extractors | `keywordFlagExtractor`, `toolCallExtractor`, `costMeterExtractor` |
| inspect (audit + lens merged) | `explainPath`, `reactiveExplainPath`, `auditTrail`, `policyGate`, `complianceSnapshot` |
| harness (building block subset) | `approvalGate` (from orchestration, re-exported), stage types, bridge factories (`evalSource`, `beforeAfterCompare`, `affectedTaskFilter`) |

**Presets (patterns/ presets.ts exports):**

| Domain | Preset | Composes |
|--------|--------|----------|
| ai | `agentMemory()` | collection + vectorIndex + knowledgeGraph + decay + retrieval + LLM extraction |
| ai | `agentLoop()` | promptNode + toolRegistry + toolExecution + status + multi-turn |
| ai | `resilientPipeline()` | rateLimiter → budgetGate → withBreaker → timeout → retry → fallback |
| harness | `harnessLoop()` | pipelineGraph + hub + approvalGate + jobQueue + feedback + effectivenessTracker |
| harness | `refineLoop()` | hub + promptNode + feedback + scorer |
| inspect | `inspect()` | explainPath + auditTrail + health + flow + why |
| inspect | `guardedExecution()` | policyGate + scopedDescribe |

---

## Open Questions

1. **`jobQueue` stays in messaging/ or gets its own folder?** Currently 557 LOC. Used only by harness. Semantically it's a messaging pattern (FIFO topic + ack). Recommendation: keep in messaging/.
2. **`processManager` stays in cqrs/ or gets its own folder?** Currently 819 LOC. Only imports from cqrs. Recommendation: keep in cqrs/ but consider cqrs+process/ folder name if the merge confuses users.
3. **Should `classifyError` be built now?** It's the only genuinely new function identified. Small scope (~50-100 LOC). Could land in extra/resilience/ as part of the reorganization. Or defer until a real caller surfaces.
4. **`pubsub` (extra/) vs `topic` (patterns/messaging/) overlap?** `pubsub` is a simpler in-process pub/sub without TopicGraph's full Graph machinery. Different abstraction level. Keep both but document when to use which.
5. **`stratify` (extra/) vs hub-based routing (patterns/messaging/)?** `stratify` is a single-node classifier operator. Hub is a full routing infrastructure. Different granularity. Both stay.

## Implementation Sequencing

**Phase 1 — extra/ folder split (mechanical codemod, no behavior change):**
Split operators.ts, sources.ts, adapters.ts, resilience.ts into folder structures. Update all import paths. Verify all tests pass. No renames, no promotions.

**Phase 2 — promotions (behavior-preserving moves):**
Move domainMeta, keepalive, mutation framework, decay, budgetGate to extra/. Update import paths in all consumers. Verify tests pass.

**Phase 3 — renames (breaking but pre-1.0):**
Apply naming convention changes (gate → approvalGate, policyEnforcer → policyGate, delete lightCollection + fromLLM). Update all consumers. Verify tests pass.

**Phase 4 — presets split:**
For each pattern domain, create presets.ts alongside index.ts. Move composite factories to presets.ts. Update import paths.

**Phase 5 — new functions:**
Add `classifyError` to extra/resilience/ if a caller surfaces. Fold `lightCollection` into `collection({ ranked: false })`.

---

## Related Files

- `archive/docs/SESSION-ai-harness-module-review.md` — 24-unit AI/harness audit
- `archive/docs/SESSION-public-face-blocks-review.md` — memory/guarded-execution/resilient-pipeline/lens audit
- `archive/docs/SESSION-harness-trends-graphrefly-positioning.md` — harness engineering trends
- `archive/docs/SESSION-graph-module-24-unit-review.md` — graph module audit
- `archive/docs/SESSION-mid-level-harness-blocks.md` — mid-level blocks design
- `docs/optimizations.md` — active backlog
- `docs/roadmap.md` — phased implementation checklist
- `~/src/graphrefly_github/profile/README.md` — public-facing 6-blocks proposal (needs update per this plan)
