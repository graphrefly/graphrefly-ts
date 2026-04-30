# Session — Graph Narrow-Waist: Pattern-Author API & Inspection Consolidation

**Date:** 2026-04-29
**Trigger:** Development velocity stagnation caused by protocol-level complexity leaking into every pattern domain. Composition guide at 41 sections and growing. Each new feature multiplies edge-case interactions across 16 pattern domains. disconnect/resubscribe not yet designed but will further multiply combinatorics. TLA+/fast-check effective at protocol layer but can't scale to pattern-layer interaction matrix.
**Precedent sessions:**
- `SESSION-patterns-extras-consolidation-plan.md` (two-layer separation, promotion, naming)
- `SESSION-ai-harness-module-review.md` (24-unit 9-question format, topology check)
- `SESSION-graph-module-24-unit-review.md` (Graph class audit)

---

## Root Cause Analysis

### The problem: no narrow waist between protocol and patterns

Well-decoupled systems have a **narrow waist** — a minimal interface that shields upper layers from lower-layer complexity:

- **Unix:** file descriptors. `read(fd, buf, n)`. Consumer doesn't think about disk sectors.
- **Internet:** IP packets. TCP doesn't care if it's Ethernet or WiFi.
- **React:** `(props) => JSX`. Component author doesn't think about the reconciler's fiber tree.
- **SQL:** `SELECT ... WHERE ...`. Query author doesn't think about B-tree page splits.

GraphReFly's waist is **the full `Node<T>` API with all 11 message types**. A pattern author building `agentMemory` or `processManager` must understand: DIRTY/RESOLVED two-phase waves, SENTINEL guards and first-run gate, batch coalescing and deferred flush ordering, push-on-subscribe timing, subscription ordering (wire observers BEFORE emitters), equals substitution scope, terminal propagation (COMPLETE/ERROR when ALL/ANY deps), closure-mirror pattern for cross-subgraph reads.

**The composition guide's 41 sections are 41 protocol concerns that leaked into the composition layer.** Each new pattern re-encounters them. Each new protocol feature (disconnect/resubscribe) multiplies the interaction matrix across all 16 pattern domains.

### Why other systems get away with it

They don't have fewer edge cases — they have **stronger absorption boundaries**. React's reconciler has fibers, lanes, suspense, concurrent mode, priority scheduling — easily as complex as GraphReFly's protocol. But component authors never see any of it. The boundary is `(props) => JSX`.

GraphReFly has `derived([deps], fn)` which IS a good absorption boundary for simple cases. The problem: **pattern authors can't stay inside `derived` for long.** They quickly need `producer()`, manual `subscribe()`, `down()`, closure mirrors, explicit batch frames — and the moment they drop to that level, they're swimming in the full protocol.

### The fix

Build a narrow waist between pattern authors (Level 2) and protocol/operator authors (Level 3). Graph is the right place for this waist — it already has container semantics, inspection, persistence, lifecycle. It just needs 4 methods that absorb protocol complexity.

---

## Audit Summary

### Methodology

Four parallel agents audited all 16 pattern domains (~372 files, ~120k LOC) for protocol-level drops: raw `node.subscribe()`, `node.down()`, `producer()` with manual `actions.down`, direct message type checks (`DATA`/`DIRTY`/`RESOLVED`/`COMPLETE`/`ERROR`), closure-mirror patterns, raw `batch()` calls.

### Numbers

| Surface | Size |
|---|---|
| `node.ts` | 2,451 LOC |
| `graph.ts` | 4,430 LOC |
| SPEC | 1,574 lines, 11 message types |
| COMPOSITION-GUIDE | 2,071 lines, 41 sections |
| `optimizations.md` | 1,012 lines active backlog |
| `src/patterns/` | 16 domains, 372 files, 120k LOC |

### Protocol drops by domain

| Pattern domain | Protocol drops | Covered by proposal | UNCOVERED |
|---|---|---|---|
| orchestration | 13 | 5 | 8 (batch, terminal, RESOLVED) |
| ai/agents | 18 | 12 | 6 (batch) |
| ai/prompts | 8 | 5 | 3 (terminal routing) |
| ai/memory | 10 | 7 | 3 (batch) |
| harness | 30+ | 6 | 24 (batch, coordinator, .cache) |
| cqrs | 15+ | 3 | 12 (coordinator, .cache) |
| process | 10+ | 0 | 10 (coordinator) |
| job-queue | 12 | 0 | 12 (batch, .cache, pump) |
| messaging | 12 | 5 | 7 (batch) |
| inspect/audit | 10 | 4 | 6 (diff+rebind) |
| reduction | 5 | 3 | 2 |
| surface | 4 | 0 | 4 (raw message routing) |
| others | ~8 | 5 | 3 |

**~65 total protocol drops. ~55 (~85%) covered by the 4 proposed methods. ~10 (~15%) remain — these are legitimately Level-3 protocol code** (producer internals, terminal forwarding in operator-like code, coordinator subscriptions in process/saga/cqrs, `.cache` reads for inspection).

### UNCOVERED patterns reclassified as Level-3

The uncovered patterns are not missing absorption — they ARE infrastructure code. The files that contain them (harness/presets/refine-loop.ts, process/index.ts, job-queue/index.ts, cqrs/index.ts, surface/reduce.ts) are framework infrastructure, not something a typical pattern author writes. They belong at Level 3 (operator/infrastructure author), not Level 2 (pattern author).

---

## 9-Question Design Review

### Q1. Semantics, purpose, implementation

**Proposal:** Add 4 methods to Graph that absorb protocol complexity for pattern authors.

| Method | Underlying primitive | What it absorbs |
|---|---|---|
| `graph.derived(name, depPaths[], fn, opts?)` | `derived()` + `resolve()` + `add()` | Path resolution, SENTINEL guard (first-run gate), registration, disposal, optional `keepAlive` |
| `graph.effect(name, depPaths[], fn, opts?)` | `effect()` + `resolve()` + `add()` | Path resolution, SENTINEL guard, cleanup registration, disposal on destroy |
| `graph.produce(name, source, opts?)` | `producer()`/`fromAny()` + `add()` | Async-to-reactive coercion, error/complete forwarding, registration, disposal |
| `graph.batch(fn)` | `batch()` from core | Same semantics, discoverable on graph instance, import hygiene |

**Naming rationale (locked):** Names match the underlying primitives exactly (`derived`/`effect`/`producer` → `produce`). Pattern author who knows `derived()` immediately knows `graph.derived()`. No cognitive mapping needed.

**`keepAlive` option on `graph.derived` only:**
- `derived`: Yes — replaces the closure-mirror pattern (COMPOSITION-GUIDE §28). A derived with `keepAlive: true` stays subscribed even without downstream subscribers, keeping its cache current. This is exactly what closure mirrors do (subscribe to keep a value fresh in a closure variable), but the value lives in the node's cache instead, visible to `describe()` and `explain()`.
- `effect`: No — effects run for their side effect. If nobody subscribes, the effect shouldn't run. If you want fire-and-forget, that's a Level-3 design question.
- `produce`: No — producers own their lifecycle (activate on first subscribe, teardown on last unsubscribe). `keepAlive` is a consumer-side concern.

**No separate `graph.link()` method.** Originally proposed as a 1:1 cross-mount wiring method. Collapsed into `graph.derived(..., { keepAlive: true })` — which provides the same absorption (subscribe, filter SENTINEL, push real values, cleanup on destroy) without a separate concept to learn.

**Each method internally:**
1. Resolves string paths to Node refs via `this.resolve(path)`
2. Creates the underlying primitive (derived/effect/producer)
3. Registers via `this.add(n, { name, annotation })`
4. Registers disposal on `this.addDisposer(...)` as needed (keepAlive unsubscribe, etc.)
5. Returns the created `Node<T>` (derived, produce) or `Node<unknown>` (effect)

Pattern authors never call individual disposers — all cleanup is managed by Graph destroy.

**Signatures:**

```ts
// 1. graph.derived — path-based pure computation
interface GraphDerivedOptions<T> {
  equals?: (a: T, b: T) => boolean;
  initial?: T | null;
  keepAlive?: boolean;
  meta?: Record<string, unknown>;
  annotation?: string;
}

derived<T>(
  name: string,
  depPaths: string[],
  fn: (values: readonly unknown[]) => T | undefined | null,
  opts?: GraphDerivedOptions<T>,
): Node<T>;

// 2. graph.effect — managed side effect
interface GraphEffectOptions {
  meta?: Record<string, unknown>;
  annotation?: string;
}

effect(
  name: string,
  depPaths: string[],
  fn: (values: readonly unknown[], actions: NodeActions, ctx: FnCtx) => void | (() => void),
  opts?: GraphEffectOptions,
): Node<unknown>;

// 3. graph.produce — async/external source → named node
interface GraphProduceOptions<T> {
  equals?: (a: T, b: T) => boolean;
  meta?: Record<string, unknown>;
  annotation?: string;
}

produce<T>(
  name: string,
  source: NodeInput<T>,  // Promise | AsyncIterable | Iterable | T
  opts?: GraphProduceOptions<T>,
): Node<T>;

// 4. graph.batch — atomic multi-mutation
batch(fn: () => void): void;
```

**Implementation cost:** Each method is ~15-25 LOC wrapping existing primitives. Zero new protocol concepts. Zero new runtime cost beyond what manual code already pays.

### Q2. Semantically correct?

- **`graph.derived()` — SENTINEL source.** If a dep path resolves to a SENTINEL node, derived must NOT call fn with `undefined`. Inherited from `derived()`'s first-run gate — fn only fires once every dep has delivered at least one real DATA. 🟢
- **`graph.derived()` — keepAlive + no subscribers.** With `keepAlive: true`, the node stays subscribed internally. Its cache is always current. Downstream consumers can depend on it by path. If the graph destroys, `addDisposer` unsubscribes. 🟢
- **`graph.effect()` — dep changes during cleanup.** Previous reaction's cleanup runs to completion before new invocation. Inherited from `effect()` semantics. 🟢
- **`graph.produce()` — source rejects after bridge teardown.** The producer's `actions` become no-ops after teardown. Unhandled rejection is swallowed. Inherited from `producer()` semantics. 🟢
- **`graph.batch()` — nested batch.** `batch()` is already reentrant in core. 🟢
- **`graph.derived()` — keepAlive transform returning `undefined`.** Should be treated as "fn returned no value" (SENTINEL semantics — no DATA emitted). Aligns with existing `derived` behavior where `fn` returning `undefined` means "no emission." 🟢

No novel semantic issues. Each method inherits well-understood behavior from its underlying primitive.

### Q3. Design-invariant violations?

| Invariant | Status | Notes |
|---|---|---|
| §5.8 No polling | 🟢 | All methods reactive |
| §5.9 No imperative triggers | 🟢 | Use reactive subscribe, not event emitters |
| §5.10 No raw async in reactive layer | 🟢 | `produce` wraps via `fromAny`/`producer` — the approved boundary |
| §5.11 Central timer + messageTier | 🟢 | No timer usage |
| §5.12 Phase 4+ developer-friendly | 🟢 | These methods ARE the developer-friendly surface |
| COMP §1 First-run gate | 🟢 | Inherited from `derived`/`effect` |
| COMP §2 Subscription ordering | 🟢 | Graph owns subscription lifecycle |
| COMP §9 Batch coalescing | 🟢 | `batch` wraps core `batch()` directly |
| COMP §28 Closure-mirror | 🟢 | `derived` with `keepAlive` REPLACES §28 entirely |

No violations.

### Q4. Open items

**Links to existing backlog:**
- `docs/optimizations.md` "Graph rewire gap" — `derived` with `keepAlive` doesn't solve disconnect/resubscribe but provides the absorption point for handling it later at one layer instead of sixteen
- `docs/optimizations.md` "Tier 4.7 narrow ReactiveMapBundle.entries callback typing" — typed `graph.derived` overload would address this; defer until core `derivedT` lands
- Memory: `project_graph_narrow_waist.md` — locked decisions

**New items surfaced:**
- **Dep typing.** With string paths, dep values are `unknown`. Pattern authors cast. A future typed-path system (e.g., `graph.derived("out", [typedPath<string>("mount::value")], ...)`) can be added without breaking the untyped form. Defer.
- **`graph.effect()` `set()` helper.** Should the callback receive a `set(path, value)` helper to stay inside the waist instead of calling `someNode.emit(v)`? Deferred — can be added as an opt-in context field later.

### Q5. Right abstraction? More generic possible?

- **Could `derived` and `effect` merge?** No — different semantics. `derived` = pure derivation (returns value, no side effects). `effect` = imperative side effect (no return value, runs cleanup). Merging loses the semantic distinction.
- **Could `produce` accept `Node<T>` as source?** No — for Node → Node, use `derived` with `keepAlive`. `produce` is specifically for non-reactive sources (Promise, AsyncIterable, callback result).
- **Should `batch` be a Graph method?** Yes — (a) discoverability, (b) future: graph-scoped batching, (c) import hygiene (no `import { batch } from "@graphrefly/graphrefly/core"`).
- **More generic: a `GraphBuilder` DSL?** A fully declarative `graph.define({ inputs, computations, effects })` could layer on top of these 4 methods. Not a replacement. The 4 methods are the right granularity.
- **Pattern-level utils (lightMutation, wrapMutation, processManager, createAuditLog, registerCursor) → move to Graph?** No. These are Level-3 infrastructure used by Level-3 authors. Graph shouldn't know about audit records. They are correctly placed in `extra/mutation/` and `patterns/process/`. See §"Pattern-level utils audit" below.

### Q6. Right long-term solution? Caveats / special cases / maintenance burden?

**6-month risks:**

1. **Surface area.** +4 methods on Graph. Mitigated by collapsing 3 (`setAll`, `removeAll`, `get`) and reclassifying 6 as escape hatches. Net pattern-author surface shrinks.
2. **disconnect/resubscribe interaction.** When this lands, `derived` with `keepAlive` must handle reconnection transparently. Mitigation: design the internal subscription management with reconnection in mind from day 1.
3. **Typing friction.** String paths lose type safety. Same friction as `graph.resolve()` today. Typed-path overload can be added later without breaking.
4. **keepAlive transform returning `undefined`.** Defined as "no emission" (SENTINEL semantics). Document explicitly.

**Maintenance burden: LOW.** Each method is 15-25 LOC wrapping existing primitives. Real complexity stays in `NodeImpl`, `derived`, `effect`, `producer`, `batch` — unchanged.

### Q7. Simplify / reactive / composable + topology check + perf & memory

**Simplification — closure-mirror elimination:**

Before (8 lines, 3 protocol concepts):
```ts
let latestMessages: Message[] = [];
const sub = chat.messages.subscribe((msgs) => {
  for (const m of msgs) if (m[0] === DATA) latestMessages = m[1];
});
subgraph.addDisposer(sub);
const messagesNode = derived([trigger], () => latestMessages);
graph.add(messagesNode, { name: "messages" });
```

After (1 line, 0 protocol concepts):
```ts
graph.derived("messages", ["chat::messages"], ([msgs]) => msgs, { keepAlive: true });
```

**Simplification — effect with cleanup:**

Before:
```ts
const fx = effect([query, model], ([q, m], actions) => {
  const handle = externalApi.call(q, m);
});
graph.add(fx, { name: "fetcher" });
graph.addDisposer(() => fx.down([[TEARDOWN]]));
```

After:
```ts
graph.effect("fetcher", ["query", "model"], ([q, m], actions, ctx) => {
  const handle = externalApi.call(q, m);
  return () => handle.cancel();  // cleanup
});
```

**Topology check:** These methods create real `derived`/`effect`/`producer` nodes registered via `graph.add()`. They appear in `describe()`, have edges in `explain()`, and don't create islands. The closure-mirror pattern (`derived` with `keepAlive` replaces) is the **#1 source of topology islands today** — values flowing through closure variables instead of visible reactive edges. `keepAlive` fixes this by keeping the value in the node's cache with a visible edge.

**Performance & memory:**
- `derived`: 1 `derived` node + 1 `graph.add` + 1 optional `keepalive` subscription. Same cost as manual.
- `effect`: 1 `effect` node + 1 disposer. Same cost as manual.
- `produce`: 1 `producer` node + 1 source coercion. Same cost as manual.
- `batch`: Zero overhead — delegates to core `batch()`.

No new per-wave costs. No retained state beyond what underlying primitives already hold.

### Q8. Alternative implementations

**A. The 4-method proposal (described above) — `graph.derived/effect/produce/batch`**
- Methods named to match underlying primitives
- `keepAlive` on `derived` only — replaces separate `link` method
- Protocol-level utils stay in `extra/mutation/` and `patterns/`

**B. Separate `GraphBuilder` class**
- `new GraphBuilder(graph)` wraps Graph, exposes only Level-2 methods
- Pro: Hard boundary. Con: Two objects for same graph, `instanceof` breaks, patterns needing escape hatches hold both.

**C. Mixin / trait approach**
- `PatternMixin` adds methods via mixin
- Pro: Opt-in. Con: TS mixins fragile with inheritance (`PipelineGraph extends Graph`, `AgentMemoryGraph extends Graph`).

**D. Standalone functions — `graphDerived(graph, name, deps, fn)`**
- Pro: No Graph class growth. Con: Discoverability worse. Consolidation plan specifically moved toward Graph methods.

**E. Do nothing — improve composition guide**
- Pro: Zero risk. Con: Doesn't reduce protocol drops. Guide grows further. The 41 sections ARE the symptom.

### Q9. Recommendation

**Alternative A.**

| Concern | Covered? |
|---|---|
| Q2 edge cases | 🟢 All inherited from existing primitives |
| Q3 design invariants | 🟢 No violations |
| Q4 open items | 🟡 Dep typing deferred; effect `set()` helper deferred |
| Q5 right abstraction | 🟢 Right granularity, no over-abstraction |
| Q6 long-term | 🟢 Low maintenance, disconnect/resubscribe absorbable |
| Q7 topology | 🟢 Fixes island problem (closure mirrors → visible edges) |
| Q7 perf | 🟢 Zero overhead vs manual |
| Alt B builder | Rejected — two-object problem, `instanceof` breaks |
| Alt C mixin | Rejected — mixin + inheritance fragility |
| Alt D standalone | Rejected — discoverability worse |
| Alt E do nothing | Rejected — problem persists, guide grows |

---

## Inspection Consolidation

### Before (7 methods, undifferentiated)

```
describe()  explain()  reachable()  observe()  profile()  trace()  get()
```

### After (3 methods, clear separation)

| Method | Aspect | What it answers |
|---|---|---|
| `describe(opts?)` | **Topology** | Structure, edges, types, status, causal chains, reachability |
| `observe(path?, opts?)` | **Data** | Values flowing, changes, events |
| `profile(opts?)` | **Resources** | Memory, node count, retained state size |

### Folding details

**`explain()` → `describe({ explain: { from, to } })`**
- Causal chain from A to B is topology traversal
- 1 real caller in patterns (`inspect/presets/inspect.ts`)
- Both static and reactive modes fold into `describe`'s existing `reactive: true` option

**`reachable()` → `describe({ reachable: { from, direction } })`**
- "What nodes can I reach from X" is topology traversal
- Already dual-exported as both standalone fn and Graph method — collapse to method only

**`get()` → removed**
- Implementation: `return this.node(name).cache` (1 line)
- 0 callers in patterns
- Hides `.cache` (a protocol concept) behind sugar that looks Level-2 but is Level-3
- Escape hatch: `graph.node(name).cache`

**`trace()` → extracted from Graph, moved to inspect/ addon**
- Only 1 caller in patterns (`demo-shell`)
- Reasoning-annotation ring buffer is a debugging/audit concern, not core Graph
- Becomes a standalone addon or `inspect/` utility: `attachTrace(graph)` or similar

**Standalone `reachable()` fn → collapsed**
- Keep only `graph.reachable()` method form (folded into describe)
- The standalone fn always takes a graph anyway

---

## Graph Method Surface — Final Shape

### Pattern-author API (Level 2)

**Writes:**
- `graph.set(name, value)` — push a value into a state node
- `graph.derived(name, deps, fn, opts?)` — reactive derivation from paths
- `graph.effect(name, deps, fn, opts?)` — managed side effect
- `graph.produce(name, source, opts?)` — external/async source → named node
- `graph.batch(fn)` — atomic multi-mutation

**Reads:**
- `graph.describe(opts?)` — topology (+ explain, reachable as options)
- `graph.observe(path?, opts?)` — data values and changes
- `graph.profile(opts?)` — resource usage

**Lifecycle:**
- `graph.add(node, opts?)` — register an externally-created node
- `graph.mount(name, child?)` — sub-graph composition
- `graph.remove(name)` — unregister + teardown
- `graph.addDisposer(fn)` — cleanup on destroy
- `graph.destroy()` — tear down everything

**14 methods** (5 write + 3 read + 6 lifecycle) with clear categories.

### Escape hatches (Level 3, documented separately)

- `graph.node(name)` — raw Node access (drops to protocol)
- `graph.resolve(path)` — raw cross-mount Node access
- `graph.error(name, err)` — emit `[[ERROR, err]]`
- `graph.complete(name)` — emit `[[COMPLETE]]`
- `graph.invalidate(name)` — emit `[[INVALIDATE]]`
- `graph.signal(msgs)` — raw message injection

These stay functional — documented as "if you're calling these, you're writing protocol-layer code."

### Collapsed

- `setAll` — 0 callers. Use `graph.batch(() => { for(...) graph.set(...) })`
- `removeAll` — rare sugar. Inline loop.
- `get` — 0 callers in patterns. Escape hatch: `graph.node(name).cache`

---

## Pattern-Level Utils Audit

**Already promoted correctly (stay in `extra/mutation/`):**

| Symbol | Used by | Verdict |
|---|---|---|
| `lightMutation` | cqrs, job-queue, messaging, process, memory | Stay — cross-domain, no domain semantics |
| `wrapMutation` | cqrs, orchestration, process | Stay |
| `createAuditLog` | cqrs, job-queue, orchestration, process, audit | Stay |
| `registerCursor` | process, job-queue | Stay |
| `tryIncrementBounded` | harness, reduction | Stay |
| `BaseAuditRecord` | 6 pattern domains | Stay |

**Stay in `patterns/`:**

| Symbol | Location | Verdict |
|---|---|---|
| `processManager` | `patterns/process/` | Stay — Level-3 coordinator, not extra or Graph |
| `emitToMeta` | `patterns/_internal/` | Stay — layout-specific (3 files only) |
| `trackingKey` | `patterns/_internal/` | Stay — harness-specific |

**Move:**

| Symbol | From | To | Reason |
|---|---|---|---|
| CQRS error classes | `patterns/_internal/errors.ts` | `patterns/cqrs/errors.ts` | CQRS-specific, not cross-domain |

**`keepalive` utility (55 call sites):**
- Stays in `extra/sources/`
- With `graph.derived(..., { keepAlive: true })`, ~30 sites can migrate
- ~25 sites are Level-3 code keeping raw nodes alive — continue using `keepalive()` directly

---

## Composition Guide Restructure

### Current state

One 2,071-line file with 41 sections. Every composition author reads all of it. Most sections are protocol-level concerns that pattern authors don't need.

### Proposed split by level

The composition guide splits into 4 documents, one per level. Each level imports concepts from the level below but doesn't require reading it.

**Level 0 — Protocol (`COMPOSITION-GUIDE-PROTOCOL.md`)**
Audience: Core contributors, operator authors (Level 3-4).

Sections moved here:
- §1 Push-on-subscribe and activation (START + first-run gate)
- §2 Subscription ordering
- §5 Graph factory wiring order
- §9 Diamond resolution and two-phase protocol
- §9a Batch-coalescing rule
- §12 ROM/RAM cache semantics
- §19 Terminal-emission operators
- §21 `actions.emit` vs `actions.down`
- §22 `autoTrackNode`
- §24 Edges are derived, not declared
- §25 Activation wave is ceremony, not transition
- §28 Factory-time seed pattern (REPLACED by `graph.derived` with `keepAlive` at Level 1 — retained here as historical context for understanding existing Level-3 code)
- §32 State-mirror pattern
- §38 Naming conventions `::` vs `/`
- §39 Function identity via meta
- §41 Tier-3 wave exclusivity

**Level 1 — Graph (`COMPOSITION-GUIDE-GRAPH.md`)**
Audience: Pattern authors (Level 2).

Sections:
- NEW: "The 4 methods" — `graph.derived`, `graph.effect`, `graph.produce`, `graph.batch`
- NEW: "`keepAlive` replaces closure mirrors" — migration from §28
- NEW: "Inspection: describe / observe / profile" — what each method answers
- §3 Null/undefined guards — two patterns, no third
- §4 Versioned wrapper navigation
- §7 Feedback cycles in multi-stage factories
- §10 SENTINEL vs null-guard cascading
- §13 `startWith` removal — use `derived` with `initial`
- §14 Blocking async bridge deadlock (PY only)
- §20 `ctx.store` for persistent fn state
- §23 Rescue pattern with `errorWhenDepsError: false`
- §26 Compat layers are two-way bridges
- §27 Tiered storage composition

**Level 2 — Domain patterns (`COMPOSITION-GUIDE-PATTERNS.md`)**
Audience: Pattern authors working in specific domains.

Sections:
- §8 promptNode SENTINEL gate
- §11 dynamicNode superset model
- §15 Scenario patterns
- §16 Nested `withLatestFrom`
- §17 Stable identity for retried items (`trackingKey`)
- §29 Multi-agent handoff pattern
- §30 Parallel guardrail pattern
- §31 Dynamic tool selection
- §33 `frozenContext`
- §34 `handoff` primitive
- §35 Imperative-controller-with-audit pattern
- §36 Process manager pattern
- §37 Versioning handlers via audit metadata
- §40 Reactive `extractFn` for `distill`

**Level 3 — Solutions (`COMPOSITION-GUIDE-SOLUTIONS.md`)**
Audience: Authors building high-level presets like `harnessLoop`, `agentMemory`, `refineLoop`.

Sections:
- NEW: Harness 7-stage composition (INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT)
- NEW: Memory tier composition (collection + vectorIndex + knowledgeGraph + decay + retrieval)
- NEW: Resilient pipeline composition (rateLimiter → budgetGate → withBreaker → timeout → retry → fallback)
- NEW: Multi-agent orchestration patterns
- Future: additional solution-level patterns as the library grows upward

The "Solutions" name acknowledges this is NOT the highest level. As the library grows, levels above solutions (applications? deployments? orchestrations?) can be added without restructuring the lower levels.

### Debugging and testing

The "Debugging composition" and "Testing composition" sections from the current guide apply at all levels. They stay as a shared appendix or become a standalone `COMPOSITION-DEBUGGING.md` referenced by all 4 level docs.

### Cross-language concerns

§6 (Cross-language data structure parity) stays as a shared reference. Not level-specific.

---

## TLA+ / Fast-Check Coverage Plan

### Current state

- **57 fast-check invariants** covering protocol layer (message types, node lifecycle, operator contracts)
- **28 TLA+ invariants** covering core spec (diamond resolution, batch, terminal propagation)
- Both effective at Level 0 (protocol). Neither covers Level 1 (Graph methods).

### Graph-level properties to verify

The 4 new Graph methods introduce a **composition contract** that sits between protocol and patterns. This contract can be verified with fast-check property tests:

**P1: SENTINEL absorption** — If any dep path resolves to a SENTINEL node, `graph.derived` must NOT call fn. fn only fires once every dep has delivered real DATA.

**P2: keepAlive consistency** — A `graph.derived(..., { keepAlive: true })` node always has `status !== "sentinel"` after subscription settles. Its `.cache` reflects the latest upstream DATA at all times (no stale values from missed updates).

**P3: Disposal completeness** — After `graph.destroy()`, every subscription created by `derived`/`effect`/`produce` (including keepAlive subscriptions) is torn down. No leaked listeners.

**P4: Batch atomicity** — Inside `graph.batch(fn)`, all `graph.set()` calls produce exactly one coalesced downstream wave. No intermediate states visible to derived nodes.

**P5: Path resolution consistency** — `graph.derived("x", ["a::b", "c::d"], fn)` resolves paths at construction time. If the mount structure changes after construction (mount removed), the derived node errors rather than silently reading stale refs.

**P6: Topology visibility** — Every node created by `graph.derived/effect/produce` appears in `graph.describe()` with correct edges. No islands. No phantom edges.

**P7: keepAlive vs non-keepAlive equivalence** — For the same fn and deps, `graph.derived(name, deps, fn, { keepAlive: true })` and `graph.derived(name, deps, fn)` + external `keepalive()` produce identical `.cache` values at all times. The keepAlive option is purely a subscription convenience, not a semantic difference.

### Implementation approach

These are fast-check properties, not TLA+ specs. They test the Graph-level contract via generated topologies (random number of mounts, random dep paths, random emission sequences). Target: ~10 new invariants in `src/__tests__/properties/_invariants.ts`, registry 57 → ~67.

TLA+ extension for Graph-level is NOT planned — the Graph methods are thin wrappers with no novel state machines. Protocol-level TLA+ already covers the underlying primitives. Adding a TLA+ model for "resolve path then call derived" would be tautological.

---

## Expectations for Decoupling

### What we expect to improve

1. **Development velocity.** New pattern domains should need ~8 composition guide sections (Level 1) instead of ~41. Protocol concerns absorbed once, not re-encountered per domain.

2. **disconnect/resubscribe blast radius.** Handled inside `graph.derived`/`graph.effect`/`graph.produce` at one layer. 16 pattern domains don't each re-encounter it.

3. **Context window efficiency.** CLAUDE.md can reference Level 1 guide (~8 sections) instead of the full composition guide (~41 sections). Level 0 protocol docs read only when writing operators or core.

4. **Topology quality.** Closure mirrors (the #1 island source) replaced by `keepAlive` deriveds with visible edges. `describe()` output becomes accurate by construction.

5. **Onboarding.** New pattern author reads: "Use `graph.derived`, `graph.effect`, `graph.produce`, `graph.batch`. Here are 8 patterns. If you need `graph.node()`, you're writing infrastructure — read the protocol guide."

### What we do NOT expect

- **Zero protocol drops.** Level-3 code (cqrs, process, job-queue, harness internals) will always use protocol APIs. That's correct — they ARE infrastructure.
- **Type safety from string paths.** Deferred. Pattern authors cast at dep boundaries today; same friction with the new methods.
- **Elimination of the composition guide.** It splits into 4 files by level, not deleted. Protocol concerns still documented — just not in the pattern author's face.

---

## Implementer Instructions

### Escalation protocol

**When implementing the 4 new Graph methods or migrating existing patterns to use them, if you encounter node usage patterns in Level 2+ code that don't fit cleanly into `graph.derived/effect/produce/batch`, DO NOT:**
- Silently force the pattern into a method it doesn't fit
- Add ad-hoc parameters to make it work
- Swallow semantic mismatches or architectural inconsistencies
- Work around the gap with protocol-level escape hatches that defeat the purpose

**Instead:**
1. Document the pattern precisely: what it does, why none of the 4 methods cover it, what protocol APIs it currently uses.
2. Raise it as a new unit for the 9-question design review format (Q1-Q9 as defined in `SESSION-ai-harness-module-review.md`).
3. Wait for the design review to produce a locked decision before implementing.

The narrow waist must be designed to the patterns, not the patterns forced to the waist. If real patterns expose gaps, the waist grows to absorb them — through rigorous design review, not ad-hoc patching.

### Implementation sequence (original plan — Phases 1–6 landed; 7 + partial 9 landed; superseded by the corrected plan below)

| Phase | Scope | Risk | Status |
|---|---|---|---|
| 1 | `graph.batch(fn)` | Trivial — 1 LOC wrapper | ✅ landed (Bundle 1) |
| 2 | `graph.derived(name, depPaths, fn, opts)` with `keepAlive` | Low — wraps resolve + derived + add + optional keepalive | ✅ landed (Bundle 1) |
| 3 | `graph.effect(name, depPaths, fn, opts)` | Low — wraps resolve + effect + add | ✅ landed (Bundle 1) |
| 4 | `graph.produce(name, source, opts)` | Moderate — decide `fromAny` vs `singleFromAny` dispatch | ✅ landed (Bundle 1) |
| 5 | Fold `explain` + `reachable` into `describe()` | Moderate — overload signature changes | ✅ landed (Bundle 3) |
| 6 | Remove `get`, `setAll`, `removeAll`; extract `trace` to inspect/ addon | Breaking (pre-1.0) | ✅ partial (`get`/`setAll`/`removeAll` removed; `trace` retained — load-bearing for `explain`'s annotation surface) |
| 7 | Fast-check properties P1-P7 | Tests only | ✅ landed (registry 57 → 64; P5 restated) |
| 8 | Composition guide split into 4 level-based files | Docs only | ⏸ deferred until corrected plan below |
| 9 | Migrate 1-2 patterns per phase to validate | Validation | ⚠ partial: agent-loop.ts (5 mirrors) + pipeline-graph.ts (1 mirror) migrated as `keepAlive` + `.cache` reads — directional step, see Course Correction below for the redo |

---

## Course Correction — Findings from Phases 7 + 9 (2026-04-29 evening)

### What we observed

Implementing Phases 7 + 9 surfaced a deeper issue: **the 4 methods as originally designed did not actually narrow the waist.** They added a more ergonomic registration path on top of core sugar without subtracting protocol exposure.

Concretely, each Graph method wraps its core-sugar counterpart 1:1 with the same fn signature:

- `graph.derived(name, deps, fn)` → `derived(deps, fn) + graph.add` — fn is `(values) => T | undefined | null`
- `graph.effect(name, deps, fn)` → `effect(deps, fn) + graph.add` — fn is `(values, actions, ctx) => cleanup`, full protocol surface
- `graph.produce(name, source)` → `fromAny + graph.add` — source-bridge form

Pattern authors can still reach for `derived` / `effect` / `producer` from `core/sugar.ts` directly, OR raw `node()` from `core/node.ts`. **Three valid paths to "build a node," each with the same protocol exposure.** The fast-check verification matrix is unchanged: 57 protocol invariants + 7 graph properties + 50+ operator invariants. Patterns combine all three rows and have no covering verification.

The Level 1 / 2 / 3 taxonomy proposed in this session is doc-only (progressive disclosure). It does not narrow what fast-check / TLA+ has to verify per pattern.

### The closure-mirror replacement was also incomplete

Phase 9's "§28 closure-mirror → `graph.derived(..., {keepAlive: true})`" replacement moves the value from a closure variable to a registered Graph node, but consumers still read its `.cache` from inside reactive fn bodies — same `.cache`-from-inside-fn boundary the protocol layer forbids for non-inspection use.

```ts
// Phase 9 migration (still wrong shape)
const latestMessagesNode = graph.derived("latestMessages", ["chat::messages"],
  ([v]) => v, { keepAlive: true });
// promptInput.fn reads latestMessagesNode.cache — that's another node's cache from inside a reactive fn body
```

True elimination of cycle-break-via-cache requires `withLatestFrom`-style operators: sample passively via real reactive deps, no `.cache` access from inside fn bodies. The migration as landed is an improvement over the closure-mirror form (visible edge from upstream into the mirror node) but is not the final shape.

### The corrected design

To actually narrow the waist, two changes are required together:

**1. Subtract the core sugar layer.** Remove `state` / `derived` / `effect` / `producer` from `core/sugar.ts` exports. Operators (`extra/operators/*`, `extra/sources/*`) use raw `node()` directly. Patterns use only Graph methods + operators. Raw `node()` + `graph.add` is the explicit escape hatch — grep-able for review, signaling "I am writing protocol-layer code."

**2. Make Graph methods strictly narrower than core sugar was.** Restricted fn signatures hide protocol-domain dispatch:

```ts
// Pure cell — no fn at all
graph.state<T>(name: string, initial: T, opts?: GraphStateOptions<T>): Node<T>

// Compute — deps + ctx → array of values to emit this wave
//   single emit: [v]    no emit: []    multi-emit: [v1, v2, v3]
//   undefined excluded — SENTINEL stays protocol-only
type DerivedFn<T> = (
  values: readonly unknown[],
  ctx: FnCtxDerived,         // exposes prevData (deps' prior values) + cache (own previous emit only)
) => readonly (T | null)[];
graph.derived<T>(name, deps, fn, opts?): Node<T>

// Side effect — pure sink. up is the only actions surface; no downstream dispatch possible
type EffectFn = (
  values: readonly unknown[],
  up: NodeUpActions,         // pause() / resume() only
  ctx: FnCtxEffect,
) => Cleanup | void | NodeFnCleanupHooks;
graph.effect(name, deps, fn, opts?): Node<unknown>

// Source bridge — push channel; same array-emission shape as derived
type ProducerSetupFn<T> = (
  push: (values: readonly (T | null)[]) => void,
  ctx: FnCtxProducer,
) => Cleanup | void | NodeFnCleanupHooks;
graph.producer<T>(name, setup, opts?): Node<T>      // renamed from graph.produce — noun consistency

graph.batch(fn: () => void): void                                // unchanged
graph.add<T extends Node>(node: T, opts: { name; … }): T          // unchanged — escape-hatch registration
```

`opts` for each: `equals`, `initial`, `meta`, `annotation`, `keepAlive` (derived only), `signal`, `describeKind`. Unchanged from current Graph methods.

**Locked design decisions (2026-04-29 evening):**

- **Q-A — single-value ergonomic for derived: A.1 strict array always.** No discriminated `T | null | T[]` form. Wrapping `[v]` is verbose for the common case but avoids defensive checks for array-T ambiguity. Pre-1.0; not worth the complexity.
- **Q-B — producer signature: B.1 push-channel fn.** `(push, ctx) => cleanup`. Async sources wrap explicitly: `graph.producer(name, (push) => { promise.then(v => push([v])); return () => abort.abort(); })`. Uniform shape with derived (array emissions), no source-shape discrimination.
- **Q-C — opts stay in opts.** `equals`, `initial`, `meta`, `annotation`, `keepAlive`, `signal`, `describeKind`. Same surface as today.
- **Q-D — `ctx.cache` for the current node's own previous emit IS allowed.** Symmetric with `ctx.prevData[i]` for dep prior values — both read "past records." Reading other nodes' `.cache` from inside reactive fn bodies remains forbidden (inspection-only rule). Enables scan-style accumulators in `derived` without operator composition.
- **Q-E — `NodeUpActions` for effect.** `pause()` and `resume()` only. No `emit` / `down` / `up(messages)`. Minimal upstream control. Effects that need to emit downstream use `producer` or drop to raw `node()`.
- **`NodeFnCleanupHooks`** — included in cleanup return type for both `effect` and `producer` for consistency. Granular `{ deactivate?, … }` rarely needed; `Cleanup | void` is the typical case.

### What this delivers that the original 4 methods don't

| Concern | Original 4 methods | Corrected restricted signatures |
|---|---|---|
| Pattern author can manually emit COMPLETE/ERROR from a derived | ✅ via `actions.down([[…]])` | ❌ removed; cascade-config or escape-hatch only |
| Pattern author can dispatch RESOLVED explicitly | ✅ via `actions.down([[RESOLVED]])` | encoded as empty array — explicit, not protocol-typed |
| Pattern author sees `undefined` (SENTINEL) as a value | possibly via raw `data` | ❌ excluded from `T \| null` |
| Pattern author calls `actions.emit` from an effect | ✅ (footgun) | ❌ effect's fn doesn't see `emit` |
| Pattern author calls multiple `actions.emit` in derived | ✅ ad-hoc | encoded as array length — explicit |
| Async source bridging | `graph.produce(name, NodeInput)` source-shape | `graph.producer(name, (push, ctx) => …)` push channel — uniform model |
| Three valid paths to "build a node" | ✅ (core sugar + Graph methods + raw node) | ❌ two paths only (Graph methods OR raw `node()` + `graph.add`) |

The fn body sees a value-domain interface only. Protocol semantics (DIRTY, RESOLVED, SENTINEL, terminal cascade, batch coalescing) live below the waist, not exposed above it.

### What this delivers for verification

Three rows to verify, no fourth:

| Row | What it covers | Status |
|---|---|---|
| Core protocol — `node()` + `batch()` | Invariants 1–57 in `_invariants.ts` | ✅ |
| Operators — `extra/operators/*` | Invariants 18–53 cover individual operators | ✅ |
| Graph methods (restricted) | P1–P7 + new P8+ enumerating array-emission semantics ("derived returning array of length N → graph emits N DATAs in one wave") | partial — P1-P7 currently test legacy fn signature; redo with new signatures in Phase 17 |

Patterns become compositions over an already-verified base. The "patterns aren't covered" gap in fast-check reduces to a documentation problem (which compositions are sound) rather than a verification problem (which behaviors are correct).

### Status of existing modifications — REVERTED per §28 reading

**Phase 9 migrations REVERTED to closure-mirror form (2026-04-29 evening, post-§28 reading).** The earlier "do not revert; directional improvement" framing was wrong: the migrations replaced the §28-canonical closure-mirror pattern (closure variable read inside fn body — sanctioned, NOT a P3 violation) with `graph.derived(..., {keepAlive: true})` + `.cache` reads inside fn bodies (which IS a P3 violation). Net regression. COMPOSITION-GUIDE §28 explicitly documents:

> The closure reads inside the reactive fn are NOT P3 violations — they read a closure variable, not a `.cache`. This is the pattern used by `stratify`'s `latestRules`, `budgetGate`'s `latestValues`, `gate()`'s `latestIsOpen`, and `distill`'s `latestStore`.

§40 reinforces it for `distill`: "Why closure-mirror, not `withLatestFrom`: `withLatestFrom(rawNode, existingNode)` swallows the initial source emission..."

**State of each site after revert:**

- **agent-loop.ts** ([src/patterns/ai/presets/agent-loop.ts](../../src/patterns/ai/presets/agent-loop.ts)) — 5 closure-mirrors restored (`latestTurn`, `latestAborted`, `latestStatus`, `latestMessages`, `latestSchemas`). Reads inside `promptInput.fn` / effects are closure-variable reads per §28. Tests + lint clean.
- **pipeline-graph.ts** ([src/patterns/orchestration/pipeline-graph.ts](../../src/patterns/orchestration/pipeline-graph.ts)) — `latestIsOpen` closure-mirror restored. Read inside `output.fn` is a closure-variable read per §28. Tests + lint clean.
- **agent-memory.ts** ([src/patterns/ai/presets/agent-memory.ts:192-208](../../src/patterns/ai/presets/agent-memory.ts#L192)) + **distill internal** ([extra/composite.ts:204-216](../../src/extra/composite.ts#L204)) + **verifiable** ([extra/composite.ts:81-114](../../src/extra/composite.ts#L81)) — Phase 16 attempt was reverted; closure-mirrors remain. These are §28's named exemplars (verifiable's `latestSource`, distill's `latestStore`).
- **memory-composers.ts** ([src/patterns/ai/memory/memory-composers.ts:266-274](../../src/patterns/ai/memory/memory-composers.ts#L266)) — closure-mirror form, §28-canonical. The retention.score read of `latestCtx` is a closure-variable read; `retention.score` is a sync mutation-path callback (not a reactive fn), which is a separate concern (optimizations.md D1 — score-fn-writing-into-graph violates pure-fn contract; orthogonal to closure-mirror).

### How to actually narrow this — the real fix is at the framework layer

The closure-mirror visibility issue (closure variables don't appear in `describe()`) IS solvable, but the fix is at the runtime/operator layer, NOT at the migration site. Already tracked in [docs/optimizations.md:812-822](../../docs/optimizations.md#L812):

> A naïve `[secondary, primary]` flip in `withLatestFrom` produces the correct initial pair but breaks topology-sensitive diamond callers — [harness/loop.ts:297–300](../../src/patterns/harness/loop.ts#L297) `executeContextNode` relies on the current ordering for same-wave settlement through the `executeInput → executeNode → executeContextNode` + `executeInput → executeContextNode` diamond. The reingestion test `reingestion — verify failure reingests to intake` times out when the flip is applied. A real framework fix needs: (a) either a diamond-topology audit of all in-tree `withLatestFrom` callers, or (b) a non-declaration-order subscribe mechanism (e.g. activation-phase batching so all deps' push-on-subscribe fires land in one combined wave). Candidate future design session.

Once that framework fix lands, the §28 sites can migrate to `withLatestFrom + switchMap + graph.add` cleanly: real reactive edges visible in `describe()`, no `.cache` reads inside fn bodies, no closure-mirrors. The "narrow waist" promise (visible-edges-by-construction) genuinely materializes.

**Concrete recommendation:** open a separate design session for activation-phase batching (option b above). That's the framework fix that unblocks the §28 cleanup across the entire library. Closure-mirror sites currently exist in `stratify`, `budgetGate`, `gate()`, `distill`, `verifiable`, `agent-loop` (5 sites), `pipeline-graph` (`approvalGate`'s latestIsOpen), `agent-memory`, `memory-composers`, and probably more — every one of them turns into a clean `withLatestFrom + switchMap` chain post-fix.

**Until that lands:** §28 closure-mirror IS the canonical pattern. Don't migrate. Don't replace with `graph.derived(keepAlive)` + `.cache` reads (that's worse). Don't attempt `withLatestFrom + switchMap` directly (that's the documented WRONG migration per §28's "WRONG: withLatestFrom drops the initial pair" warning).

### Phase 16 status — reverted, parked behind framework fix

The Phase 16 attempt (closure-mirror → `withLatestFrom + switchMap`) was directionally correct (the eventual right shape post-framework-fix) but blocked on the activation-phase issue. Reverted; closure-mirrors restored at:
- [extra/composite.ts:81-114](../../src/extra/composite.ts#L81) (`verifiable` explicit-trigger)
- [extra/composite.ts:204-216](../../src/extra/composite.ts#L204) (`distill` consolidate `latestStore`)
- [agent-memory.ts:192-208](../../src/patterns/ai/presets/agent-memory.ts#L192) (§40 extractFn bridge)

All three remain §28-canonical. Tests + lint clean post-revert.

### Implications for the restricted-signature design (Phase 11)

The §28 reading also drops the **Q-D' / `ctx.fired`** proposal entirely. I introduced that to support trigger-only-on-X without same-value re-emit fragility, but §28's closure-mirror handles this case natively (the closure handler captures every emit, not just value-changes). Once activation-phase batching lands, withLatestFrom + switchMap covers the same need. No new ctx slot required.

**Locked Q-D stays as drafted** (current-node `cache` + dep `prevData` only).

The other Phase 11 design decisions (Q-A array return, Q-B push-channel producer, Q-C opts unchanged, Q-E `up`-only effect, NodeFnCleanupHooks symmetric) are unaffected by the §28 reading. They narrow the surface for the cases where the simple sugar already fits — they don't replace closure-mirror for the cases that need it.

### LOCKED Q4 decisions (2026-04-29 evening, post-Q2–Q9 review)

| # | Item | Lock |
|---|---|---|
| 1 | Producer construction-throw semantics | Surface to caller. Synchronous throw at `graph.producer(...)` propagates up. Async errors (in setup body, via push) become `[[ERROR, e]]` emissions on the node. |
| 2 | `describeKind` override behavior | Graph method always wins — auto-set by the method. Caller-supplied `opts.describeKind` is ignored. |
| 3 | Core sugar removal mechanism | **Clean removal — no internal re-exports.** `state` / `derived` / `effect` / `producer` exports come out of `core/sugar.ts` entirely. Operators (`extra/operators/*`, `extra/sources/*`) refactor to use raw `node()` + `batch()` directly (Phase 12). Pattern code refactors to Graph methods + operators + §28 closure-mirror + raw `node() + graph.add` as escape hatch (Phase 13). |
| 4 | Async-source sugar (`graph.fromPromise` / `graph.fromAsyncIter`) | Deferred. Promise/AsyncIterable wrap explicitly via `graph.producer(name, (push) => { ... })`. Revisit if pain surfaces post-migration. |

### Final Phase 11 surface (locked)

```ts
// Pure cell — no fn at all
graph.state<T>(name: string, initial: T, opts?: GraphStateOptions<T>): Node<T>

// Compute — deps + ctx → array of values to emit this wave
//   single emit: [v]    no emit: []    multi: [v1, v2, v3]
//   undefined excluded — SENTINEL stays protocol-only
type DerivedFn<T> = (
  values: readonly unknown[],
  ctx: FnCtxDerived,         // exposes prevData (deps' prior values) + cache (own previous emit only)
) => readonly (T | null)[];
graph.derived<T>(name, deps, fn, opts?): Node<T>

// Side effect — pure sink. up is the only actions surface; no downstream emit possible.
type EffectFn = (
  values: readonly unknown[],
  up: NodeUpActions,         // pause() / resume() only
  ctx: FnCtxEffect,
) => Cleanup | void | NodeFnCleanupHooks;
graph.effect(name, deps, fn, opts?): Node<unknown>

// Source bridge — push-channel; same array-emission shape as derived
type ProducerSetupFn<T> = (
  push: (values: readonly (T | null)[]) => void,
  ctx: FnCtxProducer,
) => Cleanup | void | NodeFnCleanupHooks;
graph.producer<T>(name, setup, opts?): Node<T>      // renamed from graph.produce

graph.batch(fn: () => void): void                                // unchanged
graph.add<T extends Node>(node: T, opts: { name; … }): T          // unchanged — escape-hatch registration
```

`opts` for each: `equals`, `initial`, `meta`, `annotation`, `keepAlive` (derived only), `signal`. `describeKind` is auto-set by the method (caller opts ignored). Same surface as today's Graph methods, just with the restricted fn signatures.

### Q2–Q9 review CLOSED (2026-04-29 evening)

Phase 10 design lock complete. Decisions:

| Question | Outcome |
|---|---|
| Q1 — semantics, purpose, implementation | Locked surface above |
| Q2 — semantically correct | 🟢 all paths verified against §1 / §3 / §28 / §40 / §41 |
| Q3 — design-invariant violations | 🟢 actively closes §5.12 footguns; preserves §28/§40/§41 |
| Q4 — open items | 4 locks above (producer-throw, describeKind, clean-removal, defer-async-sugar) |
| Q5 — right abstraction | 🟢 right granularity; merge-rejected; trigger-only-mode-rejected |
| Q6 — long-term | 🟢 Phase 11 low burden; closure-mirror cost honest until Phase 10.5 ships |
| Q7 — perf / topology | 🟢 zero overhead; closure-mirror sites visible only post-Phase-10.5 |
| Q8 — alternatives | Alt A locked; mechanism C rejected per Q4#3; Alt B/D/E/F rejected |
| Q9 — recommendation | **Alt A — restricted signatures + clean core-sugar removal + Phase 10.5 framework fix as separate prerequisite for Phase 15 library-wide closure-mirror cleanup** |

### Phase 10.5 — `partial: false` is the actual fix (insight 2026-04-29 evening)

The framework fix tracked in [optimizations.md:812-822](../../docs/optimizations.md#L812) was scoped to either (a) dep-order flip (breaks diamond callers) or (b) activation-phase batching (combined wave). Neither is needed: the existing `NodeOptions.partial: false` first-run gate ALREADY solves the activation-phase coalescing — fn waits until every dep delivers real DATA before firing.

`withLatestFrom` currently passes `partial: true` (per [core/node.ts:262](../../src/core/node.ts#L262) comment). Flipping to `partial: false` gates the first run; subsequent waves are gate-free (gate scope is `_hasCalledFnOnce === false` only, per [core/node.ts:268](../../src/core/node.ts#L268)). The "fire on primary alone after warmup" semantics are preserved for waves 2+; only the activation drop is fixed.

**Behavior diff:** activation when one dep is sentinel forever — `partial: true` (current) emits RESOLVED on primary's push-on-subscribe; `partial: false` (proposed) stays silent. Audit needed: any consumer depending on the activation-RESOLVED-with-sentinel-dep behavior. Likely empty.

**Phase 10.5 rescoped to: flip withLatestFrom's partial flag, run tests.** If green, audit `valve` and worker-bridge aggregators (the other partial:true consumers) for the same flip. Single-PR change rather than a separate design session.

Once 10.5 is green, Phase 15 (library-wide §28 cleanup) is unblocked.

### Phase 16 finding (2026-04-29 evening) — superseded by §28 reading; kept for history

**Note (post-§28 reading):** the analysis below describes what was attempted before reading COMPOSITION-GUIDE §28. §28 documents the Phase 16 migration target (`withLatestFrom + switchMap`) as the WRONG direction for state+state-cached deps; the test failures listed below are the documented symptom from §28. Closure-mirror IS the canonical pattern; the framework-fix path is at the runtime layer (activation-phase batching), not at the migration site. Section retained for the failure-mode catalog only.

**What was attempted.** Phase 16 (per the Course Correction's "agent-memory + distill internal closure-mirror → `withLatestFrom + switchMap`") refactored three sites:
- `extra/composite.ts` `verifiable` explicit-trigger path
- `extra/composite.ts` `distill` consolidate path
- `patterns/ai/presets/agent-memory.ts` §40 extractFn bridge

**What broke.** 5 test failures, all the same root cause:
- `runs verification from explicit trigger` ([__tests__/extra/composite.test.ts:11](../../src/__tests__/extra/composite.test.ts#L11)) — initial verification dropped.
- `accepts falsy scalar trigger values` ([__tests__/extra/composite.test.ts:47](../../src/__tests__/extra/composite.test.ts#L47)) — same.
- `accepts falsy scalar context and consolidateTrigger` ([__tests__/extra/composite.test.ts:147](../../src/__tests__/extra/composite.test.ts#L147)) — initial consolidate dropped.
- `B12: contextWeight boosts entries whose breadcrumb matches the query` ([__tests__/patterns/ai.test.ts:1444](../../src/__tests__/patterns/ai.test.ts#L1444)) — agent-memory initial extraction dropped.
- `B20: retrieveReactive emits results when query node changes` ([__tests__/patterns/ai.test.ts:1410](../../src/__tests__/patterns/ai.test.ts#L1410)) — same.

**Root cause.** `withLatestFrom`'s documented caveat ([extra/operators/index.ts:896-906](../../src/extra/operators/index.ts#L896)): on initial activation when both deps are state-cached, the paired emission is dropped. Subscription order is sequential (primary first, secondary second), so primary's push-on-subscribe fires while secondary is still SENTINEL → first-run gate forces RESOLVED. Secondary's later push fires alone → fn's "emit only when primary fired this wave" rule takes the else branch. Net: no DATA reaches downstream from the initial pair.

The closure-mirror form works around this by reading `sourceNode.cache` at FACTORY TIME (boundary read, not inside a reactive fn) and seeding `latestSource` directly. The first trigger emission then sees a populated closure variable. withLatestFrom has no equivalent factory-time seed for secondary's prevData.

**Implication.** Every closure-mirror site that needs "first trigger emit pairs with current secondary cache" hits W1. That's:
- agent-loop's 5 mirrors (Phase 15 redo) — the gate-only-on-status pattern needs initial pairing.
- pipeline-graph's `latestIsOpen` (Phase 15 redo) — initial gate decision needs `isOpenNode`'s cached value.
- agent-memory's §40 extractFn (Phase 16 attempt) — initial raw emission needs current existing.
- distill's consolidate (Phase 16 attempt) — initial trigger needs current store.
- verifiable's explicit trigger (Phase 16 attempt) — initial verify needs current source.

**Resolution path — re-scoped after the partial:false insight (2026-04-29 evening).** W1 is **specific to `withLatestFrom` and other partial-dep operators** that explicitly disable the §2.7 first-run gate (`partial: true`) to admit "primary fires alone, secondary samples passively" semantics. `graph.derived` defaults to `partial: false` — its fn waits until every dep has delivered real DATA before firing. State-cached deps deliver immediately via push-on-subscribe; fn fires once with all values populated. **W1 does not block `graph.derived`.**

This re-frames the closure-mirror migrations entirely: instead of routing through `withLatestFrom + switchMap` (which is partial:true and hits W1), route through `graph.derived(partial: false) + switchMap`. The bridge becomes:

```ts
// agent-memory §40 — under restricted signatures (Phase 11+)
const triggerStream = graph.derived(
  ["raw", "existing"],
  ([raw, existing], ctx) => {
    if (raw == null) return [];
    if (Object.is(raw, ctx.prevData[0])) return [];   // raw didn't change → no re-extract
    return [{ raw, existing }];
  },
);
const extractionStream = switchMap(triggerStream, ({ raw, existing }) =>
  rawExtractFn(raw, existing as ReadonlyMap<string, TMem>),
);
```

No closure-mirror, no `.cache` from inside fn, no W1. Cycle-break preserved: when `existing` emits because of an applied extraction, fn re-fires, prev-comparison says "raw unchanged" → returns `[]` → no re-extraction. Same shape works for `distill` consolidate and `verifiable` explicit trigger.

**Edge case surfaced:** prev-comparison treats same-value-re-emit as no-op. For state-backed triggers where the user wants `trigger.emit(true)` followed by `trigger.emit(true)` to fire twice, prev-comparison won't differentiate. To handle this, the fn needs wave-level info ("did this dep fire DATA this wave?"), which prev-comparison alone doesn't provide. See **Q-D' below** (new design question for the restricted ctx scope).

**Position of W1 in the corrected plan:**
- **W1 is no longer a Phase 16 blocker** for the closure-mirror migrations (agent-memory, distill, verifiable). They migrate via `graph.derived(partial:false) + switchMap` once Phase 11 (restricted signatures + ctx access) lands.
- **W1 is no longer a Phase 15 blocker** for agent-loop / pipeline-graph closure-mirror redos — same `graph.derived(partial:false) + ctx.prevData` pattern handles them.
- **W1 remains an outstanding bug** in `withLatestFrom` itself. Two resolutions still on the table:
  - **W1.A — runtime activation seeding in `core/node.ts`** (`ctx.prevData[i]` initialized from `deps[i].cache`). Benefits any partial:true operator. Risk: changes meaning of `prevData[i] === undefined`.
  - **W1.B — sibling operator** (`withLatestFromEager`) with the eager-initial behavior. Narrower, lower-risk.
  - W1 fix can land independently (anytime); no longer co-prerequisite for the narrow-waist redo.

**Phase 16 status update.** The reverted code (closure-mirrors retained at [composite.ts:94-99 + 209-216](../../src/extra/composite.ts) and [agent-memory.ts:196-208](../../src/patterns/ai/presets/agent-memory.ts#L196)) stays in place pending Phase 11. Comments on those sites updated to reference the corrected migration target (`graph.derived(partial:false)` once restricted signatures land), not the abandoned `withLatestFrom + switchMap` form.

### Q-D' — new design question surfaced by the partial:false insight

Under the restricted `FnCtxDerived` (Q-D), what minimal extension to ctx covers the "did this dep fire DATA in the current wave" detection without re-exposing the full protocol surface?

- **D.1 — `prevData` + `cache` only** (current Q-D lock). Authors use prev-comparison for trigger-detection. Fragile for same-value re-emits.
- **D.2 — add `ctx.fired: readonly boolean[]`.** Parallel array to `values` indicating whether each dep emitted DATA in the current wave. Smallest extension that lets fn express trigger-only-on-X without re-exposing batch/protocol shape. `if (!ctx.fired[0]) return [];` reads naturally.
- **D.3 — expose `ctx.batch[i]`** (per-dep wave emission array, raw `node()` ctx surface). Authors get full wave granularity but the abstraction collapses — fn ctx becomes the same as raw `node()` ctx, defeating narrowing.

**Recommendation: D.2.** Smallest extension. Lets `graph.derived(partial:false)` fully replace `withLatestFrom` for trigger-only semantics in pattern-author code, without any operator-layer fix. Lock D.2 as part of Phase 11.

### Updated implementation sequence (post-§28 reading)

Phases 1–9 stay above as the historical record (Phases 1-7 landed; Phase 9 reverted post-§28-reading). Phases 10+ are the corrected plan with §28-aware ordering:

| Phase | Scope | Risk | Status |
|---|---|---|---|
| 10 | Q2–Q9 design pass on restricted signatures (Q-A array return, Q-B push-channel producer, Q-C opts unchanged, Q-D current-node cache + dep prevData, Q-E up-only effect, NodeFnCleanupHooks symmetric, `graph.state` new, `graph.producer` rename) | Design — locks the new API shape | Q2-Q9 in progress this session |
| **10.5** | **Activation-phase batching design session (framework fix for closure-mirror visibility).** Either (a) diamond-topology audit + naïve `[secondary, primary]` flip in `withLatestFrom`, or (b) coalesce all deps' push-on-subscribe into one combined initial wave at activation. Tracked in [optimizations.md:812-822](../../docs/optimizations.md#L812). **Unblocks Phase 15 cleanup across the library.** | Framework — significant. Needs its own 9-question session. | pending — separate design session |
| 11 | Implement restricted signatures: `graph.state` (new), `graph.derived` (signature change to array-return + tightened `ctx`), `graph.effect` (signature change to `up`-only + tightened ctx), `graph.producer` (rename + push-channel signature) | Breaking pre-1.0; tests + patterns adapt | pending Phase 10 lock |
| 12 | Refactor `extra/operators/*` and `extra/sources/*` to use raw `node()` + `batch()` directly (drop core-sugar imports) | Low — most operators already use `node` | pending |
| 13 | Refactor `src/patterns/` to use only Graph methods + operators + closure-mirrors per §28 (escape hatch: raw `node() + graph.add`) | Moderate — touches all 16 domains | pending |
| 14 | Remove `state` / `derived` / `effect` / `producer` exports from `core/sugar.ts` | Trivial after 12 + 13 | pending |
| 15 | **Post-Phase-10.5 only.** Closure-mirror cleanup library-wide: every §28 site (`stratify`, `budgetGate`, `gate()`, `distill`'s `latestStore`, `verifiable`'s `latestSource`, agent-loop's 5 mirrors, pipeline-graph's `latestIsOpen`, agent-memory's §40 bridge, memory-composers' `latestCtx`, ...) migrates to `withLatestFrom + switchMap + graph.add`. Real reactive edges replace closure variables. | Low — tests exist; depends on 10.5 | **blocked on Phase 10.5** |
| 16 | (subsumed into Phase 15) — agent-memory + distill internal + verifiable are §28 sites covered by 15 | n/a | n/a |
| 17 | Update P1–P7 properties for restricted signatures + add P8+ covering array-emission semantics | Tests only | pending — P1-P7 in `_invariants.ts` registry 57–64 currently test legacy signature |
| 18 | Composition guide rewrite (the original Phase 8, now with the corrected taxonomy: `node()` + operators + Graph methods + closure-mirror as documented §28 escape hatch until Phase 10.5 unblocks the library-wide migration) | Docs only | pending |

Out of scope for this redo (separate design units): Unit B (`reactiveMap` reactive-retention + optimizations.md D1), `distill` API change to take a graph + register store eagerly (post-Phase-15 distill internal closure-mirror migrates anyway, so the API change becomes optional).

### What changes in the project memory

`project_graph_narrow_waist.md` to be updated with:
- Bound the "narrow waist" claim — registration ergonomics + restricted signatures, NOT a pattern↔protocol decoupling layer in itself.
- Operators are Level-2 authoring vocabulary, not "escape hatches" or Level-3-only.
- Restricted fn signatures lock decisions A.1, B.1, Q-D, Q-E above.
- Core sugar (`state`/`derived`/`effect`/`producer` from `core/sugar.ts`) is removed from the public API; raw `node()` + `graph.add` is the explicit escape hatch.

---

## Related Files

- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — protocol spec
- `~/src/graphrefly/COMPOSITION-GUIDE.md` — current monolithic guide (to be split)
- `src/graph/graph.ts` — Graph class (methods added here)
- `src/core/sugar.ts` — `derived`, `effect`, `producer` (underlying primitives)
- `src/extra/sources/index.ts` — `keepalive`, `fromAny`, `NodeInput` (reused by new methods)
- `archive/docs/SESSION-patterns-extras-consolidation-plan.md` — two-layer separation precedent
- `archive/docs/SESSION-ai-harness-module-review.md` — 9-question format definition
- `archive/docs/SESSION-graph-module-24-unit-review.md` — Graph class audit
- `docs/optimizations.md` — active backlog
