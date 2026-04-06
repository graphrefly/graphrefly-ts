---
title: "FileCheckpointAdapter()"
description: "Atomic JSON file persistence (one file per key in a directory, temp + rename)."
---

Atomic JSON file persistence (one file per key in a directory, temp + rename).

## Signature

```ts
class FileCheckpointAdapter
```

## Behavior Details

- **Key mapping:** keys are sanitized to filesystem-safe names (`[^a-zA-Z0-9_-]` → `_`).
**Errors:** `load()` returns `null` for missing files, empty files, or invalid JSON (no throw).
