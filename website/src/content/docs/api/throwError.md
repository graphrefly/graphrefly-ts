---
title: "throwError()"
description: "Emits `ERROR` as soon as the producer starts (cold error source)."
---

Emits `ERROR` as soon as the producer starts (cold error source).

## Signature

```ts
function throwError(err: unknown, opts?: ExtraOpts): Node<never>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `err` | `unknown` | Error payload forwarded as `ERROR` data. |
| `opts` | `ExtraOpts` | Optional producer options. |

## Returns

`Node&lt;never&gt;` — terminates with `ERROR`.

## Basic Usage

```ts
import { throwError } from "@graphrefly/graphrefly-ts";

throwError(new Error("fail"));
```
