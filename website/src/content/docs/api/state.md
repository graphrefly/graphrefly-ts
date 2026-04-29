---
title: "state()"
description: "Creates a manual source node. Drive it with `state.emit(v)` (framed,\ndiamond-safe) or `state.down([[DATA, v]])` (raw compat path).\n\n**Sentinel form.** Omit `ini"
---

Creates a manual source node. Drive it with `state.emit(v)` (framed,
diamond-safe) or `state.down([[DATA, v]])` (raw compat path).

**Sentinel form.** Omit `initial` (or pass `undefined`) to leave the
node in `"sentinel"` status — the canonical "no value yet" state.
Downstream `derived` first-run gate then waits for the first real DATA
before firing. Pass an explicit `null` to cache `null` as DATA — `null`
is a valid DATA value per spec §2.2 ("`T | null` is the only valid DATA
domain; `undefined` is reserved as the global SENTINEL").

## Signature

```ts
function state<T>(initial?: T, opts?: Omit<NodeOptions<T>, "initial">): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `T` | Starting cached value (optional). Omit or pass
`undefined` for the sentinel form; pass `null` to cache `null`. |
| `opts` | `Omit&lt;NodeOptions&lt;T&gt;, "initial"&gt;` | Optional NodeOptions (excluding `initial`). |

## Basic Usage

```ts
import { state, derived } from "@graphrefly/graphrefly";

// Cached form — starts at 10, derived fires immediately on subscribe.
const counter = state(10);

// Sentinel form — derived's first-run gate waits for the first emit.
const candidates = state<readonly string[]>();
const ready = derived([candidates], ([cands]) => cands.length > 0);
candidates.emit(["v1"]); // ready fires now
```
