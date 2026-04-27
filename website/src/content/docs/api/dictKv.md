---
title: "dictKv()"
description: "Creates a kv tier backed by a caller-owned plain object (`Record<string, Uint8Array>`).\n\nUseful for embedding storage inside a parent state shape or for tests t"
---

Creates a kv tier backed by a caller-owned plain object (`Record&lt;string, Uint8Array&gt;`).

Useful for embedding storage inside a parent state shape or for tests that
need direct access to the raw bytes. The dict stores raw encoded bytes as
`Uint8Array`. Use `opts.name` to control the tier's diagnostic name
(defaults to `"dict-kv"`).

## Signature

```ts
function dictKv<T>(
	storage: Record<string, Uint8Array>,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `storage` | `Record&lt;string, Uint8Array&gt;` | Caller-owned `Record&lt;string, Uint8Array&gt;` to use as the backing store. |
| `opts` | `Omit&lt;KvStorageOptions&lt;T&gt;, "name"&gt; & { name?: string }` | Optional kv storage options (name, codec, filter, debounce, compactEvery). |

## Returns

`KvStorageTier&lt;T&gt;` backed by the provided dict object.

## Basic Usage

```ts
import { dictKv } from "@graphrefly/graphrefly/extra";

const store: Record<string, Uint8Array> = {};
const tier = dictKv<{ score: number }>(store);
await tier.save("player1", { score: 100 });
```
