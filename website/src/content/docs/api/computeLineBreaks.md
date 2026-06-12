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
	opts?: { hyphenWidth?: number; segmentAdapter?: SegmentAdapter },
): LineBreaksResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>segments</code> | <code>PreparedSegment[]</code> | Already measured text segments. |
| <code>maxWidth</code> | <code>number</code> | Line width constraint. |
| <code>opts</code> | <code>{ hyphenWidth?: number; segmentAdapter?: SegmentAdapter }</code> | Optional premeasured hyphen width and segmentation helper. |
