---
title: "auditedSuccessTracker()"
description: "Construct an AuditedSuccessTrackerGraph. Replaces the prior\n`effectivenessTracker()` and `strategyModel()` factories."
---

Construct an AuditedSuccessTrackerGraph. Replaces the prior
`effectivenessTracker()` and `strategyModel()` factories.

## Signature

```ts
function auditedSuccessTracker<
	TKey extends string = string,
	TEntry extends AuditedSuccessEntry<TKey> = AuditedSuccessEntry<TKey>,
>(opts?: AuditedSuccessTrackerOptions): AuditedSuccessTrackerGraph<TKey, TEntry>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `AuditedSuccessTrackerOptions` |  |

## Basic Usage

```ts
// Generic per-action tracker
const tracker = auditedSuccessTracker({ name: "ab-test" });
tracker.record("variant-a", true);
tracker.record("variant-b", false);
tracker.entries.subscribe(snap => console.log(snap.get("variant-a")));

// Composite-key (rootCause × intervention) tracker — caller computes the key
type StrategyEntry = AuditedSuccessEntry<StrategyKey> & {
  rootCause: RootCause;
  intervention: Intervention;
};
const strategy = auditedSuccessTracker<StrategyKey, StrategyEntry>({
    name: "strategy",
  });
strategy.record(
  strategyKey(rootCause, intervention),
  true,
  { rootCause, intervention },
);
```
