---
title: "isBatching()"
description: "Returns whether the current call stack is inside a batch scope **or** while\ndeferred phase-2 work is draining.\n\nMatching Python's `is_batching()` semantics: nes"
---

Returns whether the current call stack is inside a batch scope **or** while
deferred phase-2 work is draining.

Matching Python's `is_batching()` semantics: nested emissions during drain
are deferred until the current drain pass completes, preventing ordering
bugs when callbacks trigger further DATA/RESOLVED.

## Signature

```ts
function isBatching(): boolean
```

## Returns

`true` while inside `batch()` or while the drain loop is running.

## Basic Usage

```ts
import { batch, isBatching } from "@graphrefly/graphrefly-ts";

batch(() => {
    console.log(isBatching()); // true
  });
```
