---
title: "mermaidLiveUrl()"
description: "Encode a mermaid source string to a `https://mermaid.live/edit#base64:…`\ndeep link. Round-trip with the mermaid.live editor's `/edit#base64:`\nshare format — pay"
---

Encode a mermaid source string to a `https://mermaid.live/edit#base64:…`
deep link. Round-trip with the mermaid.live editor's `/edit#base64:`
share format — payload is `base64url(JSON({code, mermaid: {theme}, ...}))`.

Exported so callers that already have rendered mermaid text (e.g. from
`describe({ format: "mermaid" })`) can upgrade to a live-editor URL
without re-rendering. Pairs with `describe({ format: "mermaid-url" })`.

## Signature

```ts
function mermaidLiveUrl(
	mermaidSrc: string,
	opts?: { theme?: "default" | "dark" | "forest" | "neutral" | "base"; autoSync?: boolean },
): string
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `mermaidSrc` | `string` |  |
| `opts` | `{ theme?: "default" | "dark" | "forest" | "neutral" | "base"; autoSync?: boolean }` |  |
