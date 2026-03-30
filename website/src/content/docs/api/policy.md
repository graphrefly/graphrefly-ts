---
title: "policy()"
description: "Declarative guard builder. Precedence: any matching **deny** blocks even if an allow also matches.\nIf no rule matches, the guard returns `false` (deny-by-defaul"
---

Declarative guard builder. Precedence: any matching **deny** blocks even if an allow also matches.
If no rule matches, the guard returns `false` (deny-by-default). Aligned with graphrefly-py `policy()`.

## Signature

```ts
function policy(build: (allow: PolicyAllow, deny: PolicyDeny) => void): NodeGuard
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `build` | `(allow: PolicyAllow, deny: PolicyDeny) =&gt; void` | Callback that registers `allow(...)` / `deny(...)` rules in order. |

## Returns

A `NodeGuard` for use as `node({ guard })`.

## Basic Usage

```ts
const guard = policy((allow, deny) => {
    allow("observe");
    deny("write", { where: (a) => a.type === "llm" });
  });
```
