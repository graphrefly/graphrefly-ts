---
title: "effect()"
description: "Side-effect node: `fn` returns nothing; no auto-emit from return value."
---

Side-effect node: `fn` returns nothing; no auto-emit from return value.

## Signature

```ts
function effect(deps: readonly Node[], fn: NodeFn<unknown>): Node<unknown>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `readonly Node[]` |  |
| `fn` | `NodeFn&lt;unknown&gt;` |  |
