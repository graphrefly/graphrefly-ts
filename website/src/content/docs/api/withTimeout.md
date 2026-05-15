---
title: "withTimeout()"
description: "Wrap `source` with a deadline. If no `DATA` arrives within `opts.ns`\nnanoseconds, the result node emits `[[ERROR, TimeoutError]]` and\ntransitions `timeoutState`"
---

Wrap `source` with a deadline. If no `DATA` arrives within `opts.ns`
nanoseconds, the result node emits `[[ERROR, TimeoutError]]` and
transitions `timeoutState` to `"errored"`.

The timer starts on subscription and resets on each `DATA`. `DIRTY`
does NOT reset the timer. Terminal messages (`COMPLETE` / `ERROR`)
cancel the timer.

**Reactive opts (DS-13.5.B, locked 2026-05-01).**

- Static-form callers pass `Partial&lt;TimeoutOptions&gt;` (today's path).
  `ns` is validated at construction; missing / non-positive throws
  `RangeError`.
- Reactive-form callers pass `Node&lt;Partial&lt;TimeoutOptions&gt;&gt;` — each
  emission shallow-merges over the prior opts. Empty `{}` emissions
  are no-ops (no rebind, no companion fire). Mid-flight opts swap
  does NOT reset the in-flight deadline; new `ns` applies to the
  next `startTimer()` call.
- When the opts Node has `cache === undefined` (SENTINEL: no opts
  emitted yet), the source is paused until the first valid opts
  settle. The first valid settle must carry `ns &gt; 0` or the timer
  layer emits an ERROR (downstream observable) — distinct from the
  construction-time `RangeError` thrown for static / cache-defined
  invalid values.

## Signature

```ts
function withTimeout<T>(
	source: Node<T>,
	opts: Partial<TimeoutOptions> | Node<Partial<TimeoutOptions>>,
	extraOpts?: TimeoutExtraOpts,
): TimeoutBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `Partial&lt;TimeoutOptions&gt; | Node&lt;Partial&lt;TimeoutOptions&gt;&gt;` | `Partial&lt;TimeoutOptions&gt;` (static) or
`Node&lt;Partial&lt;TimeoutOptions&gt;&gt;` (reactive). |
| `extraOpts` | `TimeoutExtraOpts` | Forwarded factory metadata (meta field merged
onto the result node). |
