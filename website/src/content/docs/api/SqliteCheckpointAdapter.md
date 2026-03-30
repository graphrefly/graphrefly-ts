---
title: "SqliteCheckpointAdapter()"
description: "Persists one JSON blob under a fixed key using Node.js `node:sqlite` (DatabaseSync)."
---

Persists one JSON blob under a fixed key using Node.js `node:sqlite` (DatabaseSync).

## Signature

```ts
class SqliteCheckpointAdapter
```

## Behavior Details

- **Runtime:** Requires Node 22.5+ with `node:sqlite` enabled (experimental in some releases). Call `close()` when discarding the adapter.
