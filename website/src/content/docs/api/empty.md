---
title: "empty()"
description: "Completes immediately with no `DATA` (cold `EMPTY` analogue)."
---

Completes immediately with no `DATA` (cold `EMPTY` analogue).

## Signature

```ts
function empty<T = never>(opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ExtraOpts` | Optional producer options. |

## Returns

`Node&lt;T&gt;` — terminal `COMPLETE` only.

## Basic Usage

```ts
import { empty } from "@graphrefly/graphrefly-ts";

empty();
```
