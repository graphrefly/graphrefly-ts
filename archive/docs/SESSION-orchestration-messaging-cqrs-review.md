# Session — Orchestration / Messaging / Job-Queue / CQRS Module Review

**Date started:** 2026-04-24
**Precedent:** `SESSION-ai-harness-module-review.md` (2026-04-23 → 04-24, 24 units).
**Scope:**
- `src/patterns/orchestration/index.ts` (622 LOC) — 10 primitives
- `src/patterns/messaging/index.ts` (457 LOC) — 4 graph classes + 4 factories
- `src/patterns/job-queue/index.ts` (249 LOC) — 2 graph classes + 2 factories
- `src/patterns/cqrs/index.ts` (495 LOC) — 1 graph class + CQRS envelope + event store
- **Total:** 1,823 LOC, ~22 units.
**Format:** Same 9-question per-unit format as the AI/harness review (Q1 semantics → Q9 recommendation), including explainability/topology check inside Q7. Decisions locked per-batch so we can move on.

---

## Why this review

Mirrors the AI/harness review drivers, re-framed for this slice of the codebase:

1. **These modules are the oldest Phase-4 code** — written before the §24 "edges are derived" rule was codified, before the `messageTier` utility, and before the P3 `.cache`-in-fn scrub. Drift is expected.
2. **Composition overlap.** `orchestration.gate`, `harness.gate`, `approval` are three human-in-the-loop shapes with partial overlap. Same story for `topic` vs `pubsub`, `jobQueue` vs a subscription with a gate, `cqrs.event` vs `topic`. Consolidation candidates need naming.
3. **Imperative-publish smells (pagerduty-demo class).** First-pass reading flags at least three imperative cross-graph publishes:
   - `TopicBridgeGraph` pump effect calls `_target.publish(mapped)` and `bridgedCount.emit(…)` inside the fn body.
   - `JobFlowGraph` pump effect calls `next.enqueue(payload, …)` and `current.ack(id)` inside the fn body.
   - `CqrsGraph.dispatch` handler runs synchronously inside `batch()` and calls `_appendEvent` which then pushes to `reactiveLog.append`.
   Each of these is a place where `describe()` / `explain()` will show broken linkage between "where the pump reads" and "where it writes".
4. **Alignment with eventual vision.** The §9.0 harness loop uses `promptNode`, `gate`, `funnel`, `reduction` primitives — not `orchestration.task` / `orchestration.branch`. If these Phase-4 primitives are dead weight for the harness vision, shrink-or-consolidate. If they're live for an intentional subset of users (Pulsar / CQRS / workflow-DAG crowd), audit them for composability with harness primitives.
5. **Pre-1.0, no backward-compat budget.** Rename, delete, restructure as needed.

---

## Explainability criterion (applies to every unit)

Reuse the rule from the AI/harness review:

1. Wire a minimal composition exercising the primitive with ≥2 upstream sources and ≥1 downstream sink.
2. Run `graph.describe({ format: "ascii" })` + `graph.describe({ format: "mermaid" })`.
3. Check for islands / self-only nodes — a node with zero in-edges AND zero out-edges (that isn't the designated entry/exit) is a smell.
4. Run `graph.explain(source, sink)`. Causal chain should name every node the data flowed through.
5. Record the topology-check result per unit.

When the topology check fails, the fix is ALWAYS one of (§24 / §28 / §32):
- Convert imperative `.emit()` / `.publish()` calls inside fn bodies into proper `derived([…], fn)` edges.
- Replace closure-captured mutable state with a registered `state()` node.
- Remove `.cache` reads from reactive fn bodies (§24/§28 factory-time seed sanctioned at wiring, not inside fn).
- Move source-boundary work into proper sources at the edge.
- For pump-style relays, the pump's fn should return the new value via `actions.emit(...)` on an output node the target depends on — not imperatively call `.publish()` on another graph.

---

## Per-unit review format

Each unit answers nine questions (topology / perf folded into Q7):

1. **Semantics, purpose, implementation** — with file+line refs.
2. **Semantically correct?** — edge cases, subtle bugs.
3. **Design-invariant violations?** — COMPOSITION-GUIDE + spec §5.8–5.12. 🔴 violation / 🟡 gray-zone / 🟢 clean.
4. **Open items** — roadmap.md + optimizations.md cross-refs.
5. **Right abstraction? More generic possible?**
6. **Right long-term solution? Caveats / maintenance burden?**
7. **Simplify / reactive / composable + topology check + perf/memory.**
8. **Alternative implementations (A/B/C…)** with pros/cons.
9. **Recommendation** with coverage table against Q2–Q6.

Each unit ends with **"Decisions locked (date)"** capturing the user's call on each open question + the implementation-session scope.

---

## Batch plan (proposed)

> **Open for refinement at any batch boundary.** The split tries to group units that share a common set of concerns so discussion flows; adjust if a batch feels wrong.

### Wave A — Orchestration (10 units)

| Batch | Units | Theme |
|---|---|---|
| **A.1** | 1–6 | Declarative wiring: `pipeline`, `task`, `branch`, `join`, `subPipeline`, `sensor` |
| **A.2** | 7–10 | Control primitives (stateful / human-in-loop): `approval`, `gate`, `loop`, `onFailure` |

### Wave B — Messaging + Job-Queue (6 units)

| Batch | Units | Theme |
|---|---|---|
| **B.1** | 11–12 | Messaging core: `TopicGraph`, `SubscriptionGraph` |
| **B.2** | 13–14 | Messaging composition: `TopicBridgeGraph`, `MessagingHubGraph` |
| **B.3** | 15–16 | Job-queue: `JobQueueGraph`, `JobFlowGraph` |

### Wave C — CQRS (6 units)

| Batch | Units | Theme |
|---|---|---|
| **C.1** | 17–18 | Event primitives: `CqrsEvent` + envelope, `event(name)` |
| **C.2** | 19–20 | Write side: `command(name, handler)` + `dispatch()`, guards |
| **C.3** | 21–22 | Read side + persistence: `projection()`, `saga()`, `EventStoreAdapter` + `rebuildProjection` |

After Wave C we consolidate cross-cutting findings (same as AI/harness Unit 14 / Wave C).

---

## Current drift suspicions (to validate per-unit)

Collected from the first-pass reading of all four files:

- **Explainability failures:**
  - `TopicBridgeGraph` pump imperatively calls `target.publish()` + `bridgedCount.emit()` from fn body. Source → target edge is invisible.
  - `JobFlowGraph` pump imperatively calls `next.enqueue()` + `current.ack()` from fn body. Stage→stage edge is invisible.
  - `CqrsGraph.command` stores handler in a `Map` outside the node; `dispatch` is imperative. Command→event edges are invisible (handler is a closure).
  - `CqrsGraph.saga` stores cursor in `lastCounts: Map<string, number>` closure, not a state node.
  - `orchestration.onFailure` uses `node([], fn)` with manual `src.node.subscribe()` in fn body. Output node has zero declared deps; edge is invisible.
  - `orchestration.sensor` is a `node([], () => undefined, {…})` producer with imperative `push/error/complete`. Zero deps, declarative shape is "producer" — intentional for boundary sources, but users wire it post-hoc.

- **Abstraction overlap:**
  - `orchestration.gate` vs `harness.gate` (the §18 unit in the previous review) vs `orchestration.approval`. Three human-in-loop surfaces.
  - `messaging.topic` vs `extra/pubsub` vs `cqrs.event`. Three append-only log shapes.
  - `orchestration.loop` vs `patterns/refine-loop.refineLoop`. Two iteration shapes.

- **Dead / redundant code:**
  - `orchestration.registerStep`'s `depPaths` parameter is explicitly documented as no-op ([orchestration/index.ts:82–85](../../src/patterns/orchestration/index.ts:82)).
  - `orchestration.resolveDep`'s `findRegisteredNodePath` does a full `graph.describe()` scan on every `task/branch/join/…` call with a `Node` arg — O(nodes) per call.
  - `orchestration.task` re-implements the `derived` fn unwrap manually (`batchData.map + run(data, ctx)`) — the same shape `derived` already provides.

- **P3 `.cache` reads inside fn bodies** (partial list from optimizations.md):
  - `messaging.ts` `retained` / `ack` / `pull` / `bridgedCount` — external API methods (sanctioned boundary).
  - `patterns/orchestration/index.ts:623` — marked sanctioned external-consumer API.
  - `patterns/cqrs/index.ts:243` — sanctioned factory-time seed.
  - Re-audit needed to confirm none leaked into fn bodies after the recent split.

- **Async in public API (TS allows; PY parity gap):**
  - `CqrsGraph.rebuildProjection` is `async`. PY invariant says no `async def` in public APIs.
  - `EventStoreAdapter.loadEvents` returns `LoadEventsResult | Promise<LoadEventsResult>` — sync-or-async shape passed through.

- **Imperative cross-graph writes missing batch wrap:**
  - `JobFlowGraph` pump does `next.enqueue(…)` + `current.ack(id)` — two cross-graph state writes in one fn run. No outer `batch()`.
  - `TopicBridgeGraph` pump does multiple `target.publish(mapped)` + one `bridgedCount.emit(...)` — no outer `batch()`.
  - `CqrsGraph.dispatch` wraps in `batch()` — correct.

---

## Decisions log (running)

Appended as we lock batches. Entries sized `YYYY-MM-DD | unit | decision`.

- 2026-04-24 | A.1 framing | **Shrink `patterns/orchestration` but keep workflow-DAG sugar via a `PipelineGraph extends Graph` subclass.** Where a base `Graph` method already covers the need (e.g. `subPipeline` ≡ `Graph.mount`), delete the orchestration wrapper and rely on inheritance — callers write `pipeline.mount(...)`.
- 2026-04-24 | Unit 1 | **`pipeline(name, opts)` returns `PipelineGraph extends Graph`.** The subclass owns `.task / .classify / .combine / .approval / .gate / .loop / .onFailure` methods; inherits `.mount / .add / …` from `Graph`. The factory earns its keep.
- 2026-04-24 | Unit 2 | **Delete `task` factory; migrate to `PipelineGraph.task(name, fn, { deps })` method.** Reuses `derived` internally (no fn-unwrap drift). `StepRef` union collapses: Node deps resolved via a `WeakMap<Node, string>` maintained by base `Graph.add`; string deps resolved via `this.resolve(s)`. `depPaths` dead-param removed. Meta tag `orchestration_type: "task"` preserved.
- 2026-04-24 | Unit 3 | **Delete binary `branch`; replace with `PipelineGraph.classify(name, source, (v) => tag)` n-way classifier.** Envelope: `Node<{ tag: Tag; value: T }>`. Classifier-throw policy: catch and emit `{ tag: "error", value, error }` instead of terminating the stream. Defer `routeOn` / `router` until a real consumer asks. Binary callers use `(v) => v > 10 ? "a" : "b"`.
- 2026-04-24 | Unit 4 | **Delete `join`; replace with `PipelineGraph.combine(name, { a, b, c })` keyed-record form.** Returns `Node<{ a: A; b: B; c: C }>`. First-run gate (`partial: false`, wait for all deps) + §28 factory-time seed applied internally so push-on-subscribe over multi-state deps doesn't emit extra activation waves. Positional-tuple callers inline `derived(arr, vs => vs as […])`. Name locked as `combine` (bikeshedable — `combineLatest` is a longer alternative if RxJS familiarity trumps brevity).
- 2026-04-24 | Unit 5 | **Delete `subPipeline`.** Callers use inherited `pipeline.mount(...)`. Add builder-form overload to base `Graph.mount`:
  - `graph.mount(name)` — auto-creates a new child `Graph(name)` and mounts it.
  - `graph.mount(name, sub => { … })` — builder runs on a new child Graph BEFORE mount (preserves current "mount shows populated graph" timing).
  - `graph.mount(name, existing)` — current shape, unchanged.
- 2026-04-24 | Unit 6 | **Move `sensor` to `extra/sources.ts` as `producer(name, initial?)`, tier universal.** Controls envelope `{ node, push, error, complete }` preserved. Orchestration loses a boundary primitive it was mis-hosting. Name `producer` accepted despite shadowing the `describeKind` enum value — call-out in JSDoc. PY mirror in `graphrefly.extra.sources`.
- 2026-04-24 | A.1 cross-cutting | **Base-Graph improvements required by the above (pre-requisite for Units 2/5):**
  - `Graph.add(node, { name })` populates a private `WeakMap<Node, string>` (`_nodeToPath`) so subclass methods can do O(1) Node→path lookup. Replaces `findRegisteredNodePath`'s O(nodes²) describe-scan.
  - `Graph.mount(name, builderOrChild?)` gets the builder-form overload above.
  - `registerStep`'s dead `depPaths` parameter removed (only lives inside orchestration module; PipelineGraph methods call `this.add` directly).
- 2026-04-24 | A.1 PY parity | **Mirror `PipelineGraph` subclass in PY (`graphrefly.patterns.orchestration.PipelineGraph`).** Python method equivalents: `.task() .classify() .combine() .approval() .gate() .loop() .on_failure() .mount()`. Move `sensor` → `producer` into `graphrefly.extra.sources`. `WeakMap` analogue in PY: `WeakKeyDictionary[Node, str]` inside `Graph.add`. No `async def` anywhere in these methods.
- 2026-04-24 | Unit 7 | **Delete `approval` factory; unify into `pipeline.gate(src, opts)` with a mode selector.** Modes: `{ }` (imperative controller, default), `{ approver: Node }` (reactive auto-approve on truthy), `{ approver, onceOnly: true }` (latch — first approve opens permanently; `close()` becomes a no-op after). Keep `pipeline.approval(name, src, approver)` as a **thin method alias** that delegates to `this.gate(name, src, { approver, maxPending: 1 })` — one implementation, read-as-English ergonomics preserved. Re-emit policy: `maxPending: 1` means "emit on approve by draining the single-item queue." `maxPending: 0` (no queue) means approve is forward-only; no re-emit of history.
- 2026-04-24 | Unit 8 | **Rewrite `gate` per Alternative F — imperative controller + reactive audit tap + batched controller loops + bounded default.** Method on `PipelineGraph`: `pipeline.gate(name, src, opts?): GateController<T>`. Changes from today's shape:
  1. Add `decisions: Node<readonly Decision[]>` to controller envelope; mount in state subgraph.
  2. Add `droppedCount: Node<number>`; emit `Decision { action: "drop", items, count, t_ns }` on `maxPending` FIFO drops.
  3. Wrap `approve / reject / modify` controller bodies in `batch()` so bulk operations coalesce to one wave (not N).
  4. Default `maxPending = 1000` (was `Infinity`). `Infinity` still opt-in.
  5. Every controller method emits a `Decision` with `wallClockNs()` timestamp. Discriminated union:
     ```ts
     type Decision<T> =
       | { action: "approve"  | "reject" | "modify" | "drop"; count: number; items: readonly T[]; t_ns: number }
       | { action: "open"     | "close"  | "teardown"; t_ns: number; unflushed?: number };
     ```
  6. Teardown path emits final `Decision { action: "teardown", unflushed: queue.length, t_ns }` before clearing queue — visibility for dropped-on-teardown cases.
  7. **PY parity:** per-gate lock (`threading.Lock` or equivalent) guarding `queue / torn / latestIsOpen` read/write. Design for free-threaded Python.
  8. Unit 7 approver modes integrated via `opts.approver` / `opts.onceOnly`.
  9. `Decision` is the public primary audit surface; no parallel `approveCount: Node<number>` / `rejectCount: Node<number>` scalar mounts (consumers filter via `derived`).
- 2026-04-24 | Unit 9 | **Delete `loop` entirely.** Zero in-tree users beyond the export barrel. Remove from TS + PY patterns surface, from `exports.test.ts`, from JSDoc, from docs. "loop" name left available for a future reactive-iteration primitive if one surfaces. Users needing fixed-count synchronous iteration write `derived([src], v => { let c = v; for (let i = 0; i < N; i++) c = f(c, i); return c; })` inline. Users needing convergent iteration use `refineLoop` (§9.8).
- 2026-04-24 | Unit 10 | **Rewrite `onFailure` as dep-channel `catch` (B + C combined).** Method on `PipelineGraph.catch(name, src, recover, opts?)` — renamed from `onFailure` pre-1.0 (the method name `catch` is a valid JS property even though it's reserved as an identifier).
  - **Shape:**
    ```ts
    type TerminalCause =
      | { kind: "error"; error: unknown }
      | { kind: "complete" };

    pipeline.catch(name, src, (cause: TerminalCause, actions) => T, {
      on?: "error" | "complete" | "terminal",   // default: "error"
      completeWhenDepsComplete?: boolean,
      ...
    });
    ```
  - **Modes:**
    - `{ on: "error" }` — default. Recover from ERROR only; COMPLETE auto-propagates.
    - `{ on: "complete" }` — recover from COMPLETE only (e.g., replay-on-complete workflows); ERROR auto-propagates.
    - `{ on: "terminal" }` — recover from EITHER; handler must distinguish via `cause.kind`.
  - **Implementation:** dep-channel intercept — `node([src], fn, { errorWhenDepsError: false, completeWhenDepsComplete: false })`, fn reads `ctx.terminalDeps[0]` to classify terminal, calls `recover(cause, actions)` on matching modes, forwards DATA passthrough otherwise.
  - **Kills:** §24 violation (current `node([], …)` manual-subscribe island); closure `terminated` flag (PY race); resubscribable-source bug (core machinery handles terminal-reset now).
  - **PY parity:** mirror `pipeline.catch(...)` as method; terminal cause dataclass.
- 2026-04-24 | Q1 (gate decisions log timing) | **Ship NOW.** Part of the Unit 8 rewrite, not a follow-up.
- 2026-04-24 | Q2 (onFailure narrow vs generalize) | **Generalize.** `catch` with `{ on }` modes — user decision: "catch makes sense for ERROR/TERMINAL".
- 2026-04-24 | Q3 (approval alias) | **Keep `pipeline.approval(name, src, approver)` as thin method alias** over `pipeline.gate(name, src, { approver, maxPending: 1 })` — read-as-English ergonomics preserved, one implementation.

---

## Eventual vision — the frame this review validates against

Same as the AI/harness review:

- Ring 1 (Substrate): reactive state coherence · `graph.explain` causal tracing · reduction layer.
- Ring 2 (Harness composition): `promptNode`, `gate.modify()`, `agentMemory`, `refineLoop`, stream extractors.
- Ring 3 (Distribution): `surface/` → MCP + CLI, framework adapters.

**For this review specifically**, the question is: which of orchestration / messaging / job-queue / cqrs survives as a public domain-layer API versus gets absorbed into a smaller set of "reactive collection + pump" primitives? The review doesn't need to answer that globally upfront — it answers it unit by unit via Q5 ("right abstraction?") and Q8 ("alternatives").

---

## Wave A — Orchestration

### Unit 1 — `pipeline(name, opts)`

**Scope:** [src/patterns/orchestration/index.ts:112–117](../../src/patterns/orchestration/index.ts:112) (~6 LOC).

#### Q1 — Semantics, purpose, implementation

- `pipeline(name, opts?)` returns `new Graph(name, opts)`. Pure one-liner constructor alias.
- Used as the parent container that every other `orchestration.*` factory takes as first argument.
- No semantic difference from `new Graph(…)` — cosmetic naming + subdomain tag.

#### Q2 — Semantically correct?

- ✅ Nothing to get wrong — it's `new Graph()`.

#### Q3 — Design-invariant violations?

- 🟢 Clean. No fn body, no `.cache` reads, no timers.

#### Q4 — Open items

- Not in roadmap or optimizations. Indirect: roadmap §4.1 "Orchestration patterns" lists the bucket of which this is the root factory.

#### Q5 — Right abstraction?

- ❌ **It is not an abstraction.** It is a one-line alias that tells users the type of `Graph` they are about to construct. That information is already carried by the factories they call next (`task`, `branch`, …). Users who type `const g = pipeline("my-workflow")` learn nothing a `new Graph("my-workflow")` wouldn't also have told them.
- More generic: the natural Phase-4 "workflow graph" is just `Graph`. There is no orchestration-specific constructor behavior.

#### Q6 — Right long-term solution?

Two forces pulling opposite directions:

- **Consistency force (keep).** Every other pattern module ships a named factory that returns a specialized subclass: `messagingHub → MessagingHubGraph`, `cqrs → CqrsGraph`, `jobQueue → JobQueueGraph`, `jobFlow → JobFlowGraph`, `topic → TopicGraph`. Users reading `patterns/` see a clear idiom: "each domain has a factory; factories return the right subclass." `pipeline` fits the shape even though it currently returns plain `Graph`.
- **Honesty force (delete).** Those other factories *actually do work* — `MessagingHubGraph` tracks a `_topics` Map and `_version` counter, `CqrsGraph` holds handler maps and guards, `JobFlowGraph` builds multi-stage pumps. `pipeline` is a `new Graph()` wrapper, nothing more. Keeping it means users import a symbol that lies about doing something.
- **Third option (make it honest).** Introduce `PipelineGraph extends Graph` with methods `.task(name, fn, {deps})`, `.branch(name, src, pred)`, `.join(name, deps)`, `.classify(...)`, `.mount(name, sub)`. `pipeline(name)` returns it. Now `pipeline` has a reason to exist — every subsequent Unit (2–5) collapses into a method on that subclass, and `orchestration` becomes a shape-shifted `Graph` with ergonomic sugar for the workflow-DAG mental model. This is the "workflow DAG user" home.
- **Special case cost if kept as alias:** renames are breaking. Committing to `pipeline` as a public verb means we can't later repurpose the name without a migration. If we're unsure, deletion is cheaper than keeping options open.
- **PY parity:** whatever we choose, Python's `graphrefly.patterns.orchestration.pipeline` has to mirror. The subclass path (option C) is more Python-native (decorators + methods) than a bag of module-level factories.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** N/A — `pipeline` adds no nodes. All topology comes from whatever the caller wires next.
- **Perf:** +1 function call per workflow graph construction — measurable only if users spin up thousands of workflows in a tight loop. Not a hotspot.
- **Memory:** zero beyond `new Graph()` itself.
- **Reactive/composable:** the factory itself is trivially composable; the question is whether it earns its slot in the barrel.
- **Simpler shape:** `new Graph(name, opts)` in user code. Or `PipelineGraph` subclass if we take option C below — which trades shape-simplicity for surface-honesty.

#### Q8 — Alternatives

- **A. Delete.**
  - Pros: strictly fewer public symbols; users learn `Graph` is the base class; stops lying about doing work.
  - Cons: `orchestration` loses its "entry factory", which is a discoverability cue — users grepping `orchestration` for "how do I start" lose the breadcrumb; they now have to know `new Graph()` is the answer; asymmetric with `messagingHub` / `cqrs` / `jobQueue`.
- **B. Keep as cosmetic alias.**
  - Pros: zero-churn; one line of code to maintain; symmetry with the other domain factories at a glance.
  - Cons: 4 bytes of dishonesty; every new reader who opens the source asks "what does this do?" and learns the answer is "nothing"; locked into the name forever.
- **C. Make it honest — `PipelineGraph` subclass with methods.**
  - Pros: gives `pipeline` a real reason to exist; every Unit 2–5 factory (task / branch / join / subPipeline) migrates to methods on this subclass and loses the factory-redundancy wart; aligned with the `messagingHub` / `cqrs` / `jobQueue` pattern (factory returns a specialized subclass); fluent chainable API (`pipeline("x").task("a", fn).branch("b", …)`).
  - Cons: commits to the "workflow DAG" surface as a first-class mental model; new class hierarchy to maintain; PY parity cost (mirror subclass); decisions in this batch now shape Unit 7–10 too (do `approval` / `gate` / `loop` / `onFailure` also migrate to methods, or stay as factories?).
- **D. Hybrid: delete `pipeline`, add `Graph.task / .branch / .join` methods on the base class.**
  - Pros: removes the factory; doesn't need a new subclass.
  - Cons: pollutes the base `Graph` class with domain-flavored methods — the slippery slope question is "why task but not `promptNode`?"; PY base class gets similarly polluted.

#### Q9 — Recommendation

Two paths, parameterized on your answer to the open question at the end of this batch:

- **If you want `orchestration` to be a thin cover over `Graph`** → **A (delete `pipeline`).** Works cleanly with Units 2–5 also moving to factory-deletion or `derived + graph.add` inlining.
- **If you want `orchestration` to be a first-class "workflow DAG" surface** → **C (`PipelineGraph` subclass).** Works cleanly with Units 2–5 migrating into methods. `pipeline` becomes the natural entry point.
- **Do not pick B.** It's the "decide later" answer that guarantees we revisit this exact question in a year. The current state is B; that's the problem.

**Coverage (for A):** Q2 ✓ (nothing correct to lose), Q5 ✓ (not an abstraction, don't pretend), Q6 ✓ (removes the dishonest-alias issue), forces Units 2–5 into consistent answers.

**Coverage (for C):** Q2 ✓ (subclass still constructs `Graph`), Q5 ✓ (the abstraction IS the methods on the subclass), Q6 ✓ (earns its keep), enables Units 2–5 to lose their factory redundancy by becoming methods.

**Implementation-session scope (either path):** grep call sites (`~4` in demos/tests on first pass), update barrel exports, rewrite imports, update JSDoc. Path C also requires writing the `PipelineGraph` class and porting methods.

---

### Unit 2 — `task(graph, name, run, opts)`

**Scope:** [src/patterns/orchestration/index.ts:122–155](../../src/patterns/orchestration/index.ts:122).

#### Q1 — Semantics, purpose, implementation

- Registers a "workflow task" derived node: `node(deps, wrapped, { describeKind: "derived", meta: { orchestration: true, orchestration_type: "task" } })`.
- Accepts `deps: ReadonlyArray<StepRef>` where `StepRef = string | Node<unknown>`.
- Fn `run(data, ctx)` is wrapped to unwrap `batchData[i]` → scalar (`batch.at(-1) ?? ctx.prevData[i]`), same as `derived` does.
- Emits via `actions.emit(run(data, ctx))`.

#### Q2 — Semantically correct?

- ⚠️ **Dup of `derived`.** The `wrapped` fn (lines 131–137) implements the exact scalar-unwrap shape that `sugar.derived` already implements — the two diverge by zero semantic bits. Maintenance hazard: any change to derived's unwrap (e.g. §28 factory-time seed) has to be mirrored here.
- ⚠️ **`StepRef` string lookup is opaque.** `resolveDep(graph, dep)` calls `graph.resolve(path)` for strings — throws on typo. No type-level check. For a Phase-4 API, a typo'd string `deps: ["inpt"]` is an error at first subscribe, not at construction. (See Unit 6 discussion — all step factories share this.)
- ⚠️ **`findRegisteredNodePath` for Node args** does `Object.keys(graph.describe().nodes)` and calls `graph.resolve(path)` for each path until `=== target`. O(nodes) per `task(…)` call with a Node arg. With 100-node workflows and 50 tasks, that's 5,000 `resolve`+`===` comparisons during construction. A `WeakMap<Node, path>` maintained by `graph.add` removes the scan.

#### Q3 — Design-invariant violations?

- 🟢 No fn-body `.cache`, no raw async, no timers.
- 🟡 **§24 gray-zone:** `registerStep`'s `depPaths` argument is a no-op kept for API signature continuity (lines 82–85 comment: "after Unit 7 edges are derived from node _deps and this wiring is a no-op"). Dead parameter. Removes cleanly.

#### Q4 — Open items

- Not in optimizations. Roadmap §4.1 "Orchestration patterns" just says "shipped"; no open work.

#### Q5 — Right abstraction?

- **Not quite.** `task(graph, name, run, { deps })` is `derived(deps, run, { name })` + `graph.add(step, { name })` + `meta: { orchestration: true, orchestration_type: "task" }`.
- The "graph-scoped" coupling (`graph` as first arg, `StepRef = string | Node`) is the real differentiator — but it's ergonomic sugar, not a new primitive. The value is:
  1. Auto-registration in a named graph (`graph.add(step, { name })`).
  2. String-path deps (`deps: ["input"]`).
  3. Orchestration-domain meta tag for `describe()` grouping.
- More generic: `graph.task(name, run, { deps })` as a Graph method (chainable) would cover (1) and (2) without a global factory per domain. That pattern already exists spiritually — `Graph.add`/`Graph.mount` are methods, not factories.

#### Q6 — Right long-term solution?

Four concerns compound here:

- **`StepRef = string | Node<unknown>` is the original sin.** Every factory in this file (`branch`, `approval`, `gate`, `join`, `loop`, `onFailure`) pays the union tax. String refs are ergonomic for JSON-ish workflow-definition languages (Airflow, Prefect, n8n) where you write `deps: ["fetch", "transform"]` as data. But TypeScript gives zero help with typos — `deps: ["fetch", "tranform"]` compiles, then blows up at subscribe time. Node refs are type-safe but require the node-is-registered scan. Picking one eliminates half the code in this module.
- **Fn-unwrap duplication with `derived`.** `task`'s `wrapped` (lines 131–137) re-implements the `batch.at(-1) ?? ctx.prevData[i]` scalar-unwrap. If `derived`'s unwrap ever changes (e.g., §28 factory-time seed becomes automatic for multi-state deps, or a new "first-run gate" interaction lands), `task`'s hand-rolled version drifts silently. We already have one example of this class of drift cost in `patterns/orchestration/gate` — it manually maintains `latestIsOpen` because §28 wasn't auto-applied.
- **Describe scan is O(nodes²).** `findRegisteredNodePath` calls `graph.describe()` (itself O(nodes) because it walks `_nodes` + mounts) then iterates `Object.keys(described.nodes)` calling `graph.resolve(path) === target` until a match. For a 100-node workflow constructing 50 tasks, you're doing 50 × 100 = 5,000 `resolve` + equality checks per build, and each resolve walks the registry. At 500 nodes × 200 tasks it becomes ~100k operations during graph construction. The fix is trivial: `WeakMap<Node, path>` populated in `graph.add`, O(1) lookup. But living with the scan means construction time grows quadratically in workflow size — silent cliff for workflow-DAG users who wire larger-than-demo graphs.
- **Dead `depPaths` parameter.** `registerStep(graph, name, step, depPaths)` ignores `depPaths` (line 84–85 explicitly notes this). It's a vestige from the pre-§24 era where edges had to be declared separately. Keeping it is zero cost in bytes but non-zero in "what does this code actually do?" confusion for new readers.
- **Migration cost of breaking the string path:** Airflow-style users expect string deps. Killing them cuts off that UX. Keeping them is cheap if we index by `WeakMap` (perf fix) and document `task.deps: ["name"]` as a deliberate "data-first" shape. But the string path never earns its cost unless we also ship a separate JSON/YAML workflow-loader layer — which we don't today.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** ✓ `task(g, "x", fn, { deps: [a, b] })` produces a derived node with real `_deps = [a, b]`. `describe()` shows edges. `explain(a, x)` walks cleanly.
- **Perf:** two hotspots. (1) `findRegisteredNodePath` O(nodes²) at construction time — fixable with `WeakMap<Node, string>` maintained in `graph.add`. (2) Per-wave overhead: `wrapped`'s `batchData.map(…)` allocates a new array every wave, same as `derived`. Baseline identical.
- **Memory:** no closures retained past construction beyond whatever the user's `run` holds.
- **Simpler shapes (ordered from least to most change):**
  1. Keep `task`, fix `findRegisteredNodePath` via WeakMap, delete `depPaths` argument. Doesn't address redundancy.
  2. Replace `task` body with `derived(resolved.map(r => r.node), run, {…, name, meta: baseMeta("task")})` + `graph.add(step)`. Removes fn-unwrap duplication; still ships factory.
  3. Delete `task` export. At call sites: `graph.add(derived([a, b], fn, { name: "x" }))`. Factory-free.
  4. `graph.task("x", fn, { deps: [a, b] })` method on `Graph`. Pollutes base.
  5. `pipelineGraph.task("x", fn, { deps: [a, b] })` method on a `PipelineGraph` subclass (see Unit 1 option C). Clean subclass method; `pipeline()` earns its keep.

#### Q8 — Alternatives

- **A. Delete `task`, inline `derived + graph.add`.**
  - Pros: honest — users see the primitive and understand what `describe()` shows; smallest public surface; removes fn-unwrap drift risk.
  - Cons: two lines per task instead of one; `orchestration_type: "task"` meta tag goes away (minor — `describe()` grouping still shows `name`); loses the "workflow DAG step" framing for users coming from Airflow / Prefect / n8n.
- **B. `Graph.task(name, fn, { deps })` method on base class.**
  - Pros: one-liner; consistent with `graph.add` / `graph.mount`; chainable; string refs use `this.resolve(s)` directly; Node refs use `WeakMap`.
  - Cons: pollutes base `Graph` with domain-flavored methods — why task but not `promptNode` / `gate` / `agentMemory`? Slippery slope.
- **C. `PipelineGraph.task(name, fn, { deps })` method on subclass (paired with Unit 1 C).**
  - Pros: base `Graph` stays clean; `orchestration` exports one class with N methods instead of N factories; mental model is "pipeline is a specialized graph"; ergonomic fluent API; `StepRef` collapses to "Node always, string resolved via `this.resolve`" because the subclass owns the WeakMap.
  - Cons: commits to subclass hierarchy; PY parity requires mirror class; if other domains (`gate`, `loop`, …) don't also migrate, we end up with `PipelineGraph.task(…)` + `gate(pipelineGraph, …)` mixed shapes.
- **D. Keep `task` factory, just fix `findRegisteredNodePath` + drop dead `depPaths`.**
  - Pros: smallest diff; addresses perf and dead code without restructuring.
  - Cons: redundancy with `derived` persists; fn-unwrap drift risk persists; `StepRef` union tax persists.

#### Q9 — Recommendation

Parameterized on Unit 1:

- **If Unit 1 = A (delete `pipeline`)** → **A here.** Inline `derived + graph.add`. Simplest, most honest, forces no new class hierarchy. Ship the WeakMap fix anyway in `Graph.add` if we want `Node`-ref lookup to stay cheap for other callers (e.g., if future method-form factories need it).
- **If Unit 1 = C (`PipelineGraph` subclass)** → **C here.** Method absorbs the factory redundancy. `StepRef` union simplifies.
- **If Unit 1 = B (keep as cosmetic alias)** → **D here.** Without a home for methods, we're stuck with factories; minimum viable fixes are the WeakMap perf patch and dead-param removal.

**Coverage (for A):** Q2 ✓ (no fn-unwrap drift surface), Q3 ✓ (no dead `depPaths` because no factory), Q5 ✓ (aligns with §24 "edges are derived"), Q6 ✓ (StepRef union goes away with factory).

**Coverage (for C):** Q2 ✓ (subclass method delegates to `derived` internally), Q3 ✓ (dead `depPaths` gone), Q5 ✓ (method is the real abstraction), Q6 ✓ (WeakMap owned by subclass; `this.resolve` replaces scan).

**Coverage (for D):** Q2 ~ (fn-unwrap drift risk remains), Q3 ✓ (dead param removed), Q5 ✗ (still a one-liner over `derived`), Q6 ~ (perf fixed but redundancy persists).

**Caveat to discuss:** if we take C for Units 1–5, should Units 7–10 (`approval`, `gate`, `loop`, `onFailure`) also become methods, or stay as factories? Argument for methods: symmetry. Argument against: `gate` returns a `GateController<T>` (not `Node`), so the method form is `pipeline.gate(name, src) → GateController<T>` which diverges from `.task → Node`. Mixed-return methods are less tidy than uniform factories. This decision cascades.

---

### Unit 3 — `branch(graph, name, source, predicate, opts)`

**Scope:** [src/patterns/orchestration/index.ts:160–182](../../src/patterns/orchestration/index.ts:160).

#### Q1 — Semantics, purpose, implementation

- Registers `derived([source], ([value]) => ({ branch: predicate(value) ? "then" : "else", value }))` as a tagged branch node.
- Output type `BranchResult<T> = { branch: "then" | "else"; value: T }`.
- Downstream consumers filter by `branch` tag.

#### Q2 — Semantically correct?

- ⚠️ **Predicate throws:** if `predicate(value)` throws, the derived fn throws, which terminates the branch node with `[[ERROR]]`. That's surprising for a "pure tag" abstraction — users expect predicate-throwing to be an error *tag* (`"error"` branch?) not a fatal termination. Minor but documentable.
- ⚠️ **No three-way tagging.** Only `"then"` / `"else"`. Many workflows want `"allow"` / `"review"` / `"block"` (see `harness/contentGate` pattern in COMPOSITION-GUIDE §line 151). A predicate returning a tag directly (`(v) => "allow" | "review" | "block"`) is more composable than a boolean.

#### Q3 — Design-invariant violations?

- 🟢 Clean.

#### Q4 — Open items

- Not tracked.

#### Q5 — Right abstraction?

- **Borderline.** `derived([source], (v) => predicate(v) ? "then" : "else")` is already one-liner composable. The value-add is the `{ branch, value }` envelope, which callers can rebuild trivially.
- **More generic:** the `classifier` shape `(value) => Tag` with `Tag` a string union is the pattern `stratify` / `contentGate` / `router` use. `branch` is the boolean special case. Unify: `classify([source], (v) => tagOf(v))` returning `Node<{ tag: Tag; value: T }>`.

#### Q6 — Right long-term solution?

- **Binary classifier is a local optimum.** Ships fast, covers 60% of use cases, but turns into a wart the moment you want three-way routing — which is exactly what `harness/contentGate` does (`allow` / `review` / `block`). Shipping binary now and n-way later creates two classifiers in the public surface forever — new users have to pick, we have to document both, and upgrade migration is TypeScript-breaking (literal-union types `"then" | "else"` don't widen to `"allow" | "review" | "block"`).
- **Envelope shape choice locks consumers in.** `BranchResult<T> = { branch, value }` means every downstream unwrap reads `r.branch === "then" ? r.value : null`. If we switch to a discriminated union `{ tag: "allow"; value: T } | { tag: "review"; value: T } | ...`, TypeScript exhaustiveness-checking works; if we keep the flat `{ tag, value }` shape, it doesn't. Discriminated-union is more correct but more ceremony in handler code.
- **Predicate-throw behavior is a latent bug.** Today a throwing predicate terminates the `derived` with `[[ERROR]]`, which propagates downstream. For a "tag this value" primitive, users would expect predicate errors to be either (a) caught and tagged (`tag: "error"`) or (b) forwarded as `null` + observable on a companion error node. The current behavior (nuke the whole stream) is surprising. This is less about branch vs classify and more about "classifier error policy" — whichever we ship, pick the policy deliberately.
- **Maintenance burden:** 20 LOC today. N-way `classify` is ~25 LOC. Deletion is 0 LOC, users write `derived` inline.
- **Composability concern:** users who get `BranchResult<T>` out of `branch` then typically want to fan out downstream — one path per tag. Today: they write N `derived([b], r => r.branch === tag ? r.value : null)` nodes. A `routeOn(classifier, tag)` / `router(classifier, { allow: fn1, review: fn2 })` would compress that. If we ship `classify` without `routeOn`, we've moved the ergonomics tax from the classifier to the fan-out side — not net-positive. If we ship both, we've added two public symbols.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** ✓ `derived([source], …)` — one dep, clean describe. `explain(source, branch)` walks one hop.
- **Perf:** one allocation per wave for `{ branch, value }`. N-way `classify` allocates the same envelope shape with a different tag type. `routeOn(classifier, tag)` is another `derived` per tag, each allocates per wave. Zero delta vs writing these inline.
- **Memory:** stateless.
- **Reactive/composable:** today the fan-out pattern is verbose (N hand-written `derived` nodes). The classifier primitive is correctly reactive; the downstream is what hurts. A classifier that also returns `null` for "skip this wave" lets users express conditional forwarding without a second primitive.
- **Simpler shapes (progressive):**
  ```ts
  // Current (binary):
  const b = branch(g, "check", src, v => v > 10);
  const thens = derived([b], ([r]) => r.branch === "then" ? r.value : null, { name: "thens" });

  // N-way classify with explicit tag:
  const cls = classify(g, "check", src, v => v > 10 ? "big" : "small");
  const bigs = derived([cls], ([r]) => r.tag === "big" ? r.value : null, { name: "bigs" });

  // Classify + routeOn (paired):
  const cls = classify(g, "check", src, v => v > 10 ? "big" : "small");
  const bigs = routeOn(cls, "big");           // Node<T | null>

  // Classify + router (full fan-out):
  const { big, small } = router(cls, {
    big: (v) => v * 2,
    small: (v) => v,
  });                                          // { big: Node<T>, small: Node<T> }

  // No primitive at all:
  const cls = derived([src], ([v]) => v > 10 ? { tag: "big", value: v } : { tag: "small", value: v });
  ```

#### Q8 — Alternatives

- **A. Keep binary `branch` as-is.**
  - Pros: zero-change; users who want n-way write `derived` directly; binary case has minimum boilerplate.
  - Cons: locks in `"then" | "else"` literal types; no path to three-way without a second primitive; predicate-throw policy remains surprising.
- **B. Replace `branch` with n-way `classify((v) => tag)`, ship no `routeOn`.**
  - Pros: subsumes binary; aligns with `stratify` / `contentGate` / `router` shapes; pre-1.0 pivot is cheap; classifier-returns-null for skip covers conditional fwd.
  - Cons: binary case slightly more verbose (`v => v > 10 ? "a" : "b"` vs `v => v > 10`); fan-out still requires hand-written `derived` nodes per tag.
- **C. Replace with `classify` + `routeOn` pair.**
  - Pros: (B)'s benefits + one-liner fan-out; matches the Rx `partition` / callbag `partition` analogue; composable.
  - Cons: two public symbols instead of one; `routeOn` is a thin `derived` wrapper — pays the same redundancy tax `task` does if we're aggressively minimalist.
- **D. Replace with `classify` + `router({ allow: fn, review: fn, block: fn })`.**
  - Pros: ergonomic multi-way split in one call; each branch can have its own transform; discoverable.
  - Cons: `router` is richer than `routeOn` — it couples classification and transformation; users who just want to filter on tag would still want a `routeOn` too. Two primitives.
- **E. Delete both, ship no classifier.**
  - Pros: most honest; users write `derived` directly and see the primitive.
  - Cons: discoverability hit — classifier is a recognizable pattern from Rx / workflow engines; users come expecting it by name.
- **F. Keep `branch` as binary sugar AND add `classify` for n-way.**
  - Pros: every caller gets minimum boilerplate for their case.
  - Cons: two primitives, two docs, two tests, two PY parity mirrors — the "worst of both" on public surface cost.

#### Q9 — Recommendation

- **B (n-way `classify`, no `routeOn` yet).** Ship the generalization; defer `routeOn` until a real consumer asks for it (at least one in-tree user we already know of — `contentGate`'s three-way output — but it's already shipped differently). Don't ship paired primitives preemptively.
- **Classifier error policy: catch, emit `{ tag: "error", value, error }` envelope.** Lets downstream consumers observe classifier failures without terminating the stream. Document explicitly.
- **Coverage:** Q2 ✓ (predicate-throw → tagged error instead of terminal), Q5 ✓ (n-way is the real abstraction), Q6 ✓ (avoids binary lock-in; single primitive).
- **Trade-off to weigh:** (B) costs binary-case callers one character (`v => v > 10` vs `v => v > 10 ? "yes" : "no"`). (F) pays a public-surface cost to save that character. Pre-1.0 argument for (B) is strong: we can always add `branch` back as sugar later if the binary case shows up often.
- **Caveat:** if you see the fan-out pattern as the bottleneck (i.e., users write the `r.tag === "big" ? r.value : null` unwrap often), we should bundle `routeOn` with this batch so we're not making the call without its counterpart.

---

### Unit 4 — `join(graph, name, deps, opts)`

**Scope:** [src/patterns/orchestration/index.ts:448–471](../../src/patterns/orchestration/index.ts:448).

#### Q1 — Semantics, purpose, implementation

- Registers `derived(resolved.map(r => r.node), (values) => values as T)` returning a tuple `Node<T extends readonly unknown[]>` of latest dep values.
- Tuple-preserving via `{ [K in keyof T]: StepRef }` type signature.

#### Q2 — Semantically correct?

- ⚠️ **Push-on-subscribe / multi-state §28 risk.** If every dep is a `state()` with a cached value, push-on-subscribe fires each dep's initial DATA in sequence — `join` emits N times, once per dep. For two deps you get `[a, prev]` → `[a, b]` on activation. Whether this matters depends on the caller; §28 factory-time seed pattern is the fix when it does.
- ⚠️ **Empty-deps behavior.** `join(g, "x", [])` produces `derived([], () => [])` which activates immediately and emits `[]`. Useless but not incorrect; document or throw.

#### Q3 — Design-invariant violations?

- 🟢 Clean. It is `derived` with pass-through.

#### Q4 — Open items

- §28 factory-time seed pattern applies here if callers hit the push-on-subscribe pitfall. Not tracked as a specific join-item.

#### Q5 — Right abstraction?

- **Alias of `derived`.** `join(g, "x", [a, b])` ≡ `derived([a, b], values => values, { name: "x" })`. Zero additional behavior.
- More generic: same discussion as `task` — graph method `graph.join(name, deps)` or just document the `derived` idiom.

#### Q6 — Right long-term solution?

- **Positional tuple vs keyed record is the abstraction question.** Positional (`[A, B, C]`) is cheaper to type and zero-allocation-overhead over `derived(deps, vs => vs)`. Keyed (`{ a, b, c }`) is self-documenting, survives dep reordering, and matches what RxJS users expect from `combineLatest({…})`. The keyed form is the genuine generalization — positional is an aliased `derived`.
- **Push-on-subscribe §28 pitfall is real.** If two deps are `state()` nodes with cached values, subscribing to each fires push-on-subscribe as separate waves. `join` emits `[a, prev]` → `[a, b]` on activation, producing one extra wave per additional state dep. Callers who consume `joined.cache` synchronously see the first wave's tuple, not the settled one. The fix is §28 factory-time seed pattern inside the `join` body — but that's exactly the kind of "built-in correctness" that earns `join` a reason to exist beyond `derived + identity`.
- **First-run gate (`partial: false`) interaction.** `join`'s semantics could be "emit only after every dep has emitted at least once" (first-run gate, the default for multi-parent `derived`) — which is probably what RxJS / workflow users expect. Or it could be "emit whenever any dep emits, using `ctx.prevData` fallback for sentinel slots" (`partial: true`). Today `join` inherits `derived`'s default (gate on), which is usually right, but the `ctx.prevData` branch is still live for later waves. Document explicitly.
- **Sentinel-slot handling:** if a dep is `state()` with `undefined` initial (never emitted), the tuple slot becomes `undefined`. Consumers who type `Node<[A, B]>` get `A | undefined` implicitly. Whether this is correct depends on whether users expect `undefined` as a valid "no value yet" signal or an outright fail. Spec §5.12 reserves `undefined` as SENTINEL; the tuple representation bleeds SENTINEL through.
- **Maintenance:** 24 LOC today. Adding keyed overload ~20 LOC more. §28 seed auto-application ~15 LOC. Total grown to ~60 LOC — still small, but it's now doing real work.
- **Naming caveat:** `join` in DB / SQL world means "merge on key" — probably not what users expect. `combineLatest` is the Rx convention. `zip` means something else (pair-wise). Pick a name that matches semantics. If we pivot to keyed form, `combine` or `combineLatest` is tempting.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** ✓ fan-in tuple; describe shows N edges into the joined node.
- **Perf:** one array (positional) or object (keyed) allocation per wave. Object has marginal hidden-class overhead in V8 but identical to `derived(deps, vs => ({a: vs[0], b: vs[1]}))` written by hand. No delta.
- **Memory:** stateless apart from §28 seed closure if we add it.
- **Simpler shapes:**
  ```ts
  // Positional (current):
  const joined = join(g, "pair", [a, b]);                 // Node<[A, B]>

  // Keyed:
  const joined = join(g, "pair", { a, b });               // Node<{a: A, b: B}>

  // With first-run gate (wait for all deps):
  const joined = join(g, "pair", { a, b }, { gate: "all" });

  // With §28 seed (avoid extra activation wave):
  const joined = join(g, "pair", { a, b }, { seedInitial: true });
  ```

#### Q8 — Alternatives

- **A. Delete.**
  - Pros: strictly smaller surface; users write `derived(deps, vs => vs)` inline.
  - Cons: loses discoverability; §28 pitfall has to be re-learned by each caller who hits it.
- **B. Keep positional-tuple form only.**
  - Pros: matches current API; pre-1.0 no-op.
  - Cons: still an identity-`derived`; no real abstraction.
- **C. Add keyed-record form alongside positional.**
  - Pros: keyed is the real abstraction; positional callers unaffected.
  - Cons: two call signatures + TypeScript overload gymnastics; docs have to explain both.
- **D. Replace entirely with keyed form (rename to `combine` or `combineLatest`).**
  - Pros: one signature, aligned with RxJS; forces the positional-tuple callers (which are identity-`derived`) to inline `derived` instead.
  - Cons: breaks positional users (pre-1.0 — OK); name collision concerns if RxJS shim layer expects our `combineLatest` to have identical semantics.
- **E. Keyed form with auto-§28 seed + first-run gate as documented defaults.**
  - Pros: the primitive actually does work `derived` doesn't; users get correctness for free.
  - Cons: "do the right thing by default" can be surprising — users reading `derived` semantics elsewhere in the codebase might expect `join` to behave identically; we'd need to document divergence.
- **F. Graph method (`pipeline.join("pair", {a, b})`) paired with Unit 1 C.**
  - Pros: method-form consistent with Units 2/5; subclass owns §28 seed lifecycle.
  - Cons: ties to subclass decision.

#### Q9 — Recommendation

- **D + E (rename to `combine`, keyed-only, first-run gate + §28 seed built-in).** This is what earns the primitive its slot. Users who want positional-tuple write `derived(deps, vs => vs as [A, B])` inline — shorter than `join(g, "x", [a, b])` anyway.
- **Coverage:** Q2 ✓ (§28 seed auto-applied; first-wave sentinel-slot shape documented), Q5 ✓ (keyed IS the abstraction), Q6 ✓ (name matches semantics; one signature).
- **If Unit 1 = C** → flip to **F** (method on `PipelineGraph`).
- **If Unit 1 = A** → stay with **D+E** as a standalone factory in orchestration (or move to `core/sugar.ts` as `combine`, since it's domain-neutral).
- **Trade-off to weigh:** "do the right thing" via auto-§28 seed is a form of hidden magic. The alternative is explicit opt-in (`join({a, b}, { seedInitial: true })`). Magic = better DX, worse legibility; explicit = better legibility, worse DX.
- **Caveat:** whether to also ship `combineArray([a, b])` / positional-tuple form for callers who have an array-shaped `deps` at runtime (e.g., iterating over a collection) — that case can't use keyed form. Small additive wrapper. Worth deciding now.

---

### Unit 5 — `subPipeline(graph, name, childOrBuild, opts)`

**Scope:** [src/patterns/orchestration/index.ts:522–534](../../src/patterns/orchestration/index.ts:522).

#### Q1 — Semantics, purpose, implementation

- Mounts a child `Graph` under `graph.mount(name, child)`. Optionally takes a builder fn `(sub: Graph) => void` for inline construction.
- Returns the child graph.

#### Q2 — Semantically correct?

- ⚠️ **Builder-scope.** `childOrBuild` can be `Graph | SubPipelineBuilder | undefined`. If `undefined`, a new graph is constructed and mounted empty. If a builder, the builder runs *after* mount (line 529). That mounts an empty graph, then wires it — which means the parent `describe()` reflects an empty subgraph until the builder returns. In a reactive setting that's usually fine; in tests that `describe()` mid-construction, it isn't.

#### Q3 — Design-invariant violations?

- 🟢 Clean. Pure `graph.mount` wrapper.

#### Q4 — Open items

- Not tracked.

#### Q5 — Right abstraction?

- **Wrapper of `graph.mount` + optional new-Graph.** Returns child for chaining.
- More generic: `graph.mount(name, childOrBuild, opts)` — absorb the builder form into `Graph.mount`.

#### Q6 — Right long-term solution?

- **Construction-ordering cost of the builder form.** Today: `graph.mount(name, child)` happens first (line 532), then `childOrBuild(child)` populates (line 529 runs before mount only if `childOrBuild` is the builder — reading the code carefully: `const child = childOrBuild instanceof Graph ? childOrBuild : pipeline(name, opts);` then `if (typeof childOrBuild === "function") childOrBuild(child);` then `graph.mount(name, child)`. So actually builder runs BEFORE mount.) That's safer — parent's `describe()` during construction never sees a half-built subgraph. Verify this is intentional and documented; if ordering ever flips, mid-construction `describe()` callers see ambiguity.
- **Terminal bubble-up is the real long-term question.** Workflows often want to observe "this specific child node" from the parent. Today: `graph.resolve("subname::child-node")` with stringly-typed path. Typed bubble — `graph.mount(name, sub => {…}, { expose: { "result": resultNode } })` returning `{ graph, exposed }` — would surface the child terminal as a parent-visible node without the string-path indirection. Non-trivial to implement because it crosses graph boundaries.
- **Two call shapes (builder fn vs pre-built Graph) is a discoverability cost.** Users reading the signature `subPipeline(graph, name, childOrBuild?, opts?)` see three possibilities and have to decide which applies. Single-path is cleaner: pick one.
- **Maintenance:** 13 LOC. Tiny. Absorbable into `Graph.mount` with minimal effort.
- **PY parity:** PY's `graph.mount()` already exists. Adding an optional builder callable is additive. If we do it in TS, mirror in PY.
- **Special case:** users who want to mount-under-different-name pass `subPipeline(g, "stage-1", child)` where `child.name === "original"`. Today this works — parent indexes by `"stage-1"` regardless. Confirm this stays true if we fold into `Graph.mount`.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** ✓ mounting inserts `name::*` segment in describe; cross-graph edges derive from node `_deps` per §24, not from mount relation.
- **Perf:** identical to `Graph.mount`. Zero delta.
- **Memory:** retains child reference on the parent for the lifetime of the parent (correct).
- **Reactive/composable:** ✓ — a mounted subgraph IS a composition primitive, not a reactive step. No wave semantics.
- **Simpler shape:**
  ```ts
  // Absorb builder form into Graph.mount with optional default child:
  graph.mount(name);                              // mounts new Graph(name)
  graph.mount(name, sub => { /* populate */ });   // builder; sub = new Graph(name)
  graph.mount(name, existingGraph);               // existing; current shape
  graph.mount(name, sub => {…}, { expose: {…} }); // future: typed bubble
  ```

#### Q8 — Alternatives

- **A. Delete, fold into `Graph.mount`.**
  - Pros: one method, three overloads; consistent with Unit 1/2/5 symmetry; `graph.mount(name)` with no arg auto-creates; single doc page.
  - Cons: `Graph.mount` signature gets overloaded three ways — overload resolution can be confusing in IDE tooltips; "mount" verb vs "subPipeline" noun means workflow-DAG users may not find it by name.
- **B. Keep as thin wrapper.**
  - Pros: zero churn; `subPipeline` reads as a noun that matches workflow mental model.
  - Cons: duplicate surface; "wrapper over mount" is exactly the redundancy we're trying to kill in this batch.
- **C. Extend with `autoBubble` / `expose` option.**
  - Pros: gives it a real reason to exist — typed child-terminal access from parent; subPipeline becomes the "mount + surface" primitive while `mount` stays raw.
  - Cons: cross-graph signaling plumbing (e.g., exposed child terminal node needs to be a proxy that forwards messages from the real node); careful about COMPLETE / ERROR propagation across the boundary; non-trivial feature.
- **D. Rename method on Graph to `subgraph` or `sub`.**
  - Pros: `graph.sub("stage", sub => {…})` reads naturally; matches the workflow mental model without a separate `subPipeline` factory.
  - Cons: `mount` is the established term; renaming is a cross-codebase rename including PY + demos.
- **E. Keep `subPipeline` but strip down to the builder-form only.**
  - Pros: one call shape; removes the pre-built-graph overload (callers with a pre-built graph call `graph.mount(name, existing)` directly).
  - Cons: partial cleanup; still a wrapper.

#### Q9 — Recommendation

- **A (fold into `Graph.mount`).** Matches Unit 1/2/5 trajectory — subclass-or-delete, not wrap. `graph.mount(name)` with auto-new-graph, and `graph.mount(name, sub => {…})` builder form, cover all three current call shapes.
- **Coverage:** Q2 ✓ (construction ordering preserved if we keep "builder before mount"), Q5 ✓ (method is the right home), Q6 ✓ (no name duplication; symmetry with Units 1/2/4 restructure).
- **If Unit 1 = C (`PipelineGraph` subclass)** → `pipelineGraph.mount(…)` inherits from `Graph.mount`; same resolution.
- **If you want the typed-bubble ergonomics** → flip to **C (autoBubble/expose)** but ship that as a separate follow-up primitive, not bundled into this rename.
- **Trade-off to weigh:** `graph.mount("stage", sub => {…})` works but reads less "workflow-y" than `subPipeline(graph, "stage", sub => {…})`. If workflow-DAG vocabulary matters for discoverability (Airflow users search "subpipeline"), keep the name — but then at least strip it to a single call signature (E).
- **Caveat:** PY parity cost. TS changes are additive to `Graph.mount`; PY the same.

---

### Unit 6 — `sensor(graph, name, initial, opts)`

**Scope:** [src/patterns/orchestration/index.ts:539–567](../../src/patterns/orchestration/index.ts:539).

#### Q1 — Semantics, purpose, implementation

- Registers `node([], () => undefined, { describeKind: "producer", meta: { orchestration: true, orchestration_type: "sensor" } })` with imperative controls:
  - `push(value)` → `source.emit(value)`
  - `error(err)` → `source.down([[ERROR, err]])`
  - `complete()` → `source.down([[COMPLETE]])`
- Returns `{ node, push, error, complete }`.

#### Q2 — Semantically correct?

- ⚠️ **`describeKind: "producer"` + empty fn.** The fn `() => undefined` returns no cleanup; the producer never does any reactive work. It exists solely as an external-emit target. The `[]` deps mean no reactive input. This is effectively `state<T | undefined>(initial, { describeKind: "producer" })` with extra bytes — except the `status` semantics differ (producer vs state: see [core/node.ts:128–131](../../src/core/node.ts:128) — producer implies "a source node with no declared deps but subscribers drive reactive work").
- ⚠️ **No back-pressure / no termination auto-propagation.** Fine for a boundary source, but surprising relative to `fromPromise` / `fromAsyncIter` which do handle termination.

#### Q3 — Design-invariant violations?

- 🟡 **Gray-zone against §5.9 "no imperative triggers".** The spirit of §5.9 is that coordination inside the reactive layer uses reactive signals. `sensor` is explicitly a **boundary** — it's how imperative code hands data INTO the reactive layer. That's the sanctioned use case. But pairing `sensor` with the rest of the `orchestration` factories (all internal-graph wiring) creates a shape where users mix boundary-producers with internal composition — which is exactly the anti-pattern in spec §5.9 examples.
- 🟢 `describeKind: "producer"` is correct per [core/node.ts:128](../../src/core/node.ts:128).

#### Q4 — Open items

- Not tracked.

#### Q5 — Right abstraction?

- **Partial duplicate of `state()`.** `state(initial, { describeKind: "producer", name })` + `.emit(v)` + `.down([[ERROR, e]])` covers push+error+complete by hand. `sensor` is "producer-flavored state + named imperative controls".
- **More generic:** `producer(name, initial?)` returning `{ node, push, error, complete }` — domain-neutral, lives in `src/core/sugar.ts` or `extra/sources.ts` alongside `fromPromise` / `fromAsyncIter`.

#### Q6 — Right long-term solution?

- **Namespace mis-shelving is the load-bearing issue.** `sensor` is a boundary primitive — imperative code hands data INTO the reactive layer. That's a source, not an orchestration step. Living under `patterns/orchestration` pairs it with internal-wiring factories (`task`, `branch`, `join`), encouraging users to write `const s = sensor(g, "x"); const t = task(g, "y", fn, { deps: [s.node] })` where the `sensor` framing suggests "step 1". But sensor isn't a step — it's the ingress boundary. Mental-model mismatch leads to users adding more sensors as "steps" instead of wiring proper `fromPromise` / `fromAsyncIter` sources.
- **Overlap with `state() + describeKind: "producer"`.** Three-line equivalent exists without importing `sensor`:
  ```ts
  const s = state<T | undefined>(undefined, { describeKind: "producer", name: "x" });
  graph.add(s);
  s.emit(value);                                   // push
  s.down([[ERROR, err]]);                          // error
  s.down([[COMPLETE]]);                            // complete
  ```
  `sensor`'s `{ node, push, error, complete }` envelope is marginally nicer but lies about the level of indirection. Users reading `s.push(v)` don't see that this is `source.emit(v)` — which matters when debugging.
- **Initial value handling is stricter than `state`.** `state<T>(initial)` requires a non-`undefined` initial (or explicitly `null`). `sensor(g, "x")` lets `initial` be omitted — the resulting producer is SENTINEL. Today users don't notice, but consumers subscribing with push-on-subscribe semantics get zero emission until the first `push`. This matches "producer-without-cache" semantics, which is fine — but users who expect `sensor(g, "x", 0).node.cache === 0` get it; users who expect `sensor(g, "x").node.cache === undefined` get it. Both legal; document.
- **Termination is one-shot.** `complete()` marks done forever. `error(err)` marks errored forever. No re-arming (unless `resubscribable: true` passed through opts — today sensor threads opts but doesn't document the interaction).
- **Maintenance:** 28 LOC. Low.
- **Naming concern:** `producer` in `extra/sources.ts` would be the neutral name. BUT `producer` is already a `describeKind` enum value ([core/node.ts:128](../../src/core/node.ts:128)) — shadowing an existing identifier in a sibling file. Options: `imperativeSource`, `pushSource`, `source`, `handSource`, `emitter`. Each has a flavor.
- **PY parity cost:** whatever we name it, PY mirrors. PY's `extra.sources` already has `from_promise`, `from_async_iter` — adding `producer(name, initial)` fits.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** ✓ producer island with empty `_deps`. `describe()` shows `kind: "producer"`, no in-edges, out-edges to downstream consumers. Correct representation.
- **Perf:** zero overhead — the no-op `() => undefined` fn never fires because there are no deps to trigger it (zero-dep node with `partial: false` default is inert reactively; only external `.emit` / `.down` drives it). Identical to `state + describeKind: "producer"`.
- **Memory:** retains initial if provided; otherwise zero.
- **Reactive/composable:** ✓ — as a boundary source, its whole job is to be imperatively written from outside. This is exactly what `fromPromise` / `fromAsyncIter` / `fromTimer` do under the hood, but those bridge from a specific source shape (Promise, AsyncIterable, timer). `sensor` / `producer` bridges from arbitrary imperative caller code.
- **Simpler shapes:**
  ```ts
  // Current (orchestration):
  const s = sensor(g, "x", 0);
  s.push(1);

  // With producer() in extra/sources:
  const s = producer("x", 0);
  graph.add(s);
  s.emit(1);

  // Bare state (no wrapper):
  const s = state<number | undefined>(0, { name: "x", describeKind: "producer" });
  graph.add(s);
  s.emit(1);
  ```

#### Q8 — Alternatives

- **A. Delete `sensor` entirely.** Document `state + describeKind: "producer"` idiom; update callers.
  - Pros: most honest — no wrapper, users see the primitive; smallest public surface.
  - Cons: loses the `{push/error/complete}` envelope (though users can write it trivially); no named breadcrumb for "imperative source" in the API docs.
- **B. Move + rename to `extra/sources.ts` as `producer(name, initial?)`.**
  - Pros: right namespace; pairs with `fromPromise` / `fromAsyncIter`; keeps the named-controls envelope.
  - Cons: `producer` shadows the `describeKind` enum value — readability cost; requires rename bikeshed.
- **C. Keep in orchestration as "named imperative source".**
  - Pros: zero churn.
  - Cons: mis-shelved; reinforces the step-not-boundary mental model; asymmetric with Unit 1/2/4/5 cleanup direction.
- **D. Hybrid: `producer` in `extra/sources`, `sensor` re-exports as deprecated alias.**
  - Pros: gentle migration.
  - Cons: pre-1.0, we don't need deprecation aliases; two symbols for one shape is the worst outcome.
- **E. Make `sensor` do real work — e.g., throttle / debounce / coalesce pushes.**
  - Pros: gives it a reason beyond `state + emit`.
  - Cons: scope creep; those behaviors already exist as operators (`throttle`, `debounce`) in `extra/operators`; users compose.

#### Q9 — Recommendation

- **B (move to `extra/sources.ts`, name `producer`).** Right namespace; keeps the control-envelope ergonomics; pairs with existing sources. Tier as **universal** (browser + node safe — it's pure graph wiring with no `node:*` or DOM imports).
- **Name to be nailed down.** `producer` shadows the `describeKind` — probably survivable, but we could pick `imperativeSource` / `pushSource` / `emitter` / `handSource`. My preference: `producer`, documented with the shadow call-out. Second-best: `imperativeSource`.
- **Coverage:** Q2 ✓ (one-shot termination documented; `initial` optional documented), Q3 ✓ (stays at boundary, no invariant drift), Q5 ✓ (domain-neutral namespace), Q6 ✓ (right shelf; paired with analogous primitives).
- **Trade-off to weigh:** moving out of orchestration is a structural commit. If you see `orchestration` as "the workflow-DAG surface", and workflow-DAG users want a named `sensor` primitive, keeping it there has ergonomic value. My read of the review context (harness-first vision) is that `orchestration` should shrink, not grow — so move it.
- **Caveat:** confirm via grep that nothing uses `sensor` as a disambiguating Airflow-like signal. First-pass grep in the codebase shows only demo / test usage — safe to move.

---

## Batch A.1 cross-cutting observations

Collected while auditing Units 1–6:

1. **`StepRef = string | Node<unknown>` as a union is the root of the `resolveDep` tax.** Every factory in `orchestration/` pays it. If we migrate to Graph-method form (Unit 2 recommendation B), the union collapses to "Node is native; string is `this.resolve(s)` lookup". Removes `findRegisteredNodePath` and its O(nodes) scan.
2. **`registerStep`'s `depPaths` parameter is dead code** ([orchestration/index.ts:80–86](../../src/patterns/orchestration/index.ts:80)). Remove as part of whichever session touches this file.
3. **`orchestration_type` meta tags are useful for `describe()` grouping** but are applied inconsistently once we delete `pipeline` / `subPipeline` (which don't add nodes). Recommend: keep `orchestration_type` on `task` / `branch` / `classify` / `sensor` etc., drop from the factories that only mount/register.
4. **Every declarative-wiring unit (1–5) is a one-line alias of a core primitive.** This is a symptom — the `orchestration` module as shipped today is ~30% glue and ~70% real primitives (`gate`, `loop`, `approval`, `onFailure`). The declarative-wiring half is a candidate for deletion / method-form absorption.

---

## Open question for user (before locking A.1)

Across Units 1–5, the recommendation skews toward **moving declarative wiring into `Graph` methods** (`graph.task`, `graph.branch/classify`, `graph.join`, `graph.mount` with builder) and **deleting the factory wrappers** in `patterns/orchestration`. That's a material re-shaping of the Phase-4 surface.

Alternative position: keep `patterns/orchestration` as the public entry point for "workflow DAG users" (the crowd who came expecting Airflow / Prefect / n8n-style named-step semantics), and let `Graph` methods serve the "reactive-first" crowd. Both surfaces sit on top of the same `derived` / `node` primitives, but the namespaces give two mental models.

**Question:** Is the `orchestration` module intended as a "workflow DAG" surface (and thus worth keeping verbose declarative sugar) or as a thin cover over `Graph` that we can absorb into `Graph` methods?

Once we know the answer, Units 1–5 lock cleanly. Unit 6 (`sensor`) is independent — moves to `extra/sources.ts` regardless.

---

## Decisions locked (A.1) — 2026-04-24

**Framing:** Shrink `patterns/orchestration` while preserving the workflow-DAG surface via a `PipelineGraph extends Graph` subclass. Where a base `Graph` method already covers the need, delete the orchestration wrapper.

**Per-unit:**
- **Unit 1 `pipeline`** → repurpose as factory for `PipelineGraph`.
- **Unit 2 `task`** → `PipelineGraph.task(name, fn, { deps })` method; factory deleted.
- **Unit 3 `branch`** → replaced by `PipelineGraph.classify(name, src, (v) => tag)`; `{ tag: "error", value, error }` envelope for classifier throws.
- **Unit 4 `join`** → replaced by `PipelineGraph.combine(name, { a, b, c })`; keyed-record; first-run gate + §28 seed built-in.
- **Unit 5 `subPipeline`** → deleted; use inherited `pipeline.mount(name, builderOrChild?)`; base `Graph.mount` gains builder-form overload.
- **Unit 6 `sensor`** → moved to `extra/sources.ts` as `producer(name, initial?)`; tier universal.

**Base-Graph pre-requisites:**
- `WeakMap<Node, string>` maintained by `Graph.add` for O(1) Node→path lookup (PY: `WeakKeyDictionary[Node, str]`).
- `Graph.mount(name, builderOrChild?)` overload.

**PY parity:** mirror subclass + method API in `graphrefly.patterns.orchestration`; move `sensor` → `producer` to `graphrefly.extra.sources`; no `async def` anywhere.

**Implementation-session scope (for the eventual "implement A.1" session):**
1. Base `Graph` improvements (WeakMap, mount overload) — lands first; required by every other change.
2. Introduce `PipelineGraph` subclass with methods calling `this.add(derived(...))`.
3. Delete orchestration factories `task / branch / join / subPipeline`. Update demos / tests to use method form.
4. Move `sensor` → `producer` in `extra/sources.ts`. Update demos / tests.
5. Delete `registerStep`'s dead `depPaths` argument (internal).
6. Docs: `patterns/orchestration` README + JSDoc for `PipelineGraph` methods.
7. PY mirror — lands in a separate PY session.

---

## Wave A — Batch A.2 — Stateful / human-in-loop primitives

**Context correction (2026-04-24):** there is no separate `harness/gate` factory — the harness consumes `orchestration.gate` directly (single source of truth). The "gate overlap" suspicion flagged in the drift section is actually just "harness imports orchestration.gate." Migration target: methods on `PipelineGraph` per A.1 lock.

---

### Unit 7 — `approval(graph, name, source, approver, opts)`

**Scope:** [src/patterns/orchestration/index.ts:186–240](../../src/patterns/orchestration/index.ts:186) (~55 LOC).

#### Q1 — Semantics, purpose, implementation

- Raw `node([src, ctrl], fn, { describeKind: "derived" })`.
- Fn logic:
  1. Read latest approver value `ctrlVal` (batch.at(-1) ?? prevData[1]).
  2. If `ctrlVal === undefined` OR `!isApproved(ctrlVal)` → `actions.down([[RESOLVED]])` (hold).
  3. Else if source batch empty → re-emit `ctx.prevData[0]` if present (approval just granted without new src data).
  4. Else forward every value in source batch via `actions.emit(v)`.
- `isApproved` default: `Boolean(value)`.
- Uses raw `node()` (not `derived`) to control the `RESOLVED`-as-hold vs `DATA` distinction.

#### Q2 — Semantically correct?

- ⚠️ **Re-emit on approval grant is duplicate-emitting.** If the approver toggles from falsy → truthy AND source already emitted a value before, the gate re-emits `ctx.prevData[0]`. If the approver toggles truthy → truthy again (e.g., a fresh truthy signal every time the caller asks), we re-emit the same prior value every time. Downstream consumers see duplicates. Intentional? Probably yes for "approve means push what's queued," but surprising for "approve means gate open for future."
- ⚠️ **No "rejected" signal.** Consumers see `RESOLVED` while waiting, `DATA` when approved. Never "rejected". Rejection in this primitive ≡ "stay RESOLVED forever." Compare with `gate.reject(count)` which explicitly discards.
- ⚠️ **`undefined` guard elides `null` approvers.** `ctrlVal === undefined` is the "never emitted" guard — correct per spec §5.12. `isApproved(null)` is the intended falsy path (default `Boolean(null) === false`). OK.
- ⚠️ **Approver terminal not handled.** If `ctrl` COMPLETEs without ever approving, `approval` sits at RESOLVED forever. If `ctrl` ERRORs, `errorWhenDepsError` defaults to `true` so `approval` propagates. Interaction with `src` terminal isn't explicitly handled — depends on default behavior.

#### Q3 — Design-invariant violations?

- 🟢 No timers, no raw async, no `.cache` reads inside fn.
- 🟡 **Semantic overlap with `gate`** — `approval` is `gate` with `maxPending = 1 implicit`, no queue surface, no `reject / modify / open / close`, auto-flow when approver truthy. Not an invariant violation, but a redundancy warning.
- 🟡 **`RESOLVED` as "not approved" signal.** Valid per spec but non-obvious. Consumers expect `RESOLVED` = "my dep didn't change this wave"; this primitive uses it as "my gate is closed." Different semantic layer.

#### Q4 — Open items

- Not in optimizations.md. Overlap-with-gate is a candidate to add.

#### Q5 — Right abstraction?

- **Degenerate `gate`.** Every behavior approval provides is a strict subset of `gate` with `maxPending = 1 implicit`. The ergonomic win is "no controller object, just a Node for approver" — but a user who wants reactive approvals can feed a Node into `gate` by bridging (controller method wired to a subscribe on the approver Node). Not elegant today but unifiable.
- **More generic:** `gate(src, { approver: approverNode })` — when an approver Node is supplied, the gate auto-approves whenever the approver emits truthy. `approver: "manual"` (default) keeps the imperative controller. One primitive, two modes.

#### Q6 — Right long-term solution?

- **Two-mode vs two-primitives is the real question.** Keeping `approval` + `gate` as separate factories means users pick between "lightweight binary + reactive approver" and "queued + imperative approver." That's a real taste axis — but the cognitive cost is that both have to be documented, tested, maintained, and mirrored in PY. Merging means one primitive with a mode flag.
- **Re-emit on approval grant is a real design question, not a bug.** Some use cases want it ("the approval was for value V, emit V when granted"), some don't ("approval is a future-only gate, don't re-emit history"). `gate` today handles this via its queue — pending items are held and emitted on approve. `approval` without a queue can't — so it falls back to re-emit last. A unified `gate` with `maxPending: 0` (approver-only, no queue) would have the same ambiguity.
- **The imperative controller is load-bearing for HITL UX.** Approval workflows in real apps tend to be "user clicks Approve in UI" — that's an imperative call. A reactive-approver Node is less common (it's effectively "autopilot approver," useful for testing + canaries + automated approvers like scoring models). Don't drop imperative support.
- **Special case: `onceOnly: boolean` mode.** "Approve once, then gate becomes permanently open" is a distinct third mode. Useful for onboarding flows, consent screens. Not in any primitive today.
- **Maintenance burden:** 55 LOC. Small but carries its own test file contributions and JSDoc. Collapse saves docs + tests + PY mirror.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** ✓ `[src, ctrl]` deps declared; `describe()` shows two in-edges. `explain(src, approval)` and `explain(ctrl, approval)` both walk one hop. Clean.
- **Perf:** per-wave, does one `prevData` lookup + `isApproved` call. Negligible.
- **Memory:** stateless.
- **Reactive/composable:** ✓ as long as the approver is a Node. The only gap is ergonomic (no "human clicks button" hook).
- **Simpler shape (unified with gate):**
  ```ts
  // Today:
  const a = approval(g, "x", src, approver);                     // reactive approver
  const { node: b, approve, reject } = gate(g, "y", src);        // imperative controller

  // Unified:
  const a = pipeline.gate("x", src, { approver });               // reactive mode
  const { node: b, approve } = pipeline.gate("y", src);          // imperative mode (default)
  const c = pipeline.gate("z", src, { approver, onceOnly: true }); // latch mode
  ```

#### Q8 — Alternatives

- **A. Keep `approval` as a distinct primitive.**
  - Pros: read-as-English ergonomics (`approval(src, approver)` vs `gate(src, { approver })`); existing call sites unchanged.
  - Cons: two primitives for one concept; re-emit policy is implicit; no rejection signal; no onceOnly mode.
- **B. Delete `approval`; unify into `pipeline.gate(src, { approver })`.**
  - Pros: one primitive, three modes (imperative controller, reactive approver, onceOnly latch); one doc, one test suite, one PY mirror.
  - Cons: loses the read-as-English name; `{ approver }` option mode-switching is less discoverable than a dedicated name.
- **C. Keep `approval` as alias, method on `PipelineGraph`.**
  - Pros: migration cost zero; `pipeline.approval(name, src, approver)` reads well.
  - Cons: duplicate surface; the implementation is still ~55 LOC of gate-lite logic to maintain.
- **D. Delete `approval`; document `gate` with `maxPending: 1` + manual approver bridge.**
  - Pros: smallest surface; `gate` stays single-flavored.
  - Cons: reactive-approver users have to write `approverNode.subscribe(v => isApproved(v) && gate.approve())` glue. Imperative escape hatch for what was a one-liner.

#### Q9 — Recommendation

- **B (unify into `pipeline.gate(src, opts)` with a mode selector).** Modes:
  - `{ }` (default): imperative controller (current gate).
  - `{ approver: Node }`: reactive mode — auto-approves when approver emits truthy.
  - `{ approver, onceOnly: true }`: latch mode — first approval opens gate permanently.
  - `{ approver: "always" }`: no-op gate (degenerate but useful for tests / preview).
- **Re-emit policy (for `{ approver }`, `maxPending: 1` implicit):** emit on approve ≡ drain queue. If no queue (`maxPending: 0`), don't re-emit — approve is forward-only. Document that `maxPending: 1` is the explicit-knob replacement for "re-emit last value on approval grant."
- **Coverage:** Q2 ✓ (re-emit policy becomes explicit via `maxPending` knob; rejection observable via `rejectedCount` or a reject log), Q3 ✓ (no overlap primitive), Q5 ✓ (generalized), Q6 ✓ (single surface with mode flag + onceOnly latch).
- **Trade-off to weigh:** readability. `pipeline.approval(name, src, approver)` reads more cleanly than `pipeline.gate(name, src, { approver })` for the common case. If read-as-English matters enough, keep `pipeline.approval` as a thin method alias (C) — but make it call `this.gate(name, src, { approver, maxPending: 1 })` internally so there's one implementation.
- **Caveat:** `onceOnly` changes `isOpenNode` semantics (after first approve, `close()` is a no-op; `isOpenNode.emit(false)` still works but the gate auto-reopens on next source push). Alternative: `onceOnly` makes the gate `isOpen = true` permanently after first approve, and `close()` throws. Pick the less-surprising shape.

---

### Unit 8 — `gate(graph, name, source, opts)`

**Scope:** [src/patterns/orchestration/index.ts:287–438](../../src/patterns/orchestration/index.ts:287) (~152 LOC).

#### Q1 — Semantics, purpose, implementation

- Returns `GateController<T>` envelope: `{ node, pending, count, isOpen, approve, reject, modify, open, close }`.
- Internal reactive state: `pendingNode: Node<T[]>` (mutable-array snapshot, `equals: () => false`), `isOpenNode: Node<boolean>`, `countNode: Node<number>` (derived from `pendingNode.length`).
- Closure state: `queue: T[]`, `torn: boolean`, `latestIsOpen: boolean` (seeded from `startOpen`, updated by subscribing to `isOpenNode`).
- Output `node([src.node], fn)`:
  - If `ctx.terminalDeps[0]` set: teardown, clear queue, propagate COMPLETE/ERROR.
  - Else if source batch empty: `RESOLVED` (no-op).
  - Else for each `v`: if `latestIsOpen` → `actions.emit(v)`; else → enqueue + `RESOLVED`.
- Controller methods dequeue + imperatively `output.emit(item)` per approved item (`modify` transforms first).
- `open()` wraps `isOpenNode.emit(true) + dequeue-all + emit-each` in one `batch()`.
- Internal state mounted as `${name}_state` subgraph: `pending / isOpen / count`.

#### Q2 — Semantically correct?

- ⚠️ **Controller `approve(count)` emits N waves.** Each `output.emit(item)` is a separate wave. 10 approvals ≡ 10 waves. If `approve(10)` is meant atomic, wrap the loop in `batch()`.
- ⚠️ **`modify(fn, count)` same issue.** `output.emit(fn(item))` per item, no batching.
- ⚠️ **`reject(count)` silently drops.** No `rejectedCount` observable. Users lose the rejection audit trail.
- ⚠️ **`pendingNode.emit([...queue])` uses `equals: () => false`** (line 302). Intentional — every queue transition is a distinct event. But `pendingNode.cache` is a new array every wave, so consumers reading `pending.cache` see identity-unstable results across waves. Document.
- ⚠️ **Teardown race.** `torn = true` inside fn after receiving terminal dep, BUT controller methods called after teardown throw (`guardTorn`). If a consumer calls `approve()` between wave dispatch and sink callback, behavior depends on sync ordering. Today: JS single-threaded, so `fn` runs to completion before controller is reachable — safe. PY free-threaded: real race. Flag for PY parity.
- ⚠️ **`startOpen: true` + queued pending?** Impossible today (if open, we emit immediately; nothing queues). But users who toggle to `close()` mid-flight then `open()` flush via `open()`'s batched dequeue. Verified.
- ⚠️ **`maxPending` FIFO drop is silent.** Oldest values get `shift()`'d without any observable signal. No `droppedCount` Node.

#### Q3 — Design-invariant violations?

- 🟢 `latestIsOpen` via subscribe — §28 sanctioned pattern (already noted in optimizations.md #11).
- 🟢 `open()` batch wrap — §9a compliant.
- 🟡 **§24 gray-zone (explainability):** the output node has `_deps = [src.node]` — correct for the auto-flow case. But the "controller.approve() → output.emit()" path is an imperative producer-style emit that's invisible in describe. Users seeing `describe()` see `src → output` and miss "approvals drive emissions." `explain(src, output)` walks cleanly for pass-through values, but there is no node corresponding to "approvals issued" — the HITL observability surface is absent.
- 🟡 **`pendingNode.emit([...queue])` inside enqueue/dequeue callbacks is called imperatively from controller methods** (not from fn). This is a producer-pattern emission from outside the reactive graph. Not a §24 violation exactly (pendingNode's `_deps = []` by construction — it's a state node), but combined with `output.emit` from controllers, the whole HITL decision stream lives outside the reactive edge graph.

#### Q4 — Open items

- `optimizations.md #11` — `latestIsOpen` closure captured from `isOpenNode.subscribe`. Sanctioned.
- Not tracked: batched-approve semantics, rejected-count observability, dropped-from-maxPending observability, PY thread-safety of `torn`.

#### Q5 — Right abstraction?

- **Right abstraction for HITL, wrong for audit.** As an in-line gate for "human clicks approve", the envelope `{ node, approve, reject, modify, open, close }` is ergonomic. As an observable audit surface, it's thin — only `pending` / `count` / `isOpen` are reactive; `approvals issued / rejected / modified / dropped` are not.
- **More generic:** the missing piece is a `decisions: Node<Decision[]>` log (reactive record of every `approve / reject / modify / drop / open / close` event with timestamps and counts). Then the whole HITL audit becomes explainable.
- **Alternative shape:** replace imperative controller with a reactive `decisionsIn: NodeInput<Decision>` — users push decisions (from UI, from autopilot, from retrospective replay) and gate consumes them as a dep. Maximally reactive, but adds ceremony for the common case.

#### Q6 — Right long-term solution?

- **The imperative controller is the load-bearing UX** — users writing HITL UIs want `onClick={() => gate.approve()}`, not `onClick={() => decisionsNode.emit({action: "approve", count: 1})}`. Reactive-only gate loses the 60% case.
- **But the controller is also the blindspot** — every `approve / reject / modify` bypasses the reactive graph. Auditors can't `explain(humanClick, output)` because the click never became a node. That's a compliance gap for harness engineering where provenance is the sell.
- **Third way: imperative controller + reactive audit tap.** Keep the controller; under the hood, each `approve(n)` also emits into a `decisions: Node<Decision>` log node. Now `explain(decisions, output)` walks cleanly. Controller stays ergonomic; audit becomes visible.
- **Special cases that increase maintenance burden today:**
  - `maxPending: Infinity` default is fine for demos, dangerous for production (unbounded memory on stalled HITL flows). At minimum, document + make the default smaller (e.g., 1000) or require explicit opt-in to unbounded.
  - `pendingNode.emit([...queue])` copies the whole queue every transition. For deep queues this is O(N) per operation.
  - Internal state mount as `${name}_state` subgraph. This is clean in describe but couples the gate's implementation detail (three state nodes) to its public graph shape. If we later add `decisions` / `droppedCount` / `rejectedCount`, mount size grows.
  - Teardown clears the queue silently. If users had pending approvals and the gate tore down, those values are just gone. Optional: emit them to a "unflushedOnTeardown" log for visibility.
- **PY parity hazard:** `latestIsOpen` closure + single-threaded-assumption emits from controller methods. PY free-threaded: needs atomic read/write around `torn` + `queue` + `latestIsOpen`. Today's PY port uses `subgraph_lock` + per-node `_cache_lock` — this gate likely needs its own lock.
- **Maintenance:** 152 LOC, mixing closure state + reactive state + mounted subgraph + imperative controller. High cognitive load. Any enhancement (decisions log, dropped-count, batched-emit) touches all three layers.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:**
  - `describe()` shows: `src → gate.output` (visible), `gate_state::pending`, `gate_state::isOpen`, `gate_state::count` (derived from pending). `isOpen` has no in-edges (it's driven imperatively + by `latestIsOpen` seed).
  - Missing edges: `controller.approve / reject / modify / open / close → output` are invisible (imperative emits).
  - `explain(src, output)`: one hop via source dep. ✓
  - `explain(isOpen, output)`: no path because `output` depends on `src` only, not on `isOpen`. The gate consults `latestIsOpen` closure, not `isOpenNode` as a dep — §28 sanctioned, but explain-invisible.
- **Perf:**
  - Per source value: `queue.push` + `pendingNode.emit([...queue])` (O(N) array copy). High.
  - Per approve: `queue.splice(0, n)` (O(N)) + `pendingNode.emit([...queue])` (O(N)) + N × `output.emit(item)` (each is a full wave).
  - For a 1000-item queue with 10 sequential approves, that's ~20,000 array copies.
- **Memory:** retains queue + three state-node caches + mounted subgraph. Bounded by `maxPending`.
- **Reactive/composable:** ✓ for pass-through; ✗ for HITL decision provenance (see Q3).
- **Simpler shape (additive; keep ergonomics, fix audit gap):**
  ```ts
  type GateController<T> = {
    node: Node<T>;
    pending: Node<T[]>;
    count: Node<number>;
    isOpen: Node<boolean>;
    decisions: Node<readonly Decision[]>;     // NEW — reactive audit log
    droppedCount: Node<number>;                // NEW — from maxPending FIFO drops
    approve(count?: number): void;             // batched internally
    reject(count?: number): void;              // emits Decision to `decisions`
    modify(fn, count?: number): void;          // emits Decision with "modify" action
    open(): void;                              // batched already
    close(): void;
  };

  type Decision =
    | { action: "approve"; count: number; items: readonly T[]; t_ns: number }
    | { action: "reject"; count: number; items: readonly T[]; t_ns: number }
    | { action: "modify"; count: number; items: readonly T[]; t_ns: number }
    | { action: "drop"; count: number; items: readonly T[]; t_ns: number }
    | { action: "open" | "close"; t_ns: number };
  ```
  Every controller method appends to `decisions` via `downWithBatch` (central-timer compliant). `pendingNode.emit` uses structural equality or versioning so repeated-same-queue transitions dedup.

#### Q8 — Alternatives

- **A. Keep as-is.**
  - Pros: shipped; tests pass; harness uses it.
  - Cons: controller invisible in explain; N-wave emit on bulk approve; no audit log; unbounded maxPending default; PY thread-safety gap.
- **B. Keep imperative controller, add reactive audit tap (`decisions` + `droppedCount`).**
  - Pros: preserves UX; closes the audit gap; gives auditors a real `explain(decisions, output)` path; small additive change.
  - Cons: mount grows (5 nodes instead of 3); `Decision` envelope type has to be stable; timestamps via central timer plumbed through every controller method.
- **C. Reactive-only gate (no controller envelope).** Gate takes `decisions: NodeInput<Decision>` as a dep. Controller becomes a helper that pushes decisions into a state node.
  - Pros: maximally reactive; `explain(decisionsSource, output)` is first-class; same primitive serves UI / autopilot / replay.
  - Cons: ceremony for the common case (UI-click); two levels of indirection; PY port has to mirror.
- **D. Merge with `approval` (Unit 7 B) into a unified `pipeline.gate(src, opts)` with mode flags.**
  - Pros: one primitive surface; modes cover imperative / reactive-approver / onceOnly.
  - Cons: big signature; multiple modes on one call have complex type signature.
- **E. Split gate into `manualGate` (imperative only) and `reactiveGate` (decisions-as-input). `approval` becomes `reactiveGate` with a fn-converter.**
  - Pros: each primitive is narrow; types clean; users pick by shape they already know.
  - Cons: two primitives, grown surface.
- **F. B + batched `approve / modify` (wrap controller loops in `batch()`).**
  - Pros: B's benefits + correctness fix for bulk approvals.
  - Cons: none meaningful.

#### Q9 — Recommendation

- **F (imperative controller + reactive audit tap + batched controller loops).** Method on `PipelineGraph` per A.1 lock: `pipeline.gate(name, src, opts?): GateController<T>`.
- **Changes from today's shape:**
  1. Add `decisions: Node<readonly Decision[]>` to the controller envelope and mount it in the state subgraph.
  2. Add `droppedCount: Node<number>` + emit `Decision` on `maxPending` FIFO drops.
  3. Wrap `approve / reject / modify` controller bodies in `batch()` so bulk operations coalesce to one wave.
  4. Default `maxPending = 1000` (was `Infinity`). `Infinity` still available as explicit opt-in.
  5. Emit `Decision` with `wallClockNs()` timestamp on every controller method.
  6. **PY parity:** add per-gate lock around `queue / torn / latestIsOpen` read/write. Design for free-threaded Python.
  7. **Teardown visibility:** emit final `Decision` of shape `{ action: "teardown", unflushed: queue.length, t_ns }` to `decisions` before clearing queue.
  8. Unit 7 `approval` merges in via `opts.approver` mode — see Unit 7 decision.
- **Coverage:** Q2 ✓ (batched controller loops fix N-wave emit; rejected/dropped observable; audit trail exists), Q3 ✓ (controller actions become reactive via the decisions tap — `explain(decisions, output)` walks, solving the audit-invisibility gray-zone), Q5 ✓ (audit log is the "more generic" observability surface), Q6 ✓ (maxPending default + decisions + droppedCount + teardown visibility close the special cases), PY thread-safety explicit.
- **Trade-off to weigh:** the `decisions` envelope adds one reactive node + one state node + `Decision` type definition. Not free — but the "harness engineering = compliance artifact" sell requires it. Skip only if you're confident no user will ever ask "why did item X get emitted?"
- **Caveat:** `Decision` as a discriminated union means consumers filter: `decisions.cache.filter(d => d.action === "approve")`. Consider parallel scalar companion nodes for common filters (`approveCount: Node<number>`, `rejectCount: Node<number>`) — but that's three more nodes in the mount. Easier: ship the `decisions` log and let consumers do the filtering in their own `derived`.

---

### Unit 9 — `loop(graph, name, source, iterate, opts)`

**Scope:** [src/patterns/orchestration/index.ts:476–517](../../src/patterns/orchestration/index.ts:476) (~42 LOC).

#### Q1 — Semantics, purpose, implementation

- Raw `node([src, iterDep?], fn)` where `iterDep` is optional (static `iterations: number` or from a Node).
- Fn body:
  ```ts
  let current = batch0.at(-1) ?? prevData[0];
  const count = coerceLoopIterations(staticIterations ?? batch1-derived);
  for (let i = 0; i < count; i += 1) {
    current = iterate(current, i, actions);
  }
  actions.emit(current);
  ```
- `iterate: (value, iteration, actions: NodeActions) => T` — synchronous; receives `actions` so the fn can `emit` intermediate values.
- `coerceLoopIterations` clamps: non-finite → 1, negative → 0, floors to int.

#### Q2 — Semantically correct?

- ⚠️ **Synchronous blocking.** `iterations: 1_000_000` blocks the event loop. No yielding.
- ⚠️ **Ambiguous output stream.** `iterate` receives `actions` and can call `actions.emit(...)` per iteration — AND the fn calls `actions.emit(current)` at the end. Consumers see both intermediates AND the final. For users who want only the final, they must ignore intermediates.
- ⚠️ **`iterDep` changing mid-stream is not handled deterministically.** If a new `iterations` value arrives on the same wave as a new source value, which wins? Current code: both in the same `data[]` array; count comes from `batch1.at(-1) ?? prevData[1]`, source from `batch0.at(-1) ?? prevData[0]`. If only `iterations` changed (no new source), we re-run loop on `prevData[0]` with the new count. Surprising — iterating again on stale source.
- ⚠️ **Static `iterations: 0`** → `for` loop is skipped, `actions.emit(current)` emits the source value unchanged. Degenerate-but-legal.

#### Q3 — Design-invariant violations?

- 🟢 No timers, no raw async.
- 🟡 **§5.12 Phase-4 developer-friendly gray-zone:** `loop` with static count, synchronous inner fn, and `actions` passed through to user fn is an odd mix. Iteration is not reactive (no waves per step); `actions.emit` inside `iterate` mixes batch vs per-iteration emission.
- 🟡 **Overlap with `refineLoop` (§9.8)** — the latter is the *real* iterative primitive with convergence / scoring / strategy. `loop` is a retained-from-v0 carve that doesn't compose with the rest of the iterative stack.

#### Q4 — Open items

- Roadmap §9.8 — `refineLoop` v1 shipped; `loop` is not referenced.
- Optimizations.md — not tracked.

#### Q5 — Right abstraction?

- **Wrong level.** For "run fn N times synchronously," `derived([src], v => { let x = v; for (let i = 0; i < N; i++) x = f(x, i); return x; })` is one line. Wrapping that in a factory saves zero syntax and adds ambiguity about what `actions.emit` inside `iterate` means.
- **Wrong primitive for real iterative work.** Real iterative work (LLM refinement, convergence, score-driven retries) needs `refineLoop` — reactive, cursor-based, budget-aware.
- **More generic:** delete. The "run a pure fn N times" case is just a fold over `range(N)`, written inline.

#### Q6 — Right long-term solution?

- **Deletion is cheap.** Grepping in-tree users: per `exports.test.ts:48`, only the export barrel references it. No demo / harness / pattern code uses it. Safe to drop pre-1.0.
- **Keeping it costs documentation, tests, and the `actions` semantic ambiguity forever.** Plus a PY mirror.
- **Alternative: narrow loop to pure-fn-only.** `loop(name, src, (v, i) => f(v, i), { iterations })` — no `actions`, must return. Use case: "run this transform N times and emit final." But that's `derived([src], v => times(N, f, v))` — one line, no primitive needed.
- **Alternative: deprecate toward refineLoop.** `loop` becomes a thin wrapper over `refineLoop` with a null strategy. Adds indirection, zero ergonomic win.
- **Special case that will bite if kept:** users will try `loop(…, { iterations: Infinity })` or some very large N. Today `coerceLoopIterations` passes it through with no guard — event loop dies. Deleting kills that footgun.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check:** ✓ `[src, iterDep?]` deps declared. `describe()` shows edges. Clean.
- **Perf:** synchronous inner loop blocks thread. For N > ~10_000, user-perceptible freeze.
- **Memory:** stateless.
- **Reactive/composable:** ✗ iteration is not reactive. The primitive sits between "synchronous fn" (which `derived` covers) and "reactive iteration" (which `refineLoop` covers) — and occupies neither space cleanly.
- **Simpler shape (every common use case):**
  ```ts
  // Today:
  const y = loop(g, "times3", x, (v, i) => v + 1, { iterations: 3 });

  // Inline (same effect):
  const y = derived([x], ([v]) => {
    let c = v;
    for (let i = 0; i < 3; i++) c = c + 1;
    return c;
  }, { name: "times3" });
  graph.add(y);

  // For convergent iteration — use refineLoop instead.
  ```

#### Q8 — Alternatives

- **A. Delete.**
  - Pros: honest; zero blast radius (one export barrel reference); users write for-loop in `derived` when they want N iterations.
  - Cons: "loop" is a discoverable name for workflow-DAG users coming from Airflow et al. — they may search the docs and find nothing.
- **B. Keep as method on `PipelineGraph.loop()`, narrow to pure-fn-only (drop `actions`).**
  - Pros: eliminates ambiguous emit semantics; keeps the name.
  - Cons: still a trivial wrapper over `for` inside `derived`; maintenance debt for no ergonomic win.
- **C. Replace with `pipeline.times(src, fn, N)` sugar.**
  - Pros: Rubyish name; no `actions`; explicitly pure.
  - Cons: same as B — wrapper.
- **D. Deprecate toward `refineLoop`.**
  - Pros: one iterative primitive; consistent docs.
  - Cons: `refineLoop` is much richer (strategies, convergence); users asking for "times 3" get a whole budget / evaluator setup they don't want.
- **E. Keep `loop` for fixed-count pure iteration; add `actions`-less signature as a breaking change.**
  - Pros: keeps the name.
  - Cons: breaking change for what reason? No in-tree users.

#### Q9 — Recommendation

- **A (delete).** Zero users. Ambiguous semantics. Blocking-fn footgun. Small save but an honest one.
- **Migration:** no call sites to update. Remove from exports barrel, drop JSDoc, remove from `exports.test.ts`. PY mirror: same delete.
- **Coverage:** Q2 ✓ (no more ambiguous `actions` inside `iterate`; no blocking-iteration footgun), Q5 ✓ (primitive at the wrong level, removed), Q6 ✓ (maintenance burden gone).
- **Trade-off to weigh:** "loop" as a workflow-DAG keyword. Workflow-DAG users (Airflow / Prefect / n8n) expect `loop` to mean "iterate until converged" — which `refineLoop` provides. If we rename `refineLoop` → `loop`, we steal the name for the richer primitive. Worth doing?
  - Probably not now. `refineLoop` is specific (strategies + budget + evaluator); "loop" is too generic. Keep `refineLoop` named, kill the current `loop`, leave the name available for a future "generic reactive iteration" primitive if one surfaces.
- **Caveat:** if you disagree on deletion, B (pure-fn-only method) is the fallback — keeps the name with unambiguous semantics.

---

### Unit 10 — `onFailure(graph, name, source, recover, opts)`

**Scope:** [src/patterns/orchestration/index.ts:576–622](../../src/patterns/orchestration/index.ts:576) (~47 LOC).

#### Q1 — Semantics, purpose, implementation

- `node([], fn, { describeKind: "derived", completeWhenDepsComplete: false, errorWhenDepsError: false, … })`.
- **`_deps = []`** — output node has zero declared deps.
- Fn body manually `src.node.subscribe((msgs) => { for msg: if ERROR → emit recover(err); else → down(msg); if COMPLETE → terminated = true })` and returns `() => unsub()` cleanup.
- `recover(err, actions)` can emit recovered value + subsequent DATA.
- Comment at L585 explicitly flags this as producer pattern because "onMessage removed in v5 — use producer+subscribe instead".

#### Q2 — Semantically correct?

- ⚠️ **Spec: ERROR is terminal.** Per spec §1.2 / §2.2, ERROR is tier-4 terminal — a node that errors is dead. The manual-subscribe pattern in `onFailure` is structured to handle "error-mid-stream-continue," which per spec cannot happen on non-resubscribable sources. Either the code is defensive against an impossible case, or the spec contract is weaker than I read.
- ⚠️ **Terminated flag is closure state.** `let terminated = false` in factory closure; set inside the subscribe callback. Single-threaded JS: safe. PY free-threaded: race.
- ⚠️ **`COMPLETE` forwarding.** When source COMPLETES, the fn `actions.down([[COMPLETE]])` and sets `terminated = true`. Correct.
- ⚠️ **ERROR forwarding inside recover.** If `recover` throws, we emit `[[ERROR, err]]` and set `terminated = true`. Correct.
- ⚠️ **No re-arm for resubscribable sources.** If `src` is resubscribable (terminal-reset resets `_hasCalledFnOnce`), `onFailure`'s manual subscribe is bound to the pre-reset Node instance. Terminal reset re-creates dep records but `onFailure` still holds the original subscribe. Probably buggy; needs verification.
- ⚠️ **`completeWhenDepsComplete: false`** is set because `_deps = []` means no dep ever completes naturally. But since we also never have deps, this is a no-op. Reads as defensive-for-nothing.

#### Q3 — Design-invariant violations?

- 🔴 **§24 — `_deps = []` means describe shows no edge from `src` to this recovered node.** Topology check FAILS. The error-recovery edge is invisible. This is the exact pagerduty-demo class of bug.
- 🔴 **§5.9 — manual `src.node.subscribe` inside fn body is a producer-pattern imperative coordination.** The spec says coordination flows through the graph — the fix is dep-channel intercept via `terminalDeps`.
- 🟡 **Closure `terminated` flag** is a state that should be a state node (per §24 "replace closure-captured mutable state with a registered `state()` node"). Single-threaded-safe today; PY-race-prone tomorrow.

#### Q4 — Open items

- Not tracked. Candidate for optimizations.md: "`onFailure` should use dep-channel intercept for visibility in describe."
- Related to the "P3 `.cache` re-pass" scope — similar producer-pattern explainability gap.

#### Q5 — Right abstraction?

- **Concept is right (rescue-on-error), shape is wrong.** Dep-channel intercept via `errorWhenDepsError: false` + `ctx.terminalDeps[0]` gives the same behavior with a visible edge. This is COMPOSITION-GUIDE §23 "rescue pattern with errorWhenDepsError: false".
- **More generic:** the rescue pattern is a two-dimensional choice: (ERROR-only | ERROR+COMPLETE | COMPLETE-only) × (emit-replacement | forward-original | switch-source). `onFailure` handles ERROR → emit-replacement. Generalizing: `catch(src, handler, { on: "error" | "complete" | "any" })` returning the recovered stream.

#### Q6 — Right long-term solution?

- **Fixing describe visibility is the immediate win.** Users running explain on workflows with `onFailure` nodes see them as islands today. Fixing that gives a compliance artifact ("here's how errors were recovered").
- **Keep ergonomics: recover(err) → T.** Users want the narrow "if error, compute a replacement" fn. Don't force them into the two-dimensional matrix.
- **Special cases to handle:**
  1. Resubscribable sources — `onFailure` should re-arm when source terminal-resets. Today: broken (stale closure subscription).
  2. `recover` throws — today: emit ERROR on output, set `terminated`. Future: should `onFailure` chain to another recover? Probably not — one layer of rescue per invocation. Document.
  3. COMPLETE forwarding is implicit — users who want COMPLETE → recover have to use `catch` variant.
- **PY parity hazard:** manual-subscribe pattern is fine in PY too, but closure `terminated` needs a lock in free-threaded world. Dep-channel intercept (recommended shape) doesn't have a closure `terminated` — the dep record already tracks terminal state atomically.
- **Maintenance:** 47 LOC today, ~25 LOC with dep-channel rewrite. Smaller, simpler, more visible.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check (current):** ✗ `describe()` shows `onFailure_node` as an island (zero deps). `explain(src, onFailure_node)` has no path. FAIL.
- **Topology check (proposed dep-channel):** ✓ `describe()` shows `src → onFailure_node`. `explain(src, onFailure_node)` walks one hop. Clean.
- **Perf:**
  - Current: one subscribe + per-message iteration in callback.
  - Proposed: fn fires once on dep-terminal transition; `terminalDeps[0]` read is O(1). Equivalent.
- **Memory:** current retains closure state; proposed retains nothing beyond dep records.
- **Reactive/composable:** ✓ after dep-channel rewrite.
- **Simpler shape:**
  ```ts
  // Today (L576–622):
  const recovered = node([], (_data, actions) => {
    const unsub = src.node.subscribe((msgs) => {
      for (const msg of msgs) {
        if (terminated) return;
        if (msg[0] === ERROR) {
          try { actions.emit(recover(msg[1], actions)); }
          catch (err) { terminated = true; actions.down([[ERROR, err]]); }
        } else {
          actions.down([msg]);
          if (msg[0] === COMPLETE) terminated = true;
        }
      }
    });
    return () => unsub();
  }, { completeWhenDepsComplete: false, errorWhenDepsError: false });

  // Proposed:
  const recovered = node([src.node], (data, actions, ctx) => {
    const term = ctx.terminalDeps[0];
    if (term === true) {
      actions.down([[COMPLETE]]);
      return;
    }
    if (term !== undefined) {
      // ERROR — try to recover
      try { actions.emit(recover(term, actions)); }
      catch (err) { actions.down([[ERROR, err]]); }
      return;
    }
    // pass through DATA
    const batch0 = data[0];
    if (batch0 != null && batch0.length > 0) for (const v of batch0) actions.emit(v);
    else actions.down([[RESOLVED]]);
  }, { describeKind: "derived", errorWhenDepsError: false });
  ```

#### Q8 — Alternatives

- **A. Keep manual-subscribe pattern as-is.**
  - Pros: shipped.
  - Cons: §24 violation; invisible edge; PY race potential; resubscribable-source bug.
- **B. Rewrite as dep-channel intercept (`errorWhenDepsError: false` + `terminalDeps[0]` read).**
  - Pros: visible edge; cleaner; PY-safe; resubscribable-source handled via core machinery.
  - Cons: small behavior change — today's manual subscribe can observe `[[ERROR]]` before the node's dep record reflects it; dep-channel intercept sees the terminal on next wave. In practice: identical to users.
- **C. Generalize to `catch(src, handler, { on })` with ERROR / COMPLETE / ANY modes.**
  - Pros: richer; one primitive replaces `onFailure` + hypothetical `onComplete`.
  - Cons: scope creep; hard to justify ANY / COMPLETE modes until users ask.
- **D. Delete `onFailure`; users write dep-channel rescue inline.**
  - Pros: smallest surface.
  - Cons: rescue is a recognizable workflow-DAG pattern; losing the named breadcrumb hurts discoverability.

#### Q9 — Recommendation

- **B (dep-channel rewrite), as method on `PipelineGraph.onFailure(name, src, recover, opts?)`.** Same surface, correct implementation.
- **Consider bundling with C (generalize)?** Defer. Ship B first; evaluate `onComplete` / `catch(any)` if a user asks. YAGNI.
- **Coverage:** Q2 ✓ (resubscribable handled by core; closure race gone), Q3 ✓ (topology visible in describe; §24 clean), Q5 ✓ (dep-channel is the right shape), Q6 ✓ (PY-safe; simpler).
- **Trade-off to weigh:** the tiny behavior delta around "when does the recover fn run relative to outgoing wave." Today: callback-time (immediate). Proposed: next wave after dep-terminal transition. In practice, user callbacks run within the same tick — indistinguishable. But a pathological user writing `recover = (err) => complexPromiseChain()` in hot-loop might notice. Test with one real case before locking.
- **Caveat:** the current code has `completeWhenDepsComplete: false` (line 614) because zero-dep nodes don't auto-complete. The proposed rewrite has one dep, so we leave `completeWhenDepsComplete` at default `true` — COMPLETE auto-propagates. If user passed `completeWhenDepsComplete: false` intentionally (they have a reason to suppress COMPLETE), the rewrite should honor opts.

---

## Batch A.2 cross-cutting observations

Collected while auditing Units 7–10:

1. **The four primitives cluster into two pairs by concern:**
   - *Human-in-loop pair* (`approval`, `gate`): both pass-through-with-decision; overlap; unify into one gate with modes.
   - *Error-and-iteration pair* (`onFailure`, `loop`): both predate the v5 rescue + iteration machinery; `onFailure` needs dep-channel rewrite, `loop` should be deleted.
2. **§24 "edges are derived" is the recurring violation.** `onFailure` has empty `_deps` (islands in describe); `gate`'s imperative controller path is invisible. Both need reactive surfaces (dep-channel for onFailure; `decisions` audit tap for gate).
3. **Harness engineering compliance story demands reactive audit.** `gate`'s imperative controller + missing `decisions` log is the single biggest "compliance gap" in orchestration. Fix lands as a non-breaking additive Node on the controller envelope.
4. **PY free-threaded hazard on all four units.** Closure flags (`terminated` in onFailure, `torn / queue / latestIsOpen` in gate) need locks or state-node promotion.
5. **Deletion candidate confirmed:** `loop` has zero in-tree users beyond the export barrel. Delete.

---

## Open question for user (before locking A.2)

Units 7 / 9 have near-unambiguous directions (merge / delete). Units 8 / 10 have design knobs worth surfacing:

- **Unit 8 gate `decisions` log:** ship the `Decision` envelope + reactive audit tap as part of the method rewrite, or defer until a user asks? My recommendation is ship-now — the compliance sell for harness engineering benefits from it, and it's an additive surface. Counter-arg: "YAGNI; users build their own audit log via `onStart/onTerminal` hooks on controller methods."
- **Unit 10 onFailure scope:** rewrite narrowly (ERROR → recover) or generalize to `catch(src, h, { on: "error" | "complete" | "any" })`? My recommendation is narrow-rewrite; generalize only if a user asks. Counter-arg: "while we're in the file, might as well build the richer primitive."
- **Unit 7/8 naming in the new `PipelineGraph`:** keep `approval` as a method alias of `gate(src, { approver })`, or drop the alias to force unified naming? Read-as-English vs one-name consistency.

Once these three are answered, A.2 locks cleanly and Wave B (messaging + job-queue) starts.

---

## Decisions locked (A.2) — 2026-04-24

**Per-unit:**
- **Unit 7 `approval`** → deleted as factory; unified into `pipeline.gate(src, { approver })` with modes (imperative / reactive / `onceOnly` latch). `pipeline.approval(name, src, approver)` kept as thin method alias over `this.gate(name, src, { approver, maxPending: 1 })`.
- **Unit 8 `gate`** → rewritten as method on `PipelineGraph` per Alternative F: imperative controller + reactive `decisions: Node<readonly Decision[]>` audit tap + `droppedCount` + batched controller loops + default `maxPending = 1000` + `wallClockNs()` timestamps on every `Decision` + teardown-emits-final-Decision + PY per-gate lock.
- **Unit 9 `loop`** → deleted entirely. Zero in-tree users; name reserved for future reactive-iteration primitive if one surfaces.
- **Unit 10 `onFailure`** → rewritten + renamed to `pipeline.catch(name, src, recover, { on })` with modes `"error" | "complete" | "terminal"` (default `"error"`). Dep-channel intercept, no manual subscribe, no closure state.

**Open-question answers:**
- Q1 (gate decisions log timing) — ship now, part of Unit 8 rewrite.
- Q2 (onFailure scope) — generalize to `catch` with modes.
- Q3 (approval alias) — keep thin method alias.

**Implementation-session scope (combined with A.1 for the eventual "implement Wave A" session):**
1. Base `Graph` changes (A.1): `WeakMap<Node, string>` in `add`; `Graph.mount(name, builderOrChild?)` overload.
2. `PipelineGraph extends Graph` subclass — A.1 methods: `.task / .classify / .combine`. A.2 methods: `.gate / .approval / .catch` (plus `.mount` inherited).
3. Delete orchestration factories: `pipeline` (becomes subclass factory), `task / branch / join / subPipeline / sensor / approval / gate / loop / onFailure`. Rewrite in-tree callers to method form.
4. `Decision` discriminated union type exported from `patterns/orchestration` (public surface).
5. Move `sensor` → `producer` in `extra/sources.ts`.
6. Update `exports.test.ts`.
7. Docs: `patterns/orchestration` README + JSDoc for `PipelineGraph` methods + decisions-log walkthrough + catch mode walkthrough.
8. PY mirror — separate session: `PipelineGraph` subclass, `.gate / .approval / .catch` methods with threadsafe closure-state protection, `producer` in `extra/sources`, no `async def`.

**Total orchestration LOC impact (estimate):**
- Today: `patterns/orchestration/index.ts` = 622 LOC.
- After Wave A: `PipelineGraph` methods + `Decision` type + `producer` (moved) + base-Graph changes ≈ 450–500 LOC across files. Net shrink ~20%, audit trail added, topology violations fixed.

---



## Wave B — Messaging + Job-Queue

### Batch B.1 — Messaging core (`TopicGraph`, `SubscriptionGraph`)

---

### Unit 11 — `TopicGraph<T>` (+ `topic()` factory)

**Scope:** [src/patterns/messaging/index.ts:39–113](../../src/patterns/messaging/index.ts:39) (~75 LOC class, ~8 LOC factory at L411–416).

#### Q1 — Semantics, purpose, implementation

- `class TopicGraph<T> extends Graph` — Pulsar-inspired retained-event topic.
- Internals:
  - `_log: reactiveLog<T>([], { name: "events", maxSize: opts.retainedLimit })` — the underlying reactive list.
  - `events: Node<readonly T[]>` — `this._log.entries`; mounted as `"events"`.
  - `latest: Node<T | null>` — `derived([events], ([snap]) => snap.length === 0 ? null : snap[snap.length - 1])`.
  - `hasLatest: Node<boolean>` — `derived([events], ([snap]) => snap.length > 0)`.
- Public API:
  - `publish(value: T): void` — imperative; calls `this._log.append(value)`.
  - `retained(): readonly T[]` — reads `this.events.cache`.
- Teardown (via `addDisposer`):
  1. D1(a): emit `[[COMPLETE]]` on `events` so downstream (including externally-held subscriptions) see terminal.
  2. P9: `this._log.disposeAllViews()` — releases memoized tail/slice keepalives.
- `topic()` factory is a one-liner: `new TopicGraph<T>(name, opts)`.

#### Q2 — Semantically correct?

- ⚠️ **`latest === null` ambiguity when `T` includes `null`.** Documented in JSDoc (L46–52) with `hasLatest` as the disambiguation. Still a papercut — `topic<number | null>().latest.cache === null` is ambiguous without reading `hasLatest`. Users who forget the check have a bug.
- ⚠️ **Unbounded `retainedLimit` default.** `opts.retainedLimit` is optional; undefined → `maxSize: undefined` → `reactiveLog` default (unbounded). Same unbounded-memory footgun as `gate.maxPending: Infinity` — fine for demos, dangerous for long-running services.
- ⚠️ **`publish(value)` accepts any `T` including `undefined`.** `undefined` is SENTINEL globally (spec §5.12). Appending `undefined` to the log is legal from the log's perspective (it stores what it's given) but `events.cache.at(-1) === undefined` then collides with "never published" when used through `latest`. Today `latest` uses `snap[last]` directly — `undefined` is returned as-is, colliding with the "empty" `null` only if `T === null`. Still a sharp edge for `publish(undefined)`.
- ⚠️ **`retained()` returns a live `readonly T[]` reference.** If the log mutates that internal array in place (which `reactiveLog` does via `push` then `emit([...entries])`), external holders of `retained()`'s return value see stale snapshots. Probably intentional — `.cache` is a snapshot by protocol. Verify the reactiveLog contract.
- ⚠️ **`latest` + `hasLatest` both mount, both have `keepalive`.** Consumers never asking for either pay the activation cost anyway. For topics used as raw event streams (subscribers iterate `events` directly), this is dead work.

#### Q3 — Design-invariant violations?

- 🟢 §24 — `latest` + `hasLatest` have real `_deps = [events]`. Describe shows clean fan-out from `events`.
- 🟢 §5.11 — no timers, no raw async, no hardcoded type checks.
- 🟢 §28 — no fn-body `.cache` reads. `retained()` is external-consumer API (sanctioned boundary).
- 🟡 `publish(value)` imperative — boundary API, same class as `TopicBridgeGraph.pump` calling `target.publish(mapped)`. Here it's a user-facing verb, which is correct. Becomes a problem only when internal pumps call it cross-graph (deferred to Unit 13).
- 🟡 D1(a) teardown emits COMPLETE on `events` but `latest` / `hasLatest` don't explicitly re-emit anything final — they'll propagate COMPLETE via standard dep-channel once. OK but document.

#### Q4 — Open items

- **optimizations.md §Resolved 2026-04-15** — "reactiveLog: derived view keepalive leak" fixed via memoization. `_log.disposeAllViews()` in teardown ties off remaining views. TopicGraph itself doesn't call `_log.tail/slice` today; disposer is defensive for plugin users of `_log`.
- **optimizations.md** — `patterns/messaging.ts` (retained/ack/pull/bridgedCount) sanctioned as external-consumer API. TopicGraph `retained()` is in that set.
- Not tracked: unbounded default `retainedLimit`; `latest === null` vs SENTINEL ambiguity for `T | null`; `publish(undefined)` policy.

#### Q5 — Right abstraction? More generic possible?

- **TopicGraph is the right shape for "retained-log pub/sub".** It wraps `reactiveLog` in a Graph container, adds the two most-wanted derivations (`latest`, `hasLatest`), and exposes `publish` as the ergonomic verb. Every other messaging primitive (Subscription, Bridge, Hub) builds on this.
- **Overlap with siblings:**
  - **`extra/pubsub`** — lightweight last-value state hub. No retention, no cursors. Distinct surface (verified per line 281 comment in messaging/index.ts). `pubsub` is "like `state` but keyed"; topic is "like `reactiveLog` with convenience derivations".
  - **`cqrs.event()`** — also `reactiveLog`-backed, but carries `CqrsEvent` envelope (type + timestamp + seq) and denies external `write` via guard. Functionally a TopicGraph with a rich envelope + write-guard. Covered in Wave C.
  - **`jobQueue.pending`** — `reactiveList<string>` (ordered). Different shape (ids + claim/ack state machine), different semantics.
- **More generic possibility:** the pair (`events` + `latest` + `hasLatest`) is a recurring "log with last-value tap" pattern. Could live in `extra/reactive-log` as a built-in `withLatest()` helper: `reactiveLog([], {…}).withLatest() → { entries, latest, hasLatest }`. Then TopicGraph becomes `Graph + reactiveLog.withLatest() + publish verb`. But that's a refactor of `extra`, not messaging.

#### Q6 — Right long-term solution? Caveats / maintenance burden

- **The retained-log-plus-latest shape is load-bearing for the harness vision.** Every harness stage topic (INTAKE, TRIAGE, QUEUE, GATE, EXECUTE, VERIFY, REFLECT) needs "append events + subscribe to latest + retain for late joiners" — TopicGraph is already the canonical primitive. Don't deprecate; do polish.
- **`latest === null` ambiguity is a real user-facing footgun.** Four shapes to consider:
  1. **Status quo:** `latest: Node<T | null>` + document `hasLatest` caveat. Cheap, survives; costs user bugs.
  2. **Tagged shape:** `latest: Node<{ hasValue: true; value: T } | { hasValue: false }>` — no ambiguity possible; consumers pattern-match. More ceremony for the common `topic<number>()` case where `null` isn't a valid value.
  3. **`lastValue()` method (imperative):** `topic.lastValue(): T | undefined` — use SENTINEL semantics; consumers check for `undefined`. Matches node-level conventions (§5.12 reserves `undefined` as SENTINEL), but loses reactive subscribability.
  4. **Double-node:** `lastValue: Node<T | undefined>` (SENTINEL) + `hasLatest: Node<boolean>`. Drops `latest: Node<T | null>`, aligns with protocol sentinel, but still needs `hasLatest` to disambiguate for `T` including `undefined`-shaped values (edge case).
- **Unbounded `retainedLimit` default is risk-prone.** Long-running TopicGraphs (e.g., a hub's topic for a chat message stream) silently OOM. Sensible default: `retainedLimit: 1024` or `retainedLimit: 0` (retain nothing except `latest` cache). `Infinity` explicit opt-in. Breaking change — but pre-1.0, acceptable.
- **`publish(undefined)` policy.** Either (a) throw on `undefined`-input at publish-time (strict; matches SENTINEL reserved meaning), or (b) coerce to `null` (permissive; documented), or (c) accept and rely on `hasLatest` for disambiguation (status quo). (a) is the most protocol-aligned; cost is users accidentally calling `publish(maybeUndefined)` now get a loud error instead of silent behavior. Recommend (a).
- **`keepalive` on `latest` + `hasLatest` runs unconditionally.** If a consumer subscribes only to `events`, the two derivations still activate because of the keepalive disposer. Negligible cost (one derived fn per topic), but not zero-overhead. For topics-in-tight-loops this accumulates. Lazy keepalive (only activate when first subscribed) is an option but adds bookkeeping.
- **PY parity:** `TopicGraph` mirrored in `graphrefly.patterns.messaging`. Thread safety: `publish` → `_log.append` is a write to `reactiveLog`; PY already has per-subgraph `RLock` + per-node `_cache_lock`. Verify the `latest`/`hasLatest` derived nodes participate correctly under concurrent publish. The `_log.disposeAllViews()` teardown needs the same lock story in PY.
- **Maintenance burden:** ~75 LOC. Two caveats in JSDoc. `reactiveLog`-backed — any changes to reactiveLog (resolved 2026-04-15 leak fix is the recent one) propagate here automatically.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check (minimal composition):**
  - Build: `const t = topic<number>("nums")`; subscribe to `t.events`, `t.latest`, `t.hasLatest`; `t.publish(1)`; `t.publish(2)`.
  - `describe()` output: under `nums::`:
    - `events` (from reactiveLog, `describeKind: "state"` per reactiveLog convention)
    - `latest` (derived, deps: `["events"]`)
    - `hasLatest` (derived, deps: `["events"]`)
  - `explain(events, latest)`: one hop. ✓
  - `explain(events, hasLatest)`: one hop. ✓
  - Clean. No islands. No closure-held state reads inside fn bodies.
- **Perf:**
  - `publish`: `reactiveLog.append` is O(1) amortized (or O(maxSize) if backing storage rolls oldest-out). `events` emits the new snapshot; `latest` + `hasLatest` both fire one wave each (same wave if batched).
  - Per-publish downstream cost: 3 nodes fire (events + latest + hasLatest) even if consumer only cares about one.
  - Memory: log retains up to `retainedLimit` items; `latest` + `hasLatest` cache one value each.
- **Memory:** unbounded default is the caveat. Otherwise tight.
- **Reactive/composable:** ✓ fully reactive; fits cleanly into `derived` / `switchMap` / `reduce` downstream.
- **Simpler shape (speculative):**
  ```ts
  // Status quo:
  const t = topic<number>("nums", { retainedLimit: 1024 });
  t.publish(42);
  t.latest.cache;   // T | null

  // Protocol-aligned:
  const t = topic<number>("nums", { retainedLimit: 1024 });
  t.publish(42);
  t.lastValue.cache;  // T | undefined (SENTINEL)
  t.hasLatest.cache;  // boolean
  ```

#### Q8 — Alternatives

- **A. Keep as-is.**
  - Pros: shipped; tests pass; harness depends on it.
  - Cons: `latest === null` footgun; unbounded-memory footgun; `publish(undefined)` undefined behavior.
- **B. Align with protocol SENTINEL: rename `latest` → `lastValue: Node<T | undefined>`; keep `hasLatest`.**
  - Pros: consistent with node-level `cache: T | null | undefined` convention; no ambiguity when `T` includes `null`; matches spec §5.12.
  - Cons: breaking rename; users who read `.latest.cache` must migrate; for `T` that includes `undefined`-valued shapes (rare), ambiguity moves instead of disappearing.
- **C. Tagged-option shape: `latest: Node<{ hasValue: true; value: T } | { hasValue: false }>`.**
  - Pros: zero-ambiguity regardless of what `T` contains; pattern-match discipline.
  - Cons: heavier for the common case; consumers who just want `.value` now write `latest.cache.hasValue ? latest.cache.value : fallback`.
- **D. Bound default `retainedLimit` (e.g., 1024).**
  - Pros: removes OOM footgun; explicit `Infinity` still available.
  - Cons: breaking — existing users may implicitly depend on unbounded; document migration.
- **E. Throw on `publish(undefined)` (strict SENTINEL enforcement).**
  - Pros: aligns with spec; surfaces bugs early.
  - Cons: users who want "publish undefined as a no-value signal" have to opt into `publish(null)` or a tagged wrapper.
- **F. Lazy keepalive on `latest` / `hasLatest` (activate on first external subscribe).**
  - Pros: zero overhead for topics whose consumers only care about `events`.
  - Cons: bookkeeping complexity; tests for "subscribe after first publish sees latest via push-on-subscribe" must still work.
- **G. B + D + E combined.**
  - Pros: covers the three footguns together; one migration note.
  - Cons: bigger breaking change; but pre-1.0 budget exists.
- **H. Absorb `latest`/`hasLatest` into `reactiveLog.withLatest()` helper in `extra/reactive-log`; TopicGraph just wires it.**
  - Pros: reusable; `cqrs.event` and others can use the same helper.
  - Cons: scope creep beyond this review; `reactiveLog`-layer change.

#### Q9 — Recommendation

- **G (B + D + E combined), with H deferred.** Execute the three footgun fixes in one pre-1.0 break:
  1. `latest: Node<T | null>` → `lastValue: Node<T | undefined>` (SENTINEL-aligned).
  2. Default `retainedLimit: 1024` (explicit `Infinity` to opt into unbounded).
  3. `publish(undefined)` throws synchronously.
- **Keep `hasLatest`** as disambiguation when `T` may include `null` (and now `undefined`).
- **Defer H** (reactive-log helper extraction) to a separate `extra/reactive-log` refactor session — it touches that layer and shouldn't be bundled with messaging rewrites.
- **Defer F** (lazy keepalive) — negligible perf gain vs bookkeeping cost; revisit if a profile shows it matters.
- **Coverage:** Q2 ✓ (footguns removed), Q3 ✓ (no invariant drift), Q5 ✓ (shape preserved), Q6 ✓ (special cases closed; PY parity straightforward).
- **Trade-off to weigh:**
  - **B breaks naming.** Every `.latest.cache` call in demos/tests/docs migrates to `.lastValue.cache`. Annoying but mechanical. Alternative: keep the name `latest` but change its type to `T | undefined`. Less breaking, but loses the "rename to signal semantic change" affordance. I'd rename — the type change is semantic and deserves the name flag.
  - **D default 1024 vs something else.** 1024 is a round number but small for high-volume topics (say, per-request event logs in an API server). Other defaults: 256 (very conservative), 4096 (closer to real), 0 (retain only `lastValue`). The right number depends on the target user — conservative default + opt-in to larger is safer than the reverse. 1024 is my suggestion; open to 256.
  - **E throws on `publish(undefined)`.** Users who legitimately want "publish an unset signal" migrate to `publish(null)` with `T | null` typing. If they're heavy users of `undefined` as data (rare, since spec reserves it), they opt out via runtime coercion wrapper.
- **Caveat:** if we lock G, `cqrs.event()` (covered in C.1) should follow the same conventions for consistency — pre-note for Wave C.

---

### Unit 12 — `SubscriptionGraph<T>` (+ `subscription()` factory)

**Scope:** [src/patterns/messaging/index.ts:120–199](../../src/patterns/messaging/index.ts:120) (~80 LOC class, ~8 LOC factory at L438–445).

#### Q1 — Semantics, purpose, implementation

- `class SubscriptionGraph<T> extends Graph` — cursor-based view over a `TopicGraph`'s retained window.
- Constructor: `(name, topicGraph, { cursor = 0, graph })`.
- Internals:
  - `source: Node<readonly T[]>` — `derived([topicEvents], ([snap]) => snap as readonly T[], { initial: topicEvents.cache })`. **No-op identity passthrough of `topic.events`.**
  - `cursor: Node<number>` — `state(initialCursor)`.
  - `available: Node<readonly T[]>` — `derived([source, cursor], ([src, c]) => src.slice(max(0, trunc(c))))`.
  - `topic: TopicGraph<T>` — external reference, **intentionally NOT mounted** (D1(e): double-mount hazard if hub also owns the topic).
- Public API:
  - `ack(count?)` — advances cursor by `min(requested, available.length)`. Reads `this.available.cache` + `this.cursor.cache`; writes `this.cursor.emit(next)` (F8: uses emit so pipeline adds DIRTY + equals substitution).
  - `pull(limit?, { ack })` — returns `available.slice(0, max)`; optionally calls `ack(out.length)`.
- Disposers: `keepalive(source)`, `keepalive(available)`.

#### Q2 — Semantically correct?

- ⚠️ **`source` is a pure identity passthrough of `topic.events`.** The JSDoc (L167–168) explains it as "the node-level dep `derived([topicEvents], …)` above is the live wire" and frames it as the reason there's no explicit `graph.connect` — but a no-op `derived` node is still a node. Every cursor snapshot round-trips through it; every subscribe adds a sink to `topic.events` AND a sink to `source`. Cosmetic: it gives describe a local "source" label. Semantically: could be elided.
- ⚠️ **`ack(count)` reads `this.cursor.cache` + `this.available.cache`.** Sanctioned external-consumer boundary read (optimizations.md). But it's dangerously close to fn-body reads — if a downstream user subscribes to `available` and their callback calls `sub.ack()`, the callback's synchronous read of `.cache` happens before the current wave fully drains. Verify wave-semantics interaction.
- ⚠️ **`pull` with `{ ack: true }` is a read-then-mutate-then-return pattern.** If the topic publishes a new batch between `const available = this.available.cache` (line 190) and `this.ack(out.length)` (line 196), the cursor advances past some items the caller never saw. Under single-threaded JS this can't happen (no yield points); under PY free-threaded it's a race.
- ⚠️ **`initial: topicEvents.cache` at construction time** — §28 factory-time seed, sanctioned. But if the topic has had many publishes before the subscription is created, the subscription's initial `available` starts at the cursor (default 0) and shows ALL retained history. Users expecting "subscribe from now" have to pass `{ cursor: topicEvents.cache.length }`. Documentation point.
- ⚠️ **`cursor` advancing past `available.length` is silently clamped** (`Math.min(requested, available.length)`). Returns the actual step taken, not an error. Callers who want "ack exactly N" get "ack up to N" — surprising but defensible.
- ⚠️ **No "pause" / "stop" semantics.** A subscription never terminates on its own. Topic COMPLETE propagates via D1(a) through `events → source → available`, but the subscription's `cursor` state node stays alive. Subscribers to `available` see COMPLETE; holders of the subscription can still call `ack()` afterward (which is a no-op if no available).

#### Q3 — Design-invariant violations?

- 🟢 §24 — `available` depends on `[source, cursor]` — both real deps. Describe edges clean inside the subscription subgraph.
- 🟢 §5.11 — no timers, no raw async, no hardcoded type checks.
- 🟡 **§24 gray-zone across graph boundaries.** `source` depends on `topic.events`, but the topic is NOT mounted on the subscription. From the subscription's `describe()` point of view, `source` has a dep that points outside — the topic is labeled as `{external}` or similar. `graph.edges()` derives this correctly (per §24: edges come from `_deps`, not from mount relation), but users running describe on the subscription in isolation see `source` with an external-referenced dep. Confusing vs clean.
- 🟡 **§28 boundary reads in `ack/pull`** — sanctioned as external-consumer API. OK but documented.
- 🟡 **`source` passthrough node adds zero semantic value**, per Q2. Not a violation, but a §24 "edges derived from real deps" argues against adding shape-only nodes.

#### Q4 — Open items

- **optimizations.md** — `patterns/messaging.ts (retained/ack/pull/bridgedCount)` sanctioned external-consumer boundary reads (covers `ack/pull`).
- **optimizations.md** — no specific item for the `source` no-op passthrough.
- Not tracked: `pull({ ack: true })` TOCTOU race (PY relevant); subscription termination semantics; "subscribe from now" ergonomics.

#### Q5 — Right abstraction? More generic possible?

- **Cursor-over-log is the right abstraction** for "streaming consumer with at-most-once / at-least-once guarantees." Pulsar's mental model, which the module borrows, validates it.
- **`source` passthrough is not an abstraction** — it's a describe-layer decoration. Users who want a local label write `derived([topic.events], …, { name: "source" })` themselves; factoring it into every subscription adds one node per subscription for no behavior.
- **More generic candidates:**
  - Merge with `reactiveLog.tail(n)`: the log already has windowed views. A cursor is "view from [cursor, end)". If `reactiveLog` exposed `fromCursor(startIndex): Node<readonly T[]>` with cursor advancement as a mutation, `SubscriptionGraph` becomes `{ topic, cursor, available: topic._log.fromCursor(cursor) }`. Cleaner, but requires `extra/reactive-log` changes.
  - Reactive cursor instead of imperative `ack`: `subscription(topic, { advanceOn: ackSignalNode })` — every ack signal is a Node DATA; the cursor derives from the signal stream. Removes boundary imperative API. Ceremony for HITL manual-ack case but clean for autopilot/autoack.
  - Unify with `cqrs.projection` — both "fold events starting from some position." But CQRS projections compute a state, not a window. Different output shape.

#### Q6 — Right long-term solution? Caveats / maintenance burden

- **Keep cursor-over-log; kill the `source` passthrough.** The passthrough is cruft. `available` can depend directly on `topicGraph.events`:
  ```ts
  this.available = derived(
    [topicGraph.events, this.cursor],
    ([events, c]) => (events as readonly T[]).slice(max(0, trunc(c))),
    { name: "available", initial: [] },
  );
  ```
  Describe now shows `topic::events → available` (cross-graph edge) and `cursor → available` (local edge). Same semantics, one fewer node. Users who wanted a "source" local node for composition can add their own.
- **Pull-with-ack TOCTOU is a PY free-threaded hazard.** Fix options:
  1. Expose `pull` without ack; `ack` as explicit separate call.
  2. Under a lock, snapshot `available` and ack atomically.
  3. Make `pull({ ack })` return a tuple `{ items, ackedCursor }` so caller knows exactly how far the cursor moved.
  (3) is most ergonomic; (2) is correctness under concurrency. Combine.
- **Subscription termination semantics.** Once topic COMPLETEs, `cursor` can't advance beyond the final length. `ack()` becomes a no-op that returns `cursor.cache`. That's fine; document. Explicit `subscription.dispose()` would let callers clean up without tearing down the topic.
- **"Subscribe from now" is a real ergonomic gap.** Common user question: "how do I subscribe to a topic and see only new events, skipping retained?" Today's answer: `subscription(t, { cursor: t.events.cache.length })` — works but requires reading `.cache` at call site (boundary read, fine) and a comment explaining it. Ergonomic wrapper: `subscription(t, { from: "now" | "retained" | number })` where `"now"` resolves to current length. Small sugar, big UX win.
- **No "pause" / "resume" without cursor-arithmetic.** A paused subscription is just one that stops calling `ack`. Natural — but combined with backpressure, users sometimes want the subscription to NOT retain growing `available`. `maxAvailable: number` would cap the slice and let callers see "there are N+ pending." Marginal.
- **PY parity:** subscription is a Graph holding a state node + derived. No special thread-safety issues beyond core `Graph.add`. `ack`/`pull` boundary reads need the TOCTOU fix described.
- **Maintenance:** 80 LOC; shrinks to ~65 LOC after removing `source`. No other complexity drivers.

#### Q7 — Simplify / reactive / composable + topology check + perf

- **Topology check (minimal composition):**
  - Build: `const t = topic<number>("nums"); t.publish(1); t.publish(2); const sub = subscription("worker", t, { cursor: 0 });`
  - `describe({ subgraph: "worker" })` (today):
    - `worker::source` (derived, deps: `["nums::events"]` — cross-graph)
    - `worker::cursor` (state)
    - `worker::available` (derived, deps: `["source", "cursor"]`)
  - `explain(t.events, sub.available)`: hops `events → source → available` (two nodes due to passthrough). ✓ but unnecessary length.
  - After proposed simplification:
    - `worker::cursor` (state)
    - `worker::available` (derived, deps: `["nums::events", "cursor"]`)
  - `explain(t.events, sub.available)`: one hop. Tighter.
- **Perf:**
  - Per topic publish: subscription's `source` fires (identity pass), then `available` fires (array slice). With `source` removed: only `available` fires.
  - `slice(c)` is O(N) where N = retained-limit. For large retention + many subscriptions, this adds up per-publish. Optimizable via `reactiveLog.fromCursor(c)` shared-view, but scope creep.
  - `ack`: synchronous cache read + `cursor.emit(next)` — one wave. `pull`: synchronous `.cache` read + optional `ack`.
- **Memory:** subscription retains `cursor.cache` (one number) + `available.cache` (snapshot of sliced array, same data as topic's retained window viewed from cursor). Potentially O(N) per subscription — for M subscriptions on a large-retention topic, memory is O(M×N). Shared-view (H alternative below) would make it O(N) shared.
- **Reactive/composable:** ✓ downstream consumers `derive([sub.available], …)` cleanly.
- **Simpler shape:**
  ```ts
  // Today (boundary API with TOCTOU):
  const items = sub.pull(10, { ack: true });   // race-prone under concurrency

  // Proposed (atomic + visible cursor move):
  const { items, cursor: newCursor } = sub.pullAndAck(10);

  // Or fully reactive (autoack on a signal):
  const sub2 = subscription("auto", t, { advanceOn: doneSignal });
  // Every `doneSignal` DATA advances cursor by len(available) atomically.
  ```

#### Q8 — Alternatives

- **A. Keep as-is.**
  - Pros: shipped; harness uses it.
  - Cons: passthrough `source` cruft; `pull({ ack })` TOCTOU; "subscribe from now" requires manual `.cache` read.
- **B. Drop `source` passthrough; `available` depends directly on `topic.events` + `cursor`.**
  - Pros: one fewer node per subscription; tighter explain chain; O(N) memory saved across all subscribers per topic (not per-sub).
  - Cons: describe shows a cross-graph edge on the top-level subscription Graph (aesthetic); no behavior change for consumers.
- **C. Add `pullAndAck(limit)` returning `{ items, cursor }`; deprecate `pull({ ack })` sugar.**
  - Pros: atomic semantics; callers know exactly how far cursor moved; PY-thread-safe under a per-subscription lock.
  - Cons: one more method name; existing `pull({ ack })` callers migrate (pre-1.0 OK).
- **D. Reactive cursor: `subscription(topic, { advanceOn: signalNode })`.**
  - Pros: removes imperative boundary API for autopilot consumers; cursor movement is a reactive edge, visible in describe.
  - Cons: HITL manual-ack users still need imperative `.ack()`; two modes coexist.
- **E. `from: "now" | "retained" | number` option.**
  - Pros: common ergonomic case, short sugar.
  - Cons: another option to document; `"now"` reads `topic.events.cache.length` at factory time (sanctioned boundary).
- **F. Unify with `reactiveLog.fromCursor(n)` — subscription becomes a thin cursor-as-state wrapper over a shared log view.**
  - Pros: O(N) memory shared across subscriptions; composability with other `reactiveLog` consumers.
  - Cons: requires `extra/reactive-log` API expansion; scope creep.
- **G. B + C + D + E combined.**
  - Pros: covers every identified gap.
  - Cons: bigger breaking-change footprint.
- **H. Add `subscription.dispose()` for explicit termination; COMPLETE `cursor` on dispose.**
  - Pros: clean lifecycle; callers can stop a subscription without tearing down topic.
  - Cons: minor addition; additive, not breaking.

#### Q9 — Recommendation

- **B + C + E + H.** Drop **D** (reactive advanceOn) and **F** (fromCursor refactor) for this session:
  - **B:** remove `source` passthrough. `available` depends directly on `topic.events` + `cursor`. One fewer node per subscription; cleaner explain chain.
  - **C:** replace `pull({ ack })` with `pullAndAck(limit): { items, cursor }`. `pull(limit)` stays (no-ack read). PY per-subscription lock around the snapshot+advance pair.
  - **E:** add `{ from: "now" | "retained" | number }` option to `subscription(topic, { from })`. Default `"retained"` preserves today's behavior. `"now"` reads `topic.events.cache.length` at factory time (§28 sanctioned).
  - **H:** add `subscription.dispose(): void` — emits COMPLETE on `cursor`, clears disposers, no further `ack/pull` allowed.
- **Defer D** (reactive advanceOn) — ship when an autopilot user asks. The current `ack` imperative is not a design wart; only the `pull-with-ack` race is. Reactive cursor is a feature, not a fix.
- **Defer F** (shared `reactiveLog.fromCursor` view) — `extra/reactive-log` refactor; schedule separately.
- **Coverage:** Q2 ✓ (passthrough removed; TOCTOU fixed; subscribe-from-now sugar; explicit termination), Q3 ✓ (§24 clean; boundary reads sanctioned), Q5 ✓ (abstraction preserved, cruft removed), Q6 ✓ (PY free-thread safe under per-sub lock; subscription lifecycle explicit).
- **Trade-off to weigh:**
  - **B removes a locally-scoped node named "source".** Users grepping describe output for `"source"` in a subscription subgraph won't find it. Mitigation: subscription describe shows `available` with a cross-graph dep `nums::events` — readable, just different.
  - **C splits the API.** `pull` for read-only; `pullAndAck` for atomic advance. Clearer semantics, one more method.
  - **E's `"now"` semantics:** "from now at factory time" vs "from whatever length is at first subscribe." We pick factory time (simpler, sanctioned boundary read). Document. If users want "from first subscribe," they compute the cursor themselves post-construction.
- **Caveat:** the `PipelineGraph` decision from Wave A doesn't directly apply here — messaging primitives return typed Graphs (`TopicGraph`, `SubscriptionGraph`), not nodes. The factory pattern is correct; no method-form migration. Wave A's `pipeline.gate(...)` pattern was about orchestration-over-graph; messaging's `topic(name)` + `subscription(name, topic)` is about messaging-as-graph. Keep factories.

---

## Batch B.1 cross-cutting observations

1. **`latest === null` ambiguity is a cross-primitive concern.** Whatever we decide for `TopicGraph.latest` (rename to `lastValue: Node<T | undefined>`), `cqrs.event()`-derived surfaces should follow the same convention. Pre-flag for C.1.
2. **Unbounded-memory defaults recur.** `retainedLimit: Infinity` in TopicGraph mirrors `maxPending: Infinity` in gate (Unit 8). Setting bounded defaults across the module family is a consistent policy.
3. **External-consumer boundary read (`retained`, `ack`, `pull`) sanctioning is solid** — already noted in optimizations.md. As long as new APIs follow the same pattern (read `.cache` at boundary, never inside fn bodies), no drift.
4. **PY free-threaded hazards show up in `pull({ ack })` and `gate.queue` mutation.** Per-primitive locks or atomic-snapshot+advance are the two fix patterns. Keep consistent.
5. **No-op passthrough nodes (`SubscriptionGraph.source`) are cruft.** A future lint / `graphProfile` check could flag `derived([x], ([v]) => v)` patterns — they're always either premature naming or describe-decoration.

---

## Open questions for user (before locking B.1)

1. **Rename `TopicGraph.latest` → `lastValue` (SENTINEL-aligned, `T | undefined`)?** Breaking but aligns with spec §5.12. My rec: yes. Alternative: keep `latest` as name, change type to `T | undefined` — less migration churn but loses the rename-as-signal affordance.
2. **Default `retainedLimit`?** My rec: `1024`. Alternatives: `256` (conservative) / `0` (retain only latest) / keep `Infinity` (status quo).
3. **`publish(undefined)` policy?** My rec: throw. Alternative: coerce to `null` (permissive) / status quo (undefined behavior).
4. **Drop `SubscriptionGraph.source` passthrough?** My rec: yes. Alternative: keep for describe-layer familiarity.
5. **Subscribe-from-now sugar: `{ from: "now" | "retained" | number }` with default `"retained"`?** My rec: yes. Alternative: no sugar, document the `.cache.length` idiom.
6. **Replace `pull({ ack })` with `pullAndAck(limit): { items, cursor }`?** My rec: yes; keep read-only `pull`. Alternative: add lock to existing `pull({ ack })` without renaming.

Once answered, B.1 locks and B.2 (`TopicBridgeGraph`, `MessagingHubGraph`) starts. Pre-read drift suspicion: bridge's imperative `target.publish(mapped)` + `bridgedCount.emit(...)` is the main §24 / pagerduty-demo-class smell; hub's `_topics` Map + lazy-create is a `reactiveMap` candidate but fine as-is.

---

## Decisions locked (B.1) — 2026-04-24

**Framing:** Full-scope overhaul — every alternative (F, G, H) accepted, no defers. `extra/reactive-log` gains two new helper primitives alongside the messaging rewrite.

**Unit 11 `TopicGraph` — F + G + H:**
1. **G — Triple-footgun fix (SENTINEL-align / bounded / strict):**
   - Rename `latest: Node<T | null>` → `lastValue: Node<T | undefined>` (SENTINEL-aligned per spec §5.12).
   - Default `retainedLimit = 1024`. `Infinity` stays as explicit opt-in.
   - `publish(undefined)` throws synchronously.
   - Keep `hasLatest: Node<boolean>` for disambiguation when `T` includes `null` or `undefined`.
2. **F — Lazy keepalive on `lastValue` / `hasLatest`:** activate only on first external subscribe. Topics whose consumers use only `events` pay zero per-publish cost for the two derivations. Bookkeeping: reference-count external subscribers via `Graph.addDisposer` pair (activate on first, deactivate on last).
3. **H — Extract into `reactiveLog.withLatest()` helper in `extra/reactive-log`:**
   ```ts
   const log = reactiveLog<T>(init, opts);
   const { entries, lastValue, hasLatest } = log.withLatest(); // lazy-activated
   ```
   TopicGraph's implementation becomes a thin wrapper — `new TopicGraph(name, opts)` uses `_log.withLatest()` internally. `cqrs.event()` migrates to the same helper for consistency in C.1.
4. **Cross-cutting convention:** `cqrs.event()`-derived surfaces inherit the SENTINEL/bounded/strict conventions — pre-flagged for Wave C.

**Unit 12 `SubscriptionGraph` — F + G + H:**
1. **G — Four-change combined (B + C + D + E):**
   - **B:** drop `source` passthrough. `available` depends directly on `topic.events + cursor`. One fewer node per subscription; tighter explain.
   - **C:** `pull(limit, { ack })` → `pullAndAck(limit): { items, cursor }` (atomic tuple return). Keep read-only `pull(limit)` for no-ack reads. PY per-sub lock around the snapshot+advance pair.
   - **D:** reactive cursor via `{ advanceOn: signalNode }` option. Every DATA on the signal node advances the cursor by `available.length` atomically. Imperative `ack()` coexists as the HITL path. Describe shows `signalNode → cursor` edge — autopilot ack becomes visible in `explain()`.
   - **E:** `{ from: "now" | "retained" | number }` option, default `"retained"` (preserves today). `"now"` resolves to `topic.events.cache.length` at factory time (§28 sanctioned boundary).
2. **F — Shared `reactiveLog.fromCursor(cursorNode): Node<readonly T[]>` in `extra/reactive-log`:** replaces per-sub `slice(cursor)` with a shared windowed view. Memory goes from O(M×N) (M subs × N retained) to O(N) shared. Subscription becomes:
   ```ts
   this.available = topicGraph._log.fromCursor(this.cursor);  // reactive window view
   ```
   Cursor as a `state<number>` feeds the view; the view is memoized per-cursor-Node identity per the 2026-04-15 reactiveLog leak fix pattern.
3. **H — `subscription.dispose(): void`:** emits COMPLETE on `cursor`, runs disposers, subsequent `ack/pull/pullAndAck` throw with "subscription disposed" error.
4. **Topology:** after these changes, the subscription subgraph's describe contains `cursor` (state) + `available` (derived, deps=[`topic::events`, `cursor`]) + optional `advanceOn` input edge. Clean, explainable.

**Open-question answers (all my recs):**
- Q1 rename `latest` → `lastValue` → yes.
- Q2 default `retainedLimit = 1024` → yes.
- Q3 `publish(undefined)` throws → yes.
- Q4 drop `source` passthrough → yes.
- Q5 `{ from }` sugar → yes.
- Q6 `pullAndAck` replaces `pull({ ack })` → yes.

**Implementation-session scope (for the eventual "implement B.1" session):**
1. `extra/reactive-log` additions (prerequisite):
   - `reactiveLog.withLatest(): { entries, lastValue, hasLatest }` — lazy-activated derivations, memoized per log instance.
   - `reactiveLog.fromCursor(cursorNode: Node<number>): Node<readonly T[]>` — shared windowed view keyed by cursor-Node identity; memoization aligned with the 2026-04-15 tail/slice view fix.
2. `patterns/messaging/index.ts` rewrite:
   - `TopicGraph`: use `_log.withLatest()`; rename `latest` → `lastValue`; `retainedLimit` default `1024`; throw on `publish(undefined)`.
   - `SubscriptionGraph`: drop `source`; `available` uses `_log.fromCursor`; add `pullAndAck`; keep `pull(limit)`; add `advanceOn` option; add `from` option; add `dispose()`.
3. Update in-tree callers: `.latest.cache` → `.lastValue.cache` across demos/tests/harness/docs.
4. `exports.test.ts` surface check.
5. Docs: README + JSDoc updates; migration note for rename + behavior changes.
6. **PY parity (separate session):** mirror `with_latest` / `from_cursor` on `graphrefly.extra.reactive_log`; mirror all six TopicGraph/SubscriptionGraph changes; per-sub `Lock` for `pull_and_ack` atomicity.

**Estimated LOC impact:**
- Today: `patterns/messaging/index.ts` ≈ 457 LOC.
- After: `patterns/messaging/index.ts` ≈ 300 LOC (class internals shrink via reactive-log helpers); `extra/reactive-log` gains ~80 LOC for the two helpers. Net: roughly flat, with better memory profile (shared views), cleaner topology, and stronger type contracts.

**Cross-primitive convention locked:** SENTINEL-aligned `lastValue` + bounded default + strict `publish(undefined)` applies to `cqrs.event()` as well — note carried into Wave C.

---

## Wave B — Batches B.2, B.3 — pending

## Wave C — pending

### Batch B.2 — Messaging composition (`TopicBridgeGraph`, `MessagingHubGraph`)

---

### Unit 13 — `TopicBridgeGraph<TIn, TOut>` (+ `topicBridge()` factory)

See chat transcript for full Q1–Q9 (2026-04-24 exchange). Summary of findings:

- 🔴 §24 — pump's cross-graph imperative writes (`target.publish`, `bridgedCount.emit`) invisible in describe. `explain(sub.available, target.lastValue)` has no path.
- 🔴 P3 — `.cache` read inside fn body for accumulator.
- 🔴 §9a — N publishes per pump cycle, no `batch()` wrap.
- Double-pump-per-cycle (cursor advance re-invalidates pump's dep).
- Unbounded `maxPerPump` default.

Recommendation: **G (B + E combined)** — minimal fix + new `reactive-log.attach(upstream)` primitive in `extra/reactive-log`. Bridge rewrites to expose `output: Node<readonly TOut[]>` (reactive map), target absorbs via `target._log.attach(this.output)`, `bridgedCount` via `reactiveCounter(output)` (or scan), `sub.pullAndAck(items.length)` per B.1 Unit 12 lock, `maxPerPump` default 256.

---

### Unit 14 — `MessagingHubGraph` (+ `messagingHub()` factory)

See chat transcript for full Q1–Q9 (2026-04-24 exchange). Summary of findings:

- 🟢 Mostly clean. `_topics` / `_version` imperative registry is fine; all optimizations.md items (P1/P2/P3/P8) already resolved.
- 🟡 `_version: number` misses reactive composability — consumers who want to react to topic-set changes must poll.
- 🟡 PY free-threaded race on `topic()` lazy-create (check-then-set window).
- 🟡 `subscribe` returns unmounted subscription (UX surprise; documented).

Recommendation: **I (B + C + H combined)** — promote `_version` → `version: Node<number>` state; add `topicNames: Node<readonly string[]>` derived from `version`; PY `Lock` around `topic()` body. Defer D (split into TopicRegistry + facade), E (rename subscribe), F (subscribeOwned variant), G (throw on opts mismatch).

---

## Batch B.2 cross-cutting observations

1. §24 "invisible cross-graph write" in `TopicBridgeGraph` is the same class as `pagerduty-demo` — B.2 E primitive (`reactive-log.attach`) resolves it.
2. `.cache` inside fn body in bridge is the last P3 violation in messaging.
3. Unbounded defaults recur (`maxPerPump`); enforce bounded-default policy across module.
4. Reactive `version` Node adds composable value at low cost.
5. PY free-threaded hazard pattern: per-primitive `Lock` around check-then-set / snapshot-then-advance.
6. `extra/reactive-log` accreting helpers fast: `withLatest` + `fromCursor` + `attach`. Coherence audit flagged for post-Wave-B.

---

## Decisions locked (B.2) — 2026-04-24

**Unit 13 `TopicBridgeGraph` — G (B minimal + E reactive-log attach):**
1. New `extra/reactive-log` primitive: `attach(upstream: Node<T>): () => void`.
   - On each upstream DATA (per item or per batch — see lifecycle notes), append to the log.
   - Upstream COMPLETE → detach cleanly; upstream ERROR → forward to log terminal per spec §2.2.
   - Returns detach fn for explicit lifecycle control.
2. `TopicBridgeGraph` rewrite:
   - Expose `output: Node<readonly TOut[]>` (reactive mapped batch).
   - `this.output = derived([sub.available], ([avail]) => avail.slice(0, maxPerPump).map(mapValue).filter(x => x !== undefined), { name: "output", initial: [] })`.
   - At construction: `targetTopic._log.attach(this.output)` — imperative `publish` gone from bridge fn body.
   - `this.bridgedCount = reactiveCounter(this.output)` (or `derived + ctx.store.count` scan) — no more `.cache` read.
   - Cursor ack via `sub.pullAndAck(items.length)` per B.1 Unit 12 lock.
   - `maxPerPump` default **256** (was `2^31 - 1`).
   - Describe annotation: `output` carries `domainMeta("messaging", "bridge_output", { targetRef: targetTopic.name })`.
   - Teardown: detach `output → target._log` before propagating mount teardown.
3. PY parity: mirror `reactive_log.attach` + bridge rewrite; free-threaded attach reuses reactive-log's existing lock story.
4. Fixes: §24 invisible edges → visible; §9a batch-coalesce via reactive-log's internal dispatch; P3 `.cache` read eliminated; TOCTOU via `pullAndAck`; double-pump-per-cycle resolved; unbounded default bounded.

**Unit 14 `MessagingHubGraph` — B + D + H (explicit NOT C, NOT E, NOT F, NOT G):**
1. **B:** promote `_version: number` → `version: Node<number>` (state, mounted on hub). `topic(name)` lazy-create writes via `this.version.emit((cache as number) + 1)`; `removeTopic` increments in its `finally` block.
2. **D:** split into two classes:
   - **`TopicRegistry`** — pure imperative Map wrapper: `get / set / has / delete / size / keys()` + the `version: Node<number>` state node. Domain-neutral; no reactive methods beyond `version`.
   - **`MessagingHubGraph extends Graph`** — holds a `TopicRegistry` instance, exposes `topic / publish / publishMany / subscribe / removeTopic / topicNames()` (imperative method returning `IterableIterator<string>`, not a Node). Wraps registry access.
   - Rationale: composition over wrapper alias. `TopicRegistry` is reusable if `cqrs.eventLogs` later wants to share; not part of this lock.
3. **H:** PY port wraps `topic(name)` body (check-then-set-then-mount-then-increment) in a per-hub `threading.Lock`. Prevents the free-threaded race where two threads both miss the registry, both construct, and the second store orphans the first's mount.
4. **Explicitly NOT:**
   - **C** (`topicNames: Node<readonly string[]>` derived) — O(N) snapshot per topic change; keeps hub reactive surface narrow. Consumers who need it write `derived([hub.version], () => [...registry.keys()])` themselves (boundary read, §28 sanctioned).
   - **E** (rename `subscribe`) — rename churn without behavior change. Unmounted-lifecycle documented in JSDoc.
   - **F** (`subscribeOwned` variant) — two method names for ~same operation. Caller mounts themselves: `hub.mount("sub-x", hub.subscribe("sub-x", "topic-a"))`.
   - **G** (`topic(name, opts)` throws on opts mismatch) — noisy for no-op callers; silent ignore with documented contract stays.

**Open-question answers:**
- Q1 (bridge rewrite scope): **G** per user.
- Q2 (maxPerPump default): **256** per my rec.
- Q3 (hub scope): **B + D + H** per user — no `topicNames` Node.
- Q4 (`subscribe` UX): **leave as-is** per user.
- Q5 (`topic(name, opts)` silent-ignore): **leave as-is** per user.

**Explicit follow-up scheduled (post-Wave-B):**
- **Audit `extra/reactive-log` as a coherent layer** once B.1 + B.2 helpers land (`withLatest`, `fromCursor`, `attach`). Per user directive. Schedule after B.3 + Wave C locks.

**Implementation-session scope (builds on B.1):**
1. `extra/reactive-log.attach(upstream: Node<T>)` helper (prerequisite for Unit 13 rewrite).
2. Bridge rewrite per above.
3. Hub split into `TopicRegistry` + `MessagingHubGraph`.
4. Update in-tree callers (harness/bridge.ts / demos / tests) — grep for `.bridgedCount`, `_topics`, `_version` accessors.
5. `exports.test.ts` surface update — `TopicRegistry` export added.
6. Docs: README + JSDoc; migration note for `version` becoming a Node.
7. **PY parity (separate session):** mirror `reactive_log.attach`, bridge rewrite, `TopicRegistry` class split, `threading.Lock` in `topic()`.

**Estimated LOC impact:**
- Today: `patterns/messaging/index.ts` ≈ 457 LOC.
- After B.1 + B.2 combined: ≈ 320 LOC (bridge shrinks; hub splits but net similar); `extra/reactive-log` +~100 LOC total for three helpers (`withLatest`, `fromCursor`, `attach`).

**Cross-primitive conventions carried forward:**
- Bounded-by-default policy (Unit 8 `maxPending: 1000`, Unit 11 `retainedLimit: 1024`, Unit 13 `maxPerPump: 256`).
- PY per-primitive `Lock` for check-then-set / snapshot-then-advance critical sections (Units 8, 12, 13, 14).
- Reactive-log helpers are messaging's composition backbone — coherence audit scheduled.



### Batch B.3 — Job-queue (`JobQueueGraph`, `JobFlowGraph`)

---

### Unit 15 — `JobQueueGraph<T>` (+ `jobQueue()` factory)

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🟡 §9a wave explosion — `enqueue/claim/nack/ack` each fire 2+ waves (no `batch()` wrap).
- 🟡 §24 controller methods invisible in describe; compliance-artifact gap (same as gate pre-A.2).
- 🟡 PY free-threaded race on `_seq` counter and check-then-pop-then-mutate in `claim()`.
- 🟡 Orphaned pending ids silent-skip invisible in reactive surface.
- 🟡 No reactive event stream (gate's `decisions` equivalent missing).

Recommendation: **H (B + C + D + E)** —
- **B:** add `events: Node<readonly JobEvent<T>[]>` mounted, reactiveLog-backed, bounded `retainedLimit = 1024`.
- **C:** every public method body wrapped in `batch()`.
- **D:** PY per-queue `threading.Lock` around mutation methods.
- **E:** `claim()` orphan-skip emits `JobEvent { action: "orphan", id, reason, t_ns }`; no separate `orphanCount` mount.

Defer F (stale-inflight TTL) — composable externally. Defer G (attempts rename) — cosmetic.

---

### Unit 16 — `JobFlowGraph<T>` (+ `jobFlow()` factory)

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🔴 §24 — pump's cross-graph imperative writes (`next.enqueue`, `current.ack`, `_completed.append`) invisible in describe. Same class as TopicBridge.
- 🔴 §9a — 4+ waves per pump iteration, no `batch()` wrap.
- 🟡 `_completed` unbounded (OOM footgun).
- 🟡 `maxPerPump: 2^31 - 1` unbounded.
- 🟡 No stage-work hook — JobFlow is effectively "staged ferry" not "work pipeline". Abstraction gap.
- 🟡 Metadata `job_flow_from: string` overwrites — stage path history lost.
- 🟡 Double-pump-per-cycle artifact.

Recommendation: **H (C + E)** —
- **C:** pump rewrite to `derived` that `batch()`s `claim + ack + emit-moved-jobs`; output node feeds `next.consumeFrom(pump.output)` (new JobQueue method) or `this._completed.attach(pump.output)` (B.2's reactive-log.attach). Bounded `maxPerPump = 256`; bounded `_completed` `retainedLimit = 1024`.
- **E:** `job_flow_path: readonly string[]` accumulator replaces overwriting `job_flow_from`.

Defer D (per-stage `work` hook) — flag as follow-up. Defer F (rename to `stageTracker`) — leave name for future work-hook expansion. Reject G (delete) — primitive has compliance/audit value even ferry-only.

---

## Batch B.3 cross-cutting observations

1. Same §24 smell class as TopicBridge — JobFlow pump's invisible cross-graph writes. Fixed by same `reactive-log.attach` (B.2 E). `JobQueueGraph.consumeFrom(node)` is the parallel primitive for job queues.
2. Wave explosion is systemic across imperative-controller primitives (gate A.2, job queue B.3). Batch-wrap policy uniform.
3. Audit-log pattern `events: Node<readonly Event[]>` applies per imperative primitive (gate `decisions`, queue `events`).
4. Bounded-default policy uniform: `maxPending: 1000`, `retainedLimit: 1024`, `maxPerPump: 256`.
5. JobFlow's missing stage-work hook is an abstraction gap flagged for follow-up; doesn't block the B.3 lock.
6. PY locks accumulate consistently — Wave B leaves a clear pattern for the parity session.

---

## Decisions locked (B.3) — 2026-04-24

**Cross-primitive pattern revision (user directive):**
Prefer **multi-DATA-in-one-wave** (`node.down([[DATA, v1], [DATA, v2], [DATA, v3]])`) over `batch()` **when emissions collapse onto a single node** — it's lighter (no tier-3 deferral coordination). Per [core/node.ts:313–320](../../src/core/node.ts:313): one `.down` call = one wave; the pipeline tier-sorts the input, auto-prefixes DIRTY, runs equals substitution.

- **Within a single node:** use multi-DATA `.down` (or a new `appendAll` helper on reactive-list/log).
- **Across multiple nodes in one logical operation:** use `batch()` as before (no other tool coalesces cross-node writes).

This distinction applies to every batch-decision across Wave A/B — revisit where applicable in the implementation session.

**Unit 15 `JobQueueGraph` — G + H (B + C-nuanced + D + E + storage + withLatest):**

1. **B — add `events: Node<readonly JobEvent<T>[]>` audit log.** Mounted, reactiveLog-backed, bounded `retainedLimit = 1024` (per B.1 Unit 11 convention).
   - Use `reactiveLog.withLatest()` helper (from B.1 Unit 11 lock) to expose `lastEvent: Node<JobEvent | undefined>` + `hasLastEvent: Node<boolean>` alongside `events`.
   - `JobEvent<T>` discriminated union per Unit 15 Q6 sketch:
     ```ts
     type JobEvent<T> =
       | { action: "enqueue"; id: string; t_ns: number }
       | { action: "claim";   id: string; attempts: number; t_ns: number }
       | { action: "ack";     id: string; t_ns: number }
       | { action: "nack";    id: string; requeued: boolean; t_ns: number }
       | { action: "orphan";  id: string; reason: "state-drift" | "double-claim"; t_ns: number };
     ```
2. **C-nuanced — emission pattern:**
   - `enqueue` mutates 3 nodes (`_pending.append`, `_jobs.set`, `_events.append`) — wrap in `batch()` for cross-node coalesce.
   - `claim(N)` pops N items + sets N inflight + emits N events — use multi-DATA-in-one-wave where feasible:
     - Extend `reactiveLog` with `appendAll(values: readonly T[])` helper that uses `node.down([[DATA, snap1], [DATA, snap2], ...])` semantics. Single wave for N events. Consumers see the final snapshot (intermediate snaps are part of the same wave).
     - Extend `reactiveList` with `popMany(n)` similarly.
     - Outer `batch()` still wraps the whole claim method body to coalesce across `_pending` + `_jobs` + `_events`.
   - `ack` / `nack` — single-item mutations on 1–2 nodes; `batch()` wrap.
3. **D — PY per-queue `threading.Lock`** around `enqueue / claim / ack / nack` bodies. Prevents `_seq` counter race and `claim()` check-then-pop-then-mutate race.
4. **E-minimal — orphan visibility via `events` filter only.** No separate `orphanCount` mount (per user directive: "just events filter is enough"). Consumers `derived([queue.events], es => es.filter(e => e.action === "orphan").length)` if they need a count.
5. **`JobQueueGraph.attachStorage(eventsSink)` method** (per user directive) — attach persistent storage tiers specifically for the `events` reactive-log. Hot-in-memory + cold-to-disk compliance persistence.
   - API shape (tentative): `queue.attachStorage(tiers: readonly StorageTier[])` where tiers serialize only the `events` log (not the full graph snapshot). Analogous to `Graph.attachStorage` but scoped.
   - Open impl question: does this become a general `reactiveLog.attachStorage(tiers)` helper (third reactive-log helper after `withLatest`, `fromCursor`, `attach`)? Flagged for the **post-Wave-B reactive-log coherence audit** — tentatively yes (consistent with the other three) but deferred until that audit runs.
6. **Defer F (stale-inflight TTL)** — compose externally with `fromTimer`.
7. **Defer G-rename (`attempts` → `claims`+`failures`)** — cosmetic.

**Unit 16 `JobFlowGraph` — I-modified (C + D-work-hook + E), with `fromAny` not `fromPromise`:**

1. **C — pump rewrite to reactive:**
   - Per stage: `pump_{stage}` is a `derived` whose body does the pump cycle atomically (`batch()` for cross-node; multi-DATA where applicable) and whose output is a reactive stream of moved jobs.
   - Downstream consumption:
     - For `next` queue: `next.consumeFrom(pump.output)` — new queue-level method (per Q3 rec; invariant-preserving — `consumeFrom` uses `enqueue` internally so dedupe-id + `_jobs.set` contracts are enforced).
     - For terminal stage: `this._completed.attach(pump.output)` via B.2 Unit 13's `reactive-log.attach`.
   - Bounded `maxPerPump = 256` (was `2^31 - 1`).
   - Bounded `_completed` `retainedLimit = 1024` (was unbounded).
   - Same emission-pattern notes as Unit 15 — prefer multi-DATA where applicable (e.g., emitting the moved-jobs array in one wave).
2. **D — per-stage `work` hook (the "I" option user accepted), with `fromAny` instead of `fromPromise`:**
   - Stage definition becomes `{ name: string; work?: (job: JobEnvelope<T>) => NodeInput<T> }` where `NodeInput<T>` is "raw value | Promise<T> | Node<T>" — the universal async-or-sync boundary shape that `fromAny` handles.
   - Pump flow per stage:
     1. Claim from `current`.
     2. If `work` defined: `fromAny(work(job))` produces a per-job Node that resolves to the new payload. Pump feeds resolved payloads into `next.consumeFrom` or `_completed.attach` as before.
     3. If `work` undefined: ferry unchanged (status quo).
   - Error handling: if `work` throws (sync) or rejects (async), the stage's pump calls `current.nack(id, { requeue: false })` and emits a `JobEvent { action: "nack", requeued: false, ... }` — policy knob deferred (retry-with-backoff lives outside the primitive).
   - **Why `fromAny` not `fromPromise`:** `fromAny` accepts Promise, Node, OR raw sync value (per COMPOSITION-GUIDE patterns) — letting `work` return synchronously for trivial transforms, asynchronously for LLM/API calls, or as a Node for composed pipelines.
   - JobFlow now is a **true work pipeline**, not a "staged ferry" — answers the abstraction-gap concern in Unit 16 Q2.
3. **E — `job_flow_path: readonly string[]` accumulator.** Replaces overwriting `job_flow_from: string`. Each pump iteration appends `stage` to the path; metadata preserves full stage history. Breaking change for pre-1.0 callers reading `metadata.job_flow_from` (grep first; likely zero users).
4. **Reject F (rename to `stageTracker`)** — with work hooks in, `jobFlow` is the right name.
5. **Reject G (delete)** — the primitive earns its keep with work hooks.

**Open-question answers:**
- Q1 (Unit 15 scope): **G + H with nuanced C** (multi-DATA + batch hybrid).
- Q2 (Unit 16 scope): **I-modified** (C + D-work-hook + E, `fromAny` over `fromPromise`).
- Q3 (`consumeFrom` layering): **queue-level method** per user — preserves queue invariants (dedupe-id, `_jobs.set`).
- Q4 (rename `jobFlow`): **leave name** — work hooks justify it.

**Implementation-session scope (builds on B.1 + B.2):**
1. **`extra/reactive-log` additions:**
   - `appendAll(values: readonly T[])` — emit N values in one wave via multi-DATA.
   - Consider `attachStorage(tiers)` as third helper pending reactive-log coherence audit.
2. **`extra/reactive-list` addition:** `popMany(n: number): readonly T[]` — pop N items in one wave.
3. **`patterns/job-queue/index.ts`:**
   - `JobQueueGraph`:
     - Add `events` + `lastEvent` + `hasLastEvent` via `reactiveLog.withLatest()`.
     - Rewrite `enqueue / claim / ack / nack` to use `batch()` (cross-node) + `appendAll/popMany` (same-node multi-emission) pattern.
     - `JobEvent` discriminated union type exported.
     - `attachStorage(tiers)` method for events persistence.
     - PY per-queue `Lock`.
   - `JobQueueGraph.consumeFrom(node: Node<readonly JobEnvelope<T>[]>)` — new method; subscribes to node DATA and calls `enqueue` per item.
   - `JobFlowGraph`:
     - Pump rewrite per above; `fromAny(work(job))` for stages with work hook.
     - `StageDef = { name: string; work?: (job) => NodeInput<T> }`.
     - `job_flow_path` metadata accumulator.
     - Bounded `maxPerPump = 256`, `_completed` `retainedLimit = 1024`.
4. **PY parity:** mirror all changes in `graphrefly.patterns.job_queue`; PY `Lock`; `from_any` helper equivalent for work hook.
5. **Docs:** README + JSDoc; migration note for `job_flow_from` → `job_flow_path`; work-hook walkthrough; attachStorage example.

**Cross-cutting convention carried forward (applies to all Wave A/B primitives):**
- **Emission pattern triage:** `batch()` for cross-node coalesce; multi-DATA `.down` for same-node multi-emission. Document the distinction.
- Bounded-by-default policy (6 primitives now: gate `maxPending: 1000`, TopicGraph `retainedLimit: 1024`, bridge `maxPerPump: 256`, JobQueue events `retainedLimit: 1024`, JobFlow `maxPerPump: 256` + `completed retainedLimit: 1024`).
- Audit-log pattern (`events: Node<readonly Event[]>`) applied to 3 primitives now (gate `decisions`, queue `events`, plus Unit 8's Decision envelope).
- PY per-primitive `Lock` pattern uniform (Units 8, 12, 13, 14, 15).
- `reactive-log` helper set grows: `withLatest` (B.1), `fromCursor` (B.1), `attach` (B.2), `appendAll` (B.3), tentatively `attachStorage` (B.3/audit). **Post-Wave-B coherence audit will reconcile.**

**Estimated LOC impact (Wave B total):**
- `patterns/messaging/index.ts`: 457 → ~320 LOC (B.1 + B.2).
- `patterns/job-queue/index.ts`: 249 → ~280 LOC (adds `events`/`attachStorage`/`consumeFrom`/work-hook).
- `extra/reactive-log`: +~130 LOC across 4–5 helpers.
- `extra/reactive-list`: +~15 LOC for `popMany`.
- Net Wave B: roughly +80 LOC, but net capabilities (audit logs, storage, work hooks, reactive edges everywhere) are substantially larger. Maintenance burden rebalanced toward composable helpers.



## Wave C — CQRS

### Batch C.1 — Event primitives (`CqrsEvent`, `event(name)`)

---

### Unit 17 — `CqrsEvent<T>` envelope + `EventStoreCursor` / `LoadEventsResult`

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🟡 `payload: T` not `Readonly<T>` / not frozen — inconsistent with `JobEnvelope.metadata` freeze convention.
- 🟡 PY race on `_seq` counter (same class as JobQueue B.3 Unit 15 D).
- 🟡 Missing standard ES fields: `aggregateId`, `aggregateVersion`, `correlationId`, `causationId`, `metadata`.
- 🟡 `v0?: { id, version }` is protocol-internal but sits at top level — mixes framework vs user ownership.
- 🟡 `EventStoreCursor` type shape ambiguous — adapter-specific but untyped.

Recommendation: **G (B + C + D)** —
- Extend envelope with optional ES-standard fields (`aggregateId`, `aggregateVersion`, `correlationId`, `causationId`, `metadata: Readonly<Record<string, unknown>>`).
- `Object.freeze(payload)` at `_appendEvent` construction; `freeze: false` opt-out for hot paths.
- Split `v0` under `_internal?: { v0?: ... }` — framework-vs-user ownership clear.
- `EventStoreCursor<Shape>` branded generic type; default shape `{ timestampNs, seq }` matches MemoryEventStore.
- Dispatch-level context for correlation/causation: `dispatch(name, payload, { correlationId?, causationId?, metadata? })` propagates to all emissions within the dispatch batch; per-emit override via `actions.emit(eventName, payload, { ... })`.

Defer E (per-aggregate stream split) — big restructure; unclear demand. Defer F (required aggregateId) — too strict.

---

### Unit 18 — `CqrsGraph.event(name)` + `_appendEvent` + EVENT_GUARD

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🟡 Identity-passthrough derived for guard purposes (same pattern as SubscriptionGraph.source dropped in B.1 Unit 12).
- 🟡 `describeKind: "state"` on the guarded derived — mislabels a derived.
- 🟡 Missing `lastEvent` / `hasLastEvent` — pre-flagged in B.1 Unit 11 lock (CQRS events should inherit SENTINEL/bounded/strict conventions).
- 🟡 Unbounded retention default (same footgun class as TopicGraph pre-B.1).
- 🟡 Guard is best-effort — underlying `reactiveLog` un-guarded; external callers reaching `_eventLogs.get(name).log.append` bypass.
- 🟡 Three "named append-only reactive log" primitives now (TopicGraph B.1, JobQueue.events B.3, CQRS.event C.1) — consolidation candidate for post-Wave-B audit.

Recommendation: **F now (B + E); G later (post-audit consolidation)** —
- **B:** `retainedLimit` default 1024 per B.1 Unit 11 convention; `lastEvent: Node<CqrsEvent | undefined>` + `hasLastEvent: Node<boolean>` via `reactiveLog.withLatest()` helper; fix `describeKind: "derived"` label on passthrough.
- **E:** `Object.freeze(payload)` at `_appendEvent` construction (Unit 17 G coverage).
- **Deferred to reactive-log coherence audit (post-Wave-B):**
  - Reactive-log `guard` option — eliminates the passthrough derived.
  - TopicGraph + CQRS event unification (canonical append-only-log primitive).
  - `reactiveLog.attachStorage(tiers)` helper consistency.

---

## Batch C.1 cross-cutting observations

1. CQRS events are the third "named append-only reactive log" primitive (TopicGraph B.1, JobQueue.events B.3, CQRS.event C.1). Consolidation candidate for post-Wave-B audit.
2. Envelope convention converging: freeze at construction. `JobEnvelope.metadata` (B.3), `CqrsEvent.payload` (C.1 G).
3. Passthrough-derived-for-guard is a recurring pattern (SubscriptionGraph.source dropped B.1; CQRS event guarded wrapper remains; candidate for audit removal).
4. Standard ES fields (correlation/causation/aggregate) missing today — cheapest to add pre-1.0.
5. PY seq/version races converge on per-primitive Lock pattern — `CqrsGraph` inherits from Wave B.

---

## Decisions locked (C.1) — 2026-04-24

**Unit 17 `CqrsEvent<T>` envelope — B + C + D + E (full restructure, canonical ES shape):**

1. **B — extend envelope with ES-standard optional fields:**
   ```ts
   export type CqrsEvent<T = unknown> = {
     readonly type: string;
     readonly payload: Readonly<T>;                        // frozen per C
     readonly timestampNs: number;
     readonly seq: number;                                 // monotonic per (type, aggregateId) stream under E — NOT global
     readonly aggregateId?: string;                        // optional for non-aggregate events
     readonly aggregateVersion?: number;                   // per-aggregate-stream version
     readonly correlationId?: string;
     readonly causationId?: string;
     readonly metadata?: Readonly<Record<string, unknown>>;
     readonly _internal?: { v0?: { id: string; version: number } };   // framework-owned, nested
   };
   ```
2. **C — `Object.freeze(payload)` at `_appendEvent` construction.** `freeze: false` opt-out via `CqrsOptions.freezeEventPayload?: boolean` (default `true`) for hot-path callers. Framework-owned `_internal` nested to separate protocol vs user fields.
3. **D — branded generic `EventStoreCursor<Shape>` type:**
   ```ts
   export type EventStoreCursor<Shape = { timestampNs: number; seq: number }> =
     Readonly<Shape> & { readonly __brand: "EventStoreCursor" };
   ```
   Default shape matches `MemoryEventStore`. Adapters override generic with their own cursor shapes.
4. **E — per-aggregate streams (canonical ES structural shape):**
   - `_eventLogs: Map<string, Map<string, EventEntry>>` — two-level (type → aggregateId → log). Default aggregate bucket `"__default__"` for non-aggregate events (system events, audit logs).
   - `event(type, aggregateId?)` API:
     - `event(type)` → fan-in view across all aggregates of that type (default behavior, merges + sorts by `timestampNs + seq`).
     - `event(type, aggregateId)` → specific per-aggregate stream (canonical ES shape).
   - `aggregateVersion: number` authoritative per-stream: each `(type, aggregateId)` stream has its own monotonic counter. Enables optimistic concurrency checks at append time (future: `expectedVersion` param on dispatch).
   - `seq: number` becomes per-stream monotonic (was global per-CqrsGraph). Stable ordering within an aggregate's stream.
   - Lazy create per-aggregate log — unbounded growth risk for high-cardinality `aggregateId`s (per-user events with millions of users). **Mitigation:** `maxAggregates: number` option on CqrsGraph (default `10_000`); LRU eviction when exceeded; eviction emits a `CqrsGraph.aggregateEvictions: Node<readonly { type, aggregateId, t_ns }[]>` stream for observability. Evicted streams' in-memory retained entries are gone — replay requires `EventStoreAdapter` (persistent).
   - `EventStoreAdapter` interface updated:
     ```ts
     persist(event: CqrsEvent): void;   // event has aggregateId; adapter routes to (type, aggregateId) partition
     loadEvents(opts: {
       type: string;
       aggregateId?: string;             // undefined → all aggregates of type (fan-in)
       cursor?: EventStoreCursor;
     }): LoadEventsResult | Promise<LoadEventsResult>;
     ```
   - `MemoryEventStore` updated to two-level storage: `Map<type, Map<aggregateId, CqrsEvent[]>>`.
5. **Dispatch-level correlation/causation context (per Q2 rec):**
   ```ts
   dispatch(
     commandName: string,
     payload: T,
     opts?: {
       correlationId?: string;
       causationId?: string;
       metadata?: Record<string, unknown>;
       aggregateId?: string;              // required if command writes to an aggregate stream
       expectedAggregateVersion?: number; // optimistic concurrency; throw if stream version doesn't match
     }
   ): void;
   ```
   - All events emitted from the handler inherit `opts.correlationId / causationId / metadata / aggregateId` unless `actions.emit` overrides.
   - `expectedAggregateVersion` enables optimistic concurrency — if the target stream's current version doesn't match, `dispatch` throws before the handler runs.

**Unit 18 `CqrsGraph.event(name)` — flagged for post-Wave-B reactive-log coherence audit:**

- **Implementation tentatively: G (full consolidation with TopicGraph).** Final decision pending the audit. Audit-outcome-dependent options:
  - If audit adopts reactive-log `guard` option → eliminate passthrough derived; `event(type, aggregateId?)` returns guarded `entries` directly.
  - If audit adopts TopicGraph + CQRS event unification → `event(type, aggregateId?)` returns a `GuardedTopicGraph<CqrsEvent>` with append-only semantics.
  - If audit defers both → ship Option F (B.1 alignment + freeze; keep passthrough + current structure).
- **Baseline guaranteed to ship regardless of audit outcome:**
  - `retainedLimit = 1024` default per B.1 Unit 11 convention (per-aggregate-stream basis under E).
  - `lastEvent: Node<CqrsEvent | undefined>` + `hasLastEvent: Node<boolean>` via `reactiveLog.withLatest()` helper.
  - `Object.freeze(payload)` at `_appendEvent` per C above.
  - Fix `describeKind: "state"` mislabel on the guarded derived (or eliminate via audit outcome).
  - PY `Lock` — inherited from C.2 dispatch-level locking (not C.1).
- **Implementation of Unit 18 deferred** until after Wave C review + coherence audit. Per user: "we can wait for wave C + audit before implementing."

**Open-question answers:**
- Q1 (Unit 17 scope): **B + C + D + E** per user — full per-aggregate ES restructure.
- Q2 (correlation/causation): **dispatch-level context** per my rec; per-emit override via `actions.emit(eventName, payload, { ... })`.
- Q3 (Unit 18 scope): **deferred pending reactive-log coherence audit;** tentative G; baseline B.1 alignment guaranteed.
- Q4 (retention default): **`retainedLimit = 1024`** per B.1 convention.
- Q5 (payload freeze): **freeze by default; `freeze: false` opt-out** via `CqrsOptions.freezeEventPayload`.

**Implementation-session scope (for the eventual "implement C.1" session, after coherence audit):**
1. `CqrsEvent<T>` envelope restructure (Unit 17 B+C+D+E).
2. `CqrsGraph`:
   - `_eventLogs` two-level Map.
   - `event(type, aggregateId?)` dual-form API.
   - Per-stream `seq` + `aggregateVersion` counters with PY lock.
   - `maxAggregates` option + LRU eviction + `aggregateEvictions` observability stream.
   - `dispatch` context (correlationId / causationId / metadata / aggregateId / expectedAggregateVersion).
   - Baseline B.1 alignment (retention default, `withLatest()` helper, `describeKind` fix, payload freeze).
3. `EventStoreAdapter` interface + `MemoryEventStore` update to two-level storage.
4. **Pending coherence audit:** resolve Unit 18 implementation shape (passthrough via reactive-log guard vs TopicGraph reuse vs F baseline).
5. PY parity: mirror two-level Map, per-stream counters, `Lock` wrapped around dispatch, immutable dataclass envelopes.

**Impact notes:**
- **Per-aggregate streams (E) is the biggest structural change in Wave C.** Forces aggregate discipline. Non-aggregate callers use default bucket (no breaking change for system-event use cases).
- **`maxAggregates` eviction** is a new policy surface — users with bounded aggregate cardinality (most CQRS use cases) set it high; users with unbounded cardinality (analytics) must either (a) set `maxAggregates` and accept eviction, (b) use EventStoreAdapter for persistence, or (c) reconsider whether aggregate discipline fits their use case.
- **`dispatch.expectedAggregateVersion`** enables canonical optimistic-concurrency patterns — matches EventStoreDB's semantics.
- **Wave C implementation waits for coherence audit** — Unit 18's concrete shape depends on audit findings. C.2 (commands + dispatch) and C.3 (projections + sagas + store) can still proceed in review independently.

**Cross-primitive conventions finalized (Wave A/B/C so far):**
- Envelope-freeze-at-construction policy: `JobEnvelope.metadata` (B.3), `CqrsEvent.payload` (C.1 C), uniform.
- Per-primitive `Lock` in PY: gate, sub.pullAndAck, bridge, hub, queue, **CqrsGraph dispatch**.
- Bounded-by-default: every retention / pending / pump size has an explicit default.
- Audit log per imperative primitive: gate.decisions, queue.events, **CqrsGraph.aggregateEvictions** (new).
- Reactive-log helpers accreting: `withLatest` + `fromCursor` + `attach` + `appendAll` + likely `guard` + likely `attachStorage`. Audit reconciles.



### Batch C.2 — Write side (`command(name, handler)`, `dispatch(name, payload)`, guards)

---

### Unit 19 — `command(name, handler)` + `CommandHandler` + COMMAND_GUARD

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🔴 §24 handler-as-closure invisible in describe (`explain(command, event)` no path).
- 🟡 §5.12 typing: `state<T>(undefined as T, …)` cast lies about cache type; should be `Node<T | undefined>`.
- 🟡 `describeKind: "state"` label on write-only command — mislabel candidate.
- 🟡 No event-type validation — `actions.emit("typo")` silently lazy-creates orphan event streams (especially nasty under C.1 per-aggregate-stream model).
- 🟡 No dispatch audit surface (parallel to gate pre-A.2 / queue B.3 Unit 15 H fix).
- 🟡 `meta.error: null` conflates SENTINEL + valid DATA.
- 🟡 Duplicate registration silently partial-fails.
- 🟡 Async handler forbidden per PY parity — DX tax documented; escape-hatch pattern is saga-on-events + re-dispatch.

Recommendation: **F (B + C + D + E)** — typing fix (`Node<T | undefined>`, `meta.error: Error | undefined`) + throw on duplicate registration + CqrsGraph `dispatches` audit log (in Unit 20) + declared emits `{ emits: readonly string[] }` at registration with runtime check + object-bag signature `command(name, { handler, emits })`.

---

### Unit 20 — `dispatch(name, payload)` + execution flow + handler throws

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🔴 §24 no dispatch audit surface (same class as Unit 19).
- 🟡 §9a atomicity under handler throw ambiguous — reactiveLog store state may persist even if batch doesn't emit; needs explicit contract + test.
- 🟡 §5.12 command payload not frozen at dispatch (inconsistent with C.1 C event freeze).
- 🟡 No C.1 opts plumbing (correlationId / causationId / aggregateId / expectedAggregateVersion / metadata).
- 🟡 No error hierarchy — "unknown command" vs "handler threw" vs "optimistic concurrency" all generic Error.
- 🟡 `cmdNode.emit(payload)` happens BEFORE handler runs — intentional (lets middleware see attempted commands on failure) but should be documented.

Recommendation: **G (B + C + F)** —
- **B:** plumb C.1 opts (correlation/causation/aggregate/expectedVersion/metadata) + `freezeCommandPayload: boolean` default true (via `structuredClone` + `Object.freeze`) + error hierarchy (`UnknownCommandError`, `OptimisticConcurrencyError`, `UndeclaredEmitError`, `CommandHandlerError`).
- **C:** `CqrsGraph.dispatches: Node<readonly DispatchRecord[]>` reactive-log audit (bounded 1024; `withLatest()` for `lastDispatch` + `hasLastDispatch`). Per-dispatch record: `{ commandName, payload, timestampNs, seq, correlationId?, causationId?, aggregateId?, status: "emitted" | "failed", error?, emittedEvents: readonly { type, aggregateId?, seq }[] }`.
- **F:** test fixture verifies atomicity under handler throw; document in JSDoc.
- **PY parity:** per-CqrsGraph outer `Lock` around dispatch body; compose with per-stream locks from C.1 (outer-before-inner ordering rule).

Defer D (middleware chain) + E (reactive command queue) — composable externally via the dispatches log + saga pattern.

---

## Batch C.2 cross-cutting observations

1. Command + handler is the third "imperative mutation with closure-held logic" pattern after gate controller (A.2) and queue mutations (B.3). All three converge on the same fix: reactive audit log + freeze + central-timer + bounded retention.
2. Error hierarchy candidate for cross-primitive consolidation — shared `patterns/_internal/errors.ts` post-Wave-B cleanup.
3. Freeze-at-entry extended — events (C.1 C), command payloads (C.2 G). Policy uniform.
4. Dispatch atomicity under batch-throw documented + tested in C.2 F — pins down an ambient invariant.
5. Async work forbidden in public APIs across Wave A/B/C. PY parity rule holds uniformly.
6. `meta.error` dynamic companion pattern is novel — verify describe-surface mount semantics during implementation.

---

## Decisions locked (C.2) — 2026-04-24

**Unit 19 `command(name, handler)` — F with type-level event validation (Q5 Option C, not Q9 Option D runtime check):**

1. **B — typing + duplicate-registration fix:**
   - `cmdNode: Node<T | undefined>` — `undefined` is SENTINEL for "never dispatched." Consumers reading `.cache === undefined` distinguish from any legitimate payload.
   - `meta.error: Node<Error | undefined>` — SENTINEL-aligned; `undefined` = never errored.
   - Throw on duplicate registration: `command("x", …); command("x", …)` → `Error("Command 'x' already registered")`.
2. **C (type-level event validation) — CqrsGraph becomes generic `CqrsGraph<EventMap extends CqrsEventMap = CqrsEventMap>`:**
   ```ts
   type CqrsEventMap = Record<string, unknown>;   // default = unconstrained

   class CqrsGraph<EM extends CqrsEventMap = CqrsEventMap> extends Graph {
     event<K extends keyof EM & string>(type: K, aggregateId?: string): Node<readonly CqrsEvent<EM[K]>[]>;

     command<T, Emits extends readonly (keyof EM & string)[]>(
       name: string,
       opts: {
         handler: (payload: T, actions: {
           emit: <K extends Emits[number]>(eventName: K, payload: EM[K], opts?: EmitOpts) => void;
         }) => void;
         emits: Emits;
       }
     ): Node<T | undefined>;
   }
   ```
   - Typo'd event names → compile error. IDE autocompletes event names + payload types from declared `emits`.
   - Users who don't declare `EventMap` (default `Record<string, unknown>`) get today's behavior: any event name, any payload shape.
   - Users who declare `CqrsGraph<MyEventMap>` get full type safety.
   - **PY parity:** Python mirrors with runtime check on `actions.emit(eventName)` against `opts.emits` — throws `UndeclaredEmitError` if not declared. Asymmetric with TS (TS has compile-time only) but per language capability limits.
3. **E — object-bag signature:**
   ```ts
   command(name, { handler, emits })   // breaking from positional (name, handler); pre-1.0 OK
   ```
4. **Deferred to post-Wave-B/C reactive-log coherence audit:**
   - `describeKind: "state"` vs `"producer"` vs new kind on cmdNode — decide during audit.
   - Whether to expose handler as `meta.handler` Node companion (marginal; G candidate).
5. **Handler-as-node candidates promoted to post-Wave-C audit** (user revision 2026-04-24, after seeing scope) — not a post-1.0 deferral but an active audit. See audit item 5 in the "Post-Wave-C audits scheduled" list below. Originally entered in optimizations.md; moved out since it crosses too many primitives to defer past 1.0.

**Unit 20 `dispatch(name, payload, opts)` — D + F (middleware chain + atomicity test; with library-wide rollback policy):**

1. **B — plumbing + freeze + error hierarchy (EXTENDED to gate/queue via shared module):**
   - `dispatch(name, payload, opts?)` with `opts = { correlationId?, causationId?, metadata?, aggregateId?, expectedAggregateVersion? }` per C.1 lock.
   - `freezeCommandPayload: boolean` option on CqrsGraph, default `true`. `structuredClone` + `Object.freeze` at dispatch entry.
   - **Error hierarchy shared** in `patterns/_internal/errors.ts` (cross-primitive):
     ```ts
     // Cross-primitive (Wave A/B/C):
     export class GraphReFlyError extends Error { ... }
     export class DuplicateRegistrationError extends GraphReFlyError { ... }  // command, gate-name, queue-name
     export class UndeclaredEmitError extends GraphReFlyError { ... }         // CQRS
     export class OptimisticConcurrencyError extends GraphReFlyError { ... }  // CQRS
     export class UnknownCommandError extends GraphReFlyError { ... }         // CQRS
     export class CommandHandlerError extends GraphReFlyError { ... }         // wraps handler throw
     export class TeardownError extends GraphReFlyError { ... }               // gate/queue/sub use-after-teardown
     ```
     Callers distinguish via `instanceof` checks. Gate's `guardTorn` (A.2) + Queue's `ack`/`claim` guard (B.3) + Subscription's `dispose` (B.1) + CQRS errors all use the shared set.
2. **C — `CqrsGraph.dispatches: Node<readonly DispatchRecord[]>` audit log** (bounded `retainedLimit = 1024` per B.1; via `reactiveLog.withLatest()` for `lastDispatch` + `hasLastDispatch`). Schema:
   ```ts
   type DispatchRecord<T = unknown> = {
     commandName: string;
     payload: Readonly<T>;
     timestampNs: number;
     seq: number;
     correlationId?: string;
     causationId?: string;
     aggregateId?: string;
     expectedAggregateVersion?: number;
     status: "emitted" | "failed" | "rejected-optimistic-concurrency" | "rejected-undeclared-emit" | "rejected-unknown-command";
     error?: unknown;
     emittedEvents: readonly { type: string; aggregateId?: string; seq: number }[];
   };
   ```
3. **D — middleware chain surface (per user directive):**
   ```ts
   CqrsGraph.use(middleware: (ctx, next) => void): CqrsGraph;
   ```
   Middleware receives `ctx = { commandName, payload, opts, cmdNode }` + `next()` to continue chain. Standard before/around/after pattern (NServiceBus / BrighterCommand / Axon). Common uses: validation, authorization, logging, retries, structured audit beyond `dispatches` log.
   - Middleware chain runs INSIDE the dispatch batch (so middleware emissions coalesce with event emissions).
   - Errors thrown by middleware participate in the rollback policy (see below).
   - PY parity: same `use(middleware)` surface; middleware is sync per general async ban.
4. **F — atomicity test + library-wide rollback-on-throw policy (new cross-cutting invariant per user directive):**
   - **Policy: "All atomicity-boundary changes in this library roll back on throw."** Applies to:
     - `CqrsGraph.dispatch` — handler throws → rollback reactiveLog store mutations + dispatches-log emission reverts to "failed" record.
     - `gate.approve` / `reject` / `modify` / `open` / `close` — controller body throws → rollback queue mutations + decisions-log emission reverts.
     - `jobQueue.enqueue` / `claim` / `ack` / `nack` — method body throws → rollback.
     - `jobFlow` pump — work fn throws → rollback stage mutations for that iteration.
     - `messagingHub.publishMany` — mid-iteration throw → rollback all publishes in the batch.
   - **Implementation mechanism:** `batch(() => { ... })` must be extended (spec-level change?) to support rollback. Options:
     1. **Deferred emissions auto-rollback on throw:** `batch()` catches, discards all pending tier-3 emissions from the current frame, re-throws. This is what users expect but may not be current batch.ts behavior — **must verify in implementation session**.
     2. **Explicit snapshot-restore for store mutations:** for reactiveLog / reactiveList / reactiveMap backing-storage mutations (which happen synchronously, not deferred), each mutation method wraps in `snapshot()` + `rollback()` hooks. Adds complexity to the data-structure layer.
   - **Implementation-session verification task:** read `core/batch.ts` semantics; determine whether current batch() rolls back deferred emissions on throw; if not, spec-level extension required; if yes, document explicitly + add `patterns/_internal/errors.ts` test fixture that exercises rollback across every mutation primitive.
   - **Scope:** this is a **library-wide invariant**, not just C.2. Affects Wave A (gate), Wave B (messaging, job-queue), Wave C (CQRS), and any future mutation primitive.
5. **PY parity:**
   - Per-CqrsGraph outer `Lock` around dispatch body; composes with per-stream locks from C.1 (outer-before-inner acquisition order enforced).
   - Error hierarchy mirrored in `graphrefly.patterns._internal.errors`.
   - Rollback policy mirrored; PY's `contextlib` + try/except frame supports the same pattern.

**Open-question answers:**
- Q1 (Unit 19): **F with type-level event validation** per user — compile-time safety, not runtime check. PY mirrors with runtime check.
- Q2 (Unit 20): **D + F** per user — middleware chain added; atomicity test + library-wide rollback policy enforced.
- Q3 (Error hierarchy): **EXTEND** per user — shared `patterns/_internal/errors.ts`, `instanceof` checks across gate, queue, subscription, CQRS. Cross-primitive convention.
- Q4 (freezeCommandPayload): **true** per my rec (consistent with C.1 event freeze).
- Q5 (expectedAggregateVersion): **single primary aggregate per dispatch** per my rec — simpler, canonical ES.

**Post-Wave-C audits scheduled (accumulating):**
1. **Reactive-log coherence audit** (from B.3) — reconcile `withLatest` + `fromCursor` + `attach` + `appendAll` + potential `guard` + `attachStorage`.
2. **Imperative-controller-with-audit base class audit** (from C.2 per user directive) — unify `CqrsGraph.dispatch`, `pipeline.gate` (A.2), `pipeline.approval`, `pipeline.classify`, queue mutations (B.3), potentially others. Single base class with shared audit-log + freeze + error-hierarchy + rollback semantics. Candidates: `ImperativeControllerGraph` base or mixin.
3. **Process manager pattern audit** (from C.2 per user directive) — saga-like primitive for async workflows. Sagas today (C.3) are pure sync event handlers; a process-manager primitive would own state + orchestrate multi-step async chains + emit events in response. Distinct from current saga in scope and lifecycle.
4. **`attachStorage` scope audit** (from C.2 per user directive) — where does `attachStorage(tiers)` belong? Options: reactive-log method (consistent with B.3 `JobQueueGraph.attachStorage`), Graph-level method (consistent with COMPOSITION-GUIDE §27), per-primitive method. Audit reconciles.
5. **Handler-as-node reevaluation audit** (from C.2 Unit 19, **promoted to post-Wave-C per user directive 2026-04-24** — broader scope than originally scoped). Covers multiple Phase-4+ primitives that hold logic in closure-held callbacks rather than reactive nodes: `CqrsGraph.command` handler, `pipeline.gate` controller methods (modify/approve/reject), `pipeline.classify` predicate, `pipeline.catch` recover fn, `pipeline.combine` reducer. These are ergonomically superior today but **invisible in `describe()` / `explain()`**; mitigated by reactive audit logs per primitive (gate.decisions, queue.events, CqrsGraph.dispatches) — but the mitigation is observation-layer, not structural. Audit decides (pre-1.0): which of these should be lifted to handler-as-node form, which stay as closures with audit mitigation, and what's the uniform API shape across them. Candidates to evaluate in priority order: `CqrsGraph.command` handler (biggest compliance surface), `pipeline.gate.modify`, `pipeline.classify` predicate, `pipeline.catch` recover, `pipeline.combine` reducer. Benefits: first-class `explain(command, event)` paths; hot-swappable handler logic via node re-emission; handler versioning via `v0` versioning. Costs: users write more ceremony at registration; runtime cost of reactive handler-resolution per call.

**Implementation-session scope for C.2 (after all audits + Wave C review complete):**
1. `patterns/_internal/errors.ts` — shared error classes used by gate (retroactive), queue (retroactive), subscription (retroactive), CQRS.
2. `CqrsEventMap` type + `CqrsGraph<EM>` generic + type-level `emits` at `command()`.
3. `command(name, { handler, emits })` object-bag signature.
4. Command node typing fix (`Node<T | undefined>`, `meta.error: Node<Error | undefined>`).
5. Throw on duplicate command registration.
6. `dispatch(name, payload, opts)` opts plumbing.
7. `freezeCommandPayload: boolean` option.
8. `CqrsGraph.dispatches` audit log via `reactiveLog.withLatest()`.
9. `CqrsGraph.use(middleware)` chain.
10. Atomicity test fixture + batch-on-throw rollback verification.
11. PY `Lock` on dispatch; PY runtime `UndeclaredEmitError` check.
12. Docs: migration note for command signature change; middleware + error hierarchy + rollback + optimistic-concurrency walkthroughs.

**Cross-primitive conventions finalized (Wave A/B/C):**
- **Freeze-at-entry** policy: `JobEnvelope.metadata` (B.3), `CqrsEvent.payload` (C.1 C), `dispatch.payload` (C.2 G). Uniform.
- **Error hierarchy** shared via `patterns/_internal/errors.ts` (C.2 Q3 extended).
- **Per-primitive `Lock`** in PY: gate, sub.pullAndAck, bridge, hub, queue, CqrsGraph.dispatch. Uniform.
- **Bounded-default** on all retention/pending/pump/log: gate `maxPending: 1000`, TopicGraph `retainedLimit: 1024`, bridge `maxPerPump: 256`, JobQueue events `retainedLimit: 1024`, JobFlow `maxPerPump: 256` + `_completed retainedLimit: 1024`, CQRS event streams `retainedLimit: 1024`, CqrsGraph.dispatches `retainedLimit: 1024`.
- **Audit log per imperative primitive:** gate.decisions (A.2), queue.events (B.3), CqrsGraph.dispatches (C.2), aggregateEvictions (C.1). Reactive-log backed.
- **Library-wide atomicity-rollback-on-throw** (C.2 F): new invariant; verify batch.ts behavior + extend if needed; applies to every mutation primitive.
- **Reactive-log helpers accreting:** `withLatest` (B.1) + `fromCursor` (B.1) + `attach` (B.2) + `appendAll` (B.3) + possibly `guard` + possibly `attachStorage`. Coherence audit reconciles.
- **Cross-primitive method naming:** `.events` for audit streams (queue, CQRS), `.decisions` for gate, `.dispatches` for CQRS. Convention flagged for audit reconciliation (should all be `.events`? domain-specific names clearer?).



### Batch C.3 — Read side + persistence (`projection`, `saga`, `EventStoreAdapter`, `rebuildProjection`)

---

### Unit 21 — `projection(name, eventNames, reducer, initial)`

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🟡 §5.12 perf cliff — O(N log N) per wave full replay (allocation + sort + reducer).
- 🟡 C.1 E per-aggregate-stream fan-in breaks today's stable-subscription model.
- 🟡 Purity not enforced at runtime (opt-in dev mode).
- 🟡 No snapshot-rebuild + continue pattern (rebuild and projection are separate paths).
- 🟡 Cross-aggregate ordering determinism (seq is per-stream under C.1 E).

Recommendation: **G (B + C + E)** —
- **B:** `mode: "replay" | "scan"` default `"replay"` (canonical ES). `scan` mode: reducer receives `(prevState, newEvents)` — O(k) per wave.
- **C:** `snapshot?: { load: () => TState | Promise<TState>, save?: (state: TState) => void | Promise<void>, saveEvery?: number }` — production rebuild + continue pattern.
- **E:** projection subscribes to `event(type)` fan-in which autoTracks active aggregate streams per C.1 E.
- Cross-aggregate ordering: tertiary tie-break on `aggregateId` lexicographic — deterministic without new field.
- Defer D (freezeInputs) + F (`_internal.globalSeq`) — not blocking.

---

### Unit 22 — `saga(name, eventNames, handler)`

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🔴 §24 — `lastCounts: Map` is closure state; must be a registered state node.
- 🔴 §24 — handler-as-closure invisible in describe (same class as command; covered by post-Wave-C audit 5).
- 🟡 `meta.error: null` vs SENTINEL (same as command).
- 🟡 PY race on `lastCounts` map (free-threaded).
- 🟡 No saga invocations audit log (same class as gate pre-A.2).
- 🟡 Missing `aggregateId` filter option for C.1 E per-aggregate sagas.
- 🟡 Loose `eventNames: readonly string[]` — no type-level constraint (cascade from C.2 Unit 19).

Recommendation: **H (full spec)** —
- Cursors as state node (single `Map`-valued or per-event).
- `invocations: Node<readonly SagaInvocation[]>` + `lastInvocation` + `hasLastInvocation` via `reactiveLog.withLatest()`; bounded 1024.
- `aggregateId?: string` option (per C.1 E).
- `errorPolicy?: "advance" | "hold" | { retryMax: number }` default `"advance"` (at-most-once; users opt into retry).
- Type-level event-name constraint via C.2 Unit 19's `CqrsGraph<EM>` generic.
- SENTINEL-aligned `meta.error: Node<Error | undefined>`.
- Shrinking-events defensive clamp (LRU eviction replay case).
- Duplicate-name throws `DuplicateRegistrationError` (shared).
- Return envelope: `{ node, cursors, invocations, lastInvocation, hasLastInvocation, error }`.
- Post-Wave-C audit 3 (process manager) may introduce complementary async-workflow primitive; saga stays sync-side-effect-over-events.

---

### Unit 23 — `EventStoreAdapter` + `MemoryEventStore`

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🔴 C.1 E cascade — interface signature must update to `loadEvents({ type, aggregateId?, cursor? })`; MemoryEventStore to two-level `Map<type, Map<aggregateId, CqrsEvent[]>>`.
- 🟡 No batch persist — `persist(event)` one-at-a-time; N adapter calls per multi-event dispatch.
- 🟡 No introspection / stats API.
- 🟡 `flush()` optional but never framework-invoked.

Recommendation: **G (B + C + D + E)** —
- **B:** C.1 E signature update — aggregate-aware `loadEvents`; MemoryEventStore two-level storage.
- **C:** `persistMany?(events)` optional method; framework falls back to N `persist` calls for adapters without it.
- **D:** `stats?()` optional method for production introspection.
- **E:** framework auto-invokes `flush()` at end of every dispatch batch when adapter exposes it. Opt-out via `CqrsOptions.autoFlush: boolean` (default true when adapter has `flush`).
- Defer F (reactive `persistStream` via Node) — post-Wave-C attachStorage audit decides storage API unification.

---

### Unit 24 — `rebuildProjection(eventNames, reducer, initial)`

See chat transcript 2026-04-24 for full Q1–Q9. Findings:

- 🔴 PY parity — async in public API violates "no async def in public". TS allows; PY rename to `a_rebuild_projection` convention.
- 🟡 C.1 E cascade — must accept `aggregateId?` for per-aggregate rebuild.
- 🟡 No pagination — single-shot load catastrophic at scale (millions of events).
- 🟡 Standalone utility divorced from live projection path — rebuild and projection replay separately; Unit 21 C snapshot integration closes the gap for production path.

Recommendation: **F (keep standalone + pagination + progress; Unit 21 C handles live path)** —
- `rebuildProjection({ eventTypes, aggregateId?, reducer, initial, pageSize?, onProgress? }): Promise<TState>`.
- Pagination via cursor iteration — O(pageSize) memory; `pageSize` default 1000.
- `onProgress?: (loaded: number) => void` callback.
- Shared `RebuildError` in `patterns/_internal/errors.ts`.
- Keep standalone for ad-hoc rebuilds (analytics / batch jobs); live projections use Unit 21 C snapshot integration.
- PY: `a_rebuild_projection` async prefix convention; public sync methods remain sync.

---

## Batch C.3 cross-cutting observations

1. `projection`, `saga`, `EventStoreAdapter`, `rebuildProjection` all cascade from C.1 E per-aggregate streams — single biggest structural ripple.
2. Saga closure-cursor is the last §24 closure-state violation in CQRS.
3. Projection perf cliff (full replay O(N log N) per wave) addressed via `mode: "scan"` + snapshot integration.
4. Async rebuild + async snapshot.load are the two legitimate async boundaries in Wave C — accepted at adapter-boundary level; PY `a_` prefix convention.
5. Every unit reconfirms the cross-cutting conventions (freeze / audit / SENTINEL / bounded / shared errors / PY locks).
6. Post-Wave-C audit 4 (attachStorage scope) likely unifies EventStoreAdapter.persist* with reactive-log.attach + Graph.attachStorage.

---

## Decisions locked (C.3) — 2026-04-24

**Unit 21 `projection` — B + C + D with Option-2 fan-in + Option-3 cross-aggregate ordering + debounced snapshot.save:**

1. **B — `mode: "replay" | "scan"` default `"replay"`.** Scan mode receives `(prevState, newEvents)` for O(k) per wave. Prev-state via `ctx.store` or paired state node.
2. **C — `snapshot?: { load, save?, saveEvery?, saveDebounceMs? }` production rebuild + continue:**
   - `load: () => TState | Promise<TState>` — async-allowed at boundary; called at projection construction if provided.
   - `save?: (state: TState) => void | Promise<void>` — async-allowed.
   - **`saveDebounceMs?: number`** (NEW per user — apply `Graph.attachStorage` pattern) — debounce save until quiet window elapses. Default `1000` (1 second).
   - **`saveEvery?: number`** — cap save at every N events (forces save even under continuous activity). Default `1000`. Both knobs work together: save fires when `saveDebounceMs` elapses since last event OR `saveEvery` event count reached, whichever comes first. Same pattern as `Graph.attachStorage` tier debouncing per COMPOSITION-GUIDE §27.
3. **D — `freezeInputs?: boolean` (default false; `true` enables `Object.freeze(state) + Object.freeze(events)` per call) for purity enforcement in dev.**
4. **Per-aggregate fan-in: Option 2 (merged reactive-log union).** Per user: "autoTrackNode does not remove dep; is option 2 better?" — yes, confirmed. Implementation: `event(type)` (no aggregateId) returns a fan-in Node implemented as a merged `reactiveLog` view backed by the union of per-aggregate logs for that type. LRU eviction of an aggregate's log removes its entries from the fan-in. Heavier than autoTrackNode (which only adds deps, not removes), but lifecycle-correct under C.1 E's eviction policy. Tie-in with reactive-log coherence audit (#1) — the fan-in primitive may become a generic `reactiveLog.merge(logs)` helper.
5. **Cross-aggregate ordering: Option 3 (aggregateId lex tertiary tie-break).** Default sort comparator: `(a, b) => a.timestampNs - b.timestampNs || a.seq - b.seq || a.aggregateId.localeCompare(b.aggregateId ?? "")`. Deterministic; no new field. (Defer Option 1 globalSeq counter.)
6. **Duplicate name throws `DuplicateRegistrationError`** (shared error hierarchy).
7. **Returns envelope** (consistent with Unit 22/24 envelopes):
   ```ts
   type ProjectionResult<TState> = {
     readonly node: Node<TState>;
     rebuild: () => Promise<TState>;          // ad-hoc rebuild from event store; replaces standalone rebuildProjection (Unit 24)
     reset: () => Promise<void>;              // reload from snapshot.load + replay; resume live
   };
   ```

**Unit 22 `saga` — H (full spec); cursor-as-node deferred to post-Wave-C audit:**

1. **`invocations: Node<readonly SagaInvocation[]>` + `lastInvocation` + `hasLastInvocation` via `reactiveLog.withLatest()`.** Bounded `retainedLimit = 1024`. Schema:
   ```ts
   type SagaInvocation<T = unknown> = {
     eventType: string;
     event: CqrsEvent<T>;
     t_ns: number;
     status: "ran" | "failed" | "cursor-reset";
     error?: unknown;
   };
   ```
2. **Cursors as state node — concrete shape deferred to post-Wave-C audit 2 (imperative-controller-with-audit base class) per user directive.** For now: lock the goal ("cursors must be reactive state nodes, not closure Maps"); defer the API shape (single `Map`-valued node vs per-event-type `_cursor` nodes) to the audit's unification pass. Saga ships with cursor-as-state-node — implementation chooses shape based on audit outcome.
3. **`aggregateId?: string` option** — saga subscribes to specific per-aggregate stream (when set) or the fan-in (default).
4. **`errorPolicy?: "advance" | "hold" | { retryMax: number }`** default **`"advance"`** (at-most-once; matches today's behavior + library-wide rollback policy doesn't cleanly apply per-event in saga because saga isn't a batch boundary). Users opt into `"hold"` (stuck-saga risk) or `{ retryMax: N }` (tries each event up to N times before advancing).
5. **Type-level event-name constraint via C.2 Unit 19's `CqrsGraph<EM>` generic.**
6. **SENTINEL-aligned `meta.error: Node<Error | undefined>`.**
7. **Shrinking-events defensive clamp.** When `entries.length < lastCount` (LRU-eviction-replay edge case), clamp cursor to `min(lastCount, entries.length)` and emit `SagaInvocation { status: "cursor-reset", … }`.
8. **Duplicate name throws `DuplicateRegistrationError`.**
9. **Returns envelope**:
   ```ts
   type SagaResult = {
     readonly node: Node<unknown>;
     readonly cursors: Node<ReadonlyMap<string, number>>;     // exact shape per audit-2 outcome
     readonly invocations: Node<readonly SagaInvocation[]>;
     readonly lastInvocation: Node<SagaInvocation | undefined>;
     readonly hasLastInvocation: Node<boolean>;
     readonly error: Node<Error | undefined>;
   };
   ```

**Unit 23 `EventStoreAdapter` — F (B + C + D + E + reactive `persistStream`):**

Per user directive (more aggressive than my G rec). Full reactive ingestion path included now, not deferred.

1. **B — C.1 E signature update:**
   ```ts
   interface EventStoreAdapter {
     persist(event: CqrsEvent): void;
     persistMany?(events: readonly CqrsEvent[]): void;        // C
     loadEvents(opts: {
       type: string;
       aggregateId?: string;
       cursor?: EventStoreCursor;
     }): LoadEventsResult | Promise<LoadEventsResult>;
     flush?(): Promise<void>;                                  // E (framework-invoked)
     stats?(): Promise<EventStoreStats>;                       // D
     persistStream?(events: Node<readonly CqrsEvent[]>): () => void;  // F (reactive ingestion)
   }
   ```
2. **C — `persistMany?(events)` optional batch.** Framework falls back to N `persist` calls.
3. **D — `stats?()` optional introspection.**
4. **E — Framework auto-invokes `flush()` at end of every dispatch batch when adapter exposes it.** Opt-out via `CqrsOptions.autoFlush: boolean` (default true when adapter has `flush`).
5. **F — Reactive `persistStream?(eventsNode)`:** adapter subscribes to a Node-stream of events; appends as DATA arrives. Returns detach fn. CqrsGraph wires every event stream to `_eventStore.persistStream(stream)` when adapter exposes the method, else falls back to per-event `persist` calls. **Aligns with B.2's `reactive-log.attach(upstream)` pattern** — the reactive ingestion path applies to both messaging logs and event store. The post-Wave-C attachStorage audit (#4) reconciles whether these become a single primitive or stay parallel.
6. **MemoryEventStore** — two-level `Map<type, Map<aggregateId, CqrsEvent[]>>`; implements `persistMany` (loop), `stats()`, `persistStream` (subscribes + appends).

**Unit 24 `rebuildProjection` — E (fold into `projection.rebuild()` method; eliminate standalone):**

Per user directive ("no, fold it in projection.rebuild") — `rebuildProjection` as a standalone method on `CqrsGraph` is removed. Live projections gain `rebuild()` + `reset()` methods (per Unit 21 envelope). Ad-hoc rebuilds without a live projection use `cqrs.projection(...)` with `keepAlive: false` followed by `.rebuild()` + then disposal — no special API.

1. **`projection(name, opts)` returns** `{ node, rebuild(), reset() }` envelope (Unit 21 lock).
2. **`projection.rebuild(): Promise<TState>`:**
   - Loads from snapshot if available (`snapshot.load`).
   - Paginated fetch from `_eventStore.loadEvents({ type, aggregateId?, cursor, pageSize })` — `pageSize` default 1000.
   - Applies reducer per page (scan-style) starting from snapshot state.
   - Optional `onProgress?: (loaded: number) => void` parameter.
   - Returns final `TState`. Updates the live `node` cache.
3. **`projection.reset(): Promise<void>`:**
   - Stops live stream subscription.
   - Reloads from `snapshot.load` + replays via `rebuild`.
   - Resumes live stream.
4. **PY parity:** methods use async (boundary I/O); PY public surface uses `a_` prefix convention (`a_rebuild`, `a_reset`). Matches "no `async def` in public sync APIs" rule.
5. **Shared `RebuildError` in `patterns/_internal/errors.ts`** for adapter-side failures.

**Open-question answers:**
- Q1 (Unit 21 scope): **B + C + D** with **Option 2 fan-in** + **Option 3 cross-aggregate ordering** + **debounced snapshot.save** per user.
- Q2 (Unit 22 scope): **H** with cursor-as-node API shape **deferred to post-Wave-C audit 2** per user.
- Q3 (saga errorPolicy default): **`"advance"`** (at-most-once; users opt into retry).
- Q4 (Unit 23 scope): **F** per user — full reactive `persistStream` included, not deferred.
- Q5 (Unit 24 scope): **E** per user — fold into `projection.rebuild()` method; eliminate standalone.

**Cross-batch C.3 implementation-session scope:**
1. `projection(name, opts)` envelope rewrite per Unit 21+24 spec (mode + snapshot debouncing + freezeInputs + rebuild + reset methods + cross-aggregate aggregateId tie-break).
2. `saga(name, eventNames, handler, opts?)` envelope rewrite per Unit 22 H (cursors as state node — exact shape per post-Wave-C audit 2; invocations log; aggregateId; errorPolicy; type-level constraints; SENTINEL meta.error; shrinking-events clamp).
3. `EventStoreAdapter` interface update to F (full reactive `persistStream` shape).
4. `MemoryEventStore` two-level storage + persistMany + stats + persistStream.
5. **Removed:** standalone `rebuildProjection` method on `CqrsGraph`.
6. Per-aggregate fan-in implementation: merged `reactiveLog.merge(logs: Node<readonly T[]>[])` helper or equivalent in `extra/reactive-log` (resolve in coherence audit #1).
7. Shared errors in `patterns/_internal/errors.ts` extended: `RebuildError`.
8. PY parity: mirror all; `a_rebuild` / `a_reset` async prefix on projection envelope; `loadEvents` + `flush` + `persistStream` adapter signatures; `Lock` story.

**LOC impact (Wave C total):**
- `patterns/cqrs/index.ts`: 495 → ~600 LOC (richer envelopes; per-aggregate two-level Maps; type-level generic; middleware; audit log; rebuild method).
- `extra/reactive-log`: +~50 more LOC for `merge` helper (post-Wave-B audit consolidates with `withLatest` + `fromCursor` + `attach` + `appendAll`).
- `patterns/_internal/errors.ts`: ~60 LOC shared error hierarchy.



---

# Post-Wave-C Audits

Five audits queued to reconcile cross-cutting design questions before any implementation. Audits run sequentially: 1 → 4 → 2 → 5 → 3 (per dependency order; 5 may parallelize with 3).

---

## Audit 1 — `extra/reactive-log` coherence — LOCKED 2026-04-24

**Origin:** Wave A/B/C added 5 helpers without a coherence pass. Helper accumulation: `withLatest` (B.1) + `fromCursor` (B.1) + `attach` (B.2) + `appendAll`-or-rename (B.3) + `merge` (C.3) + `guard` opt (C.1) + `attachStorage` (B.3 + cross-Audit-4).

See chat transcript 2026-04-24 for full Q1–Q9.

**Locked decisions:**

1. **Drop `appendAll`** from B.3 Unit 15 spec. Existing `appendMany` (Wave 4 shipped 2026-04-15) covers the use case (one final-snapshot DATA wave, mutations coalesced internally). The proposed "multi-DATA-in-one-wave" semantics (intermediate snapshots delivered per state transition) doesn't have a real consumer in Wave A/B/C — audit logs want final-state semantics.
2. **`withLatest()` returns the `entries` Node with meta companions activated** (per user directive — comply with `Node.meta: Record<string, Node>` companion-node pattern):
   ```ts
   const entries = log.withLatest();   // Node<readonly T[]>; companions now active
   entries.meta.lastValue;              // Node<T | undefined>  (SENTINEL-aligned)
   entries.meta.hasLatest;              // Node<boolean>
   ```
   - Mirrors `cmdNode.meta.error` (C.2 Unit 19) and other dynamic companions.
   - Lazy keepalive — companions activate on first external subscribe.
   - Implementation verifies: meta companions visible in `describe()` under `<parent>::meta::<key>` paths and walkable via `explain()`. If meta is "floating" (not auto-mounted), explicit `Graph.add(entries.meta.lastValue, …)` happens at construction.
   - **B.1 Unit 11 lock spec updated** — TopicGraph's `lastValue` / `hasLatest` are accessed via `topic.events.meta.lastValue` / `topic.events.meta.hasLatest`. Same for cqrs.event, JobQueue.events, dispatches, invocations.
3. **`view(spec)` consolidation** (Alternative E per user directive): unify `tail / slice / fromCursor` under one method with discriminated `ViewSpec`:
   ```ts
   type ViewSpec<T> =
     | { kind: "tail"; n: number }
     | { kind: "slice"; start: number; stop?: number }
     | { kind: "fromCursor"; cursor: Node<number> };

   bundle.view(spec: ViewSpec<T>): Node<readonly T[]>;
   ```
   - **Strict consolidation:** drop `tail(n)` / `slice(start, stop)` / `fromCursor(cursor)` as separate methods. Pre-1.0 break (Wave 4 shipped these as separate methods 2026-04-15). Migration: existing callers rewrite to `view({ kind: "tail", n })` etc. Roughly mechanical.
   - **Memoization:** per spec-shape — `view({ kind: "tail", n: 10 })` and `view({ kind: "tail", n: 10 })` (different call sites, same shape) return the same node. Memoization key: `(kind, n)` for tail; `(kind, start, stop)` for slice; `(kind, cursorNodeIdentity)` for fromCursor.
   - **Extensibility:** future view kinds (e.g., `{ kind: "filter", pred }`, `{ kind: "windowByTime", ms }`) added without new methods.
4. **`mergeReactiveLogs(logs)` factory-level helper** (per user directive). Lives at `extra/reactive-log` module level, not on the bundle:
   ```ts
   export function mergeReactiveLogs<T>(
     logs: readonly Node<readonly T[]>[]
   ): Node<readonly T[]>;
   ```
   - Producer-pattern node; subscribes to inputs internally + manages dynamic subscription set (handles input log COMPLETE / ERROR / disposal).
   - Memoized by reference equality on `logs` array. Repeat calls with same array reference → same Node.
   - Lifecycle: when an input log COMPLETEs, removes from subscription set; output stays live with remaining logs. When input ERRORs, propagates ERROR per spec §2.2.
   - Used by CQRS event(type) per-aggregate fan-in (C.3 Unit 21 lock).
   - Internal subscriptions invisible in describe (producer-pattern, §24 sanctioned). The aggregate Logs don't appear as edges; merge output Node is stable. Documentation: "merge is fan-in semantics; explain across merge surfaces only the merged stream, not individual aggregate sources."
5. **No package extraction** (`@graphrefly/reactive-log` rejected). Stays in `extra/reactive-log` as internal layer.
6. **`attachStorage(tiers)` signature commitment with shape deferred to Audit 4:**
   ```ts
   bundle.attachStorage(tiers: readonly StorageTier<T>[]): () => void;
   ```
   - Cross-audit dependency: `StorageTier<T>` interface defined in Audit 4 (which reconciles `Graph.attachStorage(tiers)` + `JobQueueGraph.attachStorage(eventsSink)` + `EventStoreAdapter.persistStream`).
   - Audit 4 will pick the `StorageTier<T>` shape; reactive-log adopts it.
7. **`guard?: NodeGuard` option on `reactiveLog([], opts)`:**
   ```ts
   export type ReactiveLogOptions<T> = {
     name?: string;
     maxSize?: number;
     versioning?: VersioningLevel;
     guard?: NodeGuard;                  // NEW — applied to entries Node
     backend?: LogBackend<T>;
   };
   ```
   - Eliminates the passthrough-derived pattern in `cqrs.event` (C.1 Unit 18 baseline) — `entries` carries the guard directly.
8. **`LogBackend<T>` interface gains `snapshot()` + `restore()`:**
   ```ts
   export interface LogBackend<T> {
     // Existing
     append(value: T): void;
     appendMany(values: readonly T[]): void;
     at(i: number): T | undefined;
     slice(start: number, stop?: number): readonly T[];
     size: number;
     version: number;
     // NEW for attachStorage compat
     snapshot(): readonly T[];
     restore(values: readonly T[]): void;
   }
   ```
   - `NativeLogBackend` (default) implements both.
   - `snapshot()` returns immutable readonly view; codec serialization happens at the storage tier boundary.
   - `restore(values)` replaces backend state (used by cold-tier load on startup); fires one DATA emission for the restored state.
9. **Naming convention documented** — verbs for actions (`append`, `appendMany`, `attach`, `attachStorage`); methods for views (`view`, returns Node); options for construction (`versioning`, `guard`, `maxSize`, `backend`); helpers returning bundles vs Nodes signaled in JSDoc.
10. **Lifecycle composition test fixtures** — required in implementation:
    - Nested helper composition (`mergeReactiveLogs(logs).meta.lastValue` via withLatest).
    - LRU-eviction propagation through merge.
    - `view + attach + withLatest` co-activation ordering.
    - Teardown: `disposeAllViews` semantics; companion-node disposal.

**Open-question answers:**
- Q1 (drop `appendAll`): **yes**.
- Q2 (`merge` factory-level): **factory-level** (`mergeReactiveLogs(logs)`).
- Q3 (`view(spec)` consolidation): **yes** — strict consolidation; drop separate `tail / slice / fromCursor` methods.
- Q4 (package extraction): **no**.
- Q5 (`attachStorage` signature commitment): **yes** — tier-aware, shape deferred to Audit 4.

**Final API surface for `extra/reactive-log`:**

```ts
// Construction
export function reactiveLog<T>(
  initial: readonly T[],
  opts?: ReactiveLogOptions<T>
): ReactiveLogBundle<T>;

export type ReactiveLogOptions<T> = {
  name?: string;
  maxSize?: number;
  versioning?: VersioningLevel;
  guard?: NodeGuard;
  backend?: LogBackend<T>;
};

// Bundle
export interface ReactiveLogBundle<T> {
  readonly entries: Node<readonly T[]>;

  // Mutation
  append(value: T): void;
  appendMany(values: readonly T[]): void;

  // Boundary reads
  size: number;
  at(i: number): T | undefined;

  // Views (consolidated)
  view(spec: ViewSpec<T>): Node<readonly T[]>;

  // Companion-node activation
  withLatest(): Node<readonly T[]>;     // returns entries; activates meta.lastValue + meta.hasLatest

  // Side-effecting helpers
  attach(upstream: Node<T>): () => void;
  attachStorage(tiers: readonly StorageTier<T>[]): () => void;

  // Teardown
  disposeAllViews(): void;
}

// View specs
export type ViewSpec<T> =
  | { kind: "tail"; n: number }
  | { kind: "slice"; start: number; stop?: number }
  | { kind: "fromCursor"; cursor: Node<number> };

// Cross-log helper
export function mergeReactiveLogs<T>(
  logs: readonly Node<readonly T[]>[]
): Node<readonly T[]>;

// Backend interface
export interface LogBackend<T> {
  append(value: T): void;
  appendMany(values: readonly T[]): void;
  at(i: number): T | undefined;
  slice(start: number, stop?: number): readonly T[];
  size: number;
  version: number;
  snapshot(): readonly T[];
  restore(values: readonly T[]): void;
}
```

**Cascade impact on Wave A/B/C locks:**
- **B.1 Unit 11 (TopicGraph):** `lastValue` / `hasLatest` accessed via `topic.events.meta.lastValue` / `topic.events.meta.hasLatest` (companion-node pattern). Public API doesn't expose them as separate `topic.lastValue` / `topic.hasLatest` properties — users go through `events.meta.<key>`.
  - **Re-evaluate:** users may prefer `topic.lastValue` shorthand; bundle pattern would reintroduce that. Defer to TopicGraph implementation taste — can be a 1-line getter on TopicGraph that returns `this.events.meta.lastValue`.
- **B.1 Unit 12 (SubscriptionGraph):** `available` uses `view({ kind: "fromCursor", cursor })` instead of `fromCursor(cursor)`.
- **B.2 Unit 13 (TopicBridgeGraph):** `target.events._log` calls `attach(this.output)` — unchanged.
- **B.3 Unit 15 (JobQueueGraph):** `events` uses `withLatest()` → `events.meta.lastEvent` / `events.meta.hasLastEvent`. `appendAll` dropped; method bodies use `events.appendMany(records)` for bulk emit, `batch()` for cross-node coalesce.
- **C.1 Unit 18 (CQRS event):** `reactiveLog([], { name, versioning: 0, guard: EVENT_GUARD })` — passthrough derived eliminated. Entries Node IS the event surface, with `events.meta.lastEvent` / `events.meta.hasLastEvent` from `withLatest()`.
- **C.2 Unit 20 (CqrsGraph.dispatches):** `dispatches` uses `withLatest()` → `dispatches.meta.lastDispatch` / `dispatches.meta.hasLastDispatch`.
- **C.3 Unit 21 (projection per-aggregate fan-in):** uses `mergeReactiveLogs(perAggregateLogs)` with the dynamic-set lifecycle (LRU eviction handling).
- **C.3 Unit 22 (saga invocations):** `invocations` uses `withLatest()` → `invocations.meta.lastInvocation` / `invocations.meta.hasLastInvocation`.
- **C.3 Unit 23 (EventStoreAdapter.persistStream):** signature aligned with `attach(upstream)` — adapter subscribes to events Node and persists.

**LOC impact:**
- `extra/reactive-log/index.ts`: ~700 LOC today.
- Audit 1 additions: `withLatest` (~30) + `view(spec)` consolidation refactor (~20 net change) + `attach` (~50) + `mergeReactiveLogs` (~80) + `guard` plumbing (~10) + `LogBackend.snapshot/restore` (~20) + JSDoc convention updates (~30) = ~240 LOC.
- `attachStorage(tiers)` plumbing scope-locked but shape-deferred (~30 LOC after Audit 4 shape lands).
- Total post-audit: ~970 LOC.

**Implementation-session ordering:**
1. Add `LogBackend.snapshot/restore` (foundation).
2. Add `guard?: NodeGuard` option (small).
3. Refactor existing `tail`/`slice` to `view(spec)` (breaking; pre-1.0).
4. Add `view({ kind: "fromCursor" })` (replaces dropped fromCursor method).
5. Add `withLatest()` with meta-companion activation.
6. Add `attach(upstream)` helper.
7. Add `mergeReactiveLogs` factory.
8. Verify lifecycle test fixtures pass.
9. **Wait for Audit 4** to define `StorageTier<T>` interface.
10. Add `attachStorage(tiers)` once Audit 4 lands.

**PY parity:** mirror all helpers via `graphrefly.extra.reactive_log`; use `WeakKeyDictionary` for view memoization; lifecycle hooks as context managers for `attach` detach.

**Coverage of audit goals:**
- ✅ Naming consistency (drop appendAll; conventions documented).
- ✅ Lifecycle composition (test fixtures + `mergeReactiveLogs` dynamic subscription set).
- ✅ `guard` option (eliminates CQRS passthrough).
- ✅ `attachStorage` scope (signature locked; defers shape to Audit 4).
- ✅ Backend coverage (snapshot/restore added).
- ✅ Bundle-vs-Node return clarity (Node-returning helpers consolidated under view; companion-node returns Node).
- ✅ Type-level constraint propagation (`reactiveLog<T>` flows through all helpers including `mergeReactiveLogs<T>`).


---

## Audit 4 — `attachStorage` scope — LOCKED 2026-04-24

**Origin:** Three storage-attaching surfaces accumulated; Audit 1 deferred `StorageTier<T>` shape here. Audit 4 reconciles snapshot vs append-log semantics + scope per user expanded directives 2026-04-24.

See chat transcript 2026-04-24 for full Q1–Q9.

**User expanded directives:**
1. **N-tier flexibility** — storage is N-tier (1, 2, or N); users freely decide hot/cold combinations; framework prescribes nothing.
2. **Separate generic storage types** — `appendStorage` (delta/append) + `snapshotStorage` (full/holistic). Users pick or fan out to both. Naming: `AppendLogStorageTier<T>` + `SnapshotStorageTier<T>` (per Audit 1 lock vocabulary).
3. **Transaction semantics: one wave = one transaction** (user proposal, locked after evaluation):
   - Tiers buffer writes within a wave.
   - Framework calls `flush()` at wave-close to commit; `rollback()` on wave-throw to discard (per C.2 F library-wide rollback policy).
   - Debouncing layers cleanly on top: one debounce window covers N waves; transaction-of-record extends to debounce-fire boundary when `debounceMs > 0`.
   - **Caveat documented:** cross-tier atomicity is best-effort. Each tier is its own transaction; if tier A flushes successfully and tier B fails, partial persistence results. Users needing strict cross-tier atomicity build a transactional adapter that internally coordinates.
4. **Unified methods on `BaseStorageTier`:** `flush()`, `rollback()` shared across both kinds.
5. **F — bytes-level `StorageBackend` layer with tier specializations over it** (per user pick — overrides my "defer F" rec). Three-layer architecture.

**Locked decisions:**

### Three-layer architecture

**Layer 1 — Bytes-level `StorageBackend`:**
```ts
export interface StorageBackend {
  readonly name: string;                                       // for diagnostics
  read(key: string): Uint8Array | undefined | Promise<Uint8Array | undefined>;
  write(key: string, bytes: Uint8Array): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
  list?(prefix: string): readonly string[] | Promise<readonly string[]>;
  flush?(): Promise<void>;                                     // optional drain
  // No tier-level concerns (debounce, codec, etc.) — lives at Layer 2.
}
```
Reference backends (each a factory returning `StorageBackend`):
- `memoryBackend()` — in-process Map.
- `fileBackend(dir: string)` — filesystem.
- `sqliteBackend(path: string)` — node:sqlite (Node tier-only).
- `indexedDbBackend(spec)` — IndexedDB (browser tier-only).

**Layer 2 — Tier specializations** (parametric over `T`; layered over `StorageBackend`):

```ts
export interface BaseStorageTier {
  readonly name: string;
  readonly debounceMs?: number;                                // central-clock-driven; default tier-specific
  readonly compactEvery?: number;                              // force flush every N writes
  flush?(): Promise<void>;                                     // commit pending; framework calls at wave-close / debounce-fire
  rollback?(): Promise<void>;                                  // discard pending; framework calls on wave-throw
}

export interface SnapshotStorageTier<T = unknown> extends BaseStorageTier {
  save(snapshot: T): void | Promise<void>;
  load?(): T | Promise<T | undefined> | undefined;
  filter?: (snapshot: T) => boolean;                           // skip-save policy (e.g., version unchanged)
}

export interface AppendLogStorageTier<T = unknown> extends BaseStorageTier {
  appendEntries(entries: readonly T[]): void | Promise<void>;  // bulk-friendly
  loadEntries?(opts?: {
    cursor?: AppendCursor;
    pageSize?: number;
    keyFilter?: string;
  }): AppendLoadResult<T> | Promise<AppendLoadResult<T>>;
  keyOf?: (entry: T) => string;                                // partition key (CQRS uses `${type}::${aggregateId}`)
}

export type AppendCursor = Readonly<{ position: number; tag?: string }> & { readonly __brand: "AppendCursor" };
export type AppendLoadResult<T> = { entries: readonly T[]; cursor: AppendCursor | undefined };
```

**Tier factory functions** (take backend + opts; return tier specialization):
```ts
export function snapshotStorage<T>(
  backend: StorageBackend,
  opts?: { name?: string; codec?: Codec<T>; debounceMs?: number; compactEvery?: number; filter?: (snapshot: T) => boolean }
): SnapshotStorageTier<T>;

export function appendLogStorage<T>(
  backend: StorageBackend,
  opts?: { name?: string; codec?: Codec<T>; keyOf?: (entry: T) => string; debounceMs?: number; compactEvery?: number }
): AppendLogStorageTier<T>;
```

**Convenience factories** (separate per backend per kind, per user directive Q4 = "separate"):
```ts
// Each is a thin wrapper: memorySnapshot<T>() = snapshotStorage<T>(memoryBackend())
export function memorySnapshot<T>(opts?): SnapshotStorageTier<T>;
export function memoryAppendLog<T>(opts?): AppendLogStorageTier<T>;
export function fileSnapshot<T>(dir: string, opts?): SnapshotStorageTier<T>;
export function fileAppendLog<T>(dir: string, opts?): AppendLogStorageTier<T>;
export function sqliteSnapshot<T>(path: string, opts?): SnapshotStorageTier<T>;        // Node tier-only
export function sqliteAppendLog<T>(path: string, opts?): AppendLogStorageTier<T>;       // Node tier-only
export function indexedDbSnapshot<T>(spec, opts?): SnapshotStorageTier<T>;              // browser tier-only
export function indexedDbAppendLog<T>(spec, opts?): AppendLogStorageTier<T>;            // browser tier-only
```

Users compose at any layer:
```ts
// Convenience:
graph.attachStorage([memorySnapshot(), fileSnapshot(".graphrefly")]);

// Composition:
const fs = fileBackend(".graphrefly");
graph.attachStorage([memorySnapshot(), snapshotStorage(fs)]);
events.attachStorage([appendLogStorage(fs, { keyOf: e => `${e.type}::${e.aggregateId ?? "_"}` })]);

// N-tier with mixed kinds (user freedom):
graph.attachStorage([
  memorySnapshot(),                           // tier 1: hot
  fileSnapshot(".graphrefly", { debounceMs: 5000 }),    // tier 2: warm
  indexedDbSnapshot(idbSpec, { debounceMs: 60000 }),    // tier 3: cold
]);
```

**Layer 3 — High-level wiring** (consumer-facing):
```ts
graph.attachStorage(tiers: readonly SnapshotStorageTier<GraphCheckpointRecord>[]): () => void;
reactiveLog.attachStorage(tiers: readonly AppendLogStorageTier<T>[]): () => void;
cqrsGraph.attachEventStorage(tiers: readonly AppendLogStorageTier<CqrsEvent>[]): () => void;
jobQueueGraph.attachStorage(tiers: readonly AppendLogStorageTier<JobEvent>[]): () => void;
```

### Codec system (parameterized to `Codec<T>`; per user Q3 = yes)

```ts
export interface Codec<T = unknown> {
  readonly name: string;                                       // e.g., "json", "dag-cbor"
  readonly version: number;
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
}

// Registry on defaultConfig (existing pattern, parameterized per T):
defaultConfig.registerCodec<T>(codec: Codec<T>): void;
defaultConfig.getCodec<T>(name: string): Codec<T> | undefined;
```
Tier specializations apply codec internally: `snapshotStorage<T>` calls `codec.encode(snapshot)` before `backend.write`, `codec.decode(bytes)` after `backend.read`. v1 envelope shape carries codec name + version for self-describing reads.

### Transaction model — "one wave = one transaction"

**Lifecycle hooks on `BaseStorageTier`:**
- `flush?()` — commit pending writes; called by framework at wave-close (or debounce-fire when `debounceMs > 0`).
- `rollback?()` — discard pending writes; called by framework on wave-throw per C.2 F policy.

**Tier internal contract:**
- `save(snapshot)` / `appendEntries(entries)` adds to in-memory buffer (does NOT persist immediately).
- Buffer cleared on `flush()` (via `backend.write`) or `rollback()`.
- If `debounceMs === 0` (sync tier): flush is synchronous; per-wave commit.
- If `debounceMs > 0`: flush deferred until debounce fires; buffer accumulates across waves.
- If `compactEvery: N`: flush forced every N buffered writes regardless of debounce.

**Framework integration:**
- After every wave (and `batch()` close), framework iterates attached tiers and calls `tier.flush()` (if exposed). Async flushes don't block wave-processing; errors surface via `options.onError`.
- On wave-throw (C.2 F rollback): framework calls `tier.rollback()` (if exposed) on every attached tier. Buffer discarded; no partial persistence.

**Cross-tier atomicity caveat (documented):**
- Each tier is its own transaction. If tier A flushes successfully and tier B fails, partial persistence results.
- Best-effort cross-tier consistency is the default. Users requiring strict atomicity build a transactional adapter that internally coordinates flush across multiple backends (e.g., a single SQL transaction wrapping snapshot + append).

**N-tier user freedom (per user directive 1):**
- Users decide tier count + ordering. No prescription.
- Common patterns documented:
  - Single-tier (just memory, just file, just SQLite, etc.).
  - 2-tier (memory + file).
  - 3-tier (memory + file + remote/IndexedDB).
  - Append-only (no snapshot, just AppendLog).
  - Snapshot-only (no append, just Snapshot).
  - Fan-out (same primitive's events go to BOTH snapshot AND append tiers — e.g., reactive-log might attach both an AppendLog tier for durability AND a Snapshot tier for fast restart).

### Cascade impact on Wave A/B/C locks

- **B.3 Unit 15 `JobQueueGraph.attachStorage(tiers)`** — locked: `(tiers: readonly AppendLogStorageTier<JobEvent>[]) => () => void`. Internally calls `events._log.attachStorage(tiers)` per Audit 1 wiring.
- **C.1 + C.3 `EventStoreAdapter` interface DELETED** (per user Q2 = yes; replaces C.3 Unit 23 lock):
  - `cqrs.useEventStore(adapter)` → `cqrs.attachEventStorage(tiers: readonly AppendLogStorageTier<CqrsEvent>[])`.
  - `MemoryEventStore` class deleted; replaced by `memoryAppendLog<CqrsEvent>()` factory (or any AppendLogStorageTier impl).
  - `EventStoreAdapter.persist*` / `loadEvents` / `persistStream` / `flush` / `stats` all subsumed by `AppendLogStorageTier<CqrsEvent>` shape.
  - `keyOf` provided internally by CqrsGraph: `(e) => \`${e.type}::${e.aggregateId ?? "__default__"}\``.
- **C.3 Unit 24 `projection.rebuild()` (folded per Unit 24 E)** — pagination via `tier.loadEntries({ cursor, pageSize, keyFilter })`.
  - **Cross-tier merge for rebuild** (per user Q5 = first-tier-wins, opt-in merge): default behavior loads from highest-priority tier (first in array) that has `loadEntries` support; subsequent tiers consulted only if `opts.mergeAcrossTiers: true` is set explicitly. Documented.
- **`Graph.attachStorage(tiers)`** (existing, COMPOSITION-GUIDE §27) — type tightens to `readonly SnapshotStorageTier<GraphCheckpointRecord>[]`; behavior unchanged. Reference adapters renamed:
  - `memoryStorage()` → `memorySnapshot()`.
  - `fileStorage(dir)` → `fileSnapshot(dir)`.
  - `sqliteStorage(path)` → `sqliteSnapshot(path)`.
  - `indexedDbStorage(spec)` → `indexedDbSnapshot(spec)`.
  - Pre-1.0 break; migration mechanical.
- **Audit 1 `bundle.attachStorage(tiers)`** signature filled: `(tiers: readonly AppendLogStorageTier<T>[]) => () => void`.

### Design invariants

- 🟢 §5.10 — async I/O at adapter boundary; sync tier interaction inside reactive flow.
- 🟢 §5.11 — debounce uses central clock per tier.
- 🟢 §24 — storage is sink, not edge. Reactive integration via reactive-log's `attach(upstream)` mechanism for AppendLog tiers; Graph snapshot tiers integrate via `Graph.attachStorage`. No invisible reactive edges.
- 🟢 §28 — `tier.load()` is sanctioned factory-time boundary read.
- 🟢 C.2 F — rollback-on-throw locked into `flush`/`rollback` lifecycle.

### LOC impact

- New module `core/storage` (or expand `extra/storage`): ~400 LOC.
  - `StorageBackend` interface + `Codec<T>` parameterization (~50).
  - `BaseStorageTier` + `SnapshotStorageTier<T>` + `AppendLogStorageTier<T>` interfaces (~30).
  - `snapshotStorage(backend, opts?)` + `appendLogStorage(backend, opts?)` factories (~80 each = 160).
  - 4 backend factories × ~30 LOC each = ~120.
  - 8 convenience factories × ~10 LOC each = ~80.
- `extra/reactive-log` integration (~50 LOC for `bundle.attachStorage`).
- `patterns/cqrs` migration (delete `EventStoreAdapter`/`MemoryEventStore` ~150 LOC; add `cqrs.attachEventStorage` + per-event-stream wiring ~80 LOC). Net ~−70 LOC.
- `patterns/job-queue` integration (`jobQueueGraph.attachStorage` ~30 LOC).
- Existing `Graph.attachStorage` adapters renamed (~0 net change; mechanical).
- Total: ~500 LOC added; ~150 LOC deleted; net +350 LOC for the storage layer.

### Open-question answers

- Q1 (split high-level + CQRS restructure per G — agree?): **F per user** — full layered design (G + bytes-level `StorageBackend` layer).
- Q2 (delete `EventStoreAdapter`?): **yes** per user.
- Q3 (codec parameterized to `Codec<T>`?): **yes** per user.
- Q4 (reference adapter factory pattern): **separate** factories per kind per backend (`memorySnapshot()`, `memoryAppendLog()`, etc.) — composition layer (`snapshotStorage(backend)`) also exposed for users who want to share backend instance.
- Q5 (cross-tier merge for rebuild): **first-tier-wins** by default; **opt-in merge via `opts.mergeAcrossTiers: true`** per user.

### Documentation requirements

1. COMPOSITION-GUIDE §27 expanded: layered architecture (backend + tier + wiring); both kinds (snapshot + append-log); transaction model (wave-as-transaction + debounce override); cross-tier atomicity caveat; N-tier patterns.
2. Migration note: pre-1.0 breaks for `EventStoreAdapter`, `MemoryEventStore`, reference graph adapter renames, codec interface parameterization.
3. Per-kind tier ordering rules:
   - Snapshot: hot first → cold last; on read, first-hit wins (existing Graph.attachStorage rule).
   - Append: hot first → cold last; on `loadEntries`, first-tier-wins by default (Q5 lock); merge opt-in.
4. Adapter authoring guide: implement `StorageBackend` for byte I/O; let `snapshotStorage` / `appendLogStorage` factories layer specialization on top; codec applied automatically.

### PY parity

- Mirror `StorageBackend`, `BaseStorageTier`, `SnapshotStorageTier[T]`, `AppendLogStorageTier[T]`, `snapshot_storage(backend, opts=None)`, `append_log_storage(backend, opts=None)`, convenience factories (`memory_snapshot()`, `file_snapshot(dir)`, etc.).
- PY async tier methods (`flush`, `rollback`, `save`, `appendEntries`, `loadEntries`) acceptable at adapter boundary per "no async def in public sync APIs" rule (storage is the runner-layer boundary).
- `Codec[T]` parameterization via TypeVar.
- `WeakKeyDictionary` for any tier-level memoization (cursors, etc.).

### Coverage of audit goals

- ✅ Snapshot vs append-log distinction respected (separate interfaces, both extend BaseStorageTier).
- ✅ Shared infra reused (codec + debounce + flush/rollback + tier ordering on BaseStorageTier).
- ✅ Bytes-level backend layer (per user F directive) — adapter ecosystem maximally reusable.
- ✅ N-tier flexibility (no prescribed combinations; user decides).
- ✅ Transaction model (wave-as-transaction) aligned with C.2 F rollback policy.
- ✅ Unified methods (flush, rollback) on BaseStorageTier.
- ✅ EventStoreAdapter deleted; CQRS unified with reactive-log persistence.
- ✅ Codec parameterized for any T.
- ✅ Cross-tier atomicity caveat documented.
- ✅ Reference adapter factories per user separation directive.


---

## Audit 2 — Imperative-controller-with-audit base class — LOCKED 2026-04-24

**Origin:** Five primitives across Wave A/B/C share the "imperative mutation with closure state + reactive audit log" pattern (gate, approval, JobQueue, CqrsGraph.dispatch, CqrsGraph.saga). Audit 2 unifies the machinery without forcing inheritance.

See chat transcript 2026-04-24 for full Q1–Q9.

**Locked decisions:**

### Architectural shape: G (library helpers in `patterns/_internal/imperative-audit.ts`; spec-level batch rollback; saga per-event-type cursor nodes; `.audit` property duplication; domain names retained; keyed storage everywhere)

1. **New module `patterns/_internal/imperative-audit.ts`** (~200 LOC):
   - `BaseAuditRecord` interface (shared `t_ns` + optional `seq`).
   - `AuditLogOpts` type.
   - `createAuditLog<R extends BaseAuditRecord>(opts): ReactiveLogBundle<R>` — wraps `reactiveLog` with audit defaults: `retainedLimit = 1024` per B.1, `guard = DEFAULT_AUDIT_GUARD` (deny external write), `withLatest()` activated, optional graph mount.
   - `wrapMutation<TArgs, TResult, R>(action, opts): wrapped action` — handles freeze (default true via `Object.freeze(structuredClone(args))`), batch wrap, audit emission on success/failure, rollback-on-throw integration, optional seq counter, optional PY `Lock` injection.
   - `registerCursor(graph, name, initial): Node<number>` — promotes a closure counter to a state node mounted under graph.
   - `registerCursorMap<K extends string>(graph, name, keys, initial?): { [K_ in K]: Node<number> }` — promotes a closure `Map<K, number>` to N state nodes (one per key); used by saga.
   - `DEFAULT_AUDIT_GUARD` constant (allow observe + signal; deny write).

2. **`.audit` is a property duplication, not a getter or method** (per user directive 2026-04-24):
   ```ts
   class JobQueueGraph<T> extends Graph {
     readonly events: ReactiveLogBundle<JobEvent<T>>;
     readonly audit: ReactiveLogBundle<JobEvent<T>>;     // = this.events; same reference
     
     constructor(name, opts) {
       super(name, opts.graph);
       this.events = createAuditLog<JobEvent<T>>({ ... });
       this.audit = this.events;                          // alias set once
       // ...
     }
   }
   ```
   - Same pattern across `gate.decisions / gate.audit`, `queue.events / queue.audit`, `cqrs.dispatches / cqrs.audit`, `saga.invocations / saga.audit`.
   - Multi-log primitives (CqrsGraph has `dispatches` + `aggregateEvictions`) — `.audit` aliases the PRIMARY log (`dispatches`); secondary logs accessed by name (`cqrs.aggregateEvictions`).
   - No getter overhead; no method-call ergonomics; clean readonly property.

3. **Saga cursor shape: per-event-type state nodes (option b):**
   ```ts
   const cursors = registerCursorMap(this, `${sagaName}::cursor`, eventNames, 0);
   // produces: this.cursors.orderPlaced, this.cursors.shipmentCreated, etc.
   // each is Node<number>; mounted under `<sagaName>::cursor::<eventName>` in describe.
   ```
   - Closure `lastCounts: Map<string, number>` deleted.
   - PY-thread-safe via per-state-node lock.
   - Each cursor visible in describe; consumers can subscribe to specific cursors.
   - SagaResult envelope `cursors` typed as `{ readonly [K in EventName]: Node<number> }` — typed by event-name keys at TS level.

4. **Cross-primitive method naming: domain-flavored retained + `.audit` alias** (per Q6 D direction):
   - `gateController.decisions / gateController.audit` — both `ReactiveLogBundle<Decision>`; same reference.
   - `queue.events / queue.audit` — both `ReactiveLogBundle<JobEvent<T>>`.
   - `cqrs.dispatches / cqrs.audit` — both `ReactiveLogBundle<DispatchRecord>`.
   - `saga.invocations / saga.audit` — both `ReactiveLogBundle<SagaInvocation>`.
   - Tools / generic inspectors traverse `.audit` for cross-primitive observability; users use domain-readable names.

5. **Audit-record schema: shared `BaseAuditRecord` + per-primitive extension:**
   ```ts
   interface BaseAuditRecord {
     readonly t_ns: number;
     readonly seq?: number;
   }
   
   // per-primitive (each extends BaseAuditRecord):
   interface Decision<T> extends BaseAuditRecord { action: "approve" | ...; count?, items?, unflushed? }
   interface JobEvent<T> extends BaseAuditRecord { action: "enqueue" | ...; id, attempts?, ... }
   interface DispatchRecord<T> extends BaseAuditRecord { commandName, payload, status, ... }
   interface SagaInvocation<T> extends BaseAuditRecord { eventType, event, status, ... }
   ```

6. **Rollback-on-throw mechanism (C.2 F implementation):**
   - **Library helper layer:** `wrapMutation` catches throws, calls `bundle.rollback()` (which discards pending wave emissions on the audit log), re-throws.
   - **Spec-level batch extension:** `core/batch.ts` extended so `batch(() => { ... })` automatically discards `pendingPhase2`/`pendingPhase3` queues on throw before re-throwing. Universal protection beyond our helpers.
   - **Implementation prerequisite:** verify `batch.ts` current behavior (does it already roll back?). If yes: document explicitly. If no: spec-level extension required. Test fixture exercises rollback across all 5 primitives.
   - **Failure record still committed:** `wrapMutation` separately commits a failure record (`{ status: "failed", error }`) AFTER rollback so audit trail captures the failed attempt. Distinct from in-band emissions that get rolled back.

7. **Keyed storage pattern extended to all primitives** (per user directive 2026-04-24):
   - `AppendLogStorageTier<T>.keyOf?: (entry: T) => string` (Audit 4 lock) supports partitioning for ANY audit log, not just CQRS.
   - Each primitive exports a recommended `keyOf` constant alongside its types:
     ```ts
     // patterns/orchestration:
     export const decisionKeyOf: (d: Decision<unknown>) => string = (d) => d.action;
     
     // patterns/job-queue:
     export const jobEventKeyOf: (e: JobEvent<unknown>) => string = (e) => e.action;
     
     // patterns/cqrs:
     export const dispatchKeyOf: (r: DispatchRecord) => string = (r) => r.commandName;
     export const sagaInvocationKeyOf: (i: SagaInvocation) => string = (i) => i.eventType;
     // (CQRS event store uses keyOf already locked: (e) => `${e.type}::${e.aggregateId ?? "__default__"}`)
     ```
   - Adapter authors / users use these as defaults:
     ```ts
     import { jobEventKeyOf } from "@graphrefly/graphrefly/patterns/job-queue";
     queue.events.attachStorage([
       fileAppendLog(".audit", { keyOf: jobEventKeyOf })
     ]);
     ```
   - Users can override with custom `keyOf` if their storage strategy differs (e.g., partition by `id` instead of `action`).
   - Documentation per primitive recommends the default `keyOf` and explains use cases (filtered queries, indexed columns in SQL, separate object stores in IndexedDB).

8. **`attachStorage(tiers)` integration via `ReactiveLogBundle<R>`:**
   - Pre-1.0 break: `gateController.decisions: Node<readonly Decision[]>` → `gateController.decisions: ReactiveLogBundle<Decision>`. Same for queue.events, cqrs.dispatches, saga.invocations.
   - Users access entries via `.entries` Node: `gate.decisions.entries.cache`. Or via `.audit.entries.cache`.
   - Storage attach via `gate.decisions.attachStorage([fileAppendLog(...)])` — directly on the bundle.
   - Consistent with all other reactive-log surfaces (Audit 1+4 alignment).

9. **Closure-state promotion to state nodes (cascade migrations):**
   - **`pipeline.gate`:** closure `queue: T[]` → `pending: reactiveList<T>` (state-node-backed); closure `torn: boolean` → `state<boolean>(false, { name: "torn" })`; closure `latestIsOpen: boolean` retained as sanctioned §28 seed.
   - **`JobQueueGraph`:** closure `_seq: number` → `registerCursor(this, "seq", 0)`.
   - **`CqrsGraph.dispatch`:** closure `_dispatchSeq: number` → `registerCursor(this, "dispatch_seq", 0)`.
   - **`CqrsGraph.saga`:** closure `lastCounts: Map<string, number>` → `registerCursorMap(this, "saga_<name>::cursor", eventNames, 0)`.

10. **PY parity:**
    - Mirror `patterns/_internal/imperative_audit.py` with same helpers.
    - `wrap_mutation` accepts `lock: threading.Lock` per primitive.
    - `register_cursor` / `register_cursor_map` mirror state-node creation.
    - Spec-level batch rollback verified or extended in `core/batch.py`.
    - Each primitive's recommended `keyOf` exported as `<primitive>_key_of` Python callable.

### Open-question answers

- Q1 (architectural shape): **G (library helpers, Shape C from Q5)** per user.
- Q2 (saga cursor): **option (b) per-event-type state nodes** per recommendation.
- Q3 (`.audit` shape): **property duplication** (not getter, not method) per user clarification — set as `this.audit = this.decisions;` in constructor.
- Q4 (spec-level batch rollback extension): **yes** per recommendation.
- Q5 (audit-log shape change): **yes — `Node<readonly R[]>` → `ReactiveLogBundle<R>`** pre-1.0 break.
- **Bonus:** keyed storage pattern + recommended `keyOf` per primitive — per user directive 2026-04-24.

### Cascade impact on Wave A/B/C locks

- **A.2 Unit 7 `pipeline.approval`** — alias inherits gate's audit log via `pipeline.gate({ approver, maxPending: 1 })` internal delegation. `approval.decisions === gate.decisions === ReactiveLogBundle<Decision>`.
- **A.2 Unit 8 `pipeline.gate`:**
  - `decisions: Node<readonly Decision[]>` → `decisions: ReactiveLogBundle<Decision>`.
  - Closure `queue: T[]` → `pending: reactiveList<T>` (state-node-backed).
  - Closure `torn: boolean` → `state<boolean>(false, { name: "torn" })`.
  - Mutation methods (`approve`, `reject`, `modify`, `open`, `close`) wrap via `wrapMutation` with `decisionKeyOf` recommended.
  - Add `decisionKeyOf` export.
  - `decisions / audit` property duplication.
- **B.3 Unit 15 `JobQueueGraph`:**
  - `events: Node<readonly JobEvent[]>` → `events: ReactiveLogBundle<JobEvent>`.
  - `_seq` closure → `registerCursor(this, "seq", 0)`.
  - All mutation methods (`enqueue`, `claim`, `ack`, `nack`) wrap via `wrapMutation` with `jobEventKeyOf` recommended.
  - Add `jobEventKeyOf` export.
  - `events / audit` property duplication.
- **C.2 Unit 20 `CqrsGraph.dispatch`:**
  - `dispatches: Node<readonly DispatchRecord[]>` → `dispatches: ReactiveLogBundle<DispatchRecord>`.
  - `_dispatchSeq` closure → `registerCursor(this, "dispatch_seq", 0)`.
  - `dispatch(name, payload, opts)` body wraps via `wrapMutation` with `dispatchKeyOf` recommended.
  - Add `dispatchKeyOf` export.
  - `dispatches / audit` property duplication.
- **C.3 Unit 22 `CqrsGraph.saga`:**
  - `invocations: Node<readonly SagaInvocation[]>` → `invocations: ReactiveLogBundle<SagaInvocation>`.
  - `lastCounts: Map<string, number>` closure → `registerCursorMap(this, "saga_<name>::cursor", eventNames)`.
  - SagaResult envelope `cursors: { readonly [K in EventName]: Node<number> }` — keyed by event name at TS level.
  - Per-event handler invocation wraps via `wrapMutation` with `sagaInvocationKeyOf` recommended; `errorPolicy` controls rollback behavior (`"advance"` → no rollback on per-event throw; `"hold"` → rollback cursor + retry).
  - Add `sagaInvocationKeyOf` export.
  - `invocations / audit` property duplication.

### Documentation

1. New section in COMPOSITION-GUIDE: "Imperative-controller-with-audit pattern" — explains library helpers, when to use, examples across the 5 primitives, `keyOf` recommendation per primitive, rollback-on-throw semantics (helper + spec-level batch).
2. Migration note: pre-1.0 breaks for `.decisions` / `.events` / `.dispatches` / `.invocations` shape. Users access entries via `.entries` instead of property directly. Storage attached via `.attachStorage(tiers)` on the bundle.
3. PY parity note: mirror module location, helper signatures, `keyOf` exports.

### LOC impact

- New module `patterns/_internal/imperative-audit.ts`: ~200 LOC.
- Spec-level batch rollback (if needed): ~20 LOC in `core/batch.ts`.
- Cascade migrations: net neutral (helpers absorb common code in each primitive).
- `keyOf` constants: ~5 LOC per primitive × 4 = ~20 LOC.
- Documentation (COMPOSITION-GUIDE + migration notes): non-code.
- Total: ~240 LOC added; ~150 LOC factored out from primitives (estimate; helpers absorb duplication).

### Coverage of audit goals

- ✅ Architectural shape — Library helpers (G).
- ✅ Saga cursor concrete shape — Per-event-type state nodes.
- ✅ Cross-primitive method naming — Domain names retained + `.audit` property alias.
- ✅ Audit-record schema — Shared `BaseAuditRecord`; per-primitive extension.
- ✅ Rollback-on-throw mechanism — Library helper + spec-level batch extension.
- ✅ `attachStorage` integration — Via `ReactiveLogBundle<R>` from Audit 1+4.
- ✅ Handler-as-node prep — `wrapMutation` accepts closure or node-wrapped (Audit 5 fills shape).
- ✅ §24 closure-state violations — promoted to state nodes uniformly (cursors, `_seq`, `_dispatchSeq`, `lastCounts`, `torn`, `queue`).
- ✅ §9a wave-coalescing — handled by `wrapMutation` internally (`appendMany` for audit log; `batch()` for cross-node coordination).
- ✅ Freeze-at-entry — opt-in via `wrapMutation({ freeze: true })` default.
- ✅ Keyed storage pattern — `keyOf` recommended per primitive; exports for adapter wiring.
- ✅ PY parity — mirrored helpers + lock injection.

---

## Audit 5 — Handler-as-node candidates — LOCKED 2026-04-24

**Origin:** Multiple Phase-4+ primitives hold logic in closure-held callbacks. Initial proposal (lift command + saga handlers; dual-form for catch + jobFlow work) was rejected per user critique 2026-04-24: "the only useful piece is versioning. The other parts are not uniformed, such as whether it's node or fn closure. I don't see much value of creating such ceremony."

See chat transcript 2026-04-24 for full Q1–Q9 + revision discussion.

**Honest accounting (per user critique):**
- **Hot-swap:** marginal value. Production hot-swap happens via deploy, not runtime mutation. Hot-swap atomicity has subtle issues (in-flight calls, version skew across replicas).
- **Structural compliance via describe edges:** marginal. Audit log (Audit 2) already provides the trace via record references.
- **Versioning:** HIGH value. Tracking "which version of the handler produced this output" matters for incident analysis, A/B testing, regression debugging.

The lift was carrying its weight only on versioning. Rest of ceremony (`RegisteredHandler` union type, `resolveHandler` runtime check, dual-form complexity, hot-swap atomicity contract) was paying for value users mostly don't need.

**Locked decisions: drop the lift entirely; add versioning as registration metadata.**

1. **No `RegisteredHandler<F>` type** — primitive registration types unchanged. Closure form only.
2. **No `registeredHandler(initial, opts)` helper** — not needed.
3. **No `resolveHandler(handler)` runtime check** — handlers are always functions.
4. **No `wrapMutation` handler-resolution extension** — Audit 2's `wrapMutation` stays as-locked.
5. **`handlerVersion?: { id: string; version: string | number }` opt added at registration** for primitives that emit audit records:
   ```ts
   // Command:
   cqrs.command("placeOrder", {
     handler: (payload, actions) => actions.emit("orderPlaced", { ... }),
     emits: ["orderPlaced"],
     handlerVersion: { id: "place-order", version: "1.2.0" },     // OPTIONAL
   });
   
   // Saga:
   cqrs.saga("orderProcessor", ["orderPlaced"], handler, {
     errorPolicy: "advance",
     handlerVersion: { id: "order-processor", version: "1.0.0" },
   });
   
   // jobFlow stage with work:
   jobFlow("pipeline", {
     stages: [
       { name: "process", work: workFn, handlerVersion: { id: "process-stage", version: "2.0.0" } },
     ],
   });
   
   // pipeline.catch:
   pipeline.catch("recover", src, recoverFn, {
     on: "error",
     handlerVersion: { id: "recover-strategy", version: "1.0" },
   });
   ```
6. **`BaseAuditRecord` extended with optional `handlerVersion?: { id: string; version: string | number }`** (per Audit 2's `BaseAuditRecord` definition):
   ```ts
   interface BaseAuditRecord {
     readonly t_ns: number;
     readonly seq?: number;
     readonly handlerVersion?: { id: string; version: string | number };  // NEW
   }
   ```
7. **Primitives stamp `handlerVersion` into audit records** when registered with the opt:
   - `DispatchRecord.handlerVersion` populated from `command(name, { handlerVersion })`.
   - `SagaInvocation.handlerVersion` populated from `saga(name, ..., { handlerVersion })`.
   - `JobEvent.handlerVersion` populated when work fn has version (per stage).
   - Decision (gate)? — gate has no "registered handler" beyond the per-call modify fn; no version stamp needed.
8. **Optional, opt-in for ALL primitives.** Users who don't care about versioning don't provide the field; audit records have no version stamp. Default behavior unchanged.
9. **Version IDs and version values are user-supplied strings/numbers.** No automatic hashing (cross-runtime flakiness). Conventions:
   - `id: string` — stable identifier (e.g., `"place-order-handler"`).
   - `version: string | number` — semver string (`"1.2.0"`) or build number (`42`).
10. **Hot-swap is OUT OF SCOPE.** Users who genuinely need runtime handler swap construct their own indirection in user code (e.g., `let currentHandler = v1; ... currentHandler = v2;` and reference inside the closure). Library doesn't provide a sanctioned mechanism.
11. **Replay-determinism preserved.** Projection reducer is unchanged (always a closure); no hot-swap risk.

### Cascade impact on Wave A/B/C locks (revised from prior Audit 5 proposal)

- **C.2 Unit 19 `command` registration shape** — `command(name, { handler, emits, handlerVersion? })`. Closure-only handler retained.
- **C.3 Unit 22 `saga` registration shape** — `saga(name, eventNames, handler, { aggregateId?, errorPolicy?, handlerVersion? })`. Closure-only handler retained.
- **A.2 Unit 10 `pipeline.catch` registration** — `pipeline.catch(name, src, recover, { on?, completeWhenDepsComplete?, handlerVersion? })`.
- **B.3 Unit 16 `jobFlow` stage shape** — `StageDef = { name, work?: WorkFn<T>, handlerVersion?: { id, version } }`.
- **A.2 Unit 8 `gate` controller methods** — no `handlerVersion` (per-call modify fn; no registered handler).
- **A.1 Unit 3 `pipeline.classify`** — pure predicate; no `handlerVersion` (low compliance value).
- **A.1 Unit 4 `pipeline.combine`** — pure reducer; no `handlerVersion`.
- **C.3 Unit 21 `projection` reducer** — pure reducer; replay-critical; no `handlerVersion` (must be deploy-time-pinned anyway).

### Open-question answers (revised)

- Q1 (per-candidate lift decisions): **NONE LIFTED** per user critique — closures everywhere; opt-in `handlerVersion` metadata only.
- Q2 (`RegisteredHandler<F>` envelope): **NOT NEEDED** — handlers are functions only.
- Q3 (`registeredHandler(initial, opts?)` helper): **NOT NEEDED**.
- Q4 (`BaseAuditRecord.handlerVersion` field): **YES** — opt-in trace via audit record.
- Q5 (versioning opt-in via `versioning: 0` on handler nodes): **NOT NEEDED** — handlers aren't nodes; version is registration metadata.

### Documentation

- COMPOSITION-GUIDE: brief section on "Versioning handlers via audit metadata" — explains opt-in `handlerVersion` field; how to use for incident analysis / A/B testing / regression debugging.
- Migration note: zero migration — closures are unchanged; `handlerVersion` is purely additive.
- Note that hot-swap is intentionally not a library feature; users construct their own indirection.

### LOC impact

- `BaseAuditRecord` extension: ~5 LOC.
- `handlerVersion?` opt added at 4 primitives' registration: ~5 LOC × 4 = ~20 LOC.
- Each primitive's audit-record emission populates `handlerVersion` from registration opt: ~5 LOC × 4 = ~20 LOC.
- Total: ~45 LOC. Down from ~115 LOC of the prior proposal.

### PY parity

- `BaseAuditRecord.handler_version` mirror.
- `command(...)`, `saga(...)`, etc. accept `handler_version: dict | None = None` (or `HandlerVersion` dataclass).
- Audit records stamp version when provided.

### Coverage of audit goals (revised)

- ✅ Versioning support — opt-in via registration metadata; surfaces in audit records.
- ✅ Replay-determinism — projection reducer untouched; cannot accidentally hot-swap.
- ✅ Zero ceremony at registration — closures unchanged; `handlerVersion` purely additive opt-in.
- ✅ Cross-primitive uniformity — same `handlerVersion: { id, version }` shape everywhere; same `BaseAuditRecord.handlerVersion` field.
- ✅ Hot-swap consciously NOT a feature — users build their own if needed.
- ❌ Structural compliance via describe edges — accepted as not worth the ceremony per user critique.
- ❌ Hot-swap library feature — accepted as not worth the ceremony.

### Trade-offs to weigh

- **Manual version updates:** users update `handlerVersion.version` on each handler change. If they forget, audit records have stale version info. Mitigation: lint rule / convention to update version alongside handler changes; or use build/CI-injected version (e.g., `handlerVersion: { id: "place-order", version: BUILD_SHA }` where `BUILD_SHA` is injected at build time).
- **No automatic hashing:** `fn.toString()` hashing was rejected as cross-runtime flaky. Manual is the price.
- **No hot-swap:** users wanting runtime swap construct their own (`let h = v1; ...; h = v2;` referenced from closure). Documented as out-of-scope but achievable.

---

## Audit 3 — Process manager pattern — LOCKED 2026-04-24

**Origin:** Sagas (C.3 Unit 22) handle sync side effects per event; `cqrs.command + dispatch` is one-shot. Real ES systems need a complementary primitive for **long-running async stateful workflows correlating events across aggregates with retries + compensation**. Audit 3 designs this primitive.

See chat transcript 2026-04-24 for full Q1–Q9.

**Locked decisions:** all five recommendations confirmed per user 2026-04-24.

### Architectural choice: F (reactive workflow primitive now; state-machine DSL post-1.0)

1. **Philosophy: reactive workflow over event nodes** (Q1: F). User writes `step(state, event)` async fn; framework handles correlation, retries, compensation, persistence. State-machine DSL deferred to post-1.0 if demand surfaces.

2. **Per-instance state via event-sourcing using C.1 E aggregates** (Q2). `correlationId` IS the `aggregateId` in a synthetic `_process_<name>_state` event type. Reuses existing CQRS persistence + replay safety + audit trail.

3. **Discriminated union step result** (Q3):
   ```ts
   type ProcessStepResult<TState> =
     | { kind: "continue"; state: TState; emit?: readonly { type: string; payload: unknown }[]; schedule?: ProcessSchedule }
     | { kind: "terminate"; state: TState; emit?: readonly { type: string; payload: unknown }[]; reason?: string }
     | { kind: "fail"; error: unknown };          // triggers compensation
   ```
   Explicit + type-safe + side-effect-event emission first-class.

4. **Retry policy at step level** (Q4): `retryMax?: number` + `backoffMs?: readonly number[]`. Defaults: no retry (single attempt). Users opt in.

5. **Compensation runs on step throw AND explicit cancel** (Q5): step `kind: "fail"` returns OR throws → compensate runs; `processManager.cancel(correlationId, reason?)` triggers compensate while running.

### API surface

```ts
// patterns/process/index.ts

export type ProcessStepResult<TState> =
  | { kind: "continue"; state: TState; emit?: readonly { type: string; payload: unknown }[]; schedule?: ProcessSchedule }
  | { kind: "terminate"; state: TState; emit?: readonly { type: string; payload: unknown }[]; reason?: string }
  | { kind: "fail"; error: unknown };

export type ProcessSchedule = { afterMs: number; eventType: string };

export type ProcessStep<TState, EM extends CqrsEventMap, K extends keyof EM & string> = (
  state: TState,
  event: CqrsEvent<EM[K]>,
) => NodeInput<ProcessStepResult<TState>>;     // sync OR Promise via fromAny

export type ProcessCompensate<TState> = (state: TState, error: unknown) => NodeInput<void>;

export interface ProcessManagerOpts<TState, EM extends CqrsEventMap> {
  readonly initial: TState;
  readonly watching: readonly (keyof EM & string)[];
  readonly steps: { [K in keyof EM & string]?: ProcessStep<TState, EM, K> };
  readonly compensate?: ProcessCompensate<TState>;
  readonly isTerminal?: (state: TState) => boolean;
  readonly retryMax?: number;
  readonly backoffMs?: readonly number[];
  readonly handlerVersion?: { id: string; version: string | number };  // per Audit 5
  readonly persistence?: {
    eventStorage?: readonly AppendLogStorageTier<ProcessEvent>[];
    stateStorage?: readonly SnapshotStorageTier<Map<string, TState>>[];
  };
}

export interface ProcessInstance<TState> {
  readonly correlationId: string;
  readonly state: TState;
  readonly status: "running" | "terminated" | "failed" | "compensated";
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly version?: { id: string; version: string | number };
}

export interface ProcessManagerResult<TState> {
  readonly instances: ReactiveLogBundle<ProcessInstance<TState>>;   // Audit 1+2
  readonly audit: ReactiveLogBundle<ProcessInstance<TState>>;       // alias = instances per Audit 2
  start(correlationId: string, initialPayload?: unknown): void;
  cancel(correlationId: string, reason?: string): void;
  getState(correlationId: string): TState | undefined;              // boundary read
}

export function processManager<TState, EM extends CqrsEventMap>(
  cqrs: CqrsGraph<EM>,
  name: string,
  opts: ProcessManagerOpts<TState, EM>,
): ProcessManagerResult<TState>;
```

### Internal architecture (implementation-session blueprint)

1. **Synthetic event types per process:**
   - `_process_<name>_state` — per-instance state events (event-sourced aggregate with `correlationId` as `aggregateId`).
   - `_process_<name>_timer` — scheduled timer events.
2. **`start(correlationId, payload?)`:**
   - Dispatches synthetic `ProcessStarted` event into `_process_<name>_state` stream with `correlationId` as `aggregateId`.
   - Initial state seeded from `opts.initial`.
3. **Watched-event subscription:**
   - For each `eventType` in `opts.watching`, subscribe to per-aggregate fan-in via Audit 1 `mergeReactiveLogs` — but filtered by `correlationId` matching this process instance's correlationId.
4. **Step execution on each matched event:**
   - Load instance state (from snapshot if available; else replay events for this correlationId).
   - Run `step(state, event)` via `fromAny` (sync or async).
   - On `ProcessStepResult.kind === "continue"`: emit StepCompleted + side-effect events; update state via state-event emission.
   - On `kind === "terminate"`: emit ProcessTerminated; archive instance.
   - On `kind === "fail"` OR step throws: run compensate via `fromAny(compensate(state, error))`; emit ProcessCompensated + ProcessFailed.
   - On `schedule` set: schedule timer via `fromTimer` (per spec §5.8) for `afterMs`; on fire, emit synthetic event of `eventType` into `_process_<name>_timer` stream filtered by correlationId.
5. **Retry handling:**
   - Wrap step in retry helper: on throw, retry up to `retryMax` times with `backoffMs[i]` delay between attempts.
   - Each retry attempt audited (status: "retrying" record).
6. **Compensation:**
   - User-supplied `compensate` runs side-effect undo (refund, cancel reservation, etc.).
   - Audit log captures compensation outcome.
7. **Persistence (opt-in):**
   - `opts.persistence.eventStorage` wires the per-process state event stream to tiers via `cqrs.attachEventStorage` per Audit 4.
   - `opts.persistence.stateStorage` wires snapshots via `Map<correlationId, TState>` to snapshot tiers.
8. **Audit:**
   - `instances: ReactiveLogBundle<ProcessInstance>` via Audit 2's `createAuditLog`.
   - `.audit` property alias per Audit 2.
   - Recommended `keyOf: (i) => i.correlationId` for keyed storage of instance audit per Audit 2.

### Cascade dependencies

- **C.1 E** per-aggregate streams (correlationId as aggregateId).
- **C.1 G** `correlationId` / `causationId` / `aggregateId` in `CqrsEvent` envelope.
- **Audit 1** `mergeReactiveLogs` for fan-in of watched events.
- **Audit 1** `withLatest` / `attach` for instance audit log.
- **Audit 2** `createAuditLog` + `wrapMutation` for instance state transitions.
- **Audit 4** `AppendLogStorageTier` + `SnapshotStorageTier` for persistence.
- **Audit 5** `handlerVersion` for step trace.
- **B.3** `fromAny` for sync/async step uniformity.
- **Spec §5.8** `fromTimer` for scheduled events.

### Differences from saga and jobFlow (documentation)

| Primitive | Sync/Async | Per-instance state | Cross-aggregate correlation | Timer/scheduling | Compensation | Use case |
|---|---|---|---|---|---|---|
| `cqrs.saga` | sync | none | aggregate filter (single) | none | error policy only | sync side effects per event |
| `jobFlow` | sync or async (work hook) | per-job | none | none | nack on error | linear queue chain pipelines |
| `processManager` | sync or async | per-correlation | yes (across aggregates) | yes | full compensation | long-running multi-step workflows |

### Open-question answers

- Q1 (philosophy): **F (reactive workflow now; DSL post-1.0)** per user.
- Q2 (state model): **event-sourcing via C.1 E synthetic aggregate** per user.
- Q3 (step result shape): **discriminated union** per user.
- Q4 (retry policy at step level): **yes** per user.
- Q5 (compensation on step throw + explicit cancel): **yes both** per user.

### Documentation

- COMPOSITION-GUIDE: "Process manager pattern" — full walkthrough with order-fulfillment example. Differences vs saga vs jobFlow.
- Migration path from manual saga + command + state workflows.
- PY parity note.

### LOC impact

- New module `patterns/process/index.ts`: ~300 LOC.
- Tests: ~150 LOC across happy-path + retries + compensation + cancellation + persistence.
- Documentation substantial.
- Total: +300 LOC code; +150 LOC tests.

### PY parity

- Mirror in `graphrefly.patterns.process`.
- Async step + compensate via `from_any`.
- Per-instance state via Python dataclass.
- Retry/timer via central clock.

### Coverage of audit goals

- ✅ Async step + compensate via `fromAny`.
- ✅ Per-instance state via event-sourcing (replay + snapshot).
- ✅ Cross-aggregate correlation via `CqrsEvent.correlationId`.
- ✅ Timer integration via reactive timer source.
- ✅ Retry policy at step level.
- ✅ Compensation on step failure + explicit cancel.
- ✅ Persistence reuses Audit 4 storage tiers.
- ✅ Audit log via Audit 2 helper.
- ✅ Versioning via Audit 5 `handlerVersion`.
- ✅ Type-safe via `CqrsGraph<EM>` event-map generic.
- ✅ Replay-determinism (process state derived from event log via pure reducer).

### Trade-offs to weigh

- **Synthetic event types pollute keyspace** — `_process_<name>_state`, `_process_<name>_timer` per process. Documented as framework-internal namespacing; users avoid event-type names starting with `_process_`. Tradeoff for replay safety.
- **State-machine validation deferred to post-1.0** — users with strict transition validation needs construct their own (e.g., switch on state.status inside step fn).
- **Cross-CqrsGraph correlation deferred to post-1.0** — process manager bound to a single CqrsGraph instance; distributed workflows post-1.0.
- **Event-store keyspace growth** — every active process has its own stream; LRU eviction via C.1 `maxAggregates` applies. Long-running process stores benefit from explicit archival (terminated processes can be excluded from snapshot scope).

---

# Final cross-cutting consolidation pass — 2026-04-24

**Review complete:** 22 units across Wave A/B/C + 5 post-Wave-C audits. All decisions locked. This section consolidates findings into an implementation-phase plan + PY parity notes + cross-cutting conventions + open follow-ups.

---

## Wave + Audit summary

### Wave A — Orchestration (10 units; A.1 + A.2 batches)

| Unit | Decision |
|---|---|
| 1 `pipeline` | Subclass `PipelineGraph extends Graph` with workflow-DAG sugar methods. |
| 2 `task` | Method on `PipelineGraph`; closure unwrap via `derived` reuse. |
| 3 `branch` | Replaced by `PipelineGraph.classify(name, src, (v) => tag)` n-way. |
| 4 `join` | Replaced by `PipelineGraph.combine(name, { a, b, c })` keyed-record. |
| 5 `subPipeline` | Deleted; use inherited `pipeline.mount(name, builderOrChild?)`. |
| 6 `sensor` | Moved to `extra/sources.ts` as `producer(name, initial?)`. |
| 7 `approval` | Method alias delegating to `pipeline.gate(src, { approver, maxPending: 1 })`. |
| 8 `gate` | Imperative controller + reactive `decisions` audit + batched + bounded. |
| 9 `loop` | Deleted. |
| 10 `onFailure` | Renamed to `pipeline.catch(name, src, recover, { on })` with dep-channel. |

### Wave B — Messaging + Job-Queue (6 units; B.1 + B.2 + B.3 batches)

| Unit | Decision |
|---|---|
| 11 `TopicGraph` | SENTINEL-aligned `lastValue: Node<T \| undefined>` via `withLatest()`; `retainedLimit = 1024` default; `publish(undefined)` throws; lazy keepalive; reactive-log `withLatest` helper. |
| 12 `SubscriptionGraph` | Drop `source` passthrough; `pullAndAck(limit)`; `{ from: "now" \| "retained" \| number }` + `{ advanceOn: signalNode }`; `dispose()`; `reactiveLog.fromCursor(cursorNode)` helper. |
| 13 `TopicBridgeGraph` | Reactive rewrite via `reactive-log.attach(upstream)` helper; `output` Node + `reactiveCounter`; `maxPerPump = 256`. |
| 14 `MessagingHubGraph` | `version: Node<number>` + `TopicRegistry` + facade split; PY `Lock` on lazy-create. |
| 15 `JobQueueGraph` | `events` audit log via `withLatest` + `appendMany` (multi-DATA); cursor state; PY lock; orphan via events filter; `attachStorage(tiers)`. |
| 16 `JobFlowGraph` | Reactive pump rewrite + per-stage `work` hook (`fromAny`) + `job_flow_path` accumulator + bounded `maxPerPump = 256` / `_completed retainedLimit = 1024`; `JobQueueGraph.consumeFrom(node)` queue-level method. |

### Wave C — CQRS (6 units; C.1 + C.2 + C.3 batches)

| Unit | Decision |
|---|---|
| 17 `CqrsEvent` envelope | Extended ES standard fields (`aggregateId`, `aggregateVersion`, `correlationId`, `causationId`, `metadata`); `Object.freeze(payload)` default; branded `EventStoreCursor<Shape>`; per-aggregate streams (E). |
| 18 `event(name)` | Baseline aligned with B.1 (retainedLimit, `withLatest`, payload freeze, describeKind fix); structural details (passthrough elimination via reactive-log `guard` option) — DEFERRED to Audit 1 (now locked: `guard` opt added). |
| 19 `command` | Type-level event validation via `CqrsGraph<EventMap>` generic; `command(name, { handler, emits })` object-bag; typing fixes; throw on duplicate. |
| 20 `dispatch` | C.1 opts plumbing; `freezeCommandPayload` default true; shared error hierarchy (`patterns/_internal/errors.ts`); `dispatches` audit log; `CqrsGraph.use(middleware)` chain; library-wide rollback-on-throw policy. |
| 21 `projection` | `mode: "replay" \| "scan"`; `snapshot: { load, save?, saveDebounceMs?, saveEvery? }`; merged-log fan-in via `mergeReactiveLogs`; aggregateId tertiary tie-break for cross-aggregate ordering; `freezeInputs` opt. |
| 22 `saga` | Per-event-type cursor state nodes via `registerCursorMap`; `invocations` audit log; `aggregateId` filter; `errorPolicy: "advance" \| "hold" \| { retryMax }`; type-level event constraints. |
| 23 `EventStoreAdapter` | DELETED (per Audit 4); CqrsGraph uses `AppendLogStorageTier<CqrsEvent>` directly. |
| 24 `rebuildProjection` | Folded into `projection.rebuild()` method; standalone removed; pagination via tier `loadEntries`; `projection.reset()` for snapshot reload. |

### Audits

| Audit | Locked decision |
|---|---|
| 1 reactive-log coherence | `view(spec)` consolidation; `mergeReactiveLogs` factory-level; `withLatest()` returns Node + meta companions; `guard` option; `LogBackend.snapshot/restore`; `attachStorage(tiers)` signature deferred to Audit 4. |
| 4 `attachStorage` scope | Three-layer architecture: `StorageBackend` bytes I/O + `BaseStorageTier` + `SnapshotStorageTier<T>` / `AppendLogStorageTier<T>`; one-wave-one-transaction; cross-tier atomicity best-effort; codec parameterized; reference adapters via separate factories per kind per backend; `EventStoreAdapter` deleted. |
| 2 imperative-controller-with-audit | Library helpers in `patterns/_internal/imperative-audit.ts`: `createAuditLog`, `wrapMutation`, `registerCursor`, `registerCursorMap`. Per-event-type saga cursor nodes. `.audit` property duplication. Domain-flavored audit names retained. Spec-level batch rollback extension. Recommended `keyOf` per primitive. |
| 5 handler-as-node | Closures everywhere; opt-in `handlerVersion: { id, version }` registration metadata; `BaseAuditRecord.handlerVersion` field; hot-swap consciously NOT a library feature. |
| 3 process manager | New `patterns/process/` primitive; reactive workflow over event nodes (Philosophy B); per-instance state via C.1 E synthetic aggregates; discriminated union step result; retry policy + compensation; reuses Audits 1+2+4+5. |

---

## Cross-cutting conventions finalized

These conventions span the whole codebase and apply to every primitive in Wave A/B/C + the audits. Implementation must enforce them uniformly:

1. **SENTINEL alignment per spec §5.12.** All "last-value" nodes typed `Node<T | undefined>` (not `Node<T | null>`). Companion `hasLatest: Node<boolean>` for disambiguation when `T` includes nullish.
2. **Bounded-default policy.** Every retention / pending / pump knob has a bounded default; `Infinity` is explicit opt-in only.
   - `gate.maxPending: 1000`
   - `TopicGraph.retainedLimit: 1024`
   - `SubscriptionGraph` cursor — N/A (windowed)
   - `TopicBridgeGraph.maxPerPump: 256`
   - `JobQueueGraph.events.retainedLimit: 1024`
   - `JobFlowGraph.maxPerPump: 256`, `_completed.retainedLimit: 1024`
   - CQRS event streams `retainedLimit: 1024` per stream
   - `CqrsGraph.dispatches.retainedLimit: 1024`
   - `CqrsGraph.maxAggregates: 10_000`
   - `SagaResult.invocations.retainedLimit: 1024`
   - `ProcessManagerResult.instances.retainedLimit: 1024`
3. **Freeze-at-entry policy.** All envelopes / payloads frozen at construction:
   - `JobEnvelope.metadata` (B.3)
   - `CqrsEvent.payload` via `freezeEventPayload: boolean` default true
   - `dispatch.payload` via `freezeCommandPayload: boolean` default true
   - `DispatchRecord.payload`
   - All audit records via `wrapMutation({ freeze: true })` default
4. **Shared error hierarchy** in `patterns/_internal/errors.ts` with `instanceof` checks across all primitives:
   - `GraphReFlyError` (base)
   - `DuplicateRegistrationError` (command, gate, queue, saga, projection)
   - `UndeclaredEmitError` (CQRS — runtime check in PY; compile-time in TS)
   - `OptimisticConcurrencyError` (CQRS dispatch)
   - `UnknownCommandError` (CQRS dispatch)
   - `CommandHandlerError` (wraps handler throw)
   - `TeardownError` (gate, queue, subscription post-dispose)
   - `RebuildError` (projection.rebuild)
5. **Audit log per imperative primitive** via `patterns/_internal/imperative-audit.ts`:
   - `gate.decisions` / `.audit`
   - `queue.events` / `.audit`
   - `cqrs.dispatches` / `.audit`
   - `cqrs.aggregateEvictions` (secondary; no aliasing)
   - `saga.invocations` / `.audit`
   - `processManager.instances` / `.audit`
   - All are `ReactiveLogBundle<R>` (not bare Nodes) — pre-1.0 API change.
6. **Library-wide rollback-on-throw policy** (C.2 F):
   - Every mutation method body wrapped via `batch()` rolls back deferred emissions on throw.
   - `core/batch.ts` extended to enforce universal rollback (or documented if already there).
   - `wrapMutation` helper handles rollback-after-failure-record-emission semantics.
7. **PY per-primitive `Lock` pattern** for free-threaded thread safety:
   - Gate (queue + torn + latestIsOpen)
   - Subscription (`pullAndAck` snapshot+advance)
   - TopicBridgeGraph (pump accumulator)
   - MessagingHubGraph (`topic()` lazy-create)
   - JobQueueGraph (mutation methods + `_seq`)
   - CqrsGraph (dispatch + outer; per-stream inner)
   - Saga (handler invocation + cursors)
   - ProcessManager (per-instance state transitions)
8. **Reactive-log helper set** (Audit 1):
   - `withLatest(): Node<readonly T[]>` (with meta.lastValue + meta.hasLatest)
   - `view(spec)` consolidated tail/slice/fromCursor
   - `attach(upstream): () => void`
   - `appendMany(values)` (existing)
   - `attachStorage(tiers)`
   - `mergeReactiveLogs(logs)` factory
   - `LogBackend.snapshot/restore`
   - `guard?: NodeGuard` option
9. **Storage three-layer architecture** (Audit 4):
   - Layer 1: `StorageBackend` bytes I/O.
   - Layer 2: `BaseStorageTier` + `SnapshotStorageTier<T>` + `AppendLogStorageTier<T>`.
   - Layer 3: high-level wiring (`Graph.attachStorage`, `reactiveLog.attachStorage`, `cqrsGraph.attachEventStorage`, `jobQueueGraph.attachStorage`).
   - One-wave-one-transaction; cross-tier atomicity best-effort.
   - Reference factories: `memorySnapshot()`, `memoryAppendLog()`, `fileSnapshot(dir)`, `fileAppendLog(dir)`, `sqliteSnapshot(path)`, `sqliteAppendLog(path)`, `indexedDbSnapshot(spec)`, `indexedDbAppendLog(spec)`. Plus composition layer `snapshotStorage(backend, opts?)` / `appendLogStorage(backend, opts?)`.
10. **Versioning metadata via `handlerVersion`** (Audit 5):
    - Opt-in registration field `{ id: string; version: string | number }`.
    - Stamped into audit records via `BaseAuditRecord.handlerVersion`.
    - Closures unchanged; no node lift.
11. **Recommended `keyOf` constants per primitive** for keyed storage:
    - `decisionKeyOf`, `jobEventKeyOf`, `dispatchKeyOf`, `sagaInvocationKeyOf`, `processInstanceKeyOf`.
12. **Type-level event-map registry** for CQRS (`CqrsGraph<EM extends CqrsEventMap>`):
    - Event names + payload types known at compile time when user provides EM.
    - Default `EM = Record<string, unknown>` for users without strict typing.
    - PY mirrors with runtime `UndeclaredEmitError` check.
13. **Per-aggregate event streams** (C.1 E):
    - `_eventLogs: Map<type, Map<aggregateId, EventEntry>>` two-level.
    - `event(type, aggregateId?)` dual-form (specific stream vs fan-in).
    - Per-stream `seq` + `aggregateVersion`.
    - `maxAggregates: 10_000` LRU eviction; `aggregateEvictions` observability.
14. **Imperative-controller envelope shape:**
    - Returns `ReactiveLogBundle<R>` for audit logs (not bare Node).
    - `.audit` property duplication (not getter, not method).
    - Mutation methods wrapped via `wrapMutation` from imperative-audit helper.

---

## Implementation phase ordering

The implementation session executes in this strict order (each phase depends on prior phases):

### Phase 0 — Spec + core extensions

1. **Verify `core/batch.ts` rollback-on-throw behavior.** If already present, document. If not, extend per C.2 F policy.
2. **Spec amendments** — confirm spec §5.12 SENTINEL conventions, §6.0b versioning, batch rollback semantics. Update `~/src/graphrefly/GRAPHREFLY-SPEC.md` if needed.

### Phase 1 — Storage layer (Audit 4 — foundation for everything else)

3. **`core/storage` (or `extra/storage`) module:**
   - `StorageBackend` interface.
   - `Codec<T>` parameterized; registry refactor.
   - `BaseStorageTier` + `SnapshotStorageTier<T>` + `AppendLogStorageTier<T>`.
   - `snapshotStorage(backend, opts?)` + `appendLogStorage(backend, opts?)` factories.
   - 4 backend factories (`memoryBackend`, `fileBackend`, `sqliteBackend`, `indexedDbBackend`).
   - 8 convenience factories (per kind per backend).
4. **Existing `Graph.attachStorage`** type tightens to `readonly SnapshotStorageTier<GraphCheckpointRecord>[]`.
5. **Reference adapter renames** — `memoryStorage` → `memorySnapshot`, etc.

### Phase 2 — Reactive-log helpers (Audit 1 — depends on Phase 1 for `attachStorage`)

6. **`extra/reactive-log` additions:**
   - `LogBackend.snapshot/restore` extension.
   - `guard?: NodeGuard` option.
   - `view(spec)` consolidation (drop `tail`/`slice`/`fromCursor` separate methods).
   - `withLatest()` returns Node with meta companions activated (lazy keepalive).
   - `attach(upstream): () => void`.
   - `mergeReactiveLogs(logs)` factory.
   - `attachStorage(tiers)` integration with Phase 1.
   - `appendAll` dropped (B.3 Unit 15 spec correction).

### Phase 3 — Imperative-audit helpers (Audit 2 — depends on Phase 2)

7. **`patterns/_internal/imperative-audit.ts` module:**
   - `BaseAuditRecord` with optional `handlerVersion` (Audit 5 integration).
   - `createAuditLog<R>(opts)` factory.
   - `wrapMutation<...>(action, opts)` helper with rollback + freeze + audit emission.
   - `registerCursor(graph, name, initial)`.
   - `registerCursorMap(graph, name, keys, initial?)`.
   - `DEFAULT_AUDIT_GUARD` constant.
8. **`patterns/_internal/errors.ts` shared error hierarchy.**

### Phase 4 — Wave A primitives (Orchestration — depends on Phase 3)

9. **Base `Graph` improvements (A.1 prerequisites):**
   - `WeakMap<Node, string>` populated by `Graph.add` for O(1) Node→path lookup.
   - `Graph.mount(name, builderOrChild?)` overload.
10. **`PipelineGraph` subclass** with methods `.task`, `.classify`, `.combine`, `.gate`, `.approval`, `.catch`, `.mount` (inherited).
11. **`gate` rewrite** with audit via `wrapMutation`; `decisions: ReactiveLogBundle<Decision>` envelope; `decisionKeyOf` export.
12. **`pipeline.catch` rewrite** as dep-channel intercept with modes `"error" | "complete" | "terminal"`.
13. **`pipeline.classify` n-way** (replacing binary `branch`).
14. **`pipeline.combine` keyed-record** (replacing `join`).
15. **Delete:** `pipeline()` factory (now subclass); `task / branch / join / subPipeline / sensor / approval / gate / loop / onFailure` factories. Update demos / tests.
16. **Move `sensor` → `producer`** in `extra/sources.ts`.

### Phase 5 — Wave B primitives (Messaging + Job-Queue — depends on Phase 4)

17. **`TopicGraph` rewrite** with `withLatest()`, `lastValue`, bounded `retainedLimit = 1024`, `publish(undefined)` throws.
18. **`SubscriptionGraph` rewrite** with dropped `source` passthrough, `pullAndAck`, `from` option, `advanceOn`, `dispose()`. Use `view({ kind: "fromCursor" })` from Phase 2.
19. **`TopicBridgeGraph` rewrite** using `reactiveLog.attach`; bounded `maxPerPump = 256`.
20. **`MessagingHubGraph` split** into `TopicRegistry` + facade; `version: Node<number>`; PY `Lock`.
21. **`JobQueueGraph` rewrite** with audit via `wrapMutation`; `events: ReactiveLogBundle<JobEvent>`; cursor state nodes; `consumeFrom(node)` method; `attachStorage(tiers)`; `jobEventKeyOf` export.
22. **`JobFlowGraph` rewrite** with reactive pump + per-stage `work` hook + `job_flow_path` accumulator.

### Phase 6 — Wave C primitives (CQRS — depends on Phase 5)

23. **`CqrsEvent<T>` envelope rewrite** with extended ES fields; `freezeEventPayload`; `_internal._v0`; branded `EventStoreCursor<Shape>`.
24. **`CqrsGraph<EM>` generic** — type-level event-map registry.
25. **Per-aggregate streams** — two-level `_eventLogs: Map<type, Map<aggregateId, EventEntry>>`; `event(type, aggregateId?)` dual-form; `maxAggregates` LRU; `aggregateEvictions` observability.
26. **`event(name)` baseline rewrite** using `reactiveLog([], { guard, retainedLimit, versioning })` + `withLatest()`. Passthrough eliminated via reactive-log `guard` option.
27. **`command(name, { handler, emits, handlerVersion? })`** with type-level event constraint; throw on duplicate; typing fix.
28. **`dispatch(name, payload, opts)`** with C.1 opts plumbing; `freezeCommandPayload`; error hierarchy; `dispatches: ReactiveLogBundle<DispatchRecord>` audit; `CqrsGraph.use(middleware)`.
29. **`projection`** with `mode: "replay" | "scan"`, `snapshot` opts, `mergeReactiveLogs` fan-in, aggregateId tie-break, `projection.rebuild()` + `projection.reset()` methods.
30. **`saga`** with per-event-type cursor state nodes; `invocations` audit; `aggregateId` filter; `errorPolicy`.
31. **Delete:** `EventStoreAdapter` interface; `MemoryEventStore` class; standalone `rebuildProjection` method.
32. **Add:** `cqrs.attachEventStorage(tiers)` method.

### Phase 7 — Process manager (Audit 3 — depends on Phase 6)

33. **New `patterns/process/index.ts` module.**
34. **`processManager(cqrs, name, opts)` factory.**
35. **Synthetic event types** (`_process_<name>_state`, `_process_<name>_timer`).
36. **Watched-event correlation** + step execution + retry + compensation + persistence wiring.

### Phase 8 — Documentation + tests + verification

37. **COMPOSITION-GUIDE updates:**
    - §27 expanded for storage three-layer architecture.
    - New section: imperative-controller-with-audit pattern.
    - New section: process manager pattern.
    - New section: handler versioning via audit metadata.
    - SENTINEL convention clarifications.
38. **Test fixtures:**
    - Lifecycle composition for reactive-log helpers (Audit 1).
    - Rollback-on-throw across all 5 primitives (C.2 F).
    - Per-aggregate stream behavior (C.1 E).
    - Storage tier interactions + transaction semantics (Audit 4).
    - Process manager full lifecycle (Audit 3).
39. **`exports.test.ts` updates** for new public symbols.
40. **`pnpm run build`** verification — `assertBrowserSafeBundles` enforces tier discipline.

### Phase 9 — PY parity (separate session)

41. **Mirror everything** in `graphrefly-py`. PY-specific concerns:
    - `threading.Lock` per primitive.
    - `WeakKeyDictionary` for memoization.
    - `dataclass(frozen=True)` for envelopes.
    - Async at adapter boundary OK; `a_` prefix for async public methods (`a_rebuild`, `a_reset`).
    - Runtime `UndeclaredEmitError` check (TS has compile-time).
    - `from_any` for sync-or-async work hooks.

---

## Total LOC impact

Estimates from individual locks:

| Module | Today | After | Net |
|---|---|---|---|
| `patterns/orchestration/` | 622 | ~450–500 | -120 to -170 |
| `patterns/messaging/index.ts` | 457 | ~320 | -137 |
| `patterns/job-queue/index.ts` | 249 | ~280 | +31 |
| `patterns/cqrs/index.ts` | 495 | ~600 | +105 |
| `patterns/process/index.ts` (new) | 0 | ~300 | +300 |
| `extra/reactive-log` | ~700 | ~970 | +270 |
| `core/storage` (new + refactor) | ~200 | ~600 | +400 |
| `patterns/_internal/imperative-audit.ts` (new) | 0 | ~200 | +200 |
| `patterns/_internal/errors.ts` (new) | 0 | ~60 | +60 |
| `extra/sources.ts` (sensor → producer) | -- | -- | ~0 |
| `core/batch.ts` (rollback extension if needed) | -- | -- | +20 |
| `core/node.ts` (WeakMap addition) | -- | -- | +30 |
| **Total (TS)** | ~2723 | ~3810 | **+1087 LOC** |

LOC growth is significant (+40%) but the new code is largely:
- Storage layer (+400) — substantial value, replaces deleted `EventStoreAdapter`.
- Reactive-log helpers (+270) — composition backbone.
- Process manager (+300) — entirely new primitive.
- Cross-cutting helpers (+260) — eliminate ~200 LOC of duplication.

Net new functionality: storage, reactive-log composition, process manager, audit infrastructure, error hierarchy, type-level CQRS, per-aggregate streams.

---

## Open follow-ups (post-1.0 candidates)

1. **State-machine DSL for process manager** (Audit 3, Philosophy A) — visual / explicit state transitions if demand surfaces.
2. **Distributed process correlation** — cross-CqrsGraph workflows.
3. **Op-log changesets for reactive data structures** (existing optimizations.md item) — incremental delta protocol.
4. **Persistent backend reference packages** (`@graphrefly/backends-rrb`, `@graphrefly/backends-hamt`) — RRB-tree / HAMT structural sharing.
5. **`view(spec)` extension** — `{ kind: "filter", pred }`, `{ kind: "windowByTime", ms }`, etc.
6. **Reactive `subscription.advanceOn` for dispatches** — autopilot ack; deferred from B.1.
7. **Bytes-level `StorageBackend` ecosystem** — adapter authors share I/O code across snapshot+append.
8. **Multi-aggregate dispatch optimistic concurrency** — current lock is single-primary-aggregate per dispatch.
9. **State-machine validators / lints** — opt-in tools to verify process state transitions.
10. **`projection.snapshot.save` adapter integration** with full `attachStorage(tiers)` semantics — seamless persistence.

---

## Decisions log (final, full chronological)

- 2026-04-24 | A.1 framing | Shrink orchestration via `PipelineGraph` subclass methods; eliminate redundant factories.
- 2026-04-24 | A.1 Units 1–6 locked | Subclass + methods + delete subPipeline + move sensor.
- 2026-04-24 | A.2 Units 7–10 locked | Unify approval into gate; gate gets audit log; delete loop; rewrite onFailure as catch.
- 2026-04-24 | B.1 Units 11–12 locked | TopicGraph SENTINEL + bounded + strict; SubscriptionGraph drops source + adds pullAndAck + from + advanceOn + dispose; reactive-log withLatest + fromCursor helpers.
- 2026-04-24 | B.2 Units 13–14 locked | Bridge reactive rewrite via reactive-log attach; hub split into TopicRegistry + facade.
- 2026-04-24 | B.3 Units 15–16 locked | JobQueue events audit + cursor state + attachStorage + consumeFrom; JobFlow reactive pump + work hook + job_flow_path; multi-DATA emission pattern preferred over batch.
- 2026-04-24 | C.1 Units 17–18 locked | Per-aggregate streams; ES standard envelope fields; freeze; branded cursor; event(name) deferred to Audit 1 outcome.
- 2026-04-24 | C.2 Units 19–20 locked | Type-level event validation via CqrsGraph<EM>; dispatches audit; middleware chain; library-wide rollback-on-throw policy.
- 2026-04-24 | C.3 Units 21–24 locked | Projection mode + snapshot + merged fan-in; saga full spec; EventStoreAdapter deleted via Audit 4; rebuildProjection folded into projection.rebuild().
- 2026-04-24 | Audit 1 locked | Reactive-log helpers consolidated; view(spec); withLatest meta companions; mergeReactiveLogs; guard; LogBackend snapshot/restore; appendAll dropped.
- 2026-04-24 | Audit 4 locked | Three-layer storage architecture; one-wave-one-transaction; EventStoreAdapter deleted; codec parameterized; separate factories per kind per backend.
- 2026-04-24 | Audit 2 locked | Library helpers (no inheritance); per-event-type saga cursors; .audit property duplication; spec-level batch rollback; recommended keyOf per primitive.
- 2026-04-24 | Audit 5 locked | Closures everywhere; opt-in handlerVersion registration metadata; hot-swap consciously not a library feature.
- 2026-04-24 | Audit 3 locked | Process manager primitive; reactive workflow over event nodes; per-instance event-sourcing via C.1 E; discriminated step result; retry + compensation.

---

## Review status: COMPLETE

22 units + 5 audits across orchestration, messaging, job-queue, CQRS, plus storage / audit-log / handler-versioning / process-manager design. All decisions locked and ready for implementation in ~9 phases.

**Implementation triggers:** the user can now ask in a fresh session to implement specific phases. Recommended grouping for implementation sessions:

- **Session 1: Phase 0 + 1 + 2** (spec + core extensions + storage + reactive-log helpers) — foundational.
- **Session 2: Phase 3** (imperative-audit helpers + error hierarchy).
- **Session 3: Phase 4** (Wave A — orchestration).
- **Session 4: Phase 5** (Wave B — messaging + job-queue).
- **Session 5: Phase 6** (Wave C — CQRS).
- **Session 6: Phase 7** (process manager).
- **Session 7: Phase 8** (docs + tests + verification).
- **Session 8: Phase 9** (PY parity, separate repo).

Each session follows `/dev-dispatch` discipline: planning → user approval → implementation → tests → lint/build green.


