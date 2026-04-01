---
title: "workerBridge()"
description: "API reference for workerBridge."
---

## Signature

```ts
function workerBridge<
	TExpose extends Record<string, Node<any>>,
	TImport extends readonly string[],
>(
	target: unknown | WorkerTransport,
	opts: WorkerBridgeOptions<TExpose, TImport>,
): WorkerBridge<TExpose, TImport>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `unknown | WorkerTransport` |  |
| `opts` | `WorkerBridgeOptions&lt;TExpose, TImport&gt;` |  |
