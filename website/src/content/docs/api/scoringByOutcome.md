---
title: "scoringByOutcome()"
description: "Build a continual-learning ScoringPolicy Node from an\nOutcomeSignal stream. Pass the SAME `outcomes` Node as both\n`config.outcome` and (via this recipe) `config"
---

Build a continual-learning ScoringPolicy Node from an
OutcomeSignal stream. Pass the SAME `outcomes` Node as both
`config.outcome` and (via this recipe) `config.scoring`.

## Signature

```ts
function scoringByOutcome<T>(
	outcomes: Node<OutcomeSignal>,
	opts: ScoringByOutcomeOptions<T> = {},
): Node<ScoringPolicy<T>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>outcomes</code> | <code>Node&lt;OutcomeSignal&gt;</code> |  |
| <code>opts</code> | <code>ScoringByOutcomeOptions&lt;T&gt;</code> |  |
