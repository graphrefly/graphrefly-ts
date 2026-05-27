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
| <code>err</code> | <code>unknown</code> | Error payload forwarded as `ERROR` data. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional producer options. |

## Returns

`Node&lt;never&gt;` — terminates with `ERROR`.

## Basic Usage

```ts
import { throwError } from "@graphrefly/pure-ts";

throwError(new Error("fail"));
```
