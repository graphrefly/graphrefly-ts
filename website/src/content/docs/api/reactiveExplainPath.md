---
title: "reactiveExplainPath()"
description: "API reference for reactiveExplainPath."
---

## Signature

```ts
function reactiveExplainPath(
	target: Graph,
	from: string,
	to: string,
	opts?: { maxDepth?: number; name?: string; findCycle?: boolean },
): { node: Node<CausalChain>; dispose: () => void }
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` |  |
| `from` | `string` |  |
| `to` | `string` |  |
| `opts` | `{ maxDepth?: number; name?: string; findCycle?: boolean }` |  |
