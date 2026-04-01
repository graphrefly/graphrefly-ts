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
| `target` | `unknown | WorkerTransport` |  |
| `opts` | `WorkerSelfOptions&lt;TImport&gt;` |  |
