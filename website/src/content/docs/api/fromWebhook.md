---
title: "fromWebhook()"
description: "Bridges HTTP webhook callbacks into a GraphReFly source.\n\nThe `register` callback wires your runtime/framework callback to GraphReFly and may return a\ncleanup f"
---

Bridges HTTP webhook callbacks into a GraphReFly source.

The `register` callback wires your runtime/framework callback to GraphReFly and may return a
cleanup function. This keeps the adapter runtime-agnostic while following the same producer
pattern as fromEvent.

## Signature

```ts
function fromWebhook<T = unknown>(register: WebhookRegister<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `register` | `WebhookRegister&lt;T&gt;` | Registers webhook handlers (`emit`, `error`, `complete`) and optionally returns cleanup. |
| `opts` | `ExtraOpts` | Optional producer options. |

## Returns

`Node&lt;T&gt;` — webhook payloads as `DATA`; teardown runs returned cleanup.

## Basic Usage

```ts
import express from "express";
import { fromWebhook } from "@graphrefly/graphrefly-ts";

type HookPayload = { event: string; data: unknown };
const app = express();
app.use(express.json());

const hook$ = fromWebhook<HookPayload>(({ emit, error }) => {
    const handler = (req: express.Request, res: express.Response) => {
      try {
        emit(req.body as HookPayload);
        res.status(200).send("ok");
      } catch (e) {
      error(e);
      res.status(500).send("error");
    }
};
app.post("/webhook", handler);
return () => {
  // Express has no direct route-removal API in common use.
};
});
```

## Examples

### Fastify

```ts
import Fastify from "fastify";
import { fromWebhook } from "@graphrefly/graphrefly-ts";

const fastify = Fastify();
const hook$ = fromWebhook<any>(({ emit, error }) => {
    const handler = async (req: any, reply: any) => {
      try {
        emit(req.body);
        reply.code(200).send({ ok: true });
      } catch (e) {
      error(e);
      reply.code(500).send({ ok: false });
    }
};
fastify.post("/webhook", handler);
return () => {};
});
```
