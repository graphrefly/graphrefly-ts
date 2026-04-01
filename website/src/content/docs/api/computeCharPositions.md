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
): CharPosition[]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `lineBreaks` | `LineBreaksResult` |  |
| `segments` | `PreparedSegment[]` |  |
| `lineHeight` | `number` |  |
