---
title: "downWithBatch()"
description: "Deliver pre-sorted messages through `sink` with tier-based deferral applied.\n\n`messages` MUST be in ascending tier order (produced by `_frameBatch` in\n`node.ts`"
---

Deliver pre-sorted messages through `sink` with tier-based deferral applied.

`messages` MUST be in ascending tier order (produced by `_frameBatch` in
`node.ts`); the walker exploits that invariant to find phase cuts in one
pass without re-sorting.

Behavior (post-DS-13.5.A tier renumbering):
- Tier 0–2 — delivered synchronously.
- Tier 3 (DATA/RESOLVED) — deferred to drainPhase2 when batching.
- Tier 4 (INVALIDATE) — deferred to drainPhase2 alongside the value
  settlements (the "settle slice" — INVALIDATE settles a wave so it must
  land in the same drain phase as DATA/RESOLVED).
- Tier 5 (COMPLETE/ERROR) — deferred to drainPhase3 when batching.
- Tier 6 (TEARDOWN) — deferred to drainPhase4 when batching.

Tier-classification uses the caller-supplied `tierOf` so that batch stays
decoupled from `GraphReFlyConfig`. NodeImpl passes `config.tierOf` (a
pre-bound closure built once in the config constructor) at the emit site;
alternate configs can pass their own lookup.

## Signature

```ts
function downWithBatch(
	sink: (messages: Messages) => void,
	messages: Messages,
	tierOf: (t: symbol) => number,
): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sink` | `(messages: Messages) =&gt; void` |  |
| `messages` | `Messages` |  |
| `tierOf` | `(t: symbol) =&gt; number` |  |
