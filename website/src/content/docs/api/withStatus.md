---
title: "withStatus()"
description: "Wraps `src` with `status` and `error` state companions for UI or meta snapshots."
---

Wraps `src` with `status` and `error` state companions for UI or meta snapshots.

## Signature

```ts
function withStatus<T>(
	src: Node<T>,
	options?: { initialStatus?: StatusValue; meta?: Record<string, unknown> },
): WithStatusBundle<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `src` | `Node&lt;T&gt;` | Upstream node to mirror. |
| `options` | `{ initialStatus?: StatusValue; meta?: Record&lt;string, unknown&gt; }` | `initialStatus` defaults to `"pending"`. |

## Returns

`{ node, status, error }` where `out` is the mirrored stream, `status` is a
reactive `Node&lt;StatusValue&gt;` (`"pending" | "running" | "completed" | "errored"`),
and `error` holds the last `ERROR` payload (cleared to `null` on the next `DATA`
after `errored`).

## Basic Usage

```ts
import { withStatus, state } from "@graphrefly/graphrefly-ts";

const src = state<number>(0);
const { node, status, error } = withStatus(src);

status.subscribe((msgs) => console.log("status:", msgs));
src.down([[DATA, 42]]); // status → "running"
```

## Behavior Details

- **Lifecycle:** `pending` (no DATA yet) → `running` (on first DATA) → `completed`
(on COMPLETE) or `errored` (on ERROR). After `errored`, the next `DATA` clears
`error` and re-enters `running` inside a batch so subscribers see one
consistent transition (matches graphrefly-py).

**Producer-pattern visibility:** `out` is built via `node([], fn, …)`, so `src`
appears as the source dependency in `describe()` traversal but the `status` /
`error` companions are mirrored via subscribe-callback effects — they appear
under `out.meta.status` / `out.meta.error` (and as `<name>::__meta__::status`
paths in `describe()`) rather than as separate top-level edges. Subscribers
to `out` see the throttled DATA stream; `status` / `error` companions may not
appear as edges in `describe()` if no consumer subscribes to them (per
COMPOSITION-GUIDE §1, push-on-subscribe semantics).

**Per-subscribe lifecycle (DF8, 2026-04-29 doc lock).** When the wrapped
source is `resubscribable: true` and multiple consumers attach in
sequence, each new subscription cycle re-runs the producer fn AND
re-emits the initial `pending` + `null` companion DATAs. Downstream
subscribers to the `status` / `error` companions see thrash:
`pending → running → completed → pending → running …`. This is the
intended fresh-cycle semantic (each subscription cycle reports its own
lifecycle); consumers that need a "stable" status across cycles should
derive a snapshot via a separate `state()` mirror rather than depending
on the per-cycle reset.
