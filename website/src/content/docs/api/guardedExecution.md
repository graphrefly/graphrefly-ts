---
title: "guardedExecution()"
description: "Wrap a Graph with policyGate plus a scoped describe\nlens. Returns a GuardedExecutionGraph that can be mounted, diffed,\nor composed with graphLens."
---

Wrap a Graph with policyGate plus a scoped describe
lens. Returns a GuardedExecutionGraph that can be mounted, diffed,
or composed with graphLens.

## Signature

```ts
function guardedExecution(
	target: Graph,
	opts: GuardedExecutionOptions,
): GuardedExecutionGraph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` | The graph to guard. |
| `opts` | `GuardedExecutionOptions` | See GuardedExecutionOptions. |

## Basic Usage

```ts
const guarded = guardedExecution(app, {
    actor: { type: "human", id: "alice" },
    policies: [
      { effect: "allow", action: "read", actorType: "human" },
      { effect: "deny", action: "write", pathPattern: "system::*" },
    ],
  mode: "enforce",
});

const view = guarded.scopedDescribe({ detail: "standard" });
guarded.violations.events.subscribe(msgs => console.log("violations:", msgs));
```
