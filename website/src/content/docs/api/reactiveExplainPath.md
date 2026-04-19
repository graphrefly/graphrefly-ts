---
title: "reactiveExplainPath()"
description: "Reactive CausalChain that recomputes whenever the audited graph\nchanges. Returns a `Node<CausalChain>` suitable for subscription, mounting,\nor composition (e.g."
---

Reactive CausalChain that recomputes whenever the audited graph
changes. Returns a `Node&lt;CausalChain&gt;` suitable for subscription, mounting,
or composition (e.g. inside `graphLens.why(node)`).

**How it stays live:** an internal `version` state is bumped by an observer
attached to `target.observe()`; the derived chain depends on `version`, so
each mutation triggers a recompute. To avoid stalling on no-op events, only
`data`, `error`, `complete`, and `teardown` bump the version (matching the
audit defaults).

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
