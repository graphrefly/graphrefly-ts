# Roadmap

> **Spec:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` (canonical; not vendored in this repo)
>
> **Guidance:** [docs-guidance.md](docs-guidance.md) (documentation), [test-guidance.md](test-guidance.md) (tests). Agent context: repo root `CLAUDE.md`; skills under `.claude/skills/`.
>
> **Predecessor:** callbag-recharge (170+ modules, 13 categories). Key patterns and lessons
> carried forward — see `archive/docs/DESIGN-ARCHIVE-INDEX.md` for lineage. Clone path for local reference: `~/src/callbag-recharge`.

---

## Phase 0: Foundation

### 0.1 — Project scaffold

- [x] Repository setup: pnpm, tsup, vitest, biome
- [x] Behavioral spec read from `~/src/graphrefly/GRAPHREFLY-SPEC.md` only (no `docs/` copy)
- [x] Folder structure: `src/core/`, `src/extra/`, `src/graph/`
- [x] Package config: `@graphrefly/graphrefly-ts`, ESM + CJS + .d.ts

### 0.2 — Message protocol

- [x] Message type symbols: DATA, DIRTY, RESOLVED, INVALIDATE, PAUSE, RESUME, TEARDOWN, COMPLETE, ERROR
- [x] `Messages` type: `[Type, Data?][]` — always array of tuples
- [x] batch() utility — defers DATA, not DIRTY
- [x] Protocol invariant tests (DIRTY before DATA, RESOLVED semantics, forward unknown types)

### 0.3 — Node primitive

- [x] `node(deps?, fn?, opts?)` — single primitive
- [x] Node interface: `.get()`, `.status`, `.down()`, `.up()`, `.unsubscribe()`
- [x] Output slot: null → single sink → Set (optimization)
- [x] Two-phase push: DIRTY propagation (phase 1), DATA/RESOLVED propagation (phase 2)
- [x] Diamond resolution via bitmask
- [x] `equals` option for RESOLVED check
- [x] Lazy connect/disconnect on subscribe/unsubscribe
- [x] Error handling: fn throws → `[[ERROR, err]]` downstream
- [x] `resubscribable` and `resetOnTeardown` options

### 0.3b — Dynamic node primitive

- [x] `dynamicNode(trackingFn, opts?)` — runtime dep tracking with diamond resolution
- [x] Tracking `get()` proxy: deps discovered during fn execution, re-tracked each recompute
- [x] Dep diffing + rewire: disconnect removed deps, connect new deps, rebuild bitmask
- [x] Re-entrancy guard during rewire (suppress signals from newly-connected deps)
- [x] Full two-phase (DIRTY/RESOLVED) participation across dynamically-tracked deps
- [x] Tests: conditional deps, dep set changes, diamond resolution with dynamic deps, rewire correctness

### 0.4 — Meta (companion stores)

- [x] `meta` option: each key becomes a subscribable node
- [x] Meta nodes participate in describe() output (`metaSnapshot()` + `describeNode()` for per-node JSON; full `graph.describe()` in Phase 1.3)
- [x] Meta nodes independently observable

### 0.5 — Sugar constructors

- [x] `state(initial, opts?)` — no deps, no fn
- [x] `producer(fn, opts?)` — no deps, with fn
- [x] `derived(deps, fn, opts?)` — deps + fn (alias over `node`; spec “operator” pattern is the same primitive)
- [x] `effect(deps, fn)` — deps, fn returns nothing
- [x] `pipe(source, op1, op2)` — linear composition
- [ ] `subscribe(dep, callback)` — omitted in TS: use `node([dep], fn)` or `effect([dep], fn)`; instance `Node.subscribe` covers sink attachment
- [ ] `operator(deps, fn, opts?)` — omitted; use `derived`

### 0.6 — Tests & validation

- [x] Core node tests — `src/__tests__/core/node.test.ts`, `sugar.test.ts`
- [x] Diamond resolution tests — `node.test.ts`
- [x] Lifecycle signal tests — `node.test.ts`, `lifecycle.test.ts` (INVALIDATE cache clear per §1.2; PAUSE / RESUME; `up` fan-out; two-phase ordering)
- [x] Batch tests — `protocol.test.ts`
- [x] Meta companion store tests — `node.test.ts` (`metaSnapshot`, `describeNode`, TEARDOWN to meta)
- [x] Protocol invariant tests — `protocol.test.ts`
- [x] Benchmarks — `pnpm bench` (`src/__bench__/graphrefly.bench.ts`, shapes aligned with callbag-recharge `compare.bench.ts` where APIs match); perf smoke (`perf-smoke.test.ts`, skips timing when `CI`); optional compare vs `~/src/callbag-recharge`

---

## Phase 1: Graph Container

### 1.1 — Graph core

- [x] `Graph(name, opts?)` constructor
- [x] `graph.add(name, node)` / `graph.remove(name)`
- [x] `graph.get(name)` / `graph.set(name, value)` / `graph.node(name)`
- [x] `graph.connect(fromName, toName)` / `graph.disconnect(fromName, toName)`
- [x] Edge validation (no transforms, pure wires)

### 1.2 — Composition

- [x] `graph.mount(name, childGraph)` — subgraph embedding
- [x] Double-colon qualified paths: `"parent::child::node"` (see GRAPHREFLY-SPEC)
- [x] `graph.resolve(path)` — node lookup by qualified path
- [x] Lifecycle signal propagation through mount hierarchy

### 1.3 — Introspection

- [x] `graph.describe()` → JSON (nodes, edges, subgraphs, meta)
- [x] `graph.observe(name?)` → live message stream
- [x] Type inference in describe output (state/derived/producer/operator/effect)
- [x] Meta node registration: `graph.add()` must register `node.meta.*` sub-nodes so `describe()`, `observe()`, and `signal()` reach them (`::__meta__::` paths + `signal`→meta; TEARDOWN cascades from primary only)

### 1.4 — Lifecycle & persistence

- [x] `graph.signal(messages)` — broadcast to all nodes
- [x] `graph.destroy()` — TEARDOWN all
- [x] `graph.snapshot()` / `graph.restore(data)` / `Graph.fromSnapshot(data)`
- [x] `graph.toJSON()` — deterministic serialization

### 1.4b — Seamless persistence

Auto-checkpoint and node factory registry for zero-friction resume of dynamic graphs. Design reference: `archive/docs/SESSION-snapshot-hydration-design.md`

- [x] `graph.autoCheckpoint(adapter, opts?)` — debounced reactive persistence wired to `observe()`; trigger gate uses `messageTier` (`>=2`) for post-settlement/value lifecycle saves; returns disposable handle
- [x] Incremental snapshots — diff-based persistence via `Graph.diff()`, periodic full snapshot compaction
- [x] Selective checkpoint filter — `{ filter: (name, described) => boolean }` to control which nodes trigger saves
- [x] `Graph.registerFactory(pattern, factory)` — register node factory by name glob pattern for `fromSnapshot` reconstruction
- [x] `Graph.unregisterFactory(pattern)` — remove registered factory
- [x] `Graph.fromSnapshot(data)` registry integration — auto-reconstruct dynamic graphs (runtime-added nodes) without `build` callback; topological dep resolution
- [x] `restore(data, { only })` — selective restore (partial hydration by node name pattern)
- [x] Guard reconstruction from data — `policyFromRules()` pattern for rebuilding guard fns from persisted policy rules

### 1.5 — Actor & Guard (access control)

Built-in ABAC at the node level. Replaces external authz libraries (e.g. CASL) — the graph is the single enforcement point.

- [x] `Actor` type: `{ type: "human" | "llm" | "wallet" | "system" | string, id: string, ...claims }`
- [x] Actor context parameter on `down()`, `set()`, `signal()` — optional, defaults to `{ type: "system" }`
- [x] `guard` node option: `(actor: Actor, action: "write" | "signal" | "observe") => boolean` — checked on `down()`/`set()`/`signal()`; throws `GuardDenied` on rejection
- [x] `policy()` declarative builder — CASL-style ergonomics without the dependency:
  ```
  policy((allow, deny) => {
    allow("write",  { where: actor => actor.role === "admin" })
    allow("signal", { where: actor => actor.type === "wallet" })
    allow("observe") // open by default
    deny("write",   { where: actor => actor.type === "llm" })
  })
  ```
- [x] Scoped `describe(actor?)` / `observe(name?, actor?)` — filters output to nodes the actor may observe
- [x] Attribution: each mutation records `{ actor, timestamp }` on the node (accessible via `node.lastMutation`)
- [x] `meta.access` derived from guard when present (backward compat)
- [x] `GuardDenied` error type with `{ actor, node, action }` for diagnostics

### 1.6 — Tests

- [x] Graph add/remove/connect/disconnect
- [x] Mount and namespace resolution
- [x] describe() output validation against JSON schema
- [x] observe() message stream tests
- [x] Snapshot round-trip tests
- [x] Cross-subgraph signal propagation
- [x] Guard enforcement: allowed/denied writes, signals, observe filtering
- [x] Policy builder: allow/deny precedence, wildcard, composed policies
- [x] Actor attribution: mutation records, actor propagation through subgraphs
- [x] Scoped describe: filtered output matches guard permissions
- [x] GuardDenied error: correct actor/node/action in diagnostics

---

## Phase 2: Extra (Operators & Sources)

Port proven operators from callbag-recharge. Each is a function returning a node.

### 2.1 — Tier 1 operators (sync, static deps)

- [x] `map`, `filter`, `scan`, `reduce`
- [x] `take`, `skip`, `takeWhile`, `takeUntil`
- [x] `first`, `last`, `find`, `elementAt`
- [x] `startWith`, `tap`, `distinctUntilChanged`, `pairwise`
- [x] `combine`, `merge`, `withLatestFrom`, `zip`
- [x] `concat`, `race`

### 2.2 — Tier 2 operators (async, dynamic)

- [x] `switchMap`, `concatMap`, `exhaustMap`, `flatMap`
- [x] `debounce`, `throttle`, `sample`, `audit`
- [x] `delay`, `timeout`
- [x] `buffer`, `bufferCount`, `bufferTime`
- [x] `window`, `windowCount`, `windowTime`
- [x] `interval`, `repeat`
- [x] `pausable`, `rescue`

### 2.3 — Sources & sinks

- [x] `fromTimer`, `fromCron`, `fromEvent`, `fromIter`
- [x] `fromPromise`, `fromAsyncIter`, `fromAny`
- [x] `of`, `empty`, `never`, `throwError`
- [x] `forEach`, `toArray`
- [x] `share`, `cached`, `replay`

---

## Phase 3: Resilience & Data

### 3.1 — Utils (resilience)

- [x] `retry`, `backoff` (exponential, linear, fibonacci)
- [x] `withBreaker` (circuit breaker)
- [x] `rateLimiter`, `tokenBucket` / `tokenTracker` (Python parity name)
- [x] `withStatus` (now: sugar for meta companion stores)
- [x] `checkpoint` + adapters (file, SQLite, IndexedDB)

### 3.1b — Reactive output consistency (no Promise in public APIs)

Design invariant: every public function returns `Node<T>`, `Graph`, `void`, or a plain synchronous value — never `Promise<T>`. Predecessor precedent: `~/src/callbag-recharge/src/archive/docs/SESSION-callbag-native-promise-elimination.md`.

- [x] `fromIDBRequest<T>(req)` → `Node<T>` — reactive primitive wrapping `IDBRequest` callbacks via `producer()`
- [x] `fromIDBTransaction(tx)` → `Node<void>` — reactive primitive wrapping `IDBTransaction` completion
- [x] Refactor `saveGraphCheckpointIndexedDb` → returns `Node<void>` (not `Promise<void>`)
- [x] Refactor `restoreGraphCheckpointIndexedDb` → returns `Node<boolean>` (not `Promise<boolean>`)
- [x] Refactor `SqliteCheckpointAdapter` methods → use synchronous returns (`void` / plain value), never `Promise<T>`
- [x] Audit all remaining exports for `Promise<T>` return types — fix any found
- [x] Update checkpoint adapter interface types: synchronous (`save: void`, `load: plain value | null`)
- [x] Callback parameter types accept sync, Promise, Node, AsyncIterable via `fromAny` pattern
- [x] `firstValueFrom` exported for end-users only — not used internally
- [ ] **Python parity:** same treatment in `graphrefly-py` — no `async def` / `Awaitable` / `Future` in public APIs; wrap `asyncio` calls in reactive sources

### 3.2 — Data structures

- [x] `reactiveMap` (KV with TTL, eviction)
- [x] `reactiveLog` (append-only, reactive tail/slice)
- [x] `reactiveIndex` (dual-key sorted index)
- [x] `reactiveList` (positional operations)
- [x] `pubsub` (lazy topic stores)

### 3.2b — Composite data patterns

Higher-order patterns composing Phase 0–3.2 primitives. No new core concepts — these wire `state`, `derived`, `effect`, `switchMap`, `reactiveMap`, `dynamicNode`, and `fromAny` into reusable shapes.

Design reference: `archive/docs/SKETCH-reactive-tracker-factory.md`

- [x] `verifiable(source, verifyFn, opts?)` — value node + verification companion; fully reactive (no imperative trigger). `source: NodeInput<T>`, `verifyFn: (value: T) => NodeInput<VerifyResult>`, trigger via `opts.trigger: NodeInput<unknown>` or `opts.autoVerify`. Uses `switchMap` internally to cancel stale verifications.
- [x] `distill(source, extractFn, opts)` — budget-constrained reactive memory store. Watches source stream, extracts via `extractFn: (raw, existing) => NodeInput<Extraction<TMem>>`, stores in `reactiveMap`, evicts stale entries (reactive eviction via `dynamicNode`), optional consolidation, produces budgeted compact view ranked by caller-provided `score`/`cost` functions. LLM-agnostic — extraction and consolidation functions are pluggable.

### 3.3 — Inspector (graph-native debugging for humans & AI)

Replaces callbag-recharge's standalone `Inspector` class (28 methods, 991 LOC). In GraphReFly the graph IS the introspection layer — these extend `describe()` and `observe()` rather than adding a separate object. Needed before Phase 4: orchestration and agent loops are impractical to debug without causal tracing and structured observation.

**Predecessor reference:** `~/src/callbag-recharge/src/core/inspector.ts`

#### Structured observation (extend `observe`)

- [x] `observe(name, { structured: true })` returns `ObserveResult` object: `{ values, dirtyCount, resolvedCount, events, completedCleanly, errored, dispose }` — options bag on existing `observe()`
- [x] `observe(name, { timeline: true })` — timestamped events with batch context (`{ timestamp_ns, type, data, in_batch }`)
- [x] `observe(name, { causal: true })` — which dep triggered recomputation: `{ trigger_dep_index, trigger_dep_name, dep_values }`
- [x] `observe(name, { derived: true })` — per-evaluation dep snapshots for derived/compute nodes

#### Graph queries (extend `describe`)

- [x] `graph.describe({ filter })` — filtered describe via options bag: `graph.describe({ filter: { status: "errored" } })`, `graph.describe({ filter: (n) => n.type === "state" })`
- [x] `Graph.diff(snapshotA, snapshotB)` — static method, structural + value diff between two snapshots (nodes changed, edges added/removed, values changed)
- [x] `reachable(described, from, direction, opts?)` — standalone utility: BFS over `describe()` output, walks `deps` (inverted for downstream) + explicit `edges` transitively. Returns sorted path list. Supports `maxDepth` limit. Needed for tracker regression detection ("what's affected?") and AI debugging ("why did this recompute?").

#### Reasoning trace (AI agent observability)

- [x] `graph.annotate(name, reason)` — attach a reasoning annotation to a node (why an AI made a decision)
- [x] `graph.traceLog()` — chronological log of all annotations (ring buffer, configurable size)

#### Diagram export

- [x] `graph.toMermaid(opts?)` — Mermaid flowchart (TD/LR/BT/RL directions)
- [x] `graph.toD2(opts?)` — D2 diagram

#### Performance gating

- [x] `Graph.inspectorEnabled` flag — all structured observation, timeline, causal trace, and annotation have zero overhead when disabled (default: enabled outside production)

#### Convenience

- [x] `graph.spy(name?)` — observe + console/logger output (for quick debugging)
- [x] `graph.dumpGraph()` — pretty-print topology with values and statuses (CLI-friendly)

#### RxJS compatibility (AI ergonomics)

- [x] RxJS name aliases: `combineLatest`, `debounceTime`, `throttleTime`, `shareReplay`, `catchError`
- [x] Variadic API for `merge`, `combine`, `zip`, `race` (matches RxJS convention)
- [x] `tap` observer shape: `{ data, error, complete }` (matches RxJS tap)
- [x] `mergeMap` concurrent option: `mergeMap(source, fn, { concurrent: 3 })`
- [x] `docs/coming-from-rxjs.md` migration guide

---

## Phase 4: Domain Layers (Graph Factories)

Each returns a `Graph` — uniform introspection, lifecycle, persistence.

### 4.1 — Orchestration

- [x] `pipeline()` → Graph
- [x] `task()`, `branch()`, `gate()`, `approval()`
- [x] `forEach()`, `join()`, `loop()`, `subPipeline()`
- [x] `sensor()`, `wait()`, `onFailure()`

### 4.2 — Messaging

Pulsar-inspired messaging features for topic retention, cursor consumers, and queue workers.

- [x] `topic()` → Graph
- [x] `subscription()` (cursor-based consumer)
- [x] `jobQueue()` → Graph
- [x] `jobFlow()` → Graph (multi-queue chaining)
- [x] `topicBridge()` (distributed sync)

### 4.3 — Memory

- [x] `collection()` → Graph (reactive node set with eviction)
- [x] `lightCollection()` (FIFO/LRU, no reactive scoring)
- [x] `vectorIndex()` (HNSW)
- [x] `knowledgeGraph()` → Graph
- [x] `decay()` scoring

### 4.4 — AI surface

Design reference: `archive/docs/SESSION-agentic-memory-research.md`

- [x] `chatStream()` → Graph
- [x] `agentLoop()` → Graph
- [x] `fromLLM()` (adapter)
- [x] `toolRegistry()` → Graph
- [x] `systemPromptBuilder()`

#### `agentMemory(name, opts?)` → Graph — distill-first agentic memory

**Shipped:** `distill()` (3.2b) with `store` / `compact` / `size` nodes; optional `llmExtractor` / `llmConsolidator`; optional `admissionFilter`; optional `consolidateTrigger` (caller supplies e.g. `fromTimer` — not wired by default).

**Design targets** (research): `archive/docs/SESSION-agentic-memory-research.md` — 3-tier storage, retrieval pipeline, 3D admission scoring.

- [x] `agentMemory(name, opts?)` → Graph — factory wiring `distill()` + registered `store` / `compact` / `size` nodes
- [x] In-factory composition: `knowledgeGraph()` + `vectorIndex()` + `lightCollection()` + `decay()` + `autoCheckpoint()` — opt-in via `vectorDimensions`/`embedFn`, `enableKnowledgeGraph`/`entityFn`, `tiers` options
- [x] 3D admission filter: `admissionFilter3D({ scoreFn, persistenceThreshold, personalValueThreshold, requireStructured })` — pluggable into `admissionFilter`
- [x] 3-tier storage: permanent (`lightCollection`, `permanentFilter`), active (with `decay()` scoring + `maxActive`), archived (`autoCheckpoint` adapter)
- [x] Default retrieval pipeline: vector search → knowledgeGraph adjacency expansion → decay ranking → budget packing — reactive derived node via `retrieve(query)`
- [x] Default reflection: periodic LLM consolidation via built-in `consolidateTrigger` from `fromTimer(interval)` when `consolidateFn` provided and `reflection.enabled !== false`
- [x] `llmExtractor(systemPrompt, opts)` → `extractFn` for `distill()` — structured JSON extraction; key sampling for dedup
- [x] `llmConsolidator(systemPrompt, opts)` → `consolidateFn` for `distill()` — cluster/merge memories via LLM
- [x] Memory observability: `retrievalTrace` node captures pipeline stages (vectorCandidates, graphExpanded, ranked, packed) per retrieval run

### 4.5 — CQRS

Composition layer over 3.2 (`reactiveLog`), 4.1 (sagas), 4.2 (event bus), 4.3 (projections). Guards (1.5) enforce command/query boundary.

- [x] `cqrs(name, definition)` → Graph — top-level factory
- [x] `command(name, handler)` — write-only node; guard rejects `observe`
- [x] `event(name)` — backed by `reactiveLog`; append-only, immutable
- [x] `projection(events, reducer)` — read-only derived node; guard rejects `write`
- [x] `saga(events, handler)` — event-driven side effects
- [x] `eventStore` adapter interface — pluggable persistence (in-memory default)
- [x] Projection rebuilding: replay events to reconstruct read models
- [x] `describe()` output distinguishes command / event / projection / saga node roles

---

## Phase 5: Framework & Distribution

### 5.1 — Framework bindings

- [x] React: `useStore`, `useSubscribe`, `useSubscribeRecord`
- [x] Vue: `useStore`, `useSubscribe`, `useSubscribeRecord`
- [x] Svelte: `useSubscribe`, `useSubscribeRecord`
- [x] Solid: `useSubscribe`, `useSubscribeRecord`

### 5.1b — State-management compat layers

Thin wrappers that let users keep familiar APIs while backed by GraphReFly primitives.

- [x] Jotai: `atom` (primitive, derived, writable-derived)
- [x] Zustand: `create` (set/get contract)
- [x] Nanostores: `atom`, `computed`, `map`
- [x] TC39 Signals: `Signal.State`, `Signal.Computed`, `Signal.sub` backed by core

### 5.2 — Adapters

- [x] `fromHTTP`, `fromWebSocket`/`toWebSocket`
- [x] `fromWebhook`, `toSSE`
- [x] `fromMCP` (Model Context Protocol)
- [x] `fromFSWatch(paths, opts?)` — file system watcher as reactive source; debounced, glob include/exclude, recursive. Uses `fs.watch` (zero deps). Cleanup closes watchers on unsubscribe.
- [x] `fromGitHook(repoPath, opts?)` — git change detection as reactive source; emits structured `GitEvent` (commit, files, message, author). Default: polling via `git log --since`; opt-in hook script installation. Cross-repo via `merge([fromGitHook(tsRepo), fromGitHook(pyRepo)])`.

### 5.2b — ORM / database adapters

Reactive bindings that keep graph nodes in sync with database queries.

- [ ] Prisma: `fromPrisma` (live query → node)
- [ ] Drizzle: `fromDrizzle` (live query → node)
- [ ] Kysely: `fromKysely` (type-safe query → node)

### 5.2c — Ingest adapters (universal source layer)

Connectors for the universal reduction layer (Phase 8). Each wraps an external protocol/system as a reactive `producer` node.

- [ ] `fromOTel(opts?)` — OTLP/HTTP receiver; accepts traces, metrics, logs as nodes
- [ ] `fromSyslog(opts?)` — RFC 5424 syslog receiver (UDP/TCP)
- [ ] `fromStatsD(opts?)` — StatsD/DogStatsD UDP receiver
- [ ] `fromPrometheus(endpoint, opts?)` — scrape Prometheus /metrics as reactive source
- [ ] `fromKafka(topic, opts?)` / `toKafka(topic, opts?)` — Kafka consumer/producer
- [ ] `fromRedisStream(key, opts?)` / `toRedisStream(key, opts?)` — Redis Streams
- [ ] `fromCSV(path, opts?)` / `fromNDJSON(stream)` — file/stream ingest for batch replay
- [ ] `fromClickHouseWatch(query, opts?)` — live materialized view as reactive source

### 5.2d — Storage & sink adapters

- [ ] `toClickHouse(table, opts?)` — buffered batch insert sink
- [ ] `toS3(bucket, opts?)` — object storage sink (Parquet/NDJSON, partitioned)
- [ ] `toPostgres(table, opts?)` / `toMongo(collection, opts?)` — document/relational sink
- [ ] `toLoki(opts?)` / `toTempo(opts?)` — Grafana stack sinks
- [ ] `checkpointToS3(bucket, opts?)` — graph snapshot persistence to object storage
- [ ] `checkpointToRedis(prefix, opts?)` — fast checkpoint for ephemeral infra

### 5.3 — Worker bridge

- [x] `workerBridge()` / `workerSelf()`
- [x] Transport abstraction (Worker, SharedWorker, ServiceWorker, BroadcastChannel)

### 5.4 — LLM tool integration

- [x] `knobsAsTools(graph, actor?)` → OpenAI/MCP tool schemas from scoped describe()
- [x] `gaugesAsContext(graph, actor?)` → formatted gauge values for system prompts
- [x] Graph builder validation (validate LLM-generated graph defs)
- [x] `graphFromSpec(naturalLanguage, adapter, opts?)` → LLM composes a Graph from natural language; validates topology; returns runnable graph
- [x] `suggestStrategy(graph, problem, adapter)` → LLM analyzes current graph + problem, suggests operator/topology changes

### 5.5 — NestJS integration

Full integration replacing `@nestjs/event-emitter`, `@nestjs/schedule`, and `@nestjs/cqrs` with a single reactive graph.

#### Module & DI

- [x] `GraphReflyModule.forRoot(opts?)` — root `Graph` singleton in NestJS DI container
- [x] `GraphReflyModule.forFeature(opts)` — feature subgraph, auto-mounted into root (`root::featureName::*`)
- [x] `@InjectGraph(name?)` / `@InjectNode(path)` — decorators for DI into services/controllers
- [x] RxJS bridge: `toObservable(node)`, `toMessages$(node)`, `observeNode$(graph, path)`, `observeGraph$(graph)` — reactive all the way

#### Lifecycle

- [x] Module init → `graph.restore(snapshot)` (optional hydration via `forRoot({ snapshot })`)
- [x] Module destroy → `graph.destroy()` (TEARDOWN propagation)
- [x] REQUEST / TRANSIENT scope → `requestScope: true` option, `@InjectGraph("request")` for per-request graph

#### Actor bridge

- [ ] NestJS `@Guard()` / `ExecutionContext` → GraphReFly `Actor` mapping
- [ ] `@GraphReflyGuard()` — decorator that extracts JWT/session → Actor, passes to graph guards (1.5)

#### EventEmitter replacement

- [x] `@OnGraphEvent(nodeName)` — decorator equivalent of `@OnEvent()`, backed by `graph.observe()` with DATA filtering
- [x] `graph.set()` / `graph.signal()` replaces `eventEmitter.emit()` — events become inspectable nodes

#### Schedule replacement

- [x] `@GraphInterval(ms)` / `@GraphCron(expr)` — decorators backed by `fromTimer()` / `fromCron()` nodes
- [x] Scheduled work visible in `graph.describe()`, pausable via PAUSE/RESUME signals

#### CQRS replacement

- [ ] Integrates with 4.5 CQRS graph factory — `cqrs()` graphs register as feature modules
- [ ] `@CommandHandler` / `@EventHandler` / `@QueryHandler` decorator equivalents backed by graph nodes
- [ ] Sagas as subgraphs (replaces RxJS saga streams)

#### Gateway helpers

- [ ] `observe()` → WebSocket gateway (real-time node streams to clients)
- [ ] `observe()` → SSE controller
- [ ] `observe()` → GraphQL subscription resolver

#### Example: full-stack NestJS + GraphReFly

- [ ] Reference app demonstrating all integration points: module registration, Actor/guard from JWT, CQRS order flow (command → event → projection → saga), scheduled jobs as graph nodes, WebSocket observe, `graph.describe()` admin endpoint

---

## Phase 6: Node Versioning

Design reference: `archive/docs/SESSION-serialization-memory-footprint.md`, `~/src/callbag-recharge/src/archive/docs/SESSION-universal-data-structure-research.md`.

### 6.0 — V0: id + version (done)

Promoted from original Phase 6 placement. V0 is the minimum enabler for delta checkpoints, wire-efficient sync, LLM-friendly diffing, and dormant subgraph eviction. Effectively free (~16 bytes/node, counter bump on DATA).

- [x] Wire `createVersioning(0, ...)` into `node()` when `opts.versioning` provided
- [x] `advanceVersion()` call on every DATA emission (value changed)
- [x] `describeNode()` includes `{ id, version }` when V0 active
- [x] `graph.snapshot()` includes per-node `{ id, version }` — enables delta restore
- [x] `Graph.diff()` uses version counters to skip unchanged nodes — O(changes) not O(graph_size)
- [x] `graph.setVersioning(level)` — set default versioning level for all new nodes in this graph

#### 6.0b — V0 backfill (post-implementation)

Backfill V0 integration into already-shipped phases. Each item enables version-aware behavior in existing code.

- [x] **Phase 1.4b** (autoCheckpoint / incremental snapshots): use V0 version counters for true delta checkpoints — only serialize nodes with `version > lastCheckpointVersion`. Currently `Graph.diff()` compares two full snapshots; V0 makes this O(changes).
- [x] **Phase 3.2** (data structures): `reactiveMap`, `reactiveLog`, `reactiveIndex`, `reactiveList` entries carry V0 identity. Enables diff-friendly observation of collection changes ("which entries changed?") and dedup across snapshots.
- [x] **Phase 3.2b** (verifiable / distill): `verifiable()` verification results carry V0 for "which version was verified?" tracking. `distill()` memory entries carry V0 for dedup and consolidation identity.
- [x] **Phase 3.3** (Inspector): `Graph.diff()` upgrade to version-gated O(changes) diffing. `observe({ causal: true })` includes triggering node's version. `describe()` output includes V0 fields when active.
- [x] **Phase 4.2** (Messaging): `topic()` messages, `subscription()` cursors, and `jobQueue()` jobs carry V0 identity. Enables exactly-once delivery via version dedup and cursor-by-version.
- [x] **Phase 4.3** (Memory): `collection()` and `lightCollection()` entries carry V0 for identity-based dedup and version-aware eviction. `knowledgeGraph()` entity/relation identity.
- [x] **Phase 4.4** (AI surface): `agentMemory()` memory entries carry V0. LLM context can send delta — "nodes with version > lastSeen" — instead of full `describe()`, saving context window tokens. `chatStream()` message identity.
- [x] **Phase 4.5** (CQRS): events carry V0 identity (required for replay dedup). Projections track version for rebuild skip ("already at version N"). Commands carry version for optimistic concurrency.
- [x] **Phase 5.3** (workerBridge): wire sync uses version counters — only transfer nodes with `version > peerLastSeen`. Enables delta-based cross-worker sync instead of full snapshot transfer.
- [x] **Phase 5.4** (LLM tool integration): `gaugesAsContext()` sends only changed nodes (by version) to LLM system prompts. `knobsAsTools()` includes version for conflict detection. **Appendix B** (`describe()` JSON schema): add optional `v` when versioning is in use (same tranche as 6.0b tooling).

### 6.1 — V1: + cid + prev (content addressing, linked history)

Opt-in, real compute cost (~1μs SHA-256 per value change). Lazy CID computation (on access, not on set). DAG-CBOR deterministic encoding needed for CID.

- [x] V1: + cid + prev (content addressing, linked history)
- [ ] Lazy CID computation — `node.cid` computed on first access after value change, not on every DATA

> **Where V1 adds value in earlier phases:**
> - *Phase 1.4b* (autoCheckpoint): content-addressed snapshots — hash-compare for dedup without content diff; snapshot integrity verification
> - *Phase 4.5* (CQRS): events are content-addressed — tamper-evident event log; replay integrity
> - *Phase 5.2d* (storage sinks): content-addressed dedup in `toS3`, `toClickHouse` — don't write identical data twice
> - *Phase 8.3* (GraphSpec): spec diffing via CID — structural comparison without serializing both specs
> - *Phase 8.4* (audit/compliance): integrity chain — `complianceSnapshot` with CID proves unmodified; `explainPath` can verify each node's derivation

### 6.2 — V2: + schema (type validation)

- [ ] V2: + schema (type validation at node boundaries)

> **Where V2 adds value:**
> - *Phase 5.2c/d* (ingest/sink adapters): schema validation on system boundaries — reject malformed OTel spans, validate Kafka message shape before graph entry
> - *Phase 8.2* (domain templates): typed domain nodes — `observabilityGraph` enforces span/metric/log schemas
> - *Phase 8.3* (LLM graph composition): validate LLM-generated node configs against declared schemas before `compileSpec()`

### 6.3 — V3: + caps + refs (serialized capabilities, cross-graph references)

Runtime enforcement already in Phase 1.5; V3 adds the serialization/transport format.

- [ ] V3: + caps (serialized guard policy) + refs (cross-graph references)

> **Where V3 adds value:**
> - *Phase 1.5* (Actor/Guard): serialized guard policy enables persist/restore of access rules; currently guards are runtime functions only
> - *Phase 5.4* (LLM tool integration): capability tokens control what an LLM agent can access across sessions
> - *Phase 5.5* (NestJS): JWT → Actor → caps serialization for cross-request guard continuity
> - *Phase 8.4* (audit/compliance): capability chain in `auditTrail` — who had what permissions when
> - *Phase 8.5* (peerGraph): cross-graph `refs` enable node references across process/network boundaries without copying data

- [ ] ~~Attribution~~ → Phase 1.5 (`node.lastMutation`)

---

## Phase 7: Polish & Launch

- [ ] README with "graph + re + fly" tagline
- [x] `llms.txt` for AI agent discovery (`llms.txt`, `website/public/llms.txt`)
- [ ] npm publish: `@graphrefly/graphrefly-ts`
- [ ] Docs site
- [ ] Community launch (HN, Reddit, dev.to)

### 7.1 — Reactive layout engine (Pretext-on-GraphReFly)

Reactive text measurement and layout without DOM thrashing. Inspired by [Pretext](https://github.com/chenglou/pretext) but rebuilt as a GraphReFly graph — the layout is inspectable (`describe()`), snapshotable, and debuggable. Standalone reusable pattern; powers the three-pane demo shell (7.2). Python port: `graphrefly-py` roadmap §7.1 (same graph shape and algorithms; default measurement is Pillow/server-side). Design reference: `docs/demo-and-test-strategy.md` §2b.

Two-tier DX: out-of-the-box `reactiveLayout({ adapter, text?, font?, lineHeight?, maxWidth?, name? })` for common cases; advanced `MeasurementAdapter` interface for custom content types and environments.

#### Text layout (Pretext parity)

- [x] `MeasurementAdapter` interface: `measureSegment(text, font) → { width }`, optional `clearCache()` — pluggable measurement backend; tests use deterministic mock adapters
- [x] `state("text")` → `derived("segments")` — text segmentation (words, glyphs, emoji via `Intl.Segmenter` word granularity); adapter `measureSegment()` for segment widths, cached per `Map<font, Map<segment, width>>` — **Py port:** Unicode `\w` word-token segmentation + grapheme merge (pipeline parity; not byte-identical boundaries)
- [x] Text analysis pipeline (ported from Pretext): whitespace normalization, word segmentation, punctuation merging, CJK per-grapheme splitting, URL/numeric run merging, soft-hyphen/hard-break support
- [x] `derived("line-breaks")` — segments + max-width → greedy line breaking (no DOM): trailing-space hang, `overflow-wrap: break-word` via grapheme widths, soft hyphens, hard breaks
- [x] `derived("height")`, `derived("char-positions")` — total height, per-character `{ x, y, width, height }` for hit testing
- [x] Measurement cache with RESOLVED optimization — unchanged text/font → no re-measure
- [x] `meta: { cache-hit-rate, segment-count, layout-time-ns }` for observability
- [x] `reactiveLayout({ adapter, text?, font?, lineHeight?, maxWidth?, name? })` → `ReactiveLayoutBundle` — convenience factory

#### MeasurementAdapter implementations (pluggable backends)

- [x] `CanvasMeasureAdapter` (default, browser) — OffscreenCanvas `measureText()`, emoji correction option (Chrome/Firefox canvas inflation vs DOM)
- [x] `NodeCanvasMeasureAdapter` (Node/CLI) — injected canvas module (`@napi-rs/canvas` or `skia-canvas`) via DI, no async auto-detection
- [x] `PrecomputedAdapter` (server/snapshot) — reads from pre-computed metrics JSON, zero measurement at runtime; per-char fallback or strict error mode
- [x] `CliMeasureAdapter` (terminal) — monospace cell counting (CJK/fullwidth = 2 cells), configurable `cellPx`, no external deps

#### Multi-content blocks (SVG, images, mixed)

- [x] `reactiveBlockLayout({ adapters, blocks?, maxWidth?, gap?, name?, defaultFont?, defaultLineHeight? })` — mixed content layout: text + image + SVG blocks with per-type measurement (**Py:** `reactive_block_layout(adapters, *, blocks=..., max_width=..., gap=...)`)
- [x] `SvgBoundsAdapter` — viewBox/width/height parsing from SVG string (pure regex, no DOM); browser users pre-measure via `getBBox()`
- [x] `ImageSizeAdapter` — pre-registered dimensions by src key (sync lookup); browser users pre-measure via `Image.onload`
- [x] Block flow algorithm: vertical stacking with configurable gap, purely arithmetic over child sizes

#### Standalone extraction

- [x] Extractable as standalone pattern (`reactive-layout`) independent of demo shell — moved to `src/patterns/reactive-layout/`, subpath export `@graphrefly/graphrefly-ts/reactive-layout`

### 7.2 — Three-pane demo shell (built with GraphReFly)

The demo shell is itself a `Graph("demo-shell")` — dogfooding reactive coordination for the main/side split layout with synchronized cross-highlighting. Design reference: `docs/demo-and-test-strategy.md`.

- [ ] Layout: `state("pane/main-ratio")`, `state("pane/side-split")`, `state("pane/fullscreen")`, `state("viewport/width")` → derived pane widths
- [ ] Layout engine integration: `derived("layout/graph-labels")` for node sizing, `derived("layout/code-lines")` for virtual scroll, `derived("layout/side-width-hint")` for adaptive side pane width
- [ ] Cross-highlighting: `state("hover/target")` → derived scroll/highlight/selector → effects (code scroll, visual highlight, graph highlight)
- [ ] `derived("graph/mermaid")` from demo graph `describe()` → `effect("graph/mermaid-render")`
- [ ] Inspect panel: `state("inspect/selected-node")` → `derived("inspect/node-detail")` via `describeNode()` + `observe({ structured: true })`
- [ ] `derived("inspect/trace-log")` — formatted `traceLog()` from demo graph
- [ ] Full-screen toggle per pane; draggable main/side ratio and graph/code split
- [ ] Meta debug toggle: shell's own `toMermaid()` renders recursively (GraphReFly graph visualizing another GraphReFly graph)
- [ ] Zero framework dependency in shell graph logic; framework bindings wrap pane components only

### 7.3 — Showcase demos

Each demo uses the three-pane shell (7.2) and exercises 3+ domain layers. Detailed ACs in `docs/demo-and-test-strategy.md`.

- [ ] **Demo 1: Order Processing Pipeline** — 4.1 + 4.2 + 4.5 + 1.5 + 3.3 (vanilla JS, 10 ACs)
- [ ] **Demo 2: Multi-Agent Task Board** — 4.1 + 4.3 + 4.4 + 3.2b + 1.5 (React, WebLLM, 11 ACs)
- [ ] **Demo 3: Real-Time Monitoring Dashboard** — 4.1 + 4.2 + 4.3 + 3.1 + 3.2 (Vue, 12 ACs)
- [ ] **Demo 4: AI Documentation Assistant** — 4.3 + 4.4 + 3.2b + 3.2 + 3.1 (Preact, WebLLM, 12 ACs)

### 7.3b — Universal reduction demos

Demos exercising the Phase 8 reduction layer patterns. Design reference: `archive/docs/SESSION-universal-reduction-layer.md`.

- [ ] **Demo 5: Observability Pipeline** — 5.2c + 8.1 + 8.4 + 3.2b (fromOTel → stratify errors/traces/metrics → LLM correlation → SLO verifiable → Grafana sink). Shows "OTel Collector replacement" story.
- [ ] **Demo 6: AI Agent Observatory** — 4.4 + 8.1 + 8.4 + 3.3 (instrument agentLoop with full token/latency/decision tracing → LLM distills "why agent went off-track"). Shows LLM-observing-LLM story.
- [ ] **Demo 7: Log Reduction Pipeline** — 5.2c + 8.1 + 8.2 (fromSyslog 10K lines/sec → 4-layer reduction: dedup → classify → summarize → score → human gets 5 prioritized items/minute). Shows "massive → actionable" story.

### 7.4 — Scenario tests (headless demo logic)

Each demo has a headless scenario test that mirrors its AC list — no DOM, no WebLLM (stubbed).

- [ ] `src/__tests__/scenarios/order-pipeline.test.ts`
- [ ] `src/__tests__/scenarios/agent-task-board.test.ts`
- [ ] `src/__tests__/scenarios/monitoring-dashboard.test.ts`
- [ ] `src/__tests__/scenarios/docs-assistant.test.ts`

### 7.5 — Inspection stress & adversarial tests

- [ ] `describe()` consistency during batch drain
- [ ] `observe({ structured/causal/timeline: true })` correctness under concurrent updates
- [ ] `Graph.diff()` performance on 500-node graphs (<10ms)
- [ ] `toMermaid()` output validity (parseable by mermaid-js)
- [ ] `traceLog()` ring buffer wrap correctness
- [ ] Cross-factory composition: mounted subgraphs don't interfere
- [ ] Guard bypass attempts (`.down()` without actor)
- [ ] `snapshot()` during batch drain (consistent, never partial)
- [ ] `subscription()` added mid-drain (correct offset)
- [ ] `collection()` eviction during derived read (no stale refs)

### 7.6 — Foreseen building blocks (to be exposed by demos)

Items expected to emerge during demo implementation. Validate need, then add to the appropriate phase.

- [ ] **Reactive cursor** (shared by `subscription()` + `jobQueue()`) — cursor advancing through `reactiveLog`; likely 3.2 primitive or helper
- [x] **Streaming node convention** — `fromLLMStream(adapter, messages)` returns `Node<ReactiveLogSnapshot<string>>` using option (a) `reactiveLog` internally; `LLMAdapter` extended with required `stream()` method
- [ ] **Factory composition helper** — shared pattern/utility for 4.x graph factory boilerplate (create Graph, add nodes, wire edges, set meta)
- [ ] **Cross-island state bridge** — shared graph state across Astro islands; options: (a) global graph + subgraph subscribe, (b) `observe()` → custom events, (c) SharedWorker
- [ ] **Guard-aware describe for UI** — `describe({ showDenied: true })` variant showing hidden nodes with `{ denied: true, reason }` for "what can this actor do?" display
- [ ] **Mock LLM fixture system** — `mockLLM(responses[])` adapter for `fromLLM()` that replays deterministic canned responses with optional streaming delay
- [ ] **Time simulation** — `monotonicNs()` test-mode override for `vi.useFakeTimers()` integration with `fromTimer`/`fromCron`/`wait`

---

## Phase 8: Universal Reduction Layer (Info → Action)

Reusable patterns for taking heterogeneous massive inputs and producing prioritized, auditable, human-actionable output. Every pattern is a Graph factory — uniform introspection, lifecycle, persistence. Design reference: `archive/docs/SESSION-universal-reduction-layer.md`.

### 8.1 — Reduction primitives

Composable building blocks between sources and sinks.

- [ ] `stratify(source, rules)` → Graph — route input to different reduction branches based on classifier fn. Each branch gets independent operator chains (4 layers on branch A, 1 on branch B). Rules are reactive — an LLM can rewrite them at runtime.
- [ ] `funnel(sources[], stages[])` → Graph — multi-source merge with sequential reduction stages. Each stage is a named subgraph (dedup → enrich → score → pack). Stages are pluggable — swap a stage by graph composition.
- [ ] `feedback(graph, condition, reentry)` → Graph — introduce a cycle: when condition node fires, route output back to reentry point. Bounded by configurable max iterations + budget constraints.
- [ ] `budgetGate(source, constraints)` → Node — pass-through that respects reactive constraint nodes (token budget, network IO, cost ceiling). Backpressure via PAUSE/RESUME when budget exhausted.
- [ ] `scorer(sources[], weights)` → Node — reactive multi-signal scoring. Weights are nodes (LLM or human can adjust live). Output: sorted, prioritized items with full score breakdown in meta.

### 8.2 — Domain templates (opinionated Graph factories)

Pre-wired graphs for common "info → action" domains. Each is a working vertical that demonstrates the reduction layer patterns. Users fork/extend.

- [ ] `observabilityGraph(opts)` → Graph — OTel ingest → stratified reduction → correlation engine → SLO verification → alert prioritization → dashboard sink. Exercises: fromOTel, stratify, scorer, verifiable, feedback.
- [ ] `issueTrackerGraph(opts)` → Graph — findings ingest → extraction → verifiable assertions → regression detection → memory distillation → prioritized queue. Exercises: fromGitHook, fromFSWatch, verifiable, distill, feedback.
- [ ] `contentModerationGraph(opts)` → Graph — multimedia/text ingest → LLM classification → human review queue → feedback on false positives → policy refinement. Exercises: stratify, agentLoop, feedback, scorer.
- [ ] `dataQualityGraph(opts)` → Graph — database/API ingest → schema validation → anomaly detection → drift alerting → auto-remediation suggestions. Exercises: fromPrisma/fromKysely, verifiable, feedback.

### 8.3 — LLM graph composition

The "LLM designs the graph" capability. Design reference: `archive/docs/SESSION-universal-reduction-layer.md`.

- [ ] `GraphSpec` schema — JSON schema for declarative graph topology (nodes, edges, operator configs, constraints). Serializable, diffable.
- [ ] `compileSpec(spec)` → Graph — instantiate a Graph from a GraphSpec
- [ ] `decompileGraph(graph)` → GraphSpec — extract spec from running graph
- [ ] `llmCompose(problem, adapter, opts?)` → GraphSpec — LLM generates a GraphSpec from natural language problem description. Validates against available operators/sources/sinks. Returns spec for human review before compilation.
- [ ] `llmRefine(graph, feedback, adapter)` → GraphSpec — LLM modifies existing graph topology based on performance feedback or changed requirements
- [ ] `specDiff(specA, specB)` — structural diff between two GraphSpecs (what changed, why it matters, estimated impact)

### 8.4 — Audit & accountability

Safety layer: every reduction decision is traceable and explainable.

- [ ] `auditTrail(graph, opts?)` → Graph — wraps any graph with a reactiveLog that records every node mutation, actor, timestamp, and causal chain. Queryable by time range, actor, node.
- [ ] `explainPath(graph, from, to)` — given an output, walk backward through the graph to explain how it was derived. Returns human-readable + LLM-parseable causal chain.
- [ ] `policyEnforcer(graph, policies)` — reactive constraint enforcement. Policies are nodes (can be LLM-updated). Violations emit to an alert subgraph. Exercises: guard (1.5), budgetGate, feedback.
- [ ] `complianceSnapshot(graph)` — point-in-time export of full graph state + audit trail for regulatory/compliance archival.

### 8.5 — Performance & scale

- [ ] Backpressure protocol — formalize PAUSE/RESUME for throughput control across graph boundaries (local + distributed via peerGraph)
- [ ] `peerGraph(transport, opts?)` — federate graphs across processes/services. Transport: WebSocket (existing), gRPC, NATS, Redis pub/sub. Subset of describe() crosses boundary; node subscriptions are proxied.
- [ ] Benchmark suite: 10K nodes, 100K msgs/sec, measure propagation latency, memory footprint, GC pressure. Target: <1ms p99 per hop.
- [ ] `shardedGraph(shardFn, opts?)` — partition large graphs across workers (5.3 workerBridge). Transparent to consumers.
- [ ] Adaptive sampling — built-in operator that adjusts sample rate based on downstream backpressure + budget constraints. No config, just wiring.

### 8.6 — GraphCodec (pluggable serialization)

Design reference: `archive/docs/SESSION-serialization-memory-footprint.md`. Replaces hardcoded JSON with a pluggable codec system. Prerequisite: V0 (6.0) for delta checkpoints.

- [ ] `GraphCodec` interface: `encode(snapshot) → Uint8Array`, `decode(buffer) → GraphPersistSnapshot`, `contentType: string`
- [ ] `JsonCodec` — default, human-readable, current behavior wrapped in interface
- [ ] `DagCborCodec` — DAG-CBOR via `@ipld/dag-cbor`; ~40-50% smaller than JSON, deterministic encoding, CID links native
- [ ] `DagCborZstdCodec` — DAG-CBOR + zstd compression; ~80-90% smaller than JSON
- [ ] `graph.snapshot({ codec })` / `Graph.fromSnapshot(buffer, { codec })` — codec-aware serialization
- [ ] `autoCheckpoint` codec option — checkpoint adapter receives `Uint8Array` instead of JSON when codec specified
- [ ] Codec negotiation for `peerGraph` — peers agree on codec during handshake

### 8.7 — Delta checkpoints & WAL

Requires V0 (6.0). Track dirty nodes via bitset, serialize only changes, append to write-ahead log. At steady state (50 nodes changing/sec out of 10K), each checkpoint is ~12 KB instead of multi-MB full snapshot.

- [ ] `graph.checkpoint()` → `DeltaCheckpoint` — returns only nodes with `version > lastCheckpoint`. Bitset-tracked from propagation.
- [ ] WAL (write-ahead log) append mode — `autoCheckpoint` appends deltas; periodic full snapshot compaction
- [ ] `Graph.fromWAL(entries[], opts?)` — reconstruct graph from WAL replay (full snapshot + deltas)
- [ ] Delta-aware `peerGraph` sync — only transfer nodes with `version > peerLastSeen`

### 8.8 — Memory optimization & tiered representation

Strategies for reducing runtime memory footprint. Design reference: `archive/docs/SESSION-serialization-memory-footprint.md`.

#### Lazy meta materialization

- [ ] Meta companion objects allocated on first access (`.meta` getter), not at node construction. Cuts per-node memory ~35% for nodes nobody inspects.
- [ ] `describe()` and `observe()` trigger materialization; hot-path propagation does not

#### Bounded history

- [ ] Ring buffer option for `reactiveLog` history — `{ maxEntries }` circular buffer, constant memory (extend existing reactiveLog bounded mode)
- [ ] Time-based eviction — `{ maxAge }` for history entries
- [ ] Spill-to-disk for evicted history — evicted entries serialize to codec buffer on disk, queryable by time range

#### Structural sharing

- [ ] Value dedup — when a node's new value is structurally identical to old value, reuse the existing object reference (avoid allocation even when RESOLVED skip fires)
- [ ] Shared meta schemas — nodes with identical meta key sets share a single hidden class / prototype

#### Node pooling (struct-of-arrays)

- [ ] `NodePool(capacity)` — struct-of-arrays layout for homogeneous pipelines: `Uint32Array` for ids, packed adjacency list for deps, shared typed arrays. ~50 bytes/node vs ~800 bytes/node for structural parts.
- [ ] Transparent to consumers — `pool.get(index)` returns a proxy that reads from arrays
- [ ] Ideal for reduction pipelines (Phase 8.1) where thousands of intermediate nodes share the same shape

#### Dormant subgraph eviction

- [ ] `graph.setEvictionPolicy({ idleTimeout, tier })` — subgraphs with no propagation for `idleTimeout` serialize to codec buffer and release JS objects
- [ ] Re-hydrate on next read/propagation — cost depends on codec (JSON: slow, DAG-CBOR: fast, FlatBuffers: near-zero)
- [ ] `graph.evict(subgraphName)` — manual eviction for programmatic control
- [ ] Eviction metrics in `describe()` — `{ evicted: true, lastActive, serializedSize }`

#### Lazy hydration

- [ ] `Graph.fromBuffer(buffer, { codec, lazy: true })` — parse envelope only; decode individual nodes on first access
- [ ] FlatBuffers zero-copy option — mmap buffer, read fields directly, never allocate JS objects for unaccessed nodes
- [ ] Warm-up hint: `graph.warmup(nodeNames[])` — pre-decode specific nodes expected to be accessed soon

---

## Effort Key

| Size | Meaning |
|------|---------|
| **S** | Half day or less |
| **M** | 1-2 days |
| **L** | 3-4 days |
| **XL** | 5+ days |
