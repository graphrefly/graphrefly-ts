---
title: "admissionLlmJudge()"
description: "Adapt an upstream LLM-verdict stream to the synchronous `admissionFilter`\nface. `verdicts` is a Node carrying the current `factId → admit?` map (e.g.\na `promptN"
---

Adapt an upstream LLM-verdict stream to the synchronous `admissionFilter`
face. `verdicts` is a Node carrying the current `factId → admit?` map (e.g.
a `promptNode` accumulating judgements).

## Signature

```ts
function admissionLlmJudge<T>(
	verdicts: Node<ReadonlyMap<FactId, boolean>>,
	opts: AdmissionLlmJudgeOptions = {},
): Node<AdmissionFilter<T>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>verdicts</code> | <code>Node&lt;ReadonlyMap&lt;FactId, boolean&gt;&gt;</code> |  |
| <code>opts</code> | <code>AdmissionLlmJudgeOptions</code> |  |
