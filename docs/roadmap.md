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

- [ ] `collection()` → Graph (reactive node set with eviction)
- [ ] `lightCollection()` (FIFO/LRU, no reactive scoring)
- [ ] `vectorIndex()` (HNSW)
- [ ] `knowledgeGraph()` → Graph
- [ ] `decay()` scoring

### 4.4 — AI surface

- [ ] `chatStream()` → Graph
- [ ] `agentLoop()` → Graph
- [ ] `fromLLM()` (adapter)
- [ ] `toolRegistry()` → Graph
- [ ] `agentMemory()` → Graph — composes `distill()` (3.2b) + tracker-specific scoring/eviction
- [ ] `llmExtractor(systemPrompt, opts)` → `extractFn` for `distill()` — handles structured and unstructured LLM output, deduplicates against existing memories
- [ ] `llmConsolidator(systemPrompt, opts)` → `consolidateFn` for `distill()` — clusters and merges related memories via LLM
- [ ] `systemPromptBuilder()`

### 4.5 — CQRS

Composition layer over 3.2 (`reactiveLog`), 4.1 (sagas), 4.2 (event bus), 4.3 (projections). Guards (1.5) enforce command/query boundary.

- [ ] `cqrs(name, definition)` → Graph — top-level factory
- [ ] `command(name, handler)` — write-only node; guard rejects `observe`
- [ ] `event(name)` — backed by `reactiveLog`; append-only, immutable
- [ ] `projection(events, reducer)` — read-only derived node; guard rejects `write`
- [ ] `saga(events, handler)` — event-driven side effects (delegates to `pipeline()`)
- [ ] `eventStore` adapter interface — pluggable persistence (in-memory, SQLite, Postgres)
- [ ] Projection rebuilding: replay events to reconstruct read models
- [ ] `describe()` output distinguishes command / event / projection / saga node roles

---

## Phase 5: Framework & Distribution

### 5.1 — Framework bindings

- [ ] React: `useStore`, `useSubscribe`, `useSubscribeRecord`
- [ ] Vue: `useStore`, `useSubscribe`, `useSubscribeRecord`
- [ ] Svelte: `useSubscribe`, `useSubscribeRecord`
- [ ] Solid: `useSubscribe`, `useSubscribeRecord`

### 5.1b — State-management compat layers

Thin wrappers that let users keep familiar APIs while backed by GraphReFly primitives.

- [ ] Jotai: `atom` (primitive, derived, writable-derived)
- [ ] Zustand: `create` (set/get contract)
- [ ] Nanostores: `atom`, `computed`, `map`
- [ ] TC39 Signals: `Signal.State`, `Signal.Computed`, `Signal.subtle.Watcher`

### 5.2 — Adapters

- [ ] `fromHTTP`, `fromWebSocket`/`toWebSocket`
- [ ] `fromWebhook`, `toSSE`
- [ ] `fromMCP` (Model Context Protocol)
- [ ] `fromFSWatch(paths, opts?)` — file system watcher as reactive source; debounced, glob include/exclude, recursive. Uses `fs.watch` (zero deps); optional `fromChokidar()` for production. Cleanup closes watchers on unsubscribe.
- [ ] `fromGitHook(repoPath, opts?)` — git change detection as reactive source; emits structured `GitEvent` (commit, files, message, author). Default: polling via `git log --since`; opt-in hook script installation. Cross-repo via `merge([fromGitHook(tsRepo), fromGitHook(pyRepo)])`.

### 5.2b — ORM / database adapters

Reactive bindings that keep graph nodes in sync with database queries.

- [ ] Prisma: `fromPrisma` (live query → node)
- [ ] Drizzle: `fromDrizzle` (live query → node)
- [ ] Kysely: `fromKysely` (type-safe query → node)

### 5.3 — Worker bridge

- [ ] `workerBridge()` / `workerSelf()`
- [ ] Transport abstraction (Worker, SharedWorker, ServiceWorker, BroadcastChannel)

### 5.4 — LLM tool integration

- [ ] `knobsAsTools(graph, actor?)` → OpenAI/MCP tool schemas from scoped describe()
- [ ] `gaugesAsContext(graph, actor?)` → formatted gauge values for system prompts
- [ ] Graph builder validation (validate LLM-generated graph defs)

### 5.5 — NestJS integration

Full integration replacing `@nestjs/event-emitter`, `@nestjs/schedule`, and `@nestjs/cqrs` with a single reactive graph.

#### Module & DI

- [ ] `GraphReflyModule.forRoot(opts?)` — root `Graph` singleton in NestJS DI container
- [ ] `GraphReflyModule.forFeature(opts)` — feature subgraph, auto-mounted into root (`root:featureName:*`)
- [ ] `@InjectGraph(name?)` / `@InjectNode(path)` — decorators for DI into services/controllers

#### Lifecycle

- [ ] Module init → `Graph.fromSnapshot()` (optional hydration)
- [ ] Module destroy → `graph.destroy()` (TEARDOWN propagation)
- [ ] REQUEST / TRANSIENT scope → graph-per-request option

#### Actor bridge

- [ ] NestJS `@Guard()` / `ExecutionContext` → GraphReFly `Actor` mapping
- [ ] `@GraphReflyGuard()` — decorator that extracts JWT/session → Actor, passes to graph guards (1.5)

#### EventEmitter replacement

- [ ] `@OnGraphEvent(nodeName)` — decorator equivalent of `@OnEvent()`, backed by `graph.observe()`
- [ ] `graph.set()` / `graph.signal()` replaces `eventEmitter.emit()` — events become inspectable nodes

#### Schedule replacement

- [ ] `@GraphInterval(ms)` / `@GraphCron(expr)` — decorators backed by `fromTimer()` / `fromCron()` nodes
- [ ] Scheduled work visible in `graph.describe()`, pausable via PAUSE/RESUME signals

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

- [ ] V0: id + version (recommended minimum)
- [ ] V1: + cid + prev (content addressing, linked history)
- [ ] V2: + schema (type validation)
- [ ] V3: + caps (serialized guard policy) + refs (cross-graph references) — runtime enforcement already in Phase 1.5; V3 adds the serialization/transport format
- [ ] ~~Attribution~~ → Phase 1.5 (`node.lastMutation`)

---

## Phase 7: Polish & Launch

- [ ] README with "graph + re + fly" tagline
- [x] `llms.txt` for AI agent discovery (`llms.txt`, `website/public/llms.txt`)
- [ ] npm publish: `@graphrefly/graphrefly-ts`
- [ ] Docs site
- [ ] Community launch (HN, Reddit, dev.to)

### 7.1 — Reactive layout engine (Pretext-on-GraphReFly)

Reactive text measurement and layout without DOM thrashing. Inspired by [Pretext](https://github.com/chenglou/pretext) but rebuilt as a GraphReFly graph — the layout is inspectable (`describe()`), snapshotable, and debuggable. Standalone reusable pattern, also powers the demo shell (7.2). Design reference: `docs/demo-and-test-strategy.md` §2b.

- [ ] `state("text")` → `derived("segments")` — text segmentation (words, glyphs, emoji); uses Canvas `measureText()` for segment widths, cached
- [ ] `derived("line-breaks")` — segments + max-width → pure-arithmetic line breaking (no DOM)
- [ ] `derived("height")`, `derived("char-positions")` — total height, per-character x/y for hit testing
- [ ] Measurement cache with RESOLVED optimization — unchanged text/font → no re-measure
- [ ] `meta: { cache-hit-rate, segment-count, layout-time-ns }` for observability
- [ ] Extractable as standalone pattern (`reactive-layout`) independent of demo shell

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
- [ ] **Streaming node convention** — partial value emission for `chatStream()`/`fromLLM()` token-by-token output; options: (a) `reactiveLog` internally, (b) `DATA` with `{ partial, chunk }`, (c) `streamFrom` pattern (designed in callbag-recharge, not implemented)
- [ ] **Factory composition helper** — shared pattern/utility for 4.x graph factory boilerplate (create Graph, add nodes, wire edges, set meta)
- [ ] **Cross-island state bridge** — shared graph state across Astro islands; options: (a) global graph + subgraph subscribe, (b) `observe()` → custom events, (c) SharedWorker
- [ ] **Guard-aware describe for UI** — `describe({ showDenied: true })` variant showing hidden nodes with `{ denied: true, reason }` for "what can this actor do?" display
- [ ] **Mock LLM fixture system** — `mockLLM(responses[])` adapter for `fromLLM()` that replays deterministic canned responses with optional streaming delay
- [ ] **Time simulation** — `monotonicNs()` test-mode override for `vi.useFakeTimers()` integration with `fromTimer`/`fromCron`/`wait`

---

## Effort Key

| Size | Meaning |
|------|---------|
| **S** | Half day or less |
| **M** | 1-2 days |
| **L** | 3-4 days |
| **XL** | 5+ days |
