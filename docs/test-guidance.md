# Test guidance (graphrefly-ts)

Guidelines for writing, organizing, and maintaining tests. Read this before adding tests. **Behavioral authority:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` (and `docs/roadmap.md` for scope).

---

## Guiding principles

1. **Verify before fixing.** Every "bug" is a hypothesis until a test fails. Write the test first when possible.
2. **Source + spec over old tests.** If a test disagrees with `~/src/graphrefly/GRAPHREFLY-SPEC.md` or the implementation’s intended semantics, fix the test or the code — the spec wins for GraphReFly.
3. **Test what the code should do.** Express correct semantics; failures are real bugs or spec gaps.
4. **One concern per test.** Each `it()` should assert one behavior; avoid bundling unrelated scenarios.
5. **Protocol-level assertions.** Prefer helpers that record **`[[Type, Data?], ...]`** sequences (and, when implemented, **`Graph.observe()`**) over ad-hoc sinks. See §Observation below.
6. **Predecessor reference.** **`~/src/callbag-recharge`** has extensive tests (Inspector, operators, diamonds). Use for **ideas and edge cases**; map assertions to GraphReFly message types (`DATA`, `DIRTY`, `RESOLVED`, `COMPLETE`, `ERROR`, etc.), not legacy callbag numeric types.

---

## Runner and layout

- **Runner:** Vitest (`pnpm test`). Config: `vitest.config.ts`.
- **Discovery:** `src/**/*.test.ts` (includes `src/__tests__/**/*.test.ts`).

Recommended layout as the codebase grows (aligned with `docs/roadmap.md`):

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

- [ ] **No polling:** Operators and sources must not use `setInterval` or timer loops to poll node values. Test that reactive push propagation is the only update mechanism.
- [ ] **No leaked internals:** Phase 4+ APIs must not expose protocol internals (`DIRTY`, `RESOLVED`, bitmask) in error messages or return types visible to end users.
- [ ] **Async boundary isolation:** Async boundaries (timers, I/O, promises) belong in sources and runners, never inside node `fn` callbacks. Test that node fns remain synchronous.

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

## Authority hierarchy (tests)

1. **`~/src/graphrefly/GRAPHREFLY-SPEC.md`**
2. **`docs/roadmap.md`** (scope / phase)
3. Implementation in `src/` when spec is silent — then consider spec clarification

**RxJS / callbag** are useful **comparisons** only; GraphReFly may differ where the spec says so.
