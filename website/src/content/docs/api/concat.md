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
| <code>firstSrc</code> | <code>Node&lt;T&gt;</code> | First segment. |
| <code>secondSrc</code> | <code>Node&lt;T&gt;</code> | Second segment. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Concatenated stream.

## Basic Usage

```ts
import { concat, state } from "@graphrefly/pure-ts";

const n = concat(state(1), state(2));
```
