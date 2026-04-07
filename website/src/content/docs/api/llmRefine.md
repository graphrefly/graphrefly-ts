---
title: "llmRefine()"
description: "Ask an LLM to modify an existing GraphSpec based on feedback or changed requirements."
---

Ask an LLM to modify an existing GraphSpec based on feedback or changed requirements.

## Signature

```ts
async function llmRefine(
	currentSpec: GraphSpec,
	feedback: string,
	adapter: LLMAdapter,
	opts?: LLMRefineOptions,
): Promise<GraphSpec>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `currentSpec` | `GraphSpec` | The current GraphSpec to modify. |
| `feedback` | `string` | Natural language feedback or changed requirements. |
| `adapter` | `LLMAdapter` | LLM adapter for the generation call. |
| `opts` | `LLMRefineOptions` | Model options. |

## Returns

A new GraphSpec incorporating the feedback.
