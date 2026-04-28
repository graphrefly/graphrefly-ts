---
title: "guardedExecution()"
description: "Wrap a Graph with policyGate plus a reactive scoped describe\nlens. Returns a GuardedExecutionGraph that can be mounted, diffed,\nor composed with graphLens."
---

Wrap a Graph with policyGate plus a reactive scoped describe
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
    actor: state<Actor>({ type: "human", id: "alice" }), // reactive — re-derive on swap
    policies: [
      { effect: "allow", action: "read", actorType: "human" },
      { effect: "deny", action: "write", pathPattern: "system::*" },
    ],
  mode: "enforce",
});

// Canonical: subscribe to the mounted reactive describe (no per-call leak).
guarded.scopedDescribe.subscribe((msgs) => { /* live describe per actor / topology change *\/ });
// Per-call escape hatch (different actor / detail) — caller manages dispose.
const detailed = guarded.scopedDescribeNode(undefined, { detail: "standard" });
try { detailed.node.subscribe(/* … *\/); } finally { detailed.dispose(); }
guarded.violations.events.subscribe(msgs => console.log("violations:", msgs));
guarded.lints.events.subscribe(msgs => console.warn("lints:", msgs));
guarded.scope.subscribe(msgs => console.log("scope:", msgs));
```
