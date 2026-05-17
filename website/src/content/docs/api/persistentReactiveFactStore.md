---
title: "persistentReactiveFactStore()"
description: "Build a durable, event-sourced reactiveFactStore that owns\nlog↔store↔replay↔dedup correctly. Synchronous factory; the only async is\nan isolated internal replay "
---

Build a durable, event-sourced reactiveFactStore that owns
log↔store↔replay↔dedup correctly. Synchronous factory; the only async is
an isolated internal replay source. See module docstring for the locked
design rationale.

## Signature

```ts
function persistentReactiveFactStore<T>(
	config: PersistentReactiveFactStoreConfig<T>,
): PersistentReactiveFactStoreGraph<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `PersistentReactiveFactStoreConfig&lt;T&gt;` |  |

## Basic Usage

```ts
import { persistentReactiveFactStore } from "@graphrefly/graphrefly";
import { memoryBackend } from "@graphrefly/pure-ts/extra";

const ingest = node<MemoryFragment<Doc>>([], { initial: undefined });
const mem = persistentReactiveFactStore<Doc>({
    ingest,
    extractDependencies: (f) => f.sources,
    storage: memoryBackend(),
  });
// Restart is automatic: the durable history is replayed through `ingest`
// on construction; observe `mem.replayedCount` / `mem.position`.
ingest.emit(myFragment);            // live — persisted (not re-persisted)
await mem.flush();                  // force physically durable
```
