---
title: "gate()"
description: "Forwards upstream `DATA` only while `control.get()` is truthy; when closed, emits `RESOLVED`\ninstead of repeating the last value (value-level gate). For protoco"
---

Forwards upstream `DATA` only while `control.get()` is truthy; when closed, emits `RESOLVED`
instead of repeating the last value (value-level gate). For protocol pause/resume, use pausable.

## Signature

```ts
function gate<T>(source: Node<T>, control: Node<boolean>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` | Upstream value node. |
| `control` | `Node&lt;boolean&gt;` | Boolean node; when falsy, output stays “closed” for that tick. |
| `opts` | `ExtraOpts` | Optional node options (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` gated by `control`.

## Basic Usage

```ts
import { gate, state } from "@graphrefly/graphrefly-ts";

const data = state(1);
const open = state(true);
gate(data, open);
```
