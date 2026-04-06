---
title: "SqliteCheckpointAdapter()"
description: "Key-value persistence using Node.js `node:sqlite` (DatabaseSync)."
---

Key-value persistence using Node.js `node:sqlite` (DatabaseSync).

## Signature

```ts
class SqliteCheckpointAdapter
```

## Behavior Details

- **Runtime:** Requires Node 22.5+ with `node:sqlite` enabled (experimental in some releases). Call `close()` when discarding the adapter.
