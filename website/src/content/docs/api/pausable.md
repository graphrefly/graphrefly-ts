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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Pass-through (identity).

## Basic Usage

```ts
import { pausable, state } from "@graphrefly/pure-ts";

// No longer needed — default nodes handle PAUSE/RESUME.
const s = state(0);
pausable(s); // identity passthrough
```
