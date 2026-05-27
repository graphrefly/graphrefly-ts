---
title: "of()"
description: "Emits each argument as `DATA` in order, then `COMPLETE` (implemented via fromIter)."
---

Emits each argument as `DATA` in order, then `COMPLETE` (implemented via fromIter).

## Signature

```ts
function of<T>(...values: T[]): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>values</code> | <code>T[]</code> | Values to emit. |

## Returns

`Node&lt;T&gt;` — finite sequence.

## Basic Usage

```ts
import { of } from "@graphrefly/pure-ts";

of(1, 2, 3);
```
