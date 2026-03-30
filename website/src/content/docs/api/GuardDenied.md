---
title: "GuardDenied()"
description: "Thrown when a NodeGuard denies an action for a given actor.\n\nCarries the rejected `actor`, `action`, and optional `nodeName` for diagnostic\nmessages and middlew"
---

Thrown when a NodeGuard denies an action for a given actor.

Carries the rejected `actor`, `action`, and optional `nodeName` for diagnostic
messages and middleware error handling.

## Signature

```ts
class GuardDenied
```

## Basic Usage

```ts
import { GuardDenied, policy } from "@graphrefly/graphrefly-ts";

const guard = policy((allow) => { allow("observe"); });
try {
  if (!guard({ type: "llm", id: "agent-1" }, "write")) {
    throw new GuardDenied(
      { actor: { type: "llm", id: "agent-1" }, action: "write", nodeName: "userInput" },
    );
}
} catch (e) {
if (e instanceof GuardDenied) console.error(e.action, e.actor.type); // "write" "llm"
}
```
