---
title: "fromRaf()"
description: "Browser animation-frame source for @graphrefly/ts."
---

Browser animation-frame source. It belongs to `@graphrefly/ts/sources/browser`, not the
reactive-layout solution subpath.

## Signature

```ts
import { fromRaf } from "@graphrefly/ts/sources/browser";

function fromRaf(opts?: FromRafOptions): Operator<never, number>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>opts</code> | <code>FromRafOptions</code> | Optional host scheduler, timer fallback cadence, and `pauseWhenHidden` visibility parking. |

Bind it with `graph.initNode(fromRaf(), [])` or another existing operator-binding path. Each frame
timestamp is emitted as protocol `DATA` by the resulting source node. Cleanup cancels the pending
host frame. This is a browser/source boundary, so it does not add protocol behavior and does not
belong to universal core.
