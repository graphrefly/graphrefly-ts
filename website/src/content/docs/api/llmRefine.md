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
| <code>currentSpec</code> | <code>GraphSpec</code> | The current GraphSpec to modify. |
| <code>feedback</code> | <code>string</code> | Natural language feedback or changed requirements. |
| <code>adapter</code> | <code>LLMAdapter</code> | LLM adapter for the generation call. |
| <code>opts</code> | <code>LLMRefineOptions</code> | Model options. |

## Returns

A new GraphSpec incorporating the feedback.
