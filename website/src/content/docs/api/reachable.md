---
title: "reachable()"
description: "API reference for reachable."
---

## Signature

```ts
function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions & { withDetail: true },
): ReachableResult
function reachable(
	described: GraphDescribeOutput,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions,
): string[]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>described</code> | <code>GraphDescribeOutput</code> |  |
| <code>from</code> | <code>string</code> |  |
| <code>direction</code> | <code>ReachableDirection</code> |  |
| <code>options</code> | <code>ReachableOptions</code> |  |
