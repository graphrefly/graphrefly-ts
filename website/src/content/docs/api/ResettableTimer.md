---
title: "ResettableTimer()"
description: "Creates a resettable deadline timer for internal timeout, retry, and rate-limiting use."
---

Creates a resettable deadline timer for internal timeout, retry, and rate-limiting use.

## Signature

```ts
class ResettableTimer
```

## Basic Usage

```ts
import { ResettableTimer } from "@graphrefly/graphrefly-ts";

const timer = new ResettableTimer();
timer.start(1000, () => console.log("fired"));
timer.cancel();          // cancels before firing
timer.start(500, () => console.log("new deadline"));
console.log(timer.pending); // true
```

## Behavior Details

- **Centralised primitive:** wraps `setTimeout`/`clearTimeout` with a generation guard
so that stale callbacks never fire after `cancel()` or a new `start()`.
- **Spec §5.10 exception:** resilience operators (`timeout`, `retry`, `rateLimiter`)
need raw timers — `fromTimer` creates a new Node per reset, which is too heavy here.
Lives in `src/extra/` (not `src/core/`) because it is a documented escape hatch from
the protocol-pure core layer.
