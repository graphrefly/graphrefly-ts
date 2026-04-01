---
title: "analyzeAndMeasure()"
description: "Merge segmentation pieces: sticky punctuation, CJK per-grapheme splitting,\nand produce the final measured segment list."
---

Merge segmentation pieces: sticky punctuation, CJK per-grapheme splitting,
and produce the final measured segment list.

## Signature

```ts
function analyzeAndMeasure(
	text: string,
	font: string,
	adapter: MeasurementAdapter,
	cache: Map<string, Map<string, number>>,
	stats?: SegmentMeasureStats,
): PreparedSegment[]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` |  |
| `font` | `string` |  |
| `adapter` | `MeasurementAdapter` |  |
| `cache` | `Map&lt;string, Map&lt;string, number&gt;&gt;` |  |
| `stats` | `SegmentMeasureStats` |  |
