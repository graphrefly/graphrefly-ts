---
title: "Promises Are the New Callback Hell"
description: "How we eliminated every internal Promise from GraphReFly and replaced them with pure reactive sources - the patterns, the pitfalls, and why it matters."
date: 2026-03-25T12:00:00
authors: [david]
tags: [design-philosophy, correctness, architecture]
---

# Promises Are the New Callback Hell

*Chronicle 22 - Arc 8: Engineering Deep Cuts (Companion)*

Promises fixed callback pyramids. `async/await` fixed Promise chains. So why did we remove Promise-based internals from GraphReFly?

Because a reactive graph engine needs a single composition model. Every `await` in internals created a seam where graph-level cancellation, control signals, and observability stopped.

## The rule we adopted

**Wrap async at the boundary, stay graph-native inside.**

- External Promise APIs: adapt with `rawFromPromise`
- Async iterables: adapt with `rawFromAsyncIter`
- User callbacks of unknown shape: normalize with `rawFromAny`
- Internal control flow: continue with reactive subscription paths

This keeps data and lifecycle in one protocol from end to end.

## Replacement patterns that mattered most

- Delay: `await new Promise(setTimeout)` -> `fromTimer(ms)`
- Timeout race: `Promise.race(...)` -> `rawRace(...)`
- Wait-for-condition: `await firstValueFrom(...)` -> guarded `subscribe(...)`
- Callback returns: `await cb(...)` -> `rawFromAny(cb(...))`

The changes are mechanical, but they remove opaque control boundaries.

## Bugs this refactor revealed

Moving away from Promise deferral exposed real issues:

- synchronous emission temporal-dead-zone handling
- missing teardown paths on cancellation
- "clean END without DATA" adapter edge cases

Those bugs already existed. Promise boundaries were hiding them.

## Why this now sits with Arc 8

Promise elimination was not just a style preference. It followed the same correctness theme:

- one internal protocol
- explicit lifecycle propagation
- no hidden scheduler jumps

The result is a system that is easier to reason about under stress and easier to compose without semantic surprises.
