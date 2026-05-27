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
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>ms</code> | <code>number</code> | Quiet window in milliseconds. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

Debounced node; behavior matches `debounce`.

## Basic Usage

```ts
import { debounceTime, state } from "@graphrefly/pure-ts";

debounceTime(state(0), 100);
```
