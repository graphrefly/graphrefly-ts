---
title: "validateGraphObservability()"
description: "Exercise every observability surface on `graph` and report failures.\n\nDoes NOT throw — returns a structured result so callers (dry-run blocks,\nCLI smoke tests, "
---

Exercise every observability surface on `graph` and report failures.

Does NOT throw — returns a structured result so callers (dry-run blocks,
CLI smoke tests, MCP reduce-path validators) can exit non-zero with a
diagnostic instead of letting the process crash mid-inspection.

## Signature

```ts
function validateGraphObservability(
	graph: Graph,
	opts: ValidateObservabilityOptions = {},
): ValidateObservabilityResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` |  |
| `opts` | `ValidateObservabilityOptions` |  |

## Basic Usage

```ts
const result = validateGraphObservability(graph, {
    paths: ["input", "output"],
    pairs: [["input", "output"]],
  });
if (!result.ok) {
  console.error(result.summary());
  for (const f of result.failures) console.error(f);
  process.exit(3);
}
```
