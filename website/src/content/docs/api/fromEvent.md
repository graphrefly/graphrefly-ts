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
| <code>target</code> | <code>EventTargetLike</code> | Object with `addEventListener` / `removeEventListener`. |
| <code>type</code> | <code>string</code> | Event name (e.g. `"click"`). |
| <code>opts</code> | <code>ExtraOpts & { capture?: boolean; passive?: boolean; once?: boolean }</code> | Producer options plus listener options (`capture`, `passive`, `once`). |

## Returns

`Node&lt;T&gt;` — event payloads; teardown removes the listener.

## Basic Usage

```ts
import { fromEvent } from "@graphrefly/graphrefly";

fromEvent(document.body, "click");
```
