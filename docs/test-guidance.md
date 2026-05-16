# Test guidance (cross-language)

Guidelines for writing, organizing, and maintaining tests in both **graphrefly-ts** and **graphrefly-py**. Read this before adding tests. **Behavioral authority:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` (and `docs/roadmap.md` for scope).

---

## Guiding principles

1. **Verify before fixing.** Every "bug" is a hypothesis until a test fails. Write the test first when possible.
2. **Source + spec over old tests.** If a test disagrees with `~/src/graphrefly/GRAPHREFLY-SPEC.md` or the implementation’s intended semantics, fix the test or the code — the spec wins for GraphReFly.
3. **Test what the code should do.** Express correct semantics; failures are real bugs or spec gaps.
4. **One concern per test.** Each `it()` / `test_*` should assert one behavior; avoid bundling unrelated scenarios.
5. **Protocol-level assertions.** Prefer helpers that record **`[[Type, Data?], ...]`** sequences (and, when implemented, **`Graph.observe()`**) over ad-hoc sinks. See §Observation below.
6. **Authority hierarchy:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` → `docs/roadmap.md` → implementation when spec is silent.

---

## Runner and layout

### TypeScript

- **Runner:** Vitest (`pnpm test`). Config: `vitest.config.ts`.
- **Discovery:** `src/**/*.test.ts` (includes `src/__tests__/**/*.test.ts`).

```
src/
├── __tests__/
│   ├── core/           # protocol, node, batch, sugar, diamonds
│   ├── graph/          # Graph add/connect/mount/describe/observe/snapshot
│   ├── extra/          # operators, sources (tier 1 / tier 2)
│   ├── properties/     # property-based protocol invariants (fast-check)
│   └── integrations/   # cross-layer or interop
├── core/
├── graph/
└── extra/
```

**Property-based suite (`src/__tests__/properties/`):** invariant catalog driven by `fast-check`. Add a new invariant by appending an entry to `_invariants.ts`'s `INVARIANTS` registry — the test file iterates it automatically. Generators live in `_generators.ts`. Background and sequencing in `archive/docs/SESSION-rigor-infrastructure-plan.md` § "Project 1".

#### Property-based protocol invariants

**Property-based protocol invariants** live in `src/__tests__/properties/_invariants.ts` as an `INVARIANTS` registry. The runner at `protocol-invariants.test.ts` iterates the registry — adding a new invariant means appending one entry `{ name, specRef, generator, property, numRuns? }`.

Reproduce a counter-example with `FC_SEED=<n> pnpm test -- src/__tests__/properties` (fast-check prints the seed in every failure report).

Each invariant should map to a `specRef` pointing into `GRAPHREFLY-SPEC.md` (e.g. `§1.3 invariant 7`) — the registry doubles as the LLM-readable substrate contract.

#### Ghost-state invariants via `RigorRecorder`

TLA+-ghost invariants (cleanup witness, terminal classification, batch idle-gate) have no first-class runtime surface. Fast-check mirrors for those invariants attach an opt-in `RigorRecorder` to an **isolated `GraphReFlyConfig`** so each property run captures its own ghost log without leaking state across runs.

Shape: construct a fresh config via `new GraphReFlyConfig({ onMessage: defaultConfig.onMessage, onSubscribe: defaultConfig.onSubscribe })` + `registerBuiltins(cfg)`, attach `cfg.rigorRecorder = { onNonVacuousInvalidate, onTerminalTransition }`, then pass `config: cfg` to every node in the test topology. The helper `createRigorLoggedConfig()` at `_invariants.ts` encapsulates this. See invariants #54–#57 for canonical examples.

Guardrail: tests that filter the log by node identity (`log.witnesses.filter(w => w.node === d)`) MUST precede the filter with a non-vacuous length check against the raw log (`log.witnesses.length >= expected`). Otherwise a future `Node<T>` refactor that wraps the return value in a Proxy / façade silently breaks the identity compare and every invariant passes vacuously.

### Subscriber-throw contract

**Subscriber callbacks must not throw.** There are two distinct error paths to keep straight:

| Source of throw | Isolation? | Effect |
|---|---|---|
| **Node `fn` throws** (the compute body of a `derived`/`effect`/`producer`) | Yes — framework-handled | Node emits `[[ERROR, err]]` downstream; node transitions to `errored` status; terminal per §1.3.4. Downstream operators (`retry`, `fallback`, `withStatus`) may catch. |
| **External subscriber callback throws** (the function passed to `node.subscribe(cb)`) | **No** | Throw propagates out of `emit()`. Any subscribers registered after the thrower in the callback list miss the in-flight wave. |

If your subscriber callback may throw (e.g. it writes to a DOM, flushes to disk, posts to a service) **wrap your own try/catch** and surface the error through your own channel. The protocol deliberately doesn't swallow subscriber throws — silent swallowing would hide bugs, and the framework doesn't know your tolerance. Node-fn errors are different: the protocol handles those as ERROR messages, because that's part of the message semantic.

Property-based coverage: invariant 8 (`throw-recovery-consistency`) asserts that a throwing subscriber doesn't corrupt the node's cache/version. It deliberately does NOT assert sibling-subscriber delivery — that would contradict the contract above.

### Python

- **Runner:** pytest (`uv run pytest`). Config: `pyproject.toml`.
- **Discovery:** `tests/test_*.py`.

```
tests/
├── conftest.py              # shared fixtures
├── test_smoke.py            # package / import sanity
├── test_protocol.py         # message types, invariants, batch semantics (Phase 0.2)
├── test_core.py             # node primitive, sugar, diamond, lifecycle (Phase 0.3+)
├── test_concurrency.py      # locks, threads, free-threaded concerns (Phase 0.4)
├── test_graph.py            # Graph container (Phase 1)
├── test_guard.py            # Actor, guard, policy (Phase 1.5)
├── test_extra_tier1.py      # sync operators (Phase 2.1)
├── test_extra_tier2.py      # async/dynamic operators (Phase 2.2)
└── test_regressions.py      # regression suite
```

**Rule:** Add new tests to the narrowest existing file; create a new file only when the area is clearly separate.

### Rust (`graphrefly-rs`)

- **Runner:** `cargo-nextest` — `cargo nextest run` for the fast inner loop (the `cascade_depth` stack-safety stress tests are quarantined out of the default profile; see `graphrefly-rs/.config/nextest.toml`), `cargo nextest run --profile ci` (alias `cargo tc`) for the full suite incl. those guards (this is what CI runs and what gates a merge). `scripts/dev-test.sh` wraps the default loop with a per-worktree `CARGO_TARGET_DIR` so parallel sessions never block on the shared `target/` build lock. **Legacy `cargo test` is fallback-only** and does not honor the nextest profiles (it always runs everything, with no slow-timeout hang-kill). **Exception:** loom concurrency tests stay on `cargo test -p graphrefly-core --features loom-checked` (loom needs the `--cfg loom` build, not a nextest run). Config: per-crate `Cargo.toml` + workspace `.config/nextest.toml`.
- **Discovery:** `crates/*/tests/*.rs` (integration tests) + `#[test]` in `src/` (unit tests).

```
crates/
├── graphrefly-core/tests/        # protocol, node, batch, diamond, lifecycle
├── graphrefly-graph/tests/       # Graph mount, describe, observe, snapshot, signal
├── graphrefly-operators/tests/   # operators, sources, producers, higher-order
│   └── common/mod.rs             # shared test infrastructure (see below)
├── graphrefly-storage/tests/     # WAL, tiers, graph integration, restore
└── graphrefly-structures/tests/  # reactive data structures
```

#### Two-layer test architecture (handle protocol boundary)

Rust tests mirror the handle protocol split between Core and the binding layer:

| Layer | Asserts on | Where | Why |
|-------|-----------|-------|-----|
| **Core** (`graphrefly-core`) | `HandleId`, `Message`, `NodeId` | `crates/graphrefly-core/tests/` | Core sees only opaque `HandleId` tokens — no user values. Tests verify message routing, batching, lifecycle. |
| **Operators** (`graphrefly-operators`) | `TestValue`, `RecordedEvent` | `crates/graphrefly-operators/tests/` | Operator semantics require value visibility — "did `map` transform 1→2?" Raw `HandleId` assertions would be opaque and fragile. |

#### Test infrastructure (`tests/common/mod.rs`)

The operators crate provides shared test helpers:

- **`TestValue`** — small enum (`Int(i64)`, `Str(String)`, `Pair(…)`, `Tuple(…)`) that serves as the user-facing `T` type in the binding's value registry.
- **`InnerBinding`** — implements both `BindingBoundary` and `OperatorBinding`. Maintains a `HandleId ↔ TestValue` registry with refcounting, plus closure registries for projectors, predicates, folders, packers, etc.
- **`OpRuntime`** — glues `Core` + `InnerBinding` together. Provides convenience methods: `intern_int(n)`, `state_int(initial)`, `emit_int(node, n)`, `subscribe_recorder(node)`.
- **`Recorder`** / **`RecordedEvent`** — sink that resolves `HandleId` → `TestValue` at record time, producing readable assertions:

```rust
let rec = rt.subscribe_recorder(node);
assert_eq!(rec.events(), vec![
    RecordedEvent::Start,
    RecordedEvent::Dirty,
    RecordedEvent::Data(TestValue::Int(42)),
    RecordedEvent::Complete,
]);
// Or extract just data values:
assert_eq!(rec.data_values(), vec![TestValue::Int(42)]);
```

**When to use `events()` vs `data_values()`:** Use `events()` when testing lifecycle ordering (Dirty before Data, Start/Complete presence). Use `data_values()` when only the transformed values matter and lifecycle events are noise.

**Producer tests:** `subscribe_recorder(node)` triggers the producer's build closure synchronously (first subscriber activates the producer). Assert on the recorder immediately after — no async wait needed for cold/sync producers.

---

## What to test — core protocol & node

From **GRAPHREFLY-SPEC** §1 and §2:

- [ ] **Message shape:** emissions are arrays of tuples `[Type, data?]` (no single-tuple shorthand at API boundaries you control).
- [ ] **DIRTY before DATA/RESOLVED** when two-phase push applies; **batch** defers DATA, not DIRTY.
- [ ] **RESOLVED** when value unchanged per `equals` — downstream skips recompute where specified.
- [ ] **Diamond:** shared ancestor → derived node runs **once** per upstream change after all deps settle.
- [ ] **ERROR** from `fn` → `[[ERROR, err]]` downstream; **COMPLETE** / **ERROR** terminal rules.
- [ ] **Unknown types** forward (forward-compat).
- [ ] **Meta** keys behave as subscribable nodes when present.

### Push-on-subscribe (Spec v0.2)

All nodes with a cached value push `[[DATA, cached]]` to new subscribers synchronously during `subscribe()`. Key implications for tests:

- **Use `node<T>()` (SENTINEL) when you don't want initial push.** `state(v)` and `node({initial: v})` push on subscribe; bare `node<T>()` has no cached value and does not push.
- **No DIRTY precedes the initial push.** Two-phase `DIRTY → DATA` ordering applies to *updates*, not the initial cached push.
- **Terminal nodes do not push.** After `COMPLETE` or `ERROR`, push-on-subscribe is skipped (§1.3.4).
- **Compat adapters suppress the initial push** where the external library's API contract says "no immediate call" (nanostores `listen`, jotai/zustand/signals `subscribe`).

### Design invariant violations

From **GRAPHREFLY-SPEC §5.8–5.12**:

- [ ] **No polling:** Operators and sources must not use `setInterval`/`time.sleep` loops to poll node values. Test that reactive push propagation is the only update mechanism.
- [ ] **No leaked internals:** Phase 4+ APIs must not expose protocol internals (`DIRTY`, `RESOLVED`, bitmask) in error messages or return types visible to end users.
- [ ] **Async boundary isolation:** Async boundaries (timers, I/O, promises/coroutines) belong in sources and runners, never inside node `fn` callbacks. Test that node fns remain synchronous.

### Python-specific test axes

- [ ] **Thread safety:** Where APIs claim thread-safe `.cache` reads / propagation, stress with multiple threads (see roadmap 0.4).
- [ ] **Concurrent `.cache` reads without torn reads** — independent subgraphs updated without deadlock.
- [ ] **Under load:** DIRTY/DATA ordering invariants hold under concurrent writes.
- [ ] **Free-threaded Python 3.14:** Tests should pass with GIL disabled.
- Always use **timeouts** and **liveness assertions** on thread joins where threads might block.

---

## What to test — Graph

From **§3** (see `src/__tests__/graph/graph.test.ts`, `validate-describe-appendix-b.ts`, `describe-appendix-b.schema.json`):

- [x] add/remove/connect/disconnect; edges are **wires only** (no transforms on edges).
- [x] `describe()` matches expected shape (see spec Appendix B); with actor, hidden nodes and dependent edges/subgraphs are omitted.
- [x] `observe(name?)` / `observe({ actor })` — message stream for tests and debugging; `GuardDenied` when the actor cannot observe.
- [x] `signal()`, `destroy()`, snapshot round-trips as specified.
- [x] **Guard (roadmap 1.5):** `set`/`signal` vs `write`/`signal` actions, meta inheriting primary guard, `lastMutation`, internal TEARDOWN bypass, `policy()` allow/deny order.

---

## What to test — extra operators

Tier **1** (sync-style): happy path, DIRTY propagation, RESOLVED when suppressing duplicate value, error/complete propagation, reconnect, diamond where applicable. For **`merge`**, assert **`COMPLETE` only after every inner source has completed** (spec §1.3.5, same as multi-dep passthrough).

Tier **2** (async / dynamic): same plus teardown (timers, inner subs), reconnect freshness, races called out in spec/roadmap.

---

## Observation patterns

### Until `Graph.observe()` exists

Use a small test helper or the future public API to collect ordered message arrays from a node subscription. Assert on:

- **Order:** e.g. `DIRTY` before `DATA` in a two-phase push.
- **Counts:** how many `DIRTY` / `DATA` / `RESOLVED` per scenario.
- **Terminal:** `COMPLETE` or `ERROR` and no further emissions.

### With `Graph.observe()`

Prefer **`graph.observe(name)`** (or per-node) for live streams — see **GRAPHREFLY-SPEC §3.6**. This replaces a separate “Inspector-only” observe path: the Graph is the introspection layer.

**Note:** `graph.set()` forwards **`[[DATA, value]]` only** to the node; observers on a **state** source may not see a preceding `DIRTY`. For **two-phase** ordering (`DIRTY` then `DATA`), assert on a **derived** (or other dep-backed) node after an upstream `set`, or call `node.down()` with an explicit batch.

---

## Shared test helpers

Both repos provide a unified `collect` helper for subscribing to a node and recording messages. Use `collect` instead of manual `sink.append` / inline lambdas.

### API

**TypeScript** (`src/__tests__/test-helpers.ts`):
```ts
import { collect } from "../test-helpers.js";

const { messages, unsub } = collect(node);                      // batches, no START
const { messages, unsub } = collect(node, { flat: true });      // flat messages, no START
const { messages, unsub } = collect(node, { raw: true });       // batches including START
const { messages, unsub } = collect(node, { flat: true, raw: true }); // flat including START
```

**Python** (`tests/conftest.py` — auto-discovered by pytest):
```python
batches, unsub = collect(node)                        # batches, no START
msgs, unsub = collect(node, flat=True)                # flat messages, no START
batches, unsub = collect(node, raw=True)              # batches including START
msgs, unsub = collect(node, flat=True, raw=True)      # flat including START
```

### When to use which mode

| Mode | Use when |
|------|----------|
| `collect(n)` (default) | Most tests — asserts on batch structure after updates |
| `collect(n, flat=True)` | Adapter tests asserting on ordered message sequences |
| `collect(n, raw=True)` | Tests verifying START handshake behavior |
| `collect(n, flat=True, raw=True)` | Full protocol trace including START |

### When to stay inline

Keep custom sinks inline when doing type-only, value-only, or filtered extraction (e.g. `msgs.filter(m => m[0] === DATA).map(m => m[1])`). The `collect` helper collects raw message tuples — transform after collection.

---

## Debugging: `describe()` and `status` first, `.cache` second

`node.cache` and `graph.get(name)` return the **cached value only** — they do not guarantee freshness, do not trigger computation, and return `undefined` for nodes that have never received DATA. This is by design (spec §2.2).

**When a node returns an unexpected value, check its status before investigating the value:**

```ts
// Single node — use node.status directly
const nd = graph.node("myNode");
console.log(nd.status);  // "sentinel" | "pending" | "dirty" | "settled" | "errored" | ...

// All nodes at once — use describe()
const desc = graph.describe({ detail: "standard" });
// Each node in desc.nodes has { type, status, value, deps, ... }
```

| Status | `.cache` returns | What it means |
|--------|----------------|---------------|
| `sentinel` | `undefined` | No subscribers (compute node cache cleared) or never set |
| `pending` | `undefined` | Subscribed but fn hasn't run yet — SENTINEL dep blocking first-run gate |
| `dirty` | Previous value (stale) | DIRTY received, waiting for DATA |
| `settled` | Current value (fresh) | DATA received, value is current |
| `resolved` | Current value (fresh) | Was dirty, value confirmed unchanged |
| `errored` | Last good value or `undefined` | `fn` or `equals` threw — check `observe()` for the ERROR |
| `completed` | Final value | Terminal — no further updates |

**Common pitfall:** `.cache` returning `undefined` on a derived node almost always means the node is `sentinel` (no subscribers activating it) or `pending` (a SENTINEL dep blocking the first-run gate) or `errored`. All three look identical from `.cache` alone. `node.status` or `describe()` distinguishes them instantly.

**In tests:** When asserting derived node values, always subscribe first (via `graph.observe(name).subscribe(...)` or an effect) to activate the lazy computation chain. Then check the value. If the value is still unexpected, assert on `status` to diagnose.

---

## Inspection tools in tests

When debugging composed factories (Phase 4+), use profiling utilities to snapshot graph state rather than adding ad-hoc console.logs:

```ts
import { graphProfile } from "../../graph/profile.js";
import { harnessProfile } from "../../patterns/harness/profile.js";

// Snapshot before and after an operation
const before = graphProfile(graph);
// ... perform operation ...
const after = graphProfile(graph);

// Check for memory growth, runaway subscribers, stuck nodes
expect(after.totalValueSizeBytes).toBeLessThan(100_000);
expect(after.hotspots[0].status).toBe("settled");
```

For harness-specific debugging, `harnessProfile` adds queue depths, strategy entries, and retry/reingestion tracker sizes — these immediately reveal unbounded counters or runaway loops.

**Isolate first:** When a test OOMs or times out, run it alone (`npx vitest run -t "test name"`) before investigating. Multiple test instances of the same factory can obscure the signal.

---

## Diamond resolution pattern

```ts
// Conceptual shape (API names may differ until implemented)
// A → B, A → C, D depends on [B, C]
// expect: D updates once per A change, correct final value
```

Always assert **both** recompute count **and** final value.

---

## RESOLVED / skip pattern

When upstream emits **RESOLVED** (unchanged value), downstream should **not** spuriously recompute — assert with counters on dependent nodes/effects.

---

## Error and completion

- Errors propagate as **`ERROR`**; do not swallow as completion.
- After **COMPLETE** or **ERROR**, no further messages from that node unless **resubscribable** (opt-in).

---

## Regression tests

When fixing a confirmed bug, add a **regression test** with a short comment:

```ts
// Regression: <one-line description>. Spec: GRAPHREFLY-SPEC §x.x
```

Do not delete regression tests without explicit reason.

---

## Running tests

**TypeScript:**
```bash
pnpm test
npx vitest run -t "test name"    # single test
```

**Python:**
```bash
uv run pytest
uv run pytest tests/test_core.py
uv run pytest tests/test_core.py::test_name -v
uv run pytest -x
```

---

## Async tests and runner selection (PY)

When writing async tests (`async def test_*`) in Python:

- **Use the conftest `_ThreadRunner` (default).** It spawns a thread per coroutine
  via `asyncio.run()`. This avoids the blocking-bridge deadlock described in
  COMPOSITION-GUIDE §14 — `first_value_from()` blocks the test thread while the
  coroutine completes in a separate thread.

- **Do NOT use `AsyncioRunner.from_running()` in tests that exercise factories
  with blocking bridges** (promptNode, tool handlers, harness pipeline). The
  `AsyncioRunner` schedules work on the test's event loop, but `first_value_from`
  blocks that same thread — deadlock.

- **Reactive waits in async tests:** Replace `time.sleep` polling loops with
  `asyncio.Future` signaled by a reactive subscription:

  ```python
  async def test_something() -> None:
      loop = asyncio.get_running_loop()
      ready: asyncio.Future[None] = loop.create_future()

      def _on_update(msgs: object) -> None:
          for msg in msgs:
              if msg[0] is MessageType.DATA and my_condition():
                  if not ready.done():
                      loop.call_soon_threadsafe(ready.set_result, None)

      unsub = target_node.subscribe(_on_update)
      try:
          await asyncio.wait_for(ready, timeout=5.0)
      finally:
          unsub()
  ```

  `call_soon_threadsafe` is needed because the subscription callback may fire from
  a runner thread (not the event loop thread). Push-on-subscribe (§2.2) ensures the
  callback fires immediately if the node already holds the value — no race condition.

---

## Mock LLM adapters must be async

Real LLM SDKs (OpenAI, Anthropic) return async iterables from their streaming APIs — token delivery requires network I/O. Test mock adapters **must match this async behavior** so tests validate the actual reactive chain (thread runner → `from_async_iter` → `switch_map`), not a synchronous shortcut that hides timing bugs.

### Invariant

- **`adapter.stream()` must be `async def` (PY) / return `AsyncIterable` (TS).** Sync list/generator returns bypass the async runner path and mask push-on-subscribe race conditions.
- **`adapter.invoke()` may remain sync** — single-shot invocation doesn't involve streaming infrastructure.

### Test assertion pattern

Because the stream runs in a background thread, tests **cannot** assert results immediately after `subscribe()`. Use reactive wait helpers instead of `time.sleep`:

**TypeScript:**
```ts
// Subscribe resolves via Promise when a non-null DATA arrives
const result = await new Promise<string>((resolve) => {
  handle.output.subscribe((msgs) => {
    for (const [type, data] of msgs) {
      if (type === DATA && data != null) resolve(data);
    }
  });
});
expect(result).toBe("Hello world!");
```

**Python:**
```python
# _wait_for_result uses threading.Event — no polling
result = _wait_for_result(handle.output)
assert result == "Hello world!"

# For gate count or custom conditions, use a predicate:
_wait_for_result(handle.gate.count, predicate=lambda v: v >= 1)
```

The `_wait_for_result` helper handles push-on-subscribe correctly — if the value is already cached when `subscribe()` fires, it returns immediately without blocking.

### Symmetry — tool handlers also opt into the async / signal-aware shape

The same async-end-to-end principle applies to `ToolDefinition.handler`. Real handlers that own I/O (`fetch`, child processes, DB queries) should opt into the `(args, opts?: { signal?: AbortSignal })` shape so `switchMap`-supersede inside the agent loop actually cancels in-flight work — sync handlers in tests mask the cancellation chain the same way sync `adapter.stream` mocks mask the streaming chain. See [§ Tool handlers should thread `signal`](#tool-handlers-should-thread-signal) below.

---

## Tool handlers should thread `signal`

The `ToolDefinition.handler` signature widened to accept an optional second arg — `(args, opts?: { signal?: AbortSignal }) => NodeInput<unknown>`. Existing handlers that ignore `opts` still work unchanged; handlers that own real I/O (`fetch`, child processes, DB queries, long-running generation) should opt in so `switchMap`-supersede inside the agent loop actually cancels in-flight work.

### Why it matters

`ToolRegistryGraph.executeReactive(name, args)` returns a producer node. Each call mounts a per-invocation `AbortController`; on producer teardown the controller's `abort()` fires, propagating into:

- `fromPromise(p, { signal })` — rejects the inner promise when signal aborts.
- `fromAsyncIter(it, { signal })` — breaks the async iteration on signal abort.
- The handler itself when it threads `signal` into its own `fetch(url, { signal })` / DB cancel call / child-process kill.

Inside `toolExecution`, `switchMap` cancels the prior inner producer whenever a new tool-call batch supersedes — without `signal` in the handler, the network request keeps running and burns budget for a result that no consumer will read.

### Handler shape

```ts
const fetchTool: ToolDefinition = {
  name: "fetch",
  description: "...",
  parameters: { type: "object", properties: { url: { type: "string" } } },
  // Threading `signal` into fetch propagates supersede-cancellation
  // all the way through the wire request.
  handler: async ({ url }, { signal } = {}) => {
    const resp = await fetch(url as string, { signal });
    return await resp.text();
  },
};
```

### Test pattern

Handlers under test should assert that an aborted signal short-circuits the work. The `tool-registry` regression test at [src/__tests__/patterns/ai/tool-registry.test.ts](../src/__tests__/patterns/ai/tool-registry.test.ts) drives the producer's unsubscribe path and asserts `signal.aborted === true` was observed inside the handler. New signal-aware handlers should mirror that pattern: subscribe to `executeReactive`, unsubscribe before the handler resolves, then assert the handler saw an abort.

### When `signal` is optional vs required

- **Optional:** in-process pure transforms, file reads small enough to be effectively synchronous, registry lookups. The tool returns before supersede has a chance to fire — adding `signal` plumbing is dead code.
- **Required:** anything network-bound or process-bound. Without `signal`, an agent that retries / supersedes leaks request budget.

---

## Authority hierarchy (tests)

1. **`~/src/graphrefly/GRAPHREFLY-SPEC.md`**
2. **`docs/roadmap.md`** (scope / phase)
3. Implementation in `src/` when spec is silent — then consider spec clarification

**RxJS** is a useful **comparison** only; GraphReFly may differ where the spec says so.
