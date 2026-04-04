---
title: "Migrating from callbag-recharge"
description: "Step-by-step guide for migrating from callbag-recharge to GraphReFly — API mapping, import changes, and behavioral differences."
---

# Migrating from callbag-recharge

GraphReFly is the successor to callbag-recharge. The core reactive model (two-phase push, diamond resolution, push-phase memoization) is identical. The differences are in API naming, module structure, and the single-primitive architecture.

## Install

```bash
# Remove the old package
npm uninstall @callbag-recharge/callbag-recharge

# Install GraphReFly
npm install @graphrefly/graphrefly
```

## Import changes

```diff
- import { state, derived, effect, producer } from 'callbag-recharge'
+ import { state, derived, effect, producer } from '@graphrefly/graphrefly'

- import { switchMap, debounce, retry } from 'callbag-recharge/extra'
+ import { switchMap, debounce, retry } from '@graphrefly/graphrefly/extra'

- import { Graph } from 'callbag-recharge/graph'
+ import { Graph } from '@graphrefly/graphrefly/graph'
```

## API mapping

### Primitives

| callbag-recharge | GraphReFly | Notes |
|---|---|---|
| `state(initial)` | `state(initial)` | Same |
| `derived([deps], fn)` | `derived([deps], fn)` | Same |
| `dynamicDerived(fn)` | `dynamicNode(fn)` | Renamed |
| `producer(fn)` | `producer(fn)` | Same |
| `effect([deps], fn)` | `effect([deps], fn)` | Same |
| `operator([deps], fn)` | `derived([deps], fn)` | Use `derived` — `operator` is removed |
| `pipe(source, ...ops)` | `pipe(source, ...ops)` | Same |
| `batch(fn)` | `batch(fn)` | Same |

### Stores & state access

| callbag-recharge | GraphReFly | Notes |
|---|---|---|
| `store.get()` | `node.get()` | Same |
| `store.set(value)` | `node.set(value)` | Same |
| `store.subscribe(fn)` | `node.subscribe(fn)` | Same |
| `store.source()` | `node.subscribe(sink)` | `source()` is removed; use `subscribe` |

### Graph

| callbag-recharge | GraphReFly | Notes |
|---|---|---|
| `Inspector.dumpGraph()` | `graph.describe()` | Now a Graph method, not a global |
| `Inspector.observe(fn)` | `graph.observe(fn)` | Same |
| — | `graph.register(name, node)` | New — register nodes for namespace |
| — | `graph.snapshot()` | New — serialize graph state |
| — | `graph.diff(a, b)` | New — diff two snapshots |
| — | `graph.diagram()` | New — Mermaid diagram output |

### Operators

All 70+ operators carry forward with the same names and semantics. A few notes:

| callbag-recharge | GraphReFly | Notes |
|---|---|---|
| `fromObs(obs$)` | `fromAny(obs$)` | `fromAny` normalizes any source (Observable, Promise, iterable) |
| `wrap(store)` | `toObservable(node)` | Renamed for clarity |
| `route(source, pred)` | Use `dynamicNode` or conditional `derived` | `route()` removed; use reactive patterns |
| `select(store, fn)` | `derived([store], fn)` | `select` removed; `derived` does the same |
| `createStore(fn)` | Use `@graphrefly/graphrefly/compat/zustand` | Compat layer available |

### Compat layers

| callbag-recharge | GraphReFly |
|---|---|
| `callbag-recharge/compat/zustand` | `@graphrefly/graphrefly/compat/zustand` |
| `callbag-recharge/compat/jotai` | `@graphrefly/graphrefly/compat/jotai` |
| `callbag-recharge/compat/react` | `@graphrefly/graphrefly/compat/react` |
| `callbag-recharge/compat/vue` | `@graphrefly/graphrefly/compat/vue` |
| `callbag-recharge/compat/svelte` | `@graphrefly/graphrefly/compat/svelte` |
| `callbag-recharge/compat/solid` | `@graphrefly/graphrefly/compat/solid` |
| — | `@graphrefly/graphrefly/compat/nestjs` (new) |

### Messages

| callbag-recharge | GraphReFly | Notes |
|---|---|---|
| `sink(1, value)` | `[[DATA, value]]` | Named tuples instead of numeric types |
| `sink(3, DIRTY)` | `[[DIRTY]]` | No more Type 3 — all messages are tuples |
| `sink(3, RESOLVED)` | `[[RESOLVED]]` | Same |
| `sink(2)` | `[[TEARDOWN]]` or `[[COMPLETE]]` | Explicit termination types |
| `sink(0, talkback)` | — | No handshake ceremony — nodes connect via deps |

### Resilience

| callbag-recharge | GraphReFly | Notes |
|---|---|---|
| `retry(source, opts)` | `retry(source, opts)` | Same |
| `circuitBreaker(opts)` | `circuitBreaker(opts)` | Same |
| `withRetry(opts)` | `retry(opts)` | Consolidated |
| `withBreaker(breaker)` | `withBreaker(breaker)` | Same |
| `checkpoint()` | `saveGraphCheckpoint(graph, adapter)` | Now Graph-level, not per-store |

### Patterns (new in GraphReFly)

These APIs don't exist in callbag-recharge:

- `pipeline()`, `task()`, `branch()`, `gate()`, `approval()` — orchestration
- `topic()`, `subscription()`, `jobQueue()` — messaging
- `collection()`, `vectorIndex()`, `knowledgeGraph()`, `decay()` — memory
- `fromLLM()`, `chatStream()`, `agentLoop()`, `toolRegistry()` — AI
- `cqrs()` — CQRS
- `reactiveLayout()`, `reactiveBlockLayout()` — layout engine
- `workerBridge()`, `workerSelf()` — worker bridge

## Behavioral differences

### One primitive, not six

callbag-recharge had six distinct primitive implementations. GraphReFly has one (`node`) with sugar constructors. This means:

- All nodes share the same internal code path
- Options like `meta`, `guard`, `name`, `resubscribable` work on any node type
- `dynamicNode()` is a constructor over `node`, not a separate implementation

### No handshake ceremony

callbag-recharge used the callbag protocol's Type 0 handshake (source sends talkback to sink). GraphReFly nodes connect through the `deps` array — no handshake, no talkback management.

### Graph container is first-class

In callbag-recharge, the Inspector was a side-channel observer. In GraphReFly, `Graph` is the primary container for grouping, introspecting, and persisting nodes. Use `graph.register()` to add nodes, then `describe()`, `snapshot()`, `observe()`, and `diagram()` for full visibility.

### Message format

callbag-recharge used numeric types (`0`, `1`, `2`, `3`) with positional payloads. GraphReFly uses named symbol tuples (`[[DATA, value]]`, `[[DIRTY]]`). This is more readable, extensible, and debuggable.

## Quick migration checklist

- [ ] Replace `@callbag-recharge/callbag-recharge` with `@graphrefly/graphrefly` in `package.json`
- [ ] Update all import paths
- [ ] Rename `dynamicDerived` → `dynamicNode`
- [ ] Replace `operator()` calls with `derived()`
- [ ] Replace `Inspector.dumpGraph()` with `graph.describe()` (requires a `Graph` instance)
- [ ] Replace `fromObs()` / `wrap()` with `fromAny()` / `toObservable()`
- [ ] Replace `select(store, fn)` with `derived([store], fn)`
- [ ] Update any direct message sends from numeric to named tuples
- [ ] Run tests — the reactive semantics are identical, so most tests should pass after renaming
