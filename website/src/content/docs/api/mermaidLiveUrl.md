---
title: "mermaidLiveUrl()"
description: "Encode an arbitrary mermaid source string to a `mermaid.live` deep link.\nExported separately so callers that already rendered mermaid text can\nupgrade to a live"
---

Encode an arbitrary mermaid source string to a `mermaid.live` deep link.
Exported separately so callers that already rendered mermaid text can
upgrade to a live-editor URL without re-rendering.

## Signature

```ts
function mermaidLiveUrl(
	mermaidSrc: string,
	opts?: { theme?: MermaidLiveTheme; autoSync?: boolean },
): string
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `mermaidSrc` | `string` |  |
| `opts` | `{ theme?: MermaidLiveTheme; autoSync?: boolean }` |  |
