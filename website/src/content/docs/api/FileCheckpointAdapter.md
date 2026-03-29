---
title: "FileCheckpointAdapter()"
description: "Atomic JSON file persistence (temp file in the target directory, then `rename`)."
---

Atomic JSON file persistence (temp file in the target directory, then `rename`).

## Signature

```ts
class FileCheckpointAdapter
```

## Behavior Details

- **Errors:** `load()` returns `null` for missing files, empty files, or invalid JSON (no throw).
