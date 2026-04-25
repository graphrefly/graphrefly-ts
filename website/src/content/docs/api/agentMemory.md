---
title: "agentMemory()"
description: "Pre-wired agentic memory graph. Sugar over `distill` plus the\n`memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval`\ncomposers. Power user"
---

Pre-wired agentic memory graph. Sugar over `distill` plus the
`memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval`
composers. Power users who want a subset of capabilities can call those
composers directly; this factory bundles them into one ergonomic call.

## Signature

```ts
function agentMemory<TMem = unknown>(
	name: string,
	source: NodeInput<unknown>,
	opts: AgentMemoryOptions<TMem>,
): AgentMemoryGraph<TMem>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` |  |
| `source` | `NodeInput&lt;unknown&gt;` |  |
| `opts` | `AgentMemoryOptions&lt;TMem&gt;` |  |
