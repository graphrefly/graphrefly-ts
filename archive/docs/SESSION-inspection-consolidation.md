# Session: Inspection Tool Consolidation — TS + PY Parity

**Date:** 2026-04-08
**Origin:** graphrefly (cross-repo)
**Trigger:** Debugging PY gate.modify() steering test exposed inspection gaps and tool sprawl

---

## Context

While porting the gate.modify() steering test from TS to PY (roadmap §9.0 "Dogfood on 9.1b"), debugging the async pipeline stall required manual print-debugging at each harness stage. This exposed:

1. **PY lacks key inspection tools** that TS has (harnessTrace, Graph.diff, annotate)
2. **TS has 14+ exported inspection tools** — too many for developers/LLMs to memorize
3. **Test utilities violate design invariants** — `_wait_for` polling loops break §5.8 (No polling)

## Debugging failures that drove this

| Failure | Root cause | What inspection tool would have prevented it |
|---------|-----------|----------------------------------------------|
| Standalone `asyncio.run()` script hung | No Runner registered outside pytest | `runner.__repr__` showing `registered=False` |
| `_wait_for` polling timeout | §5.8 violation — busy-wait instead of reactive subscribe | `filter \| take(1)` reactive composition |
| Manual print-debugging of 7 harness stages | No pipeline-level trace tool in PY | `harnessTrace()` one-call visibility |
| Couldn't diff graph state before/after `gate.modify()` | PY missing `Graph.diff()` | `diff(snap_before, snap_after)` |

## TS tool inventory (before consolidation)

| Tool | Files using it | Layer |
|------|---------------|-------|
| `describe()` | 22 | Foundational |
| `observe()` | 10 | Foundational |
| `node.status` / `node.get()` | everywhere | Core protocol |
| `graphProfile()` | 4 | Profiling |
| `harnessProfile()` | 4 | Domain profiling |
| `spy()` | 4 | Debug (overlaps observe) |
| `annotate()` | 4 | Trace write |
| `traceLog()` | 4 | Trace read |
| `diff()` | 4 | Snapshot analysis |
| `reachable()` | 4 | Graph traversal |
| `describeNode()` | 2 | Internal (used by describe) |
| `metaSnapshot()` | 2 | Internal (used by describeNode) |
| `sizeof()` | 2 | Internal (used by graphProfile) |
| `observeNode$` / `observeGraph$` / `toMessages$` / `toObservable` | 3 | RxJS bridge |

**Key finding:** Two tools carry 80% of usage (`describe` at 22 files, `observe` at 10). Everything else has 2-4 call sites.

## Consolidation decisions

### 1. Merge `spy()` into `observe(format=)`

`spy()` is `observe({ structured: true })` + a pretty-print logger. No independent logic.

```ts
// After:
graph.observe("foo", { format: "pretty" })   // replaces spy()
```

### 2. Merge `annotate()` + `traceLog()` into `trace()`

Write and read through one method:

```ts
graph.trace("path", "reason")   // write
graph.trace()                   // read all
```

### 3. Consolidate RxJS bridge to single `toObservable()`

4 functions → 1:

```ts
toObservable(node)                    // values
toObservable(node, { raw: true })     // raw messages
```

### 4. Unexport internal plumbing

`describeNode`, `metaSnapshot` — only used by `describe()`. Remove from public API.

### 5. Reactive composition replaces polling `_wait_for`

Instead of a new `await_settled` or `first_where` primitive, use existing operators:

```python
pipe(node, filter(lambda s: len(s) > 0), take(1))
```

This is `subscribe → filter → take(1)` — reactive internally, no polling, no thread blocking. The `_wait_for` helper across 3+ test files gets replaced by operator composition.

**Why not a standalone `first_where()`:** It would be `filter | take(1)` with a blocking `threading.Event` — adding an imperative bridge where none is needed. The reactive graph already delivers values via the Runner's callback threads.

## New tools (both languages)

### `harnessTrace(harness, logger?)`

Wires `observe(format="pretty")` to all 7 harness stages. One call → full pipeline visibility:

```
[0.000s] INTAKE    ← "T5: resilience ordering wrong"
[0.312s] TRIAGE    → route=needs-decision, rootCause=unknown
[0.850s] GATE      ▶ modify() → rootCause=composition
[1.305s] STRATEGY  → upsert composition→template (1/1 = 100%)
```

### `Graph.diff(a, b)` (PY — port from TS)

Static snapshot diffing. Already exists in TS.

### Runner `__repr__` / `toString()`

Pending task counter on runner implementations. Surfaces in assertion failures and `harnessProfile()` output. No new exported function.

## Final surface (both languages)

| # | Tool | Responsibility |
|---|------|----------------|
| 1 | `describe()` | Structure snapshot |
| 2 | `observe()` | Live events + pretty-print (absorbs spy) |
| 3 | `trace()` | Reasoning annotations + ring buffer (absorbs annotate + traceLog) |
| 4 | `graphProfile()` | Memory & connectivity profiling |
| 5 | `harnessProfile()` | Harness domain profiling |
| 6 | `diff()` | Compare describe snapshots |
| 7 | `reachable()` | Graph traversal |
| 8 | `filter() \| take()` | Reactive "first value where…" (replaces _wait_for) |
| 9 | `harnessTrace()` | Pipeline stage trace |

9 tools, no overlaps, no memorization burden.

## Pending work

- PY gate.modify() steering test written but needs re-validation using the new inspection tools once built
- All consolidation items tracked in `docs/roadmap.md` § "Inspection Tool Consolidation"
- All items sized S (half-day each)

## Design invariants enforced

| Invariant | How inspection tools help |
|-----------|--------------------------|
| §5.8 No polling | `filter \| take(1)` replaces `_wait_for` busy-wait loops |
| §5.9 No imperative triggers | `harnessTrace` surfaces gaps in reactive flow (stage fires without upstream event) |
| §5.10 No raw Promises/microtasks | Runner `__repr__` immediately shows missing/misconfigured runner |
| §5.12 Phase 4+ dev-friendly | 9 tools vs 14+ — lower cognitive load for both developers and LLMs |
