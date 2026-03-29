---
title: "last()"
description: "Last value before `source` completes. Use `options.defaultValue` if the source may complete\nwithout emitting."
---

Last value before `source` completes. Use `options.defaultValue` if the source may complete
without emitting.

## Signature

```ts
function last<T>(source: Node<T>, options?: ExtraOpts & { defaultValue?: T }): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Node&lt;T&gt;` |  |
| `options` | `ExtraOpts & { defaultValue?: T }` |  |
