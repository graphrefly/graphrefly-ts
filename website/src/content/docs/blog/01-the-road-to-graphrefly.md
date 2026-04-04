---
title: "The Road to GraphReFly"
date: 2026-03-21T09:00:00
authors: [david]
tags: [origins, design-philosophy, architecture]
---

# The Road to GraphReFly

*Arc 1, Post 1 — Origins: From Callbag to GraphReFly*

---

In 2018, Andre Staltz published [callbag](https://github.com/callbag/callbag), a spec for reactive programming based on a single function signature. No classes. No inheritance. No framework. Just functions calling functions.

```ts
(type: 0 | 1 | 2, payload?: any) => void
```

That's the entire spec. A callbag is a function that takes a type (0 for handshake, 1 for data, 2 for termination) and an optional payload. Sources and sinks are both callbags. They talk to each other through this one interface.

The community built operators, adapters, utilities. Then it went quiet. By 2022, most callbag repos hadn't seen a commit in years. RxJS was entrenched. The Signals wave was building. Callbag was, by all reasonable measures, dead.

We revived it anyway. That revival became [callbag-recharge](https://github.com/nicholasgalante1997/callbag-recharge) — and what we learned building it became **GraphReFly**.

## What hooked me before there was a roadmap

I didn't start with a business case. I started with a design crush.

Callbag's spec is tiny: one function type, a handful of numeric message kinds — and yet it describes a **full duplex** conversation. The sink and the source are the same kind of thing. When they connect, the source hands back **talkback**: another callbag the sink can invoke. That one mechanism covers push *and* pull without splitting the model. You can request the next value, cancel, or negotiate backpressure through the same callable interface the stream already uses for data.

That symmetry felt like the right abstraction for problems that mix "tell me when you have something" with "give me the next thing when I ask" — not two libraries duct-taped together, one protocol.

The other half of the attraction was mechanical. A callbag is **just a closure**. State lives in captured variables, not in a parallel hierarchy of objects you allocate to participate in the system. Fewer moving parts on the hot path; no subscription class tax just to move a value through a graph. The elegance of the spec and the performance story point the same direction: **less machinery**.

The ecosystem moved on; the idea didn't let go.

## What everyone else saw

When people looked at callbag, they saw a minimalist alternative to RxJS. Simpler, lighter, but with fewer operators and no community momentum. A nice experiment that lost to network effects.

Fair assessment. Wrong conclusion.

## What we saw

We saw something different: **a protocol, not a library**.

RxJS gives you `Observable`, `Subject`, `BehaviorSubject`, `ReplaySubject`, `Subscriber`, `Subscription`, `Scheduler`, `Operator` — a type hierarchy that solves real problems but also cements a particular worldview. Your code becomes RxJS code. Your mental model becomes the RxJS mental model.

Callbag gives you a function signature. That's it. What you build on top is up to you.

This distinction matters enormously when you're trying to unify state management and stream processing — which is exactly what we needed.

## The state management problem

Here's the landscape in 2025:

- **Zustand, Jotai, Redux** — great for UI state, no streaming
- **RxJS** — great for streams, awkward for simple state
- **Preact Signals, SolidJS** — great for fine-grained reactivity, limited composability
- **TC39 Signals** — standardizing the basics, but explicitly excludes async/streaming

Every library solves one slice. If your app needs both a reactive counter *and* a WebSocket stream *and* an LLM response that arrives token by token — you're stitching together two or three libraries with glue code between them.

We wanted one primitive that handles all three. Not a mega-framework. A single, composable building block.

## The callbag-recharge experiment

In the predecessor (callbag-recharge), we built on the original callbag protocol directly. We added Type 3 as a STATE channel for control signals — DIRTY, RESOLVED — enabling two-phase push and glitch-free diamond resolution. We proved the concept: a protocol-first reactive system that unifies state and streams.

But we also hit the walls. Callbag's function signature `(type, payload?) => void` is elegant and minimal, but it's *too* minimal for what we needed:

- **No first-class graph container.** Nodes existed in isolation. Observability meant bolting on an Inspector that walked closures.
- **Imperative wiring.** Connecting sources and sinks required manual handshakes. The topology was implicit, buried in closure references.
- **Extension friction.** Adding new message types (PAUSE, RESUME, TEARDOWN) required careful backward-compatible layering on a spec designed for three types.

We needed the protocol's *principles* — message-based communication, protocol-level composability, two-phase push — without the specific constraints of the callbag function signature.

## The evolution: GraphReFly's message tuples

GraphReFly keeps the engineering insights from callbag and callbag-recharge but redesigns the message format from scratch:

```ts
// GraphReFly: array of message tuples
[[DIRTY], [DATA, 42]]                    // two-phase update
[[DIRTY], [RESOLVED]]                    // unchanged after dirty
[[DATA, "a"], [DATA, "b"], [COMPLETE]]   // burst + close
[[PAUSE, lockId]]                        // pause with lock
```

Instead of a function that switches on numeric types, GraphReFly uses typed message tuples `[Type, Data?]` delivered as arrays. The message vocabulary is open — nodes forward types they don't recognize, just as callbag-recharge's Type 3 passthrough worked, but now as a first-class protocol invariant rather than an extension hack.

And instead of closures wired by handshake, GraphReFly has `node` — one primitive that becomes a source, derived computation, or effect depending on configuration — living inside a `Graph` container that provides observability, lifecycle, and topology inspection by default.

```ts
import { node, state, derived, effect } from '@graphrefly/graphrefly';

const count = state(0);
const doubled = derived([count], () => count.get() * 2);

effect([doubled], () => {
  console.log('doubled:', doubled.get());
});

count.set(5); // logs: "doubled: 10"
```

The same simplicity. The same protocol-level diamond resolution. But now with a graph you can `describe()`, snapshot, and reason about as a first-class data structure.

## The bet

We're betting that the future of reactive programming isn't in choosing between state management and stream processing. It's in unifying them.

A `state(0)` that holds a counter and a `producer()` that wraps an LLM stream should compose with the same operators, flow through the same graph, and be observable with the same tools. The user shouldn't have to think about whether their data is "state" or "stream" — it's just a node in a graph.

Callbag's protocol was minimal enough to teach us this. Callbag-recharge was the experiment that proved it. GraphReFly is the result: same principles, new architecture, a graph that's built for human + LLM co-operation from the ground up.

---

*Next: [Protocol-First Thinking](./02-protocol-first-thinking) — the engineering principle of designing around a message protocol rather than an API surface.*
