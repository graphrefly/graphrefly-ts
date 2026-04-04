---
title: "Signals Are Not Enough"
description: "TC39 Signals handle UI state beautifully. But streaming, orchestration, and diamond correctness need more. Here's where Signals stop and where GraphReFly begins."
date: 2026-03-21T13:00:00
authors: [david]
tags: [architecture, design-philosophy]
---

# Signals Are Not Enough

*Arc 1, Post 3 — Origins: Why Revive Callbag?*

---

Let's be clear upfront: TC39 Signals are a good idea. Standardizing fine-grained reactivity at the language level is the right move. Preact Signals, SolidJS, Angular Signals, Vue's ref system — they've all converged on roughly the same model. A standard is overdue.

But Signals solve one problem: **synchronous, fine-grained UI state**. And the world has moved on.

LLMs stream tokens over WebSockets. AI agents orchestrate multi-step workflows with retries and timeouts. Edge devices run inference locally and sync state across tabs. Modern applications need more than a reactive counter.

This post isn't about bashing Signals. It's about honestly mapping where they work, where they don't, and why GraphReFly exists in the gap.

## What Signals get right

Credit where it's due. The Signals model has genuine strengths:

**Simple mental model.** A Signal holds a value. A Computed derives from Signals. An Effect runs when its dependencies change. Three concepts, done.

```ts
const count = new Signal.State(0);
const doubled = new Signal.Computed(() => count.get() * 2);
```

**Automatic dependency tracking.** Computed Signals discover their dependencies at runtime by intercepting `.get()` calls. No explicit dep arrays, no manual wiring. It Just Works for simple cases.

**Framework integration.** Because Signals are being standardized at TC39, every framework can adopt the same primitive. A Signal created in vanilla JS works in React, Vue, Solid, Svelte. That's powerful.

**Performance for UI.** Lazy evaluation means Computed Signals don't recompute until read. For UI rendering — where you only care about visible components — this is ideal. Don't compute what you don't display.

These are real wins. For a todo app, a form, a dashboard counter — Signals are excellent.

## Where Signals stop

### 1. No streaming

The TC39 Signals proposal explicitly scopes out async and streaming. A Signal holds a value. It doesn't represent a sequence of values over time.

```ts
// Signals: this is awkward
const llmResponse = new Signal.State('');

// How do you stream tokens into this?
// You set() repeatedly, but there's no backpressure,
// no completion signal, no error channel, no cancellation.
for await (const token of stream) {
  llmResponse.set(llmResponse.get() + token);
  // What if the user navigates away? No cancellation.
  // What if the stream errors? No error propagation.
  // What if you want to debounce? Import another library.
}
```

With GraphReFly, streaming is native:

```ts
const response = producer<string>((emit, end) => {
  const reader = stream.getReader();
  let buffer = '';
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { end(); return; }
        buffer += value;
        emit(buffer);
      }
    } catch (e) { end(e); }
  })();
  return () => reader.cancel(); // cleanup on unsubscribe
});

// Now use it like any other store
const wordCount = derived([response], () =>
  response.get().split(/\s+/).length
);
```

Same `get()` interface. But underneath, the callbag protocol handles completion, errors, cancellation, and cleanup — things Signals have no vocabulary for.

### 2. No completion or error semantics

A Signal exists forever. It doesn't complete. It doesn't error. It just... holds a value.

Real-world data sources complete and fail:

- An HTTP request returns a response, then it's done
- A WebSocket connection drops
- An LLM stream finishes generating
- A file read encounters a permission error

Callbag type 2 (END) handles this natively:

```ts
sink(2);        // completion: stream is done
sink(2, error); // error: stream failed
```

Every operator in GraphReFly knows how to propagate completion and errors. `switchMap` cancels the previous inner stream. `rescue` catches errors and substitutes a fallback. `retry` resubscribes on failure.

With Signals, you're back to wrapping everything in try/catch and setting error state manually:

```ts
const error = new Signal.State(null);
const loading = new Signal.State(false);
const data = new Signal.State(null);

// The "loading/error/data" triple that every Signal app reinvents
```

### 3. The diamond problem — actually solved vs. approximately solved

Both Signals and GraphReFly handle the diamond problem. But they solve it differently, and the difference matters.

**Signals approach: lazy pull.**
Computed Signals are lazy — they don't recompute until someone reads them. When A changes, B and C are marked stale. When D is read (e.g., during rendering), it pulls B and C, which pull A. The topological order emerges from the pull chain.

This works for UI rendering where a framework controls when reads happen. But it breaks down for **eager effects** — side effects that should run immediately when state changes, not when something eventually reads them.

```ts
// Signals: when does this effect actually run?
// It depends on the framework's scheduling.
new Signal.subtle.Watcher(() => {
  // This is explicitly marked "subtle" because
  // the timing semantics are framework-dependent
});
```

**GraphReFly approach: two-phase push.**
DIRTY propagates eagerly and synchronously. Values follow. Effects run inline when all deps resolve. No scheduler. No timing ambiguity.

```ts
effect([b, c], () => {
  // Runs synchronously after A.set(),
  // guaranteed to see consistent B and C values.
  // No scheduler. No "subtle" API.
  console.log(b.get(), c.get());
});
```

For AI applications — where you need to react to state changes immediately (cancel a request, update a progress bar, trigger the next step in a workflow) — push semantics with guaranteed consistency beats lazy evaluation.

### 4. No operators

Signals give you `State` and `Computed`. That's the composition model.

Need to debounce? Write it yourself or import lodash.
Need to throttle? Same.
Need switchMap (cancel previous async operation when a new one starts)? Write a state machine.
Need to merge two streams? Combine three signals with backpressure? Window events into batches?

GraphReFly ships 70+ operators that work on any store:

```ts
pipe(
  searchInput,
  debounce(300),
  filter(q => q.length > 2),
  switchMap(q => fromPromise(fetch(`/api/search?q=${q}`))),
  map(res => res.json()),
  subscribe(results => render(results))
);
```

This isn't about operator count as a vanity metric. It's about having a composable vocabulary for async behavior. Each operator is a reusable building block. Without them, you're writing imperative async logic with `setTimeout`, `AbortController`, and manual cleanup — exactly the code reactive programming was supposed to eliminate.

### 5. No observability

Signals are opaque. You can read a Signal's value, but you can't inspect the dependency graph, trace signal propagation, or monitor performance at runtime.

GraphReFly's graph sees everything:

```ts
import { graph } from '@graphrefly/graphrefly';

const count = state(0, { name: 'count' });
const doubled = derived([count], () => count.get() * 2, { name: 'doubled' });

// See the full dependency graph
graph.describe();
// → { 'count': ['doubled'], 'doubled': [] }
```

For debugging AI agent state — where a dozen stores interact across async boundaries — observability isn't a nice-to-have. It's the difference between understanding your system and staring at console.log output.

## The missing middle

Here's how we see the landscape:

```
Simple UI state          Complex reactive logic           Full stream processing
     <-------------------------------------------------------------->

  TC39 Signals                                              RxJS
  Preact Signals           <- THE GAP ->
  SolidJS signals
  Vue refs

                       GraphReFly
                     <------------------->
```

Signals own the left side. RxJS owns the right side. The middle — where you need both simple state AND streaming AND orchestration AND observability — is where GraphReFly lives.

You shouldn't need to choose between "reactive counter" and "cancelable debounced async stream with error recovery." They should be the same primitive, composed differently.

## The compatibility layer approach

We're not asking anyone to abandon Signals. We built compatibility wrappers:

```ts
import { SignalState, SignalComputed } from '@graphrefly/graphrefly/compat/signals';

// TC39 Signals API, GraphReFly engine
const count = new SignalState(0);
const doubled = new SignalComputed(() => count.get() * 2);

// But now you can also do this:
pipe(
  count,
  debounce(300),
  switchMap(n => fromPromise(fetchData(n))),
  subscribe(data => render(data))
);
```

Same API you already know. But when you need stream operators, diamond resolution, completion semantics, or observability — it's there. No second library.

We also have compat layers for [Zustand](/recipes/zustand-migration), [Jotai](/recipes/jotai-migration), and [Nanostores](/recipes/nanostores-migration). The point isn't to replace what works. It's to extend it into territory Signals can't reach.

## What GraphReFly costs you

Honest trade-offs:

**Bundle size.** The core is small, but the full library with 70+ operators, data structures, and orchestration primitives is larger than a minimal Signals polyfill. You only import what you use (tree-shakable), but the ceiling is higher.

**Explicit deps.** GraphReFly uses explicit dependency arrays instead of automatic tracking. This is a deliberate choice — explicit deps are predictable, debuggable, and have zero runtime tracking overhead — but it means more characters typed.

```ts
// Signals: implicit tracking
const sum = new Signal.Computed(() => a.get() + b.get());

// GraphReFly: explicit deps
const sum = derived([a, b], () => a.get() + b.get());
```

**Learning curve.** If you've never used reactive streams, operators like `switchMap` and `exhaustMap` take time to internalize. The store API (`get/set`) is immediate, but the full operator vocabulary has depth.

**Community size.** Signals will have the entire JavaScript ecosystem behind them. We're a focused library for developers who need more than what Signals offer. That's a smaller audience — by design.

## Who this is for

If your app is a form with validation and a shopping cart, use Signals. Seriously. You don't need what we offer.

If your app streams LLM responses, orchestrates multi-step AI agent workflows, manages real-time collaborative state, or runs inference on-device — and you want one primitive that handles all of it with correct diamond resolution and runtime observability — that's what GraphReFly is built for.

Signals handle the simple case beautifully. We handle what comes after.

---

*This concludes Arc 1: Origins. Next up — Arc 2: Architecture v1, where we'll walk through our first attempt at push-invalidation-pull-computation and the lessons it taught us about why data should flow through the graph, not around it.*
