---
title: "debounceTime()"
description: "RxJS-named alias for debounce — drops rapid `DATA` until `ms` of quiet."
---

RxJS-named alias for debounce — drops rapid `DATA` until `ms` of quiet.

## Signature

```ts
function debounce<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream node. |
| `ms` | `number` | Quiet window in milliseconds. |
| `opts` | `ExtraOpts` | Optional NodeOptions (excluding `describeKind`). |

## Returns

Debounced node; behavior matches `debounce`.

## Basic Usage

```ts
import { debounceTime, state } from "@graphrefly/graphrefly-ts";

debounceTime(state(0), 100);
```
