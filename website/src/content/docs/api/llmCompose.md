---
title: "llmCompose()"
description: "Ask an LLM to compose a GraphSpec from a natural-language problem description.\n\nThe LLM generates a GraphSpec (with templates + feedback), validated before\nretu"
---

Ask an LLM to compose a GraphSpec from a natural-language problem description.

The LLM generates a GraphSpec (with templates + feedback), validated before
returning. The spec is for human review before compilation via compileSpec().

## Signature

```ts
async function llmCompose(
	problem: string,
	adapter: LLMAdapter,
	opts?: LLMComposeOptions,
): Promise<GraphSpec>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `problem` | `string` | Natural language problem description. |
| `adapter` | `LLMAdapter` | LLM adapter for the generation call. |
| `opts` | `LLMComposeOptions` | Model options and catalog description. |

## Returns

A validated GraphSpec.
