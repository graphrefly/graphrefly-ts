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
| <code>expr</code> | <code>string</code> |  |
| <code>opts</code> | <code>FromCronOptions</code> |  |
