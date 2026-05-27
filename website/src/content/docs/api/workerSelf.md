---
title: "workerSelf()"
description: "API reference for workerSelf."
---

## Signature

```ts
function workerSelf<TImport extends readonly string[]>(
	target: unknown | WorkerTransport,
	opts: WorkerSelfOptions<TImport>,
): WorkerSelfHandle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>target</code> | <code>unknown | WorkerTransport</code> |  |
| <code>opts</code> | <code>WorkerSelfOptions&lt;TImport&gt;</code> |  |
