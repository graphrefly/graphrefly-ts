---
title: "auditTrail()"
description: "Wraps any Graph with a reactive audit trail recording every event\nmatching `includeTypes` (default: data + error + complete + teardown).\n\nEach entry carries `se"
---

Wraps any Graph with a reactive audit trail recording every event
matching `includeTypes` (default: data + error + complete + teardown).

Each entry carries `seq`, `timestamp_ns` (monotonic), `wall_clock_ns`,
`path`, `type`, and — when available — `actor`, `value`, `error`, and the
`graph.trace()` reasoning annotation for the path.

The returned graph mounts an `entries` node + `count` derived. Query
helpers (`byNode`, `byActor`, `byTimeRange`) operate on the cached
snapshot synchronously.

## Signature

```ts
function auditTrail(target: Graph, opts: AuditTrailOptions = {}): AuditTrailGraph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` |  |
| `opts` | `AuditTrailOptions` |  |
