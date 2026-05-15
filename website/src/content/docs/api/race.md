---
title: "race()"
description: "First source to emit **`DATA`** wins; later traffic follows only the winner (Rx-style `race`)."
---

First source to emit **`DATA`** wins; later traffic follows only the winner (Rx-style `race`).

## Signature

```ts
function race<T>(...sources: readonly Node<T>[]): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `readonly Node&lt;T&gt;[]` | Contestants (variadic; throws at construction when empty; one node is identity). |

## Returns

`Node&lt;T&gt;` - Winning stream.

## Basic Usage

```ts
import { race, state } from "@graphrefly/graphrefly-ts";

const n = race(state(1), state(2));
```
