---
title: "pausable()"
description: "Identity passthrough — `pausable()` has been promoted to default node behavior in v5 (§4)."
---

Identity passthrough — `pausable()` has been promoted to default node behavior in v5 (§4).

## Signature

```ts
function pausable<T>(source: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Pass-through (identity).

## Basic Usage

```ts
import { pausable, state } from "@graphrefly/graphrefly-ts";

// No longer needed — default nodes handle PAUSE/RESUME.
const s = state(0);
pausable(s); // identity passthrough
```
