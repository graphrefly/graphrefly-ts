---
title: "fromPushNotification()"
description: "Wraps a host push transport; each delivered message becomes a `DATA`\nemission. Teardown invokes the registration's unsubscribe."
---

Wraps a host push transport; each delivered message becomes a `DATA`
emission. Teardown invokes the registration's unsubscribe.

## Signature

```ts
function fromPushNotification<T = unknown>(
	register: PushRegister<T>,
	opts?: ExtraOpts,
): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>register</code> | <code>PushRegister&lt;T&gt;</code> | Called on activation with a `deliver(payload)` sink;
returns an optional unsubscribe. |
| <code>opts</code> | <code>ExtraOpts</code> | Producer node options (`name`, `meta`, …). |

## Returns

`Node&lt;T&gt;` — push payloads as a reactive stream.

## Basic Usage

```ts
import { fromPushNotification } from "@graphrefly/graphrefly";

// memo:Re premium backend — opt-in cloud audit pushed (not polled).
const auditPushes = fromPushNotification<AuditEvent>((deliver) => {
    const sub = messaging.onMessage((msg) => deliver(msg.data as AuditEvent));
    return () => sub.remove();
  });
```

## Behavior Details

- A synchronous throw inside `register` propagates as an activation failure
(it is not caught here) — same shape as `fromEvent`. Push transports are
open-ended: this source never emits `COMPLETE`/`ERROR` on its own; the
stream ends only via `onDeactivation` (unsubscribe). Surface a terminal
yourself (e.g. compose a downstream operator) if the host needs one.
