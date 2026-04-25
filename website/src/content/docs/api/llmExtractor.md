---
title: "llmExtractor()"
description: "Returns an `extractFn` callback for `distill()` that invokes an LLM to\nextract structured memories from raw input.\n\nThe system prompt should instruct the LLM to"
---

Returns an `extractFn` callback for `distill()` that invokes an LLM to
extract structured memories from raw input.

The system prompt should instruct the LLM to return JSON matching
`Extraction&lt;TMem&gt;` shape: `{ upsert: [{ key, value }], remove?: [key] }`.

Built on `promptNode({format: "json"})` — inherits markdown-fence stripping
and content-preview parse errors. Stack `withRetry` on the adapter for
transient-error tolerance (see `patterns/ai/adapters/middleware/retry.ts`).

## Signature

```ts
function llmExtractor<TRaw, TMem>(
	systemPrompt: string,
	opts: LLMExtractorOptions,
): (raw: TRaw, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `systemPrompt` | `string` |  |
| `opts` | `LLMExtractorOptions` |  |
