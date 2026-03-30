# Coming from RxJS

A concise migration guide for developers familiar with RxJS moving to GraphReFly.

---

## Name mapping

GraphReFly prefers shorter names but provides RxJS-compatible aliases.

| RxJS | GraphReFly | Alias available? |
|------|-----------|-----------------|
| `combineLatest` | `combine` | Yes — `combineLatest` |
| `debounceTime` | `debounce` | Yes — `debounceTime` |
| `throttleTime` | `throttle` | Yes — `throttleTime` |
| `shareReplay` | `replay` | Yes — `shareReplay` |
| `catchError` | `rescue` | Yes — `catchError` |
| `mergeMap(fn, n)` | `mergeMap(source, fn, { concurrent: n })` | — |
| `flatMap` | `flatMap` | Same name (alias of `mergeMap`) |

---

## API shape differences

### Variadic arguments, not arrays

Combinators accept variadic sources directly:

```ts
// RxJS
combineLatest([a, b, c])

// GraphReFly
combine(a, b, c)
```

This applies to `merge`, `combine`, `zip`, and `race`.

### Direct-form operators

All operators take the source as their first argument:

```ts
// RxJS
source$.pipe(
  map(x => x + 1),
  filter(x => x > 0)
)

// GraphReFly — direct form
filter(map(source, x => x + 1), x => x > 0)
```

`pipe()` exists as a convenience, but every operator is also callable directly.

---

## Intentional divergences

| Topic | RxJS | GraphReFly |
|-------|------|-----------|
| **scan / reduce seed** | Seed is optional (seedless mode infers from first value) | Seed is always required |
| **tap** | Accepts a function or a partial `Observer` | Accepts a function or `{ data, error, complete }` observer object |
| **share / replay** | Configurable `refCount` behavior | Always resets on zero subscribers (no configurable refcount) |
| **startWith** | Accepts multiple values: `startWith(1, 2, 3)` | Single value only — chain for multiple: `startWith(startWith(s, 1), 2)` |

---

## Two-phase semantics

GraphReFly introduces a DIRTY / DATA / RESOLVED protocol that has no RxJS equivalent.

When a source changes, downstream nodes first receive a **DIRTY** notification (meaning "your inputs may have changed"). They then recompute and emit either:

- **DATA** — the recomputed value (changed), or
- **RESOLVED** — "I recomputed but my value is the same as before" (enables skip optimization).

This two-phase protocol gives GraphReFly **diamond glitch-freedom**: a `combine(a, b)` that depends on two branches of the same source will never expose an intermediate state where one branch has updated but the other has not. DIRTY propagates first through the entire graph, then DATA/RESOLVED propagates, so `combine` knows to wait for both inputs before recomputing.

RxJS `combineLatest` is susceptible to this intermediate-state problem (commonly called "glitches") because it emits eagerly on each input change.
