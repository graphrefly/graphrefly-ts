# Roadmap

> **Spec:** [GRAPHREFLY-SPEC.md](GRAPHREFLY-SPEC.md)
>
> **Guidance:** [docs-guidance.md](docs-guidance.md) (documentation), [test-guidance.md](test-guidance.md) (tests). Agent context: repo root `CLAUDE.md`; skills under `.claude/skills/`.
>
> **Predecessor:** callbag-recharge (170+ modules, 13 categories). Key patterns and lessons
> carried forward — see `archive/docs/DESIGN-ARCHIVE-INDEX.md` for lineage. Clone path for local reference: `~/src/callbag-recharge`.

---

## Phase 0: Foundation

### 0.1 — Project scaffold

- [x] Repository setup: pnpm, tsup, vitest, biome
- [x] `GRAPHREFLY-SPEC.md` in docs
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
- [x] Colon-delimited namespace: `"parent:child:node"`
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

### 1.5 — Actor & Guard (access control)

Built-in ABAC at the node level. Replaces external authz libraries (e.g. CASL) — the graph is the single enforcement point.

- [ ] `Actor` type: `{ type: "human" | "llm" | "wallet" | "system" | string, id: string, ...claims }`
- [ ] Actor context parameter on `down()`, `set()`, `signal()` — optional, defaults to `{ type: "system" }`
- [ ] `guard` node option: `(actor: Actor, action: "write" | "signal" | "observe") => boolean` — checked on `down()`/`set()`/`signal()`; throws `GuardDenied` on rejection
- [ ] `policy()` declarative builder — CASL-style ergonomics without the dependency:
  ```
  policy((allow, deny) => {
    allow("write",  { where: actor => actor.role === "admin" })
    allow("signal", { where: actor => actor.type === "wallet" })
    allow("observe") // open by default
    deny("write",   { where: actor => actor.type === "llm" })
  })
  ```
- [ ] Scoped `describe(actor?)` / `observe(name?, actor?)` — filters output to nodes the actor may observe
- [ ] Attribution: each mutation records `{ actor, timestamp }` on the node (accessible via `node.lastMutation`)
- [ ] `meta.access` derived from guard when present (backward compat)
- [ ] `GuardDenied` error type with `{ actor, node, action }` for diagnostics

### 1.6 — Tests

- [ ] Graph add/remove/connect/disconnect
- [ ] Mount and namespace resolution
- [ ] describe() output validation against JSON schema
- [ ] observe() message stream tests
- [ ] Snapshot round-trip tests
- [ ] Cross-subgraph signal propagation
- [ ] Guard enforcement: allowed/denied writes, signals, observe filtering
- [ ] Policy builder: allow/deny precedence, wildcard, composed policies
- [ ] Actor attribution: mutation records, actor propagation through subgraphs
- [ ] Scoped describe: filtered output matches guard permissions
- [ ] GuardDenied error: correct actor/node/action in diagnostics

---

## Phase 2: Extra (Operators & Sources)

Port proven operators from callbag-recharge. Each is a function returning a node.

### 2.1 — Tier 1 operators (sync, static deps)

- [ ] `map`, `filter`, `scan`, `reduce`
- [ ] `take`, `skip`, `takeWhile`, `takeUntil`
- [ ] `first`, `last`, `find`, `elementAt`
- [ ] `startWith`, `tap`, `distinctUntilChanged`, `pairwise`
- [ ] `combine`, `merge`, `withLatestFrom`, `zip`
- [ ] `concat`, `race`

### 2.2 — Tier 2 operators (async, dynamic)

- [ ] `switchMap`, `concatMap`, `exhaustMap`, `flatMap`
- [ ] `debounce`, `throttle`, `sample`, `audit`
- [ ] `delay`, `timeout`
- [ ] `buffer`, `bufferCount`, `bufferTime`
- [ ] `window`, `windowCount`, `windowTime`
- [ ] `interval`, `repeat`
- [ ] `pausable`, `rescue`

### 2.3 — Sources & sinks

- [ ] `fromTimer`, `fromEvent`, `fromIter`
- [ ] `fromPromise`, `fromAsyncIter`, `fromAny`
- [ ] `of`, `empty`, `never`, `throwError`
- [ ] `forEach`, `toArray`
- [ ] `share`, `cached`, `replay`

---

## Phase 3: Resilience & Data

### 3.1 — Utils (resilience)

- [ ] `retry`, `backoff` (exponential, linear, fibonacci)
- [ ] `withBreaker` (circuit breaker)
- [ ] `rateLimiter`, `tokenTracker`
- [ ] `withStatus` (now: sugar for meta companion stores)
- [ ] `checkpoint` + adapters (file, SQLite, IndexedDB)

### 3.2 — Data structures

- [ ] `reactiveMap` (KV with TTL, eviction)
- [ ] `reactiveLog` (append-only, reactive tail/slice)
- [ ] `reactiveIndex` (dual-key sorted index)
- [ ] `reactiveList` (positional operations)
- [ ] `pubsub` (lazy topic stores)

---

## Phase 4: Domain Layers (Graph Factories)

Each returns a `Graph` — uniform introspection, lifecycle, persistence.

### 4.1 — Orchestration

- [ ] `pipeline()` → Graph
- [ ] `task()`, `branch()`, `gate()`, `approval()`
- [ ] `forEach()`, `join()`, `loop()`, `subPipeline()`
- [ ] `sensor()`, `wait()`, `onFailure()`
- [ ] `toMermaid()` / `toD2()` diagram export

### 4.2 — Messaging

- [ ] `topic()` → Graph
- [ ] `subscription()` (cursor-based consumer)
- [ ] `jobQueue()` → Graph
- [ ] `jobFlow()` → Graph (multi-queue chaining)
- [ ] `topicBridge()` (distributed sync)

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
- [ ] `agentMemory()` → Graph
- [ ] `systemPromptBuilder()`

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

### 5.3 — Worker bridge

- [ ] `workerBridge()` / `workerSelf()`
- [ ] Transport abstraction (Worker, SharedWorker, ServiceWorker, BroadcastChannel)

### 5.4 — LLM tool integration

- [ ] `knobsAsTools(graph, actor?)` → OpenAI/MCP tool schemas from scoped describe()
- [ ] `gaugesAsContext(graph, actor?)` → formatted gauge values for system prompts
- [ ] Graph builder validation (validate LLM-generated graph defs)

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
- [ ] `llms.txt` for AI agent discovery
- [ ] Showcase demos (markdown editor, workflow builder, AI assistant)
- [ ] npm publish: `@graphrefly/graphrefly-ts`
- [ ] Docs site
- [ ] Community launch (HN, Reddit, dev.to)

---

## Effort Key

| Size | Meaning |
|------|---------|
| **S** | Half day or less |
| **M** | 1-2 days |
| **L** | 3-4 days |
| **XL** | 5+ days |
