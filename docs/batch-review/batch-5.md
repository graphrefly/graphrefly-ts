# Batch 5: Python Internal API Pattern Consistency Audit

**Scope:** `graphrefly-py` source files (no tests)
**Date:** 2026-03-29
**Auditor:** Claude Opus 4.6

---

## 1. CORE PRIMITIVES — Construction Pattern

### 1a. `node()` — function

**CONSISTENT** — `node()` is a factory function (`node.py:789–830`) returning `NodeImpl[Any]`.
`NodeImpl` is a generic class (`node.py:154`). Same pattern as TS (`node()` function → `NodeImpl<T>` class).

### 1b. `state()`, `derived()`, `producer()`, `effect()`, `pipe()` — all functions

**CONSISTENT** — All are plain functions in `sugar.py:13–38`. Same as TS `sugar.ts`.

### 1c. `batch()` — context manager function

**CONSISTENT** — `batch()` is a `@contextmanager` generator (`protocol.py:119–149`), used as `with batch():`. TS uses `batch(fn)` callback. This divergence is **justified by Python idioms** — context managers are the Pythonic equivalent of callback-scoped resource management. Matches spec §6.1 requirement.

### 1d. `Graph` — class

**CONSISTENT** — `Graph` is a class (`graph.py:118`). Same as TS.

---

## 2. PYTHON IDIOMS

### 2a. snake_case / PascalCase naming

**CONSISTENT** — Functions use `snake_case` throughout (`down_with_batch`, `distinct_until_changed`, `take_while`, `partition_for_batch`). Classes use `PascalCase` (`NodeImpl`, `Graph`, `MessageType`, `GuardDenied`, `ReactiveMapBundle`). Type aliases use `PascalCase` (`PipeOperator`, `NodeFn`, `BackoffStrategy`).

### 2b. `batch()` uses context manager

**CONSISTENT** — `protocol.py:119–149`. Usage: `with batch(): ...`. Per spec §6.1.

### 2c. `pipe` supports `|` operator

**CONSISTENT** — `NodeImpl.__or__` at `node.py:781–786` implements `left | op` for unary `(Node) -> Node` operators. Per spec §4.1.

### 2d. Resource cleanup via context managers

**CONSISTENT** — `subgraph_locks.py:152` (`lock_for`), `subgraph_locks.py:236` (`acquire_subgraph_write_lock_with_defer`), `graph.py:173` (`_locked`), `protocol.py:119` (`batch`) all use `@contextmanager`. Node cleanup uses callable return values from compute functions (same as TS).

---

## 3. EXTRA OPERATORS

### 3a. Consistent signature pattern across tier1 and tier2

**CONSISTENT** — Unary operators consistently return `PipeOperator` (i.e. `Callable[[Node], Node]`): `map`, `filter`, `scan`, `reduce`, `take`, `skip`, `take_while`, `take_until`, `debounce`, `throttle`, `delay`, `switch_map`, `concat_map`, `flat_map`, `exhaust_map`, `retry`, `rate_limiter`, etc. Multi-source operators (`combine`, `merge`, `zip`, `race`) return `Node` directly. This split is documented in `tier1.py:1–8` and matches TS.

### 3b. Curried-vs-direct pattern

**CONSISTENT** — Python uses the same curried pattern as TS: `map(fn)` returns a `PipeOperator`, not `map(source, fn)`. This is not the most "Pythonic" style (Python typically prefers direct calls), but it's **justified** because the spec's `pipe` composition (`pipe(src, map(fn), filter(pred))`) requires curried operators, and the `|` operator support benefits from it too.

### 3c. All return Node

**CONSISTENT** — All tier1/tier2 operators return `Node[Any]` (via the `PipeOperator` wrapper). Multi-source operators return `Node[Any]` directly.

**CONCERN** — `with_breaker` returns `WithBreakerBundle` (not `Node`) and `with_status` returns `WithStatusBundle` (`resilience.py:327–338`, `resilience.py:569–576`). These are **dataclasses** wrapping a `.node` field plus companion nodes. This diverges from the standard `PipeOperator` pattern. This is **intentional** (bundle provides access to companion state), but the type signature `Callable[[Node], WithBreakerBundle]` is not a `PipeOperator` — users can't directly pipe these with `|`. Worth documenting explicitly.

---

## 4. CONCURRENCY MODEL

### 4a. Per-subgraph locks (spec §6.1)

**CONSISTENT** — `subgraph_locks.py` implements a union-find registry (`_SubgraphRegistry`, line 42) with per-component `RLock`s. `union_nodes` (`line 193`) merges components when dependency edges form. `lock_for` (`line 152`) acquires the component lock with retry logic for concurrent union activity. Matches spec §6.1 requirement for per-subgraph write locks.

### 4b. Thread safety of shared mutation points

**CONSISTENT** — Protected points:
- Node cache reads: `_cache_lock` (per-node `threading.Lock`, `node.py:223`)
- All state-mutating operations (`down`, `subscribe`, `unsubscribe`, `_run_fn`): use `acquire_subgraph_write_lock_with_defer` (`node.py:417`, `616`, `629`, `733`, `776`)
- Registry metadata: `_meta_lock` on `_SubgraphRegistry` (`subgraph_locks.py:46`)
- Batch state: thread-local storage (`protocol.py:68`, `_batch_tls`)
- Deferred queue: thread-local storage (`subgraph_locks.py:207`, `_deferred_tls`)
- `Graph` registry mutations: per-graph `RLock` (`graph.py:164`)
- Resilience primitives: internal `threading.Lock` on `_CircuitBreakerImpl` (`resilience.py:236`), `_TokenBucketImpl` (`resilience.py:412`)
- `PubSubHub`: `threading.Lock` (`data_structures.py:476`)

### 4c. Asyncio integration

**CONSISTENT** — Async bridges (`from_awaitable`, `from_async_iter` in `sources.py:212–297`) run async code on daemon threads via `asyncio.run()` with fallback to `asyncio.new_event_loop()` for nested-loop scenarios. This is a pragmatic Python-specific bridge (TS doesn't need this). No async/await in the core — all core operations are synchronous with threading, which is correct for the spec.

### 4d. Weak reference cleanup

**CONSISTENT** — `_SubgraphRegistry` uses `weakref.ref` with GC callbacks (`subgraph_locks.py:121`) to clean up entries when nodes are collected. The `_on_gc` method (`line 53`) properly re-parents children in the union-find tree.

**CONCERN** — `lock_for` retries up to `_MAX_LOCK_RETRIES=100` (`subgraph_locks.py:39`) when the component root changes during lock acquisition (due to concurrent union). While defensive, 100 retries could mask a bug. Worth monitoring or logging on high retry counts.

---

## 5. TYPE HINTS

### 5a. Present on all public functions

**CONSISTENT** — All public functions have return type annotations and parameter types. Examples: `node()` (`node.py:789`), `state()` (`sugar.py:13`), `batch()` (`protocol.py:120`), `Graph.__init__()` (`graph.py:153`), all tier1/tier2 operators, all resilience functions, all checkpoint adapters.

### 5b. Consistent style

**MOSTLY CONSISTENT** — Uses PEP 604 union syntax (`str | None`, `dict[str, Any] | None`) throughout. Uses `from __future__ import annotations` in all files for forward reference support.

**INCONSISTENT** — Type alias style mixes two approaches:
- PEP 695 `type` statement: `type Message = ...` (`node.py:85`, `protocol.py:35–36`), `type PipeOperator = ...` (`sugar.py:10`), `type BackoffStrategy = ...` (`backoff.py:13`), `type JitterMode = ...` (`backoff.py:9`)
- Plain assignment: `NodeStatus = str` (`node.py:29`), `NodeFn = Callable[...]` (`node.py:144`), `GuardAction = str` (`guard.py:9`), `EmitStrategy = Literal[...]` (`protocol.py:44`)

**Recommendation:** Standardize on PEP 695 `type` statements for all type aliases, since the codebase already requires Python 3.12+ (uses `class NodeImpl[T]` generic syntax at `node.py:154`).

### 5c. Generic type parameters

**CONSISTENT** — `NodeImpl[T]` (`node.py:154`), `share[T]` (`sources.py:497`), `cached[T]` (`sources.py:502`), `replay[T]` (`sources.py:542`), `_ReplayNode[T]` (`sources.py:512`), `ReactiveIndexBundle[K]` (`data_structures.py:330`), `_IndexRow[K]` (`data_structures.py:319`). Uses PEP 695 bracket syntax consistently.

---

## 6. EXPORTS (`__init__.py`)

### 6a. All public APIs exported

**CONSISTENT** — Each module defines `__all__` and re-exports through the package hierarchy:
- `core/__init__.py` re-exports from `node`, `sugar`, `protocol`, `guard`, `meta`, `subgraph_locks`
- `graph/__init__.py` re-exports from `graph`
- `extra/__init__.py` re-exports from `tier1`, `tier2`, `sources`, `resilience`, `backoff`, `checkpoint`, `data_structures`
- Top-level `__init__.py` re-exports core + graph (not extra — extra is a separate import namespace)

### 6b. `__all__` defined

**CONSISTENT** — Every module file defines `__all__`:
- `node.py:836`, `sugar.py:41`, `protocol.py:286`, `guard.py:181`, `meta.py:14`, `subgraph_locks.py:289`
- `graph.py` — **MISSING** `__all__` in the module itself (Graph class module)
- `tier1.py:991`, `tier2.py` (has `__all__`), `sources.py:621`, `resilience.py:25`, `backoff.py:15`, `checkpoint.py:17`, `data_structures.py:534`, `cron.py` — **MISSING** `__all__`
- All `__init__.py` files define `__all__`

**INCONSISTENT** — `graph/graph.py` and `extra/cron.py` lack `__all__`. Recommend adding for completeness:
- `graph.py`: should export `Graph`, `GraphObserveSource`, `PATH_SEP`, `GRAPH_META_SEGMENT`, `META_PATH_SEG`, `GRAPH_SNAPSHOT_VERSION`
- `cron.py`: should export `CronSchedule`, `parse_cron`, `matches_cron`

### 6c. Internal symbols properly hidden

**CONSISTENT** — Internal helpers use underscore prefix: `_BitSet` (`node.py:34`), `_BatchState` (`protocol.py:71`), `_SubgraphRegistry` (`subgraph_locks.py:42`), `_LockBox` (`subgraph_locks.py:30`), `_CircuitBreakerImpl` (`resilience.py:200`), `_TokenBucketImpl` (`resilience.py:409`), `_MapState` (`data_structures.py:73`), `_IndexRow` (`data_structures.py:319`), `_UNSET` (`tier2.py:23`), `_DESCRIBE_UNSCOPED` (`graph.py:37`), etc.

**CONCERN** — `core/__init__.py:93–98` exports sugar functions (`derived`, `effect`, `pipe`, `producer`, `state`) at the end of `__all__` rather than in alphabetical order. Minor but inconsistent with the rest of the list which is sorted.

---

## 7. CROSS-REPO CONSISTENCY

### 7a. Same class-vs-function pattern

**CONSISTENT** — Both repos use:
- `node()` factory function → `NodeImpl` class (TS: `NodeImpl<T>`, Python: `NodeImpl[T]`)
- `state()`, `derived()`, `producer()`, `effect()`, `pipe()` as plain functions
- `Graph` as a class
- `policy()` as a builder function returning a guard callable
- Operators as curried functions returning `PipeOperator`

### 7b. Unjustified divergences

**NONE FOUND** — All divergences are justified by language idioms:

| Feature | TypeScript | Python | Justification |
|---------|-----------|--------|---------------|
| batch | `batch(fn)` callback | `with batch():` context manager | Pythonic resource scoping |
| MessageType | `Symbol.for()` constants | `StrEnum` class | Python has no Symbol; StrEnum is idiomatic |
| Naming | camelCase functions | snake_case functions | Language convention |
| Option keys | `camelCase` (`resetOnTeardown`) | `snake_case` (`reset_on_teardown`) | Language convention; Python also accepts camelCase aliases (`node.py:821–828`) |
| Type system | Interface + class | Class + type alias `Node = NodeImpl` | Python lacks interface keyword; same effect |
| Generics | `<T>` | `[T]` (PEP 695) | Syntax difference |

### 7c. Message type representation

**CONSISTENT** — Per spec §6.1:
- TS uses `Symbol.for("graphrefly/DATA")` etc.
- Python uses `class MessageType(StrEnum)` at `protocol.py:20–32`

This is the spec-mandated divergence. Python's `StrEnum` provides `is`-comparable identity (used throughout: `if t is MessageType.DATA`), string serialization for debugging, and enum member iteration — all appropriate Python equivalents of Symbol semantics.

---

## Summary

| Category | Status | Issues |
|----------|--------|--------|
| Core primitives | CONSISTENT | — |
| Python idioms | CONSISTENT | — |
| Extra operators | CONSISTENT | `with_breaker`/`with_status` return bundles, not `PipeOperator` (intentional) |
| Concurrency model | CONSISTENT | Lock retry cap (100) could mask bugs |
| Type hints | MOSTLY CONSISTENT | Mixed type alias styles (PEP 695 vs plain assignment) |
| Exports | MOSTLY CONSISTENT | `graph.py` and `cron.py` missing `__all__`; minor sort order in `core/__init__.py` |
| Cross-repo consistency | CONSISTENT | All divergences justified by language idioms |

### Recommended Actions

1. **Add `__all__`** to `graph/graph.py` and `extra/cron.py` — low effort, improves consistency
2. **Standardize type aliases** on PEP 695 `type` statements (`NodeStatus`, `NodeFn`, `GuardAction`, `DownStrategy`, `DeferWhen`) — the codebase already requires 3.12+
3. **Sort `__all__` in `core/__init__.py`** — move sugar exports into alphabetical position
4. **Document bundle-returning operators** (`with_breaker`, `with_status`) as intentionally outside `PipeOperator` — they can't be used with `|` or `pipe()`
