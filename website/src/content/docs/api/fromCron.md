---
title: "fromCron()"
description: "API reference for fromCron."
---

## Signature

```ts
function fromCron(expr: string, opts?: FromCronOptions & { output: "date" }): Node<Date>
function fromCron(expr: string, opts?: FromCronOptions): Node<number>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `expr` | `string` |  |
| `opts` | `FromCronOptions` |  |
