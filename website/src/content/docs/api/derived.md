---
title: "derived()"
description: "Creates a derived node that computes **one output per wave** from the latest\nvalue of each dependency — **snapshot / combine semantics**.\n\n`fn` receives one sca"
---

Creates a derived node that computes **one output per wave** from the latest
value of each dependency — **snapshot / combine semantics**.

`fn` receives one scalar per dep (the last DATA value seen this wave, or the
prior-wave value as fallback). It is called once per settled wave and emits
a single value via `actions.emit`. The equals check then suppresses the
emission as `RESOLVED` if the output has not changed.

**Not for streaming one-to-one transforms.** If each DATA value in a batch
must produce a corresponding output (e.g. transforming every item emitted by
`fromIter` individually), use map or raw `node()` with full batch
iteration instead. `derived` only sees the *last* value per dep when a batch
carries multiple DATAs.

## Signature

```ts
function derived<T = unknown>(
	deps: readonly Node[],
	fn: DerivedFn<T>,
	opts?: NodeOptions<T> & { partial?: boolean },
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `readonly Node[]` |  |
| `fn` | `DerivedFn&lt;T&gt;` |  |
| `opts` | `NodeOptions&lt;T&gt; & { partial?: boolean }` |  |

## Basic Usage

```ts
const a = state(1);
const b = derived([a], ([x]) => (x as number) * 2);
```
