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

### Implementation sequence

| Phase | Scope | Risk |
|---|---|---|
| 1 | `graph.batch(fn)` | Trivial — 1 LOC wrapper |
| 2 | `graph.derived(name, depPaths, fn, opts)` with `keepAlive` | Low — wraps resolve + derived + add + optional keepalive |
| 3 | `graph.effect(name, depPaths, fn, opts)` | Low — wraps resolve + effect + add |
| 4 | `graph.produce(name, source, opts)` | Moderate — decide `fromAny` vs `singleFromAny` dispatch |
| 5 | Fold `explain` + `reachable` into `describe()` | Moderate — overload signature changes |
| 6 | Remove `get`, `setAll`, `removeAll`; extract `trace` to inspect/ addon | Breaking (pre-1.0) |
| 7 | Fast-check properties P1-P7 | Tests only |
| 8 | Composition guide split into 4 level-based files | Docs only |
| 9 | Migrate 1-2 patterns per phase to validate | Validation |

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
