---
title: "concat()"
description: "All values from `first` (until it completes), then all from `second`. DATA from\n`second` that arrives during phase 0 is buffered and replayed on handoff."
---

All values from `first` (until it completes), then all from `second`. DATA from
`second` that arrives during phase 0 is buffered and replayed on handoff.

## Signature

```ts
function concat<T>(firstSrc: Node<T>, secondSrc: Node<T>, opts?: ExtraOpts): Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `firstSrc` | `Node&lt;T&gt;` |  |
| `secondSrc` | `Node&lt;T&gt;` |  |
| `opts` | `ExtraOpts` |  |
