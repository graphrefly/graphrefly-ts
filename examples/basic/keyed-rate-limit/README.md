# keyed externally authoritative rate limit

This runnable example shows the complete B111 host-integration boundary without
adding a public persistence API, provider, registry, or application action.

Import the keyed rate-limit domain from `@graphrefly/ts/rate-limit`. Import
`KeyedRateLimitAuthority` and `attachKeyedRateLimitAuthority` from
`@graphrefly/ts/adapters`. The package root and
`@graphrefly/ts/orchestration` do not re-export the rate-limit domain.

## Run

```bash
pnpm --filter @graphrefly-examples/keyed-rate-limit typecheck
pnpm --filter @graphrefly-examples/keyed-rate-limit test
```

The example uses only non-secret placeholders. Requests and outcomes are
ordinary observable Graph DATA, so real hosts must choose their own safe
diagnostic and data-handling policy.

## Host order

The controlled `ExampleAtomicAuthority` follows this order inside one
host-owned atomic consume boundary:

1. Strictly validate and identify the complete request.
2. Look up the receipt by authority and request id.
3. For identical material, return the stored outcome without policy, state,
   time, evaluator, or commit access.
4. For different material under the same request id, return conflict.
5. Resolve the exact policy.
6. Load the exact scoped state.
7. Acquire authoritative `observedAtMs`.
8. Evaluate one optional reference transition.
9. Atomically replace the exact `nextState` and outcome receipt.
10. Supply the externally authoritative outcome through the adapter.
11. Correlate the outcome into an admission or ready denial.
12. Let the protected effect read only `adapter.admission.admissions` and apply
    its separate application-owned effect receipt.

`keyedRateLimitRequestIdentity` supplies canonical identity; consumers do not
hand-author canonical encoding. The in-memory atomic image is a deterministic
teaching model, not a database implementation or certification.

## Domain roles

- A **request** binds request id, opaque key, exact policy and algorithm
  revision, authority, operation, and positive units.
- An **outcome** is the externally authoritative host decision.
- An **admission** is the correlated Graph fact created only from a valid
  `allowed` outcome.
- A **denial** is a ready valid quota denial created only from a valid `denied`
  outcome. Unavailable, conflict, malformed, mismatched, overflow, and orphan
  material fails closed through status and issues; it is not a denial.
- A **policy** defines exact algorithm configuration and scope.
- **State** is exact algorithm-specific quota state for key, policy/algorithm
  revision, authority, and state revision.
- Evaluator **input** combines request, exact policy, exact state or explicit
  first initialization, and externally supplied `observedAtMs`.
- A **transition** is an immutable ready calculation containing `nextState`.
  It is not an outcome, receipt, admission, clock, transaction, or Graph node.

## Reference evaluators

All evaluator calls receive explicit `observedAtMs`; the example never calls
`Date.now`.

- Fixed Window uses Unix-epoch-aligned half-open windows `[start, end)`.
  Observation at `end` starts the next window. Units above capacity are a
  permanent valid denial with `retryAfterMs: null`.
- Sliding Window keeps an exact bounded successful-consumption ledger. Entries
  at or before `observedAtMs - windowMs` expire, and equal-millisecond
  successful consumption coalesces. Active entries are not approximated or
  silently evicted.
- Token Bucket uses integer-rational refill with a persisted remainder.
  Saturation discards excess credit and remainder, and a valid denial still
  advances returned refill state.

The evaluators are optional synchronous pure host-side calculators. They are
not Graph nodes, admission authorities, clocks, persistence owners,
transaction managers, durable receipt owners, or protected-effect executors.

`custom-authority.ts` shows a host algorithm that implements
`KeyedRateLimitAuthority` without importing a reference evaluator and without
an algorithm registry, policy SDK, provider registry, or callback engine.

## Replay and exactly-once boundaries

Durable quota-receipt replay and protected application-effect receipts are
different boundaries. Quota replay prevents consumption from advancing twice.
The bounded live gate suppresses a second admission only while its completed
correlation entry remains retained. A fresh Graph can admit the same stored
outcome again, so cross-restart or multi-instance protected-effect exactly-once
requires an application/executor-owned effect receipt.

The example uses a process-local `Set` only to make that second boundary
visible. It is not durable: each fresh consumer has its own set and may execute
the same stored admission once.

B111.6 is deterministic serialized atomic contract-model evidence. It does not
certify SQLite, Redis, fsync, crash-mid-commit recovery, or real
parallel-process isolation.

## Local helper

`localFixedWindowRateLimitBundle` is a graph-local, in-memory, non-keyed stream
shaper. It is not durable, atomic across processes, or a multi-instance
authority. Governed protected effects should not bypass the bounded authority
adapter through its `allowed` node.
