---
title: "complianceSnapshot()"
description: "One-shot point-in-time export of a Graph's state plus optional\naudit + policy bundles. Returns a JSON-serializable object with a\ndeterministic truncated-SHA-256"
---

One-shot point-in-time export of a Graph's state plus optional
audit + policy bundles. Returns a JSON-serializable object with a
deterministic truncated-SHA-256 ComplianceSnapshotResult.fingerprint
over the canonical payload for tamper-evidence in regulatory archival.

**Cryptographic strength:** the fingerprint is truncated to 64 bits for
compact archival. Collision-resistant for casual integrity checks but NOT
sufficient for adversarial tamper-evidence — pair with a full SHA-256
(or stronger) over the canonical JSON when regulatory requirements demand
collision resistance.

## Signature

```ts
function complianceSnapshot(
	target: Graph,
	opts: ComplianceSnapshotOptions = {},
): ComplianceSnapshotResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` |  |
| `opts` | `ComplianceSnapshotOptions` |  |
