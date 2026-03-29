---
title: "CircuitBreaker()"
description: "Small synchronous circuit breaker with `closed`, `open`, and `half-open` states (aligned with roadmap §3.1)."
---

Small synchronous circuit breaker with `closed`, `open`, and `half-open` states (aligned with roadmap §3.1).

## Signature

```ts
class CircuitBreaker
```

## Behavior Details

- **Timing:** Uses `performance.now()` for cooldown (milliseconds). Not thread-safe across workers; JS runtimes are single-threaded.
