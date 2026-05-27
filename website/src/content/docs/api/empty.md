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
| <code>opts</code> | <code>ExtraOpts</code> | Optional producer options. |

## Returns

`Node&lt;T&gt;` — terminal `COMPLETE` only.

## Basic Usage

```ts
import { empty } from "@graphrefly/pure-ts";

empty();
```
