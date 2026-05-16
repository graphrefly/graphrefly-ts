---
title: "bigintJsonCodecFor()"
description: "Returns the bigintJsonCodec cast to `Codec<T>`. Pure typing helper —\nno runtime overhead. Use when a generic tier API requires a `Codec<T>` and\n`T` carries `big"
---

Returns the bigintJsonCodec cast to `Codec&lt;T&gt;`. Pure typing helper —
no runtime overhead. Use when a generic tier API requires a `Codec&lt;T&gt;` and
`T` carries `bigint` fields.

## Signature

```ts
function bigintJsonCodecFor<T>(): Codec<T>
```

## Basic Usage

```ts
import { memoryBackend, snapshotStorage, bigintJsonCodecFor } from "@graphrefly/pure-ts/extra";

const tier = snapshotStorage<FactStore>(memoryBackend(), {
    codec: bigintJsonCodecFor<FactStore>(),
  });
```
