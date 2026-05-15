---
title: "budgetGate()"
description: "Pass-through that respects reactive constraint nodes.\n\nDATA flows through when all constraints are satisfied. When any constraint\nis exceeded, `PAUSE` is sent u"
---

Pass-through that respects reactive constraint nodes.

DATA flows through when all constraints are satisfied. When any constraint
is exceeded, `PAUSE` is sent upstream and DATA is buffered in a FIFO queue.
When constraints relax, the queue drains in arrival order and `RESUME` is
sent upstream.

## Invariants (do not refactor without preserving)

1. **Terminal force-flush.** On `COMPLETE` / `ERROR` arriving from `source`,
   every buffered item is emitted downstream BEFORE the terminal message is
   forwarded. The constraint is intentionally bypassed for the flush — once
   upstream is done, the caller must see the buffered work, not lose it.
   See COMPOSITION-GUIDE §19 (terminal-emission operators).

2. **PAUSE-release ordering.** When a constraint flips from saturated →
   released, the queue drains in FIFO order downstream BEFORE `RESUME` is
   sent upstream. Reversing the order (RESUME-then-drain) would let new
   upstream DATA interleave with the queue tail, breaking arrival-order
   delivery. See COMPOSITION-GUIDE §9, §9a (diamond + batch coalescing).

3. **Deferred RESOLVED.** A `RESOLVED` from `source` while the queue is
   non-empty is held until the queue drains, then forwarded — so downstream
   sees `[buffered DATA…, RESOLVED]` in causal order rather than
   `[RESOLVED, buffered DATA…]`.

   **Stall risk (qa D4):** if the constraint never relaxes AND no terminal
   arrives from `source`, the deferred RESOLVED is held forever. Downstream
   consumers that depend on `RESOLVED` for an `awaitSettled`-style
   coordination wait stall in this case. PAUSE is sent upstream so source
   backpressure stops further DATA, but the gate itself has no escape
   hatch — by design (the producer-pattern is fire-and-forget; recovery
   happens at the compositor level via timeout, retry, or cancellation).

4. **Constraint DIRTY suppression.** Constraint-node DIRTY does NOT
   propagate downstream — only `source`-DIRTY does. The gate's downstream
   semantics track `source`'s wave, not constraint waves.

5. **Lazy PAUSE (qa D3).** PAUSE is sent upstream ONLY when a `source` DATA
   arrives that fails the constraint check (the first blocked item). A
   constraint flipping closed BEFORE any source DATA arrives does NOT emit
   a preemptive PAUSE — upstream may push DATA freely until the first
   item is buffered. This matches the producer-pattern lazy-activation
   philosophy (don't impose backpressure for hypothetical future blocks).
   For eager-PAUSE semantics, wrap the gate in a compositor that watches
   constraints + source independently.

## Queue

The internal buffer is an unbounded HeadIndexQueue (O(1) push,
O(1) shift, opportunistic compaction). It does NOT use RingBuffer
because RingBuffer's drop-oldest eviction would silently lose buffered
items between PAUSE and RESUME. Backpressure (PAUSE) is the upstream
contract for bounding the queue, not capacity-driven eviction here.

## Producer-pattern: source edge is invisible to `describe()`

`budgetGate` is constructed via `node([], fn)` and subscribes to `source`
and the constraint nodes manually inside its activation fn. Because no
dep is declared at construction, **`describe()` shows no edge from
`source` (or any constraint) into the returned node** — the gate looks
like a standalone leaf source. This is intentional (see COMPOSITION-GUIDE
§24 "Edges are derived, not declared"): if you want the constraint /
source dependency to appear in describe output, surface it at the
compositor level (e.g. annotate via `meta.ai.upstream`, or wrap the gate
in a parent factory that exposes the deps as constructor args).

## Reference equality + Tier 6.5 3.2.5 locked semantics

**Constraint VALUES are reactive.** Each `BudgetConstraint.node` is
subscribed at activation; per-value changes flip the gate (re-evaluate
in the same wave) and trigger PAUSE/RESUME upstream. Per the locked
semantic rule for the reactive-options-widening batch (Tier 6.5 3.2.5,
2026-04-29): "constraints array re-evaluated immediately against
current source; adding/removing constraints triggers gate
re-evaluation in the same wave" — the per-value half is shipped via
the existing constraint-Node subscription model.

**The constraints ARRAY shape is static.** The factory captures the
`constraints` array reference and each `check` function at
construction; it does NOT diff subsequent arrays. To add or remove
constraints reactively, build the swap at the compositor level (a
`switchMap` rebuild over a constraint-shape Node), or construct a new
gate. Dynamic constraint-array reactivity is intentionally deferred —
the subscription churn (resub on every constraint add/remove) and
`latestValues` shape mutation overshoot the budget-gate's
fire-and-forget ergonomics.

## Signature

```ts
function budgetGate<T>(
	source: Node<T>,
	constraints: ReadonlyArray<BudgetConstraint>,
	opts?: BudgetGateOptions,
): BudgetGateBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Input node. |
| `constraints` | `ReadonlyArray&lt;BudgetConstraint&gt;` | Reactive constraint checks. MUST be non-empty. |
| `opts` | `BudgetGateOptions` | Optional node options. |

## Returns

Gated node.
