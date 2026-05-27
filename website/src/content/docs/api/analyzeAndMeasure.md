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
	segmentAdapter?: SegmentAdapter,
): PreparedSegment[]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>text</code> | <code>string</code> |  |
| <code>font</code> | <code>string</code> |  |
| <code>adapter</code> | <code>MeasurementAdapter</code> |  |
| <code>cache</code> | <code>Map&lt;string, Map&lt;string, number&gt;&gt;</code> |  |
| <code>stats</code> | <code>SegmentMeasureStats</code> |  |
| <code>segmentAdapter</code> | <code>SegmentAdapter</code> |  |
