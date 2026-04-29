---
title: "inspect()"
description: "Build an InspectGraph that mounts `graphLens` + `auditTrail` over\nthe wrapped target and exposes `explainTarget()` + `complianceSnapshot()`\nfacades."
---

Build an InspectGraph that mounts `graphLens` + `auditTrail` over
the wrapped target and exposes `explainTarget()` + `complianceSnapshot()`
facades.

## Signature

```ts
function inspect(target: Graph, opts: InspectOptions = {}): InspectGraph
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Graph` |  |
| `opts` | `InspectOptions` |  |

## Basic Usage

```ts
import { inspect } from "@graphrefly/graphrefly/patterns/inspect";

const target = buildMyApp();
const view = inspect(target, { actor: { id: "ops-bot", role: "monitor" } });

// Live observability
view.lens.health.subscribe((msgs) => console.log("health:", msgs));
view.lens.flow.subscribe((msgs) => console.log("flow:", msgs));

// Causal explainability across the wrapped target
const chain = view.explainTarget("input", "output");

// Tamper-evident snapshot for archival
const snapshot = view.complianceSnapshot();
```
