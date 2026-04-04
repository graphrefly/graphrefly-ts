---
title: "The Day We Read the Spec (Again)"
date: 2026-03-24T09:00:00
authors: [david]
tags: [architecture, protocol, lessons-learned]
---

# The Day We Read the Spec (Again)

*Arc 4, Post 10 — Lessons from the Predecessor*

---

Everyone quotes the callbag handshake. Fewer people linger on the fourth argument to `sink`.

In the predecessor (callbag-recharge), we had already moved **DIRTY** onto the wire in v2 — but we were still treating it like *data-shaped noise*: special values riding **type 1 DATA**, while "real" outputs were often pulled through **`.get()`** on the side. It worked. It was also a category error. **The reactive wiring layer should carry the full story.** If half the narrative lives in push signals and the other half in imperative reads, you split the debugger, the Inspector, and your own mental model.

So we opened the callbag spec again. The protocol already listed four types:

- **START (0)** — handshake
- **DATA (1)** — payload
- **END (2)** — completion or error
- **Custom (3)** — *reserved for extensions*

That last line was the unlock. We were not inventing a parallel protocol. We were **using the extension slot for what it was for**: control semantics that are not user values.

## The breakthrough in one sentence

**Put DIRTY, RESOLVED, and future lifecycle signals on type 3 STATE; keep type 1 DATA for real values only.**

That single separation implied the rest: two-phase push (prepare, then commit or resolve), bitmask diamond resolution, forward-compatible passthrough of unknown STATE signals, and a hard rule that **the data channel never carries sentinels** — so any consumer that only understands DATA still sees a trustworthy stream of values.

## Why we did not keep "DIRTY as DATA"

Mixing control and payload on one channel forces every receiver to ask: *is this my next value, or is it a coordination message?* Libraries end up with `undefined`-as-signal hacks, duplicate equality checks, and debugging stories that start with "it looked like a value."

A dedicated control channel makes the question disappear. **DATA is always data.** Control messages are always "how to interpret what comes next." Downstream nodes can implement the protocol fully; raw sinks that only observe values are not forced to understand graph coordination — yet coordinating nodes still participate in diamond resolution because they see the full protocol.

## What changed in callbag-recharge's codebase

We codified **STATE = 3** with **DIRTY** and **RESOLVED** symbols, wired **producer** as the universal source primitive with `emit` / `signal` / `complete` / `error`, and taught **operator**, **derived**, and **effect** to forward STATE (especially unknown STATE) instead of swallowing it — so PAUSE, RESUME, or future control verbs could travel without another breaking redesign.

This was not a cosmetic rename. It was the moment v2's "dual channel in spirit" became **one callbag-shaped spine** for both coordination and values.

## How GraphReFly evolved this into the message tier system

The Type 3 breakthrough in callbag-recharge was the seed. But shoehorning an open vocabulary of control signals into a single numeric type had limits. Every new signal — PAUSE, RESUME, TEARDOWN, INVALIDATE — was another payload variant on Type 3, requiring pattern matching inside the STATE handler.

GraphReFly took the principle (separate control from data) and made it the entire protocol design. Instead of four callbag types with one extensible, GraphReFly has an open set of message types, each a first-class citizen:

```ts
// callbag-recharge v3:
sink(3, DIRTY);      // Type 3 STATE with DIRTY payload
sink(1, value);      // Type 1 DATA
sink(3, RESOLVED);   // Type 3 STATE with RESOLVED payload
sink(3, PAUSE);      // Type 3 STATE... getting crowded

// GraphReFly:
[[DIRTY]]            // DIRTY is its own message type
[[DATA, value]]      // DATA carries the value
[[RESOLVED]]         // RESOLVED is its own message type
[[PAUSE, lockId]]    // PAUSE is its own message type, with typed data
```

Each message type has a **tier** classification that determines how it interacts with batch semantics, auto-checkpoint behavior, and graph lifecycle:

- **Tier 0** (coordination): DIRTY — propagates immediately, even inside batches
- **Tier 1** (lifecycle): PAUSE, RESUME, INVALIDATE — scheduling and resource management
- **Tier 2+** (data/terminal): DATA, RESOLVED, COMPLETE, ERROR, TEARDOWN — deferred inside batches

The tier system generalizes what the predecessor did with two phases (DIRTY first, values second) into a multi-tier ordering that handles the full lifecycle vocabulary. The protocol invariant — DIRTY before DATA within a batch — is now a special case of a more general rule: lower-tier messages propagate before higher-tier messages.

## The lesson

The callbag spec had the answer all along. It just took us three architecture versions to find it.

Re-reading a spec you think you already understand is one of the highest-leverage things you can do. The original callbag authors left Type 3 open because they knew the protocol might need control semantics someday. We read past that line for months before seeing it.

GraphReFly's message tuple system — where every message type is a first-class participant in an open protocol, classified by tier, forwarded by default — is the direct descendant of that afternoon when we opened the callbag spec again and read the line we'd been ignoring.

## Further reading

- [Why Control Signals Don't Belong in the Data Stream](./11-control-signals-separation) — the invariants we adopted after the split
- [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push) — the v2 bridge into v3
- [Architecture](/architecture/) — current protocol and design

---

*Next: [Why control signals don't belong in the data stream](./11-control-signals-separation).*
