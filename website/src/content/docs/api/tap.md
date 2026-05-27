---
title: "tap()"
description: "Invokes side effects; values pass through unchanged.\n\nAccepts either a function (called on each DATA) or an observer object\n`{ data?, error?, complete? }` for l"
---

Invokes side effects; values pass through unchanged.

Accepts either a function (called on each DATA) or an observer object
`{ data?, error?, complete? }` for lifecycle-aware side effects.

## Signature

```ts
function tap<T>(
	source: Node<T>,
	fnOrObserver: ((value: T) => void) | TapObserver<T>,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>source</code> | <code>Node&lt;T&gt;</code> | Upstream node. |
| <code>fnOrObserver</code> | <code>((value: T) =&gt; void) | TapObserver&lt;T&gt;</code> | Side effect function or observer object. |
| <code>opts</code> | <code>ExtraOpts</code> | Optional NodeOptions (excluding `describeKind`). |

## Returns

`Node&lt;T&gt;` - Passthrough node.

## Basic Usage

```ts
import { tap, state } from "@graphrefly/pure-ts";

// Function form (DATA only)
tap(state(1), (x) => console.log(x));

// Observer form (DATA + ERROR + COMPLETE)
tap(state(1), { data: console.log, error: console.error, complete: () => console.log("done") });
```
