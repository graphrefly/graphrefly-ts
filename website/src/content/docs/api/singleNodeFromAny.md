---
title: "singleNodeFromAny()"
description: "Reactive variant: returns a bound callable that hands out `Node<T>` values.\nAll concurrent callers with the same key during an in-flight source share\nthe same N"
---

Reactive variant: returns a bound callable that hands out `Node&lt;T&gt;` values.
All concurrent callers with the same key during an in-flight source share
the same Node. The cache entry is evicted (so the next call re-invokes
`factory`) when the underlying source either:

- **terminally settles** — `ERROR` or `COMPLETE`; or
- **tears down** — `TEARDOWN` (M8 fix). A DATA-only source (e.g. a
  long-lived `state(...)`) never emits `ERROR`/`COMPLETE`, so without
  the TEARDOWN arm a destroyed shared Node — plus this watcher
  subscription — would be pinned in the `inFlight` Map forever. Evicting
  on TEARDOWN bounds the entry's lifetime to the Node's own lifetime.

DATA is NOT an eviction trigger — callers subscribing after the first
DATA still receive the shared Node (and push-on-subscribe per the spec's
cached-DATA contract). The Node stays shared while alive (the dedup
contract); only its death (terminal or teardown) releases the entry.

Use when downstream wants reactive subscription (not a one-shot Promise).

## Signature

```ts
function singleNodeFromAny<K, T>(
	factory: (key: K) => NodeInput<T>,
	opts: SingleFromAnyOptions<K> = {},
): (key: K) => Node<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>factory</code> | <code>(key: K) =&gt; NodeInput&lt;T&gt;</code> |  |
| <code>opts</code> | <code>SingleFromAnyOptions&lt;K&gt;</code> |  |
