---
title: "The Inspector Pattern: Observability as a First-Class Citizen"
description: "GraphReFly keeps stores as plain { get, set?, source } objects. Names, edges, and debug hooks live in WeakMaps — so you only pay for observability when you use it."
date: 2026-03-22T13:00:00
authors: [david]
tags: [architecture, performance]
---

# The Inspector Pattern: Observability as a First-Class Citizen

*Arc 2, Post 6 — Architecture v1: The Naive First Attempt*

---

Reactive libraries are easy to use until something goes wrong at 2 a.m. Then you need answers: **Which node updated? In what order? Why did this derived recompute?** Most ecosystems hand you a browser extension, a proprietary devtools plugin, or `console.log` archaeology.

We wanted **runtime graph introspection** to be a library concern — without taxing every store in production.

The solution was not to add `name`, `kind`, and `__debug` fields to every object. It was **`Inspector`**: a global singleton (toggleable) that hangs metadata off **`WeakMap`s keyed by store instances**, tracks live nodes with `WeakRef` where needed, and auto-registers dependency edges when derived and operator nodes wire up.

This post is how that pattern works, why it mattered from v1 onward, and what we learned when we wired real hooks into hot paths.

## The context: plain objects on purpose

From the first architecture write-up, a store was defined as nothing more than:

```ts
{ get, set?, source }
```

No wrapper classes, no `Object.defineProperties` tricks. That choice keeps instances small and avoids fighting the runtime (for example, read-only function names and hidden class churn).

But plain objects have a downside: **where do you put the name?**

If every store carries a `debugName`, every app pays for it — even minified production bundles that will never open devtools. If only *some* stores are named, you still allocate fields or inherit from a base class, which changes the shape of hot objects.

## The insight: metadata outside the instance

**WeakMap metadata** breaks the trade-off:

- The store stays a minimal plain object on the fast path.
- `Inspector.register(store, { name, kind })` associates debug data **without expanding the store's shape**.
- When the store is garbage-collected, the WeakMap entry disappears — no manual registry cleanup.

Unnamed stores pay **nothing** for naming. Named stores pay **indirection**, not an extra field on every `get()`.

The same pattern extends to **edges**: parent/child relationships for the DAG can be recorded when upstream connections are made, without baking adjacency lists into user-visible objects.

## What Inspector is for

Depending on the version you read in the archive vs today's codebase, the surface has grown — but the roles are stable:

- **Introspection:** Graph snapshots, pretty-printed dumps, edge listings — "what exists and how is it wired?"
- **Tracing:** Follow one store's emissions and status transitions for a bug report.
- **Testing:** `Inspector.observe(store)` gives a structured callbag observer so tests assert on protocol order (DIRTY before DATA, `RESOLVED` paths, completion) instead of hand-rolled sinks.

That last point mattered enough to document explicitly: we added `observe()` because ad-hoc listeners in tests were repeating the same mistakes.

## The pitfall: hooks in hot paths are not free

When we wired `onEmit`, `onSignal`, `onStatus`, and `onEnd` into primitives, **naive** `if (Inspector.onEmit) ...` checks caused measurable benchmark regressions — not because the branch was expensive, but because **how** we stored hook state on the `Inspector` object interacted badly with V8's hidden classes.

The fix was boring engineering:

- Avoid getters/setters on the hot `Inspector` object shape when they cause global deopt.
- Use a **module-level boolean guard** for "are any hooks installed?" so the fast path is a cheap falsy check.
- Keep production as **disabled by default** when `NODE_ENV === 'production'` (historically; always verify current defaults in source).

The lesson generalizes: **observability hooks belong in the design**, but **their guard rails belong in measurement**. First-class does not mean "unconditionally on."

## Why this is architectural, not cosmetic

RxJS taught a generation that **marble diagrams and pipe names** are the debugging UX. Signals ecosystems often lean on framework devtools. For a **protocol-first** library, we wanted the same visibility **without** assuming React, a browser, or a specific bundler.

`graph.describe()` is the answer to: "Can I explain this graph to a coworker, a test, or an AI agent assisting with debug?" If `graph.describe()` reads like a stack trace for your reactive layer, we did the job.

## What we kept as the system grew

Later architecture passes added type 3 control signals, output-slot dispatch, and more primitives — but **metadata stays out of store shapes** as a design rule. Observability remains **opt-in**, **GC-friendly**, and **testable** through the same Inspector surface.

## Further reading

- [Why Explicit Dependencies Beat Magic Tracking](./05-explicit-dependencies) — why the graph is visible in code *and* at runtime
- [Architecture & design](/architecture/) — current Inspector behavior and protocol details
- Session notes: `src/archive/docs/SESSION-inspector-hooks-wiring.md`, `src/archive/docs/architecture-v1.md` (section: observability)

---

*Next: Arc 3 starts with [Data Should Flow Through the Graph, Not Around It](./07-data-should-flow-through-the-graph-not-around-it).*
