---
title: "computeCharPositions()"
description: "Compute per-character x,y positions from line breaks and segments."
---

Compute per-character x,y positions from line breaks and segments.

## Signature

```ts
function computeCharPositions(
	lineBreaks: LineBreaksResult,
	segments: PreparedSegment[],
	lineHeight: number,
	segmentAdapter?: SegmentAdapter,
): CharPosition[]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>lineBreaks</code> | <code>LineBreaksResult</code> |  |
| <code>segments</code> | <code>PreparedSegment[]</code> |  |
| <code>lineHeight</code> | <code>number</code> |  |
| <code>segmentAdapter</code> | <code>SegmentAdapter</code> |  |
