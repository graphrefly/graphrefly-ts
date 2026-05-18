---
title: "simpleFactStore()"
description: "API reference for simpleFactStore."
---

## Signature

```ts
function simpleFactStore<T>(
	opts: SimpleFactStoreOptions<T> & { storage: StorageBackend },
): PersistentSimpleFactStoreGraph<T>
function simpleFactStore<T>(opts?: SimpleFactStoreOptions<T>): SimpleFactStoreGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `SimpleFactStoreOptions&lt;T&gt;` |  |
