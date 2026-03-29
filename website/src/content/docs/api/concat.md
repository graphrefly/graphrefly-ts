---
title: "concat()"
description: "Plays all of `firstSrc`, then all of `secondSrc`. **`DATA`** from `secondSrc` during phase one is buffered until handoff."
---

Plays all of `firstSrc`, then all of `secondSrc`. **`DATA`** from `secondSrc` during phase one is buffered until handoff.

## Signature

```ts
function concat<T>(firstSrc: Node<T>, secondSrc: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `firstSrc` | `Node&lt;T&gt;` | First segment. |
| `secondSrc` | `Node&lt;T&gt;` | Second segment. |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Concatenated stream.

## Basic Usage

```ts
import { concat, state } from "@graphrefly/graphrefly-ts";

const n = concat(state(1), state(2));
```
