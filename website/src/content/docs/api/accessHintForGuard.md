---
title: "accessHintForGuard()"
description: "Derives a best-effort `meta.access` hint string by probing `guard` with the\nstandard actor types `human`, `llm`, `wallet`, `system` for the `\"write\"` action\n(ro"
---

Derives a best-effort `meta.access` hint string by probing `guard` with the
standard actor types `human`, `llm`, `wallet`, `system` for the `"write"` action
(roadmap 1.5). Aligned with graphrefly-py `access_hint_for_guard`.

## Signature

```ts
function accessHintForGuard(guard: NodeGuard): string
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `guard` | `NodeGuard` | Guard function to probe (typically from policy). |

## Returns

`"restricted"` when no standard type is allowed; `"both"` when both
`human` and `llm` are allowed (plus optionally `system`); the single allowed
type name when only one passes; or a `"+"` joined list otherwise.

## Basic Usage

```ts
import { policy, accessHintForGuard } from "@graphrefly/graphrefly-ts";

const guardBoth = policy((allow) => { allow("write"); });
accessHintForGuard(guardBoth); // "both"

const guardHuman = policy((allow) => {
    allow("write", { where: (a) => a.type === "human" });
  });
accessHintForGuard(guardHuman); // "human"
```
