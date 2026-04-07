---
title: "feedback()"
description: "Introduce a bounded reactive cycle into an existing graph.\n\nWhen `condition` emits a non-null DATA value, the feedback effect routes it\nback to the `reentry` st"
---

Introduce a bounded reactive cycle into an existing graph.

When `condition` emits a non-null DATA value, the feedback effect routes it
back to the `reentry` state node — creating a cycle. Bounded by
`maxIterations` (default 10). The counter node (`__feedback_&lt;condition&gt;`)
is the source of truth — reset it to 0 to allow more iterations.

To remove the feedback cycle, call `graph.remove("__feedback_&lt;condition&gt;")`.

## Signature

```ts
function feedback(
	graph: Graph,
	condition: string,
	reentry: string,
	opts?: FeedbackOptions,
): Graph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Graph` | Existing graph to augment with a feedback cycle. |
| `condition` | `string` | Path to a node whose DATA triggers feedback. |
| `reentry` | `string` | Path to a state node that receives the feedback value. |
| `opts` | `FeedbackOptions` | Iteration bounds and metadata. |

## Returns

The same graph (mutated with feedback nodes added).
