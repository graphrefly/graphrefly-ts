---
title: "reactiveLayout()"
description: "Create a reactive text layout graph.\n\n```\nGraph(\"reactive-layout\")\n├── state(\"text\")\n├── state(\"font\")\n├── state(\"line-height\")\n├── state(\"max-width\")\n├── deriv"
---

Create a reactive text layout graph.

```
Graph("reactive-layout")
├── state("text")
├── state("font")
├── state("line-height")
├── state("max-width")
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
