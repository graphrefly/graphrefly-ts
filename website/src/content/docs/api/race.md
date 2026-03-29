---
title: "race()"
description: "First source to emit **`DATA`** wins; later traffic follows only the winner (Rx-style `race`)."
---

First source to emit **`DATA`** wins; later traffic follows only the winner (Rx-style `race`).

## Signature

```ts
function race<T>(sources: readonly Node<T>[], opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `readonly Node&lt;T&gt;[]` | Contestants (empty completes immediately; one node is identity). |
| `opts` | `ExtraOpts` | Optional  (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Winning stream.

## Basic Usage

```ts
import { race, state } from "@graphrefly/graphrefly-ts";

const n = race([state(1), state(2)]);
```
