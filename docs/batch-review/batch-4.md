# Batch 4 — Internal API Pattern Consistency Audit

Audited all source files (not tests) under `src/core/`, `src/graph/`, `src/extra/`, and barrel exports.

---

## 1. CORE PRIMITIVES — Construction pattern

**CONSISTENT** — Clean intentional distinction.

- `node()` — factory function (`src/core/node.ts:870`)
- `state()` — factory function (`src/core/sugar.ts:22`)
- `derived()` — factory function (`src/core/sugar.ts:66`)
- `producer()` — factory function (`src/core/sugar.ts:44`)
- `effect()` — factory function (`src/core/sugar.ts:93`)
- `pipe()` — factory function (`src/core/sugar.ts:121`)
- `batch()` — factory function (`src/core/batch.ts:57`)
- `Graph` — class (`src/graph/graph.ts:209`) per spec §3.1

All sugar constructors delegate to `node()`. `node()` internally instantiates `NodeImpl` (class, for V8 hidden-class optimization) but the public return type is the `Node<T>` interface — the class is an implementation detail.

---

## 2. EXTRA OPERATORS — Signature pattern

**CONSISTENT** — All operators use the **direct form**: `op(source, ...config, opts?)`.

Signature: `(source: Node<T>, ...requiredArgs, opts?: ExtraOpts) => Node<R>`

Evidence (all in `src/extra/operators.ts`):
- `map(source, project, opts?)` — line 42
- `filter(source, predicate, opts?)` — line 63
- `scan(source, reducer, seed, opts?)` — line 97
- `reduce(source, reducer, seed, opts?)` — line 132
- `take(source, count, opts?)` — line 180
- `skip(source, count, opts?)` — line 262
- `takeWhile(source, predicate, opts?)` — line 307
- `takeUntil(source, notifier, opts?)` — line 359
- `first(source, opts?)` — line 413
- `last(source, options?)` — line 433
- `find(source, predicate, opts?)` — line 481
- `elementAt(source, index, opts?)` — line 506
- `startWith(source, initial, opts?)` — line 527
- `tap(source, fn, opts?)` — line 560
- `distinctUntilChanged(source, equals?, opts?)` — line 588
- `pairwise(source, opts?)` — line 615
- `combine(sources, opts?)` — line 652
- `withLatestFrom(primary, secondary, opts?)` — line 677
- `merge(sources, opts?)` — line 736
- `zip(sources, opts?)` — line 812
- `concat(firstSrc, secondSrc, opts?)` — line 904
- `race(sources, opts?)` — line 960
- `switchMap(source, project, opts?)` — line 1059
- `exhaustMap(source, project, opts?)` — line 1135

No curried `op(config)(source)` form. `pipe()` uses inline lambdas instead: `(n) => map(n, fn)`.

**CONCERN** — This is a deliberate choice (see `sugar.ts:104` comment), but means `pipe()` calls are more verbose than curried RxJS style. Consistent, but worth noting as a design trade-off.

---

## 3. EXTRA SOURCES — `from*` naming and return types

**CONSISTENT** — All return `Node<T>`. Adapter naming uses `from*` prefix consistently.

Evidence (all in `src/extra/sources.ts`):
- `fromTimer(ms, opts?)` — line 78 → `Node<number>`
- `fromCron(expr, opts?)` — line 124/126 → `Node<number | Date>`
- `fromEvent(target, type, opts?)` — line 158 → `Node<T>`
- `fromIter(iterable, opts?)` — line 175 → `Node<T>`
- `fromPromise(p, opts?)` — line 198 → `Node<T>`
- `fromAsyncIter(iterable, opts?)` — line 235 → `Node<T>`
- `fromAny(input, opts?)` — line 287 → `Node<...>` (dispatcher)
- `of(...values)` — line 312 → `Node<T>` (value source, no `from` prefix — correct)
- `empty(opts?)` — line 317 → `Node<T>`
- `never(opts?)` — line 325 → `Node<T>`
- `throwError(err, opts?)` — line 330 → `Node<never>`

**Two special cases** (both intentional, not inconsistencies):
- `forEach(source, fn, opts?)` — line 341 → returns `() => void` (unsubscribe), not `Node<T>`. It is a sink, documented correctly.
- `firstValueFrom(source)` — line 429 → returns `Promise<T>`, not `Node<T>`. Bridge to promise world, correctly named.

---

## 4. RESILIENCE — Classes vs factory functions

**CONSISTENT** — Justified split between utility objects (factory functions) and pipe operators.

| API | Kind | Location | Returns |
|-----|------|----------|---------|
| `circuitBreaker(opts?)` | factory fn | `resilience.ts:234` | `CircuitBreaker` (interface) |
| `tokenBucket(cap, rate)` | factory fn | `resilience.ts:422` | `TokenBucket` (interface) |
| `withBreaker(breaker, opts?)` | factory fn (curried) | `resilience.ts:352` | `(source) => WithBreakerBundle<T>` |
| `retry(opts?)` | factory fn | `resilience.ts:70` | `PipeOperator` |
| `rateLimiter(max, window)` | factory fn | `resilience.ts:467` | `PipeOperator` |
| `withStatus(src, opts?)` | factory fn | `resilience.ts:573` | `WithStatusBundle<T>` |
| `CircuitOpenError` | class (Error subclass) | `resilience.ts:175` | — |

`CircuitOpenError` is the only exported class in resilience — justified as an Error subclass (standard pattern). All stateful objects (`CircuitBreaker`, `TokenBucket`) are returned as interfaces from factory functions — **consistent**.

**INCONSISTENCY** — `retry` and `rateLimiter` return `PipeOperator` (curried form for `pipe()`), while `withBreaker` returns a curried function `(source) => Bundle` (not a `PipeOperator`). The return shapes differ because `withBreaker` returns a bundle, not a single `Node`. This is justified by the different return type but could be cleaner.

**INCONSISTENCY** — `withStatus(src, opts?)` takes source as the first arg (direct form like operators), while `retry(opts?)` and `rateLimiter(max, window)` return `PipeOperator` (curried form). Both are valid patterns but the resilience module uses **both** conventions:
- Direct: `withStatus(src)` at `resilience.ts:573`
- Curried/pipe: `retry(opts?)` at `resilience.ts:70`, `rateLimiter(max, window)` at `resilience.ts:467`

**Recommendation:** This is defensible — `withStatus` returns a bundle (not `Node`), so it can't be a `PipeOperator`. The pipe-compatible ones return `PipeOperator`. Document the rationale.

---

## 5. DATA STRUCTURES — Factory functions, return types, API surface

**CONSISTENT** — All are factory functions returning bundle objects.

| API | Location | Returns |
|-----|----------|---------|
| `reactiveMap(opts?)` | `reactive-map.ts:83` | `ReactiveMapBundle<K,V>` |
| `reactiveLog(initial?, opts?)` | `reactive-log.ts:58` | `ReactiveLogBundle<T>` |
| `reactiveIndex(opts?)` | `reactive-index.ts:106` | `ReactiveIndexBundle<K,V>` |
| `reactiveList(initial?, opts?)` | `reactive-list.ts:46` | `ReactiveListBundle<T>` |
| `pubsub()` | `pubsub.ts:64` | `PubSubHub` |

All bundles expose a `.node` or primary node property (`.entries`, `.items`, `.ordered`) plus imperative methods. Pattern is consistent across map/log/index/list.

**INCONSISTENCY** (minor) — Bundle primary node naming varies:
- `reactiveMap` → `.node` (`reactive-map.ts:26`)
- `reactiveLog` → `.entries` (`reactive-log.ts:18`)
- `reactiveIndex` → `.ordered` (`reactive-index.ts:24`)
- `reactiveList` → `.items` (`reactive-list.ts:17`)

The names are semantically appropriate for each structure, but there's no universal `.node` property across all bundles. `reactiveMap` uses `.node`; the others use domain-specific names.

**Recommendation:** This is defensible for API ergonomics (`.entries` reads better than `.node` on a log). If uniformity is desired, add a `.node` alias on all bundles pointing to the primary node.

**INCONSISTENCY** — `PubSubHub` is the only data structure exposed as a **class** (with `new PubSubHub()` possible), though `pubsub()` factory is the documented entry point. All others are pure factory functions returning plain objects.

- `PubSubHub` class is exported: `pubsub.ts:14`
- `pubsub()` factory: `pubsub.ts:64`

**Recommendation:** Either unexport the `PubSubHub` class (keep only the factory + a `PubSubHub` type) or convert to the same pattern as the other data structures.

---

## 6. OPTIONS PATTERN

**CONSISTENT** — `(requiredArgs, opts?)` used universally.

All functions follow the pattern of required positional args first, then an optional options object last:
- Operators: `(source, ...config, opts?: ExtraOpts)` — all in `operators.ts`
- Sources: `(required, opts?: ExtraOpts | AsyncSourceOpts)` — all in `sources.ts`
- Resilience: `(required, opts?)` or `(opts?)` for config-only — `resilience.ts`
- Data structures: `(initial?, opts?)` — `reactive-*.ts`

`ExtraOpts` is consistently `Omit<NodeOptions, "describeKind">` across operators, sources, and resilience modules.

No functions use positional args for optional configuration.

---

## 7. NAMING

**CONSISTENT** — camelCase for functions, PascalCase for classes/types/interfaces.

- Functions: `node`, `state`, `derived`, `map`, `filter`, `circuitBreaker`, `reactiveMap`, etc.
- Classes: `Graph`, `NodeImpl`, `GuardDenied`, `CircuitOpenError`, `PubSubHub`, `MemoryCheckpointAdapter`, etc.
- Types/interfaces: `Node`, `NodeOptions`, `Message`, `Messages`, `CircuitBreaker`, `TokenBucket`, etc.
- Constants: `DATA`, `DIRTY`, `RESOLVED`, etc. (UPPER_CASE for symbols — consistent)

No mixed conventions found.

---

## 8. RETURN TYPES

**CONSISTENT** — Operators return `Node<T>` (or documented alternatives).

Documented exceptions (all intentional):
- `forEach()` → `() => void` (sink, auto-subscribes) — `sources.ts:341`
- `firstValueFrom()` → `Promise<T>` (bridge) — `sources.ts:429`
- `retry()`, `rateLimiter()` → `PipeOperator` (for `pipe()`) — `resilience.ts:70,467`
- `withBreaker()` → `(source) => WithBreakerBundle` — `resilience.ts:352`
- `withStatus()` → `WithStatusBundle` — `resilience.ts:573`
- `circuitBreaker()` → `CircuitBreaker` (utility, not reactive) — `resilience.ts:234`
- `tokenBucket()` → `TokenBucket` (utility, not reactive) — `resilience.ts:422`
- Data structure factories → Bundle types — all `reactive-*.ts`

No functions return raw values or unexpected types.

---

## 9. EXPORTS

### Barrel completeness

**CONSISTENT** — Barrel exports are complete and well-organized.

- `src/index.ts` — re-exports all from `core`, `extra`, `graph` plus namespace exports
- `src/core/index.ts` — `export *` from all 7 core modules
- `src/graph/index.ts` — named exports from `graph.ts` (selective, no internals)
- `src/extra/index.ts` — `export *` from all 10 extra modules

`reactive-base.ts` is correctly **not** exported from `src/extra/index.ts` — it's `@internal` (`reactive-base.ts:1-11`).

### Concerns

**CONCERN — `NodeImpl` leaks through barrel exports.**

`NodeImpl` is `export class` at `src/core/node.ts:290`. Since `src/core/index.ts:10` does `export * from "./node.js"`, `NodeImpl` is publicly accessible. It is used internally by `graph.ts` and `meta.ts` for `instanceof` checks, but it exposes internal fields (`_deps`, `_fn`, `_opts`, `_describeKind`, etc.) to consumers.

**Recommendation:** Either:
1. Switch `src/core/index.ts` to named exports (like `graph/index.ts` does) and exclude `NodeImpl`, or
2. Accept `NodeImpl` as a semi-public escape hatch but document it as unstable.

**CONCERN — `wrapSubscribeHook` from `sources.ts` is not exported** (function-scoped), but it creates objects that satisfy `Node<T>` without being `NodeImpl` instances. This means `instanceof NodeImpl` checks in `graph.ts`/`meta.ts` will fail for `replay()`-created nodes. `Graph.connect()` requires `NodeImpl` (`graph.ts:416`), so `replay()` nodes cannot be wired with `connect()`.

**CONCERN — Graph class docstring example uses `g.register(...)` but the method is named `g.add(...)`** at `graph.ts:203-204` vs `graph.ts:295`. The docstring example is stale.

---

## 10. TYPE SAFETY

**CONSISTENT** — Generic type parameters used well throughout.

- `Node<T>`, `NodeImpl<T>`, `NodeFn<T>` — core generics flow through all APIs
- Operators properly narrow: `map<T, R>`, `scan<T, R>`, `switchMap<T, R>`, etc.
- `fromCron` uses overloads for `Node<Date>` vs `Node<number>` (`sources.ts:124-125`)
- `combine` and `zip` use `const T extends readonly unknown[]` for tuple inference
- `Versioned<T>` wrapper properly parameterized across all data structures

**No `any` types found in any source file.** A grep for `: any`, `as any`, `<any>`, `any[]` returned zero results.

`as unknown as` casts appear in several places (operators accessing dep values) — these are necessary because `node()` deps are typed as `readonly Node[]` (heterogeneous), so the compute function receives `readonly unknown[]`. This is the correct design — generic narrowing happens at the operator level.

---

## Summary of findings

| # | Area | Verdict | Action needed |
|---|------|---------|---------------|
| 1 | Core primitives | CONSISTENT | None |
| 2 | Operator signatures | CONSISTENT | None |
| 3 | Source naming | CONSISTENT | None |
| 4 | Resilience patterns | CONSISTENT (minor divergence justified) | Document rationale for mixed direct/pipe forms |
| 5 | Data structure bundles | CONSISTENT (minor) | Consider `.node` alias or accept domain-specific names; unexport `PubSubHub` class |
| 6 | Options pattern | CONSISTENT | None |
| 7 | Naming conventions | CONSISTENT | None |
| 8 | Return types | CONSISTENT | None |
| 9 | Exports | CONCERN | Fix `NodeImpl` leak; fix stale `register` docstring |
| 10 | Type safety | CONSISTENT | None |

### Priority fixes

1. **`graph.ts:203`** — Stale docstring example: `g.register(...)` should be `g.add(...)`.
2. **`core/index.ts`** — `NodeImpl` leaks as public API. Switch to named exports.
3. **`pubsub.ts`** — `PubSubHub` class exported alongside `pubsub()` factory. Consider hiding class.
4. **`sources.ts:46` (`wrapSubscribeHook`)** — `replay()` nodes won't pass `instanceof NodeImpl`, breaking `Graph.connect()`. Document or address.
