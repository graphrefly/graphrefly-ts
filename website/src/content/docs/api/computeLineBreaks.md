---
title: "computeLineBreaks()"
description: "Greedy line-breaking algorithm.\n\nWalks segments left to right, accumulating width. Breaks when a segment would\noverflow maxWidth. Supports:\n- Trailing space han"
---

Greedy line-breaking algorithm.

Walks segments left to right, accumulating width. Breaks when a segment would
overflow maxWidth. Supports:
- Trailing space hang (spaces don't trigger breaks)
- overflow-wrap: break-word via grapheme widths
- Soft hyphens (break opportunity, adds visible hyphen width)
- Hard breaks (forced newline)

## Signature

```ts
function computeLineBreaks(
	segments: PreparedSegment[],
	maxWidth: number,
	adapter: MeasurementAdapter,
	font: string,
	cache: Map<string, Map<string, number>>,
): LineBreaksResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `segments` | `PreparedSegment[]` |  |
| `maxWidth` | `number` |  |
| `adapter` | `MeasurementAdapter` |  |
| `font` | `string` |  |
| `cache` | `Map&lt;string, Map&lt;string, number&gt;&gt;` |  |
