---
title: "fromEvent()"
description: "Wraps a DOM-style `addEventListener` target; each event becomes a `DATA` emission."
---

Wraps a DOM-style `addEventListener` target; each event becomes a `DATA` emission.

## Signature

```ts
function fromEvent<T = unknown>(
	target: EventTargetLike,
	type: string,
	opts?: ExtraOpts & { capture?: boolean; passive?: boolean; once?: boolean },
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `EventTargetLike` | Object with `addEventListener` / `removeEventListener`. |
| `type` | `string` | Event name (e.g. `"click"`). |
| `opts` | `ExtraOpts & { capture?: boolean; passive?: boolean; once?: boolean }` | Producer options plus listener options (`capture`, `passive`, `once`). |

## Returns

`Node&lt;T&gt;` — event payloads; teardown removes the listener.

## Basic Usage

```ts
import { fromEvent } from "@graphrefly/graphrefly-ts";

fromEvent(document.body, "click");
```
