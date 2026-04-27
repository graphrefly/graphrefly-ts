---
title: "jsonCodecFor()"
description: "Returns the default `jsonCodec` cast to `Codec<T>`.\n\nPure typing helper — no runtime overhead. Use when a generic API requires a\n`Codec<T>` and the value is kno"
---

Returns the default `jsonCodec` cast to `Codec&lt;T&gt;`.

Pure typing helper — no runtime overhead. Use when a generic API requires a
`Codec&lt;T&gt;` and the value is known to be JSON-serializable.

## Signature

```ts
function jsonCodecFor<T>(): Codec<T>
```

## Returns

`Codec&lt;T&gt;` backed by the shared `jsonCodec` (UTF-8 JSON, stable key order).

## Basic Usage

```ts
import { memoryBackend, snapshotStorage, jsonCodecFor } from "@graphrefly/graphrefly/extra";

type MyState = { count: number; label: string };
const tier = snapshotStorage<MyState>(memoryBackend(), {
    codec: jsonCodecFor<MyState>(),
  });
```
