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
| `described` | `GraphDescribeOutput` |  |
| `from` | `string` |  |
| `direction` | `ReachableDirection` |  |
| `options` | `ReachableOptions` |  |
