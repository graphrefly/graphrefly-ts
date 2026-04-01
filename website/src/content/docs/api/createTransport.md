---
title: "createTransport()"
description: "Auto-detect transport type and create a normalized WorkerTransport.\n\nSupports:\n- `Worker` — direct postMessage/onmessage\n- `SharedWorker` — port-based postMessa"
---

Auto-detect transport type and create a normalized WorkerTransport.

Supports:
- `Worker` — direct postMessage/onmessage
- `SharedWorker` — port-based postMessage/onmessage
- `ServiceWorker` — postMessage via controller, listen via navigator.serviceWorker
- `BroadcastChannel` — postMessage/onmessage (no Transferable support)
- `MessagePort` — direct postMessage/onmessage (worker-side SharedWorker port)

## Signature

```ts
function createTransport(target: unknown): WorkerTransport
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `unknown` |  |
