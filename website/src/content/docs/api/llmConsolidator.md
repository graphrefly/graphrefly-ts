---
title: "llmConsolidator()"
description: "Returns a `consolidateFn` callback for `distill()` that invokes an LLM to\ncluster and merge related memories."
---

Returns a `consolidateFn` callback for `distill()` that invokes an LLM to
cluster and merge related memories.

## Signature

```ts
function llmConsolidator<TMem>(
	systemPrompt: string,
	opts: LLMConsolidatorOptions,
): (entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `systemPrompt` | `string` |  |
| `opts` | `LLMConsolidatorOptions` |  |
