---
title: "downWithBatch()"
description: "Deliver pre-sorted messages through `sink` with tier-based deferral applied.\n\n`messages` MUST be in ascending tier order (produced by `_frameBatch` in\n`node.ts`"
---

Deliver pre-sorted messages through `sink` with tier-based deferral applied.

`messages` MUST be in ascending tier order (produced by `_frameBatch` in
`node.ts`); the walker exploits that invariant to find phase cuts in one
pass without re-sorting.

Behavior:
- Tier 0–2 — delivered synchronously.
- Tier 3 — deferred to drainPhase2 when batching, else synchronous.
- Tier 4 — deferred to drainPhase3 when batching, else synchronous.
- Tier 5 — deferred to drainPhase4 when batching, else synchronous.

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
