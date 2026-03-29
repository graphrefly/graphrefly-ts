---
title: "withLatestFrom()"
description: "When `primary` settles, emit `[primary, latestSecondary]`. Updates from `secondary` alone\nrefresh the cached secondary value but do not emit."
---

When `primary` settles, emit `[primary, latestSecondary]`. Updates from `secondary` alone
refresh the cached secondary value but do not emit.

## Signature

```ts
function withLatestFrom<A, B>(
	primary: Node<A>,
	secondary: Node<B>,
	opts?: ExtraOpts,
): Node<readonly [A, B]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `primary` | `Node&lt;A&gt;` |  |
| `secondary` | `Node&lt;B&gt;` |  |
| `opts` | `ExtraOpts` |  |
