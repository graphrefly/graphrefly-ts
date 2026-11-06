# Batch 17 — Output Type Consistency Audit (TS + Py)

Scope: `docs/audit-plan.md` checklist items 1-6 (lines 1041-1106), auditing listed files in:

- `graphrefly-ts/src/core`, `src/graph`, `src/extra`, and barrel exports
- `graphrefly-py/src/graphrefly/core`, `graph`, `extra`, and package exports

Invariant under audit:

> Every public function returns `Node<T>`, `Graph`, `void`/`None`, or plain synchronous values.
> `Promise`/`Awaitable`/`Future` are only allowed as user escape hatches leaving reactive-land.

---

## 1) Public Return Types

### TypeScript

- CORRECT (`src/core/sugar.ts:22`) — `state(...) -> Node<T>`
- CORRECT (`src/core/sugar.ts:44`) — `producer(...) -> Node<T>`
- CORRECT (`src/core/sugar.ts:66`) — `derived(...) -> Node<T>`
- CORRECT (`src/core/sugar.ts:93`) — `effect(...) -> Node<unknown>`
- CORRECT (`src/core/batch.ts:75`) — `batch(...) -> void`
- CORRECT (`src/core/node.ts:908`) — `node(...) -> Node<T>`
- CORRECT (`src/graph/graph.ts:286`) — `Graph` class container
- CORRECT (`src/extra/operators.ts:43`) — operators return `Node<...>` (same pattern through file)
- CORRECT (`src/extra/sources.ts:84`) — source constructors return `Node<...>` (same pattern through file)
- CORRECT (`src/extra/checkpoint.ts:205`) — `saveGraphCheckpoint(...) -> void`
- CORRECT (`src/extra/checkpoint.ts:218`) — `restoreGraphCheckpoint(...) -> boolean` (plain sync query)

- CORRECT (`src/extra/sources.ts:656`) — `firstValueFrom(...) -> Promise<T>` exists as explicit user escape hatch.

### Python

- CORRECT (`src/graphrefly/core/sugar.py:13`) — `state(...) -> Node[Any]`
- CORRECT (`src/graphrefly/core/sugar.py:18`) — `producer(...) -> Node[Any]`
- CORRECT (`src/graphrefly/core/sugar.py:23`) — `derived(...) -> Node[Any]`
- CORRECT (`src/graphrefly/core/sugar.py:28`) — `effect(...) -> Node[Any]`
- CORRECT (`src/graphrefly/core/node.py:813`) — `node(...) -> Node[...]`
- CORRECT (`src/graphrefly/core/protocol.py:158`) — `batch() -> Generator[None]` context-manager effect (no awaitable return API)
- CORRECT (`src/graphrefly/graph/graph.py:165`) — `Graph` class container
- CORRECT (`src/graphrefly/extra/tier1.py:27`) — tier1 operators return `PipeOperator` (`Node -> Node`)
- CORRECT (`src/graphrefly/extra/tier2.py:112`) — tier2 operators return `PipeOperator` or `Node`
- CORRECT (`src/graphrefly/extra/checkpoint.py:161`) — `save_graph_checkpoint(...) -> None`
- CORRECT (`src/graphrefly/extra/checkpoint.py:168`) — `restore_graph_checkpoint(...) -> bool`
- CORRECT (`src/graphrefly/extra/sources.py:400`) — `first_value_from(...) -> Any` synchronous bridge (escape hatch, non-reactive plain return)

### Violations

- No `VIOLATION` found for public APIs returning `Promise<T>`/`Awaitable`/`Future` in the audited module set.

---

## 2) Adapter Interfaces

- CORRECT (`src/extra/checkpoint.ts:51`) — `CheckpointAdapter.save(...) -> void`, `load() -> GraphPersistSnapshot | null` (sync contract).
- CORRECT (`src/graphrefly/extra/checkpoint.py:31`) — `CheckpointAdapter.save(...) -> None`, `load() -> dict | None` (sync contract).

- CORRECT (`src/extra/checkpoint.ts:253`) — IndexedDB request adapter returns `Node<T>`.
- CORRECT (`src/extra/checkpoint.ts:287`) — IndexedDB transaction adapter returns `Node<void>`.

No adapter signature returns `Promise`/`Awaitable` in the audited checkpoint contracts.

---

## 3) Internal Promise/Future Usage Classification

### TypeScript

- BOUNDARY (`src/extra/sources.ts:274`) — `Promise.resolve(p).then(...)` inside `fromPromise`, immediately wrapped as `Node<T>`.
- BOUNDARY (`src/extra/sources.ts:330`) — `Promise.resolve(it.next()).then(...)` inside `fromAsyncIter`, immediately wrapped as `Node<T>`.
- BOUNDARY (`src/extra/sources.ts:350`) — `Promise.resolve(it.return?.())` cleanup in async-iter adapter.
- BOUNDARY (`src/extra/sources.ts:656`) — `new Promise(...)` in `firstValueFrom` user bridge.

### Python

- BOUNDARY (`src/graphrefly/extra/sources.py:211`) — `from_awaitable(...)` wraps awaitable into `Node`.
- BOUNDARY (`src/graphrefly/extra/sources.py:218`) — internal `async def arun` used only inside bridge adapter.
- BOUNDARY (`src/graphrefly/extra/sources.py:255`) — `from_async_iter(...)` wraps async iterable into `Node`.
- BOUNDARY (`src/graphrefly/extra/sources.py:262`) — internal `async def arun` for async iterable bridge.

### Coordination violations

- No COORDINATION violations found (no internal waiting/racing via Promise/Future for reactive coordination in audited production sources).

---

## 4) Callback Parameter Types (fromAny-style flexibility)

- CORRECT (`src/extra/operators.ts:1142`) — `switchMap` project callback returns `NodeInput<R>` (supports node/sync/promise/iterable/async iterable via `fromAny`).
- CORRECT (`src/extra/operators.ts:1221`) — `exhaustMap` same flexibility.
- CORRECT (`src/extra/operators.ts:1302`) — `concatMap` same flexibility.
- CORRECT (`src/extra/operators.ts:1404`) — `mergeMap` same flexibility.
- CORRECT (`src/extra/sources.ts:381`) — `fromAny` dispatcher accepts heterogeneous inputs.

- CORRECT (`src/graphrefly/extra/tier2.py:33`) — `_as_node(...)` routes mapper outputs through `from_any`.
- CORRECT (`src/graphrefly/extra/tier2.py:113`) — `switch_map(fn: Callable[[Any], Any])` accepts broad callback outputs.
- CORRECT (`src/graphrefly/extra/tier2.py:198`) — `concat_map` callback similarly broad.
- CORRECT (`src/graphrefly/extra/tier2.py:295`) — `flat_map` callback similarly broad.
- CORRECT (`src/graphrefly/extra/sources.py:299`) — `from_any` handles Node/AsyncIterable/Awaitable/iterable/scalar.

No Promise-only callback surface found.

---

## 5) Cross-Repo Consistency

- INCONSISTENCY (`src/extra/sources.ts:656` vs `src/graphrefly/extra/sources.py:400`) — `firstValueFrom` escape hatch returns `Promise<T>` in TS but synchronous blocking value (`Any`) in Py.
  - Classification: acceptable API-shape divergence for language ergonomics; both are explicit bridges out of reactive-land.
  - Impact: docs should clarify this difference for cross-language users.

- No inconsistency found where one repo returns reactive (`Node`) and the other returns `Awaitable/Future` for equivalent core/operator/checkpoint APIs.

---

## 6) `firstValueFrom` / `first_value_from` Escape Hatch

- CORRECT (`src/extra/index.ts`) — TS exports `firstValueFrom` as user-facing escape hatch (via `export * from "./sources.js"`).
- CORRECT (`src/graphrefly/extra/__init__.py:56`) — Py exports `first_value_from` as user-facing escape hatch.

- CORRECT (TS internal usage audit) — no production internal calls to `firstValueFrom(...)` under `src/` outside its own implementation/docs comments.
- CORRECT (Py internal usage audit) — no production internal calls to `first_value_from(...)` for reactive coordination in audited sources.

---

## Final Verdict

- No direct return-type violations of the core invariant were found in the audited public APIs.
- Internal async/Promise constructs are confined to boundary adapters and the explicit user bridge.
- One cross-repo divergence exists in escape-hatch shape (`Promise` in TS vs blocking sync in Py), but both remain outside reactive core APIs and do not violate the invariant.
