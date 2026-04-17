---
title: "isBatching()"
description: "Returns whether the current call stack is inside a batch scope **or** while\na deferred drain is in progress. Nested `downWithBatch` calls during drain\nstill def"
---

Returns whether the current call stack is inside a batch scope **or** while
a deferred drain is in progress. Nested `downWithBatch` calls during drain
still defer (they bump the drain loop).

## Signature

```ts
function isBatching(): boolean
```
