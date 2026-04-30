---
title: "promptCall()"
description: "Build a one-shot LLM JSON-call factory: each invocation wraps `input` in a\nfresh `node([], { initial: input })`, delegates to `promptNode({format: \"json\"})`, an"
---

Build a one-shot LLM JSON-call factory: each invocation wraps `input` in a
fresh `node([], { initial: input })`, delegates to `promptNode({format: "json"})`, and
returns a `NodeInput&lt;TOut&gt;` that the caller plugs into `distill` /
`agentLoop` / any reactive composition that accepts `NodeInput`.

**Per-call lifecycle.** The returned `NodeInput&lt;TOut&gt;` is a producer that
emits exactly one `DATA` per upstream input (per Tier 1.2 Session C lock —
`promptNode` guarantees one DATA per wave). When the consumer's switchMap
supersedes it, the per-call `node([], { initial: input })` and the inner `prompt_node::call`
tear down together.

## Signature

```ts
function promptCall<TIn, TOut>(
	systemPrompt: string,
	buildUserContent: (input: TIn) => string,
	opts: PromptCallOptions,
	defaultName: string,
): (input: TIn) => NodeInput<TOut>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `systemPrompt` | `string` | System message sent on every call. |
| `buildUserContent` | `(input: TIn) =&gt; string` | Per-input user-content builder (must be JSON-stringifiable). |
| `opts` | `PromptCallOptions` | Adapter + model/temperature/maxTokens + optional name prefix. |
| `defaultName` | `string` | Path-prefix fallback when `opts.name` is omitted. |

## Returns

Factory `(input: TIn) =&gt; NodeInput&lt;TOut&gt;`.
