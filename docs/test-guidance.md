# Test guidance (cross-language)

Guidelines for writing, organizing, and maintaining tests in both **graphrefly-ts** and **graphrefly-py**. Read this before adding tests. **Behavioral authority:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` (and `docs/roadmap.md` for scope).

---

## Guiding principles

1. **Verify before fixing.** Every "bug" is a hypothesis until a test fails. Write the test first when possible.
2. **Source + spec over old tests.** If a test disagrees with `~/src/graphrefly/GRAPHREFLY-SPEC.md` or the implementation’s intended semantics, fix the test or the code — the spec wins for GraphReFly.
3. **Test what the code should do.** Express correct semantics; failures are real bugs or spec gaps.
4. **One concern per test.** Each `it()` / `test_*` should assert one behavior; avoid bundling unrelated scenarios.
5. **Protocol-level assertions.** Prefer helpers that record **`[[Type, Data?], ...]`** sequences (and, when implemented, **`Graph.observe()`**) over ad-hoc sinks. See §Observation below.
6. **Predecessor reference.** TS: **`~/src/callbag-recharge`**. PY: **`~/src/callbag-recharge-py`**. Use for **ideas and edge cases**; map assertions to GraphReFly message types, not legacy callbag numeric types.
7. **Authority hierarchy:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` → `docs/roadmap.md` → implementation when spec is silent.

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
│   └── integrations/   # cross-layer or interop
├── core/
├── graph/
└── extra/
```

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

### Design invariant violations

From **GRAPHREFLY-SPEC §5.8–5.12**:

- [ ] **No polling:** Operators and sources must not use `setInterval`/`time.sleep` loops to poll node values. Test that reactive push propagation is the only update mechanism.
- [ ] **No leaked internals:** Phase 4+ APIs must not expose protocol internals (`DIRTY`, `RESOLVED`, bitmask) in error messages or return types visible to end users.
- [ ] **Async boundary isolation:** Async boundaries (timers, I/O, promises/coroutines) belong in sources and runners, never inside node `fn` callbacks. Test that node fns remain synchronous.

### Python-specific test axes

- [ ] **Thread safety:** Where APIs claim thread-safe `get()` / propagation, stress with multiple threads (see roadmap 0.4).
- [ ] **Concurrent `get()` without torn reads** — independent subgraphs updated without deadlock.
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

## Debugging: `describe()` and `status` first, `get()` second

`node.get()` and `graph.get(name)` return the **cached value only** — they do not guarantee freshness, do not trigger computation, and return `undefined` for nodes that have never received DATA. This is by design (spec §2.2).

**When a node returns an unexpected value, check its status before investigating the value:**

```ts
// Single node — use node.status directly
const nd = graph.node("myNode");
console.log(nd.status);  // "disconnected" | "dirty" | "settled" | "errored" | ...

// All nodes at once — use describe()
const desc = graph.describe({ detail: "standard" });
// Each node in desc.nodes has { type, status, value, deps, ... }
```

| Status | `get()` returns | What it means |
|--------|----------------|---------------|
| `disconnected` | Last known value or `undefined` | Node has no subscribers — derived nodes are lazy |
| `dirty` | Previous value (stale) | DIRTY received, waiting for DATA |
| `settled` | Current value (fresh) | DATA received, value is current |
| `resolved` | Current value (fresh) | Was dirty, value confirmed unchanged |
| `errored` | Last good value or `undefined` | `fn` or `equals` threw — check `observe()` for the ERROR |
| `completed` | Final value | Terminal — no further updates |

**Common pitfall:** `get()` returning `undefined` on a derived node almost always means the node is `disconnected` (no subscribers activating it) or `errored` (computation threw). Both look identical from `get()` alone. `describe()` or `node.status` distinguishes them instantly.

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

## Authority hierarchy (tests)

1. **`~/src/graphrefly/GRAPHREFLY-SPEC.md`**
2. **`docs/roadmap.md`** (scope / phase)
3. Implementation in `src/` when spec is silent — then consider spec clarification

**RxJS / callbag** are useful **comparisons** only; GraphReFly may differ where the spec says so.
