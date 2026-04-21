---
title: "parseRateLimitFromError()"
description: "Extract a RateLimitSignal from a fetch-style error object, a Response,\nor any object exposing `.status` + `.headers` + `.message`.\n\nReturns `undefined` if no ra"
---

Extract a RateLimitSignal from a fetch-style error object, a Response,
or any object exposing `.status` + `.headers` + `.message`.

Returns `undefined` if no rate-limit information can be extracted.

## Signature

```ts
function parseRateLimitFromError(err: unknown): RateLimitSignal | undefined
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `err` | `unknown` |  |
