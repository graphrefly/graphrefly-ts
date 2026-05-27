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
| <code>target</code> | <code>unknown | WorkerTransport</code> |  |
| <code>opts</code> | <code>WorkerBridgeOptions&lt;TExpose, TImport&gt;</code> |  |
