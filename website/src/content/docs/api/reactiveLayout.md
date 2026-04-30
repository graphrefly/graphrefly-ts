---
title: "reactiveLayout()"
description: "Create a reactive text layout graph.\n\n```\nGraph(\"reactive-layout\")\n├── node([], { initial: \"text\" })\n├── node([], { initial: \"font\" })\n├── node([], { initial: \""
---

Create a reactive text layout graph.

```
Graph("reactive-layout")
├── node([], { initial: "text" })
├── node([], { initial: "font" })
├── node([], { initial: "line-height" })
├── node([], { initial: "max-width" })
├── derived("segments")      — text + font → PreparedSegment[]
├── derived("line-breaks")   — segments + max-width → LineBreaksResult
├── derived("height")        — line-breaks → number
└── derived("char-positions") — line-breaks + segments → CharPosition[]
```

## Signature

```ts
function reactiveLayout(opts: ReactiveLayoutOptions): ReactiveLayoutBundle
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ReactiveLayoutOptions` |  |
