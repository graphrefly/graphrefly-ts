---
title: "We Debugged an OOM with Our Own Reactive Inspection Tools — Here's What We Learned"
date: 2026-04-07T10:00:00
authors:
  - david
tags:
  - engineering
  - inspectability
  - ai-collaboration
  - harness
---

# We Debugged an OOM with Our Own Reactive Inspection Tools — Here's What We Learned

*A real debugging session that accidentally proved our thesis: reactive processes should be inspectable by humans and LLMs alike.*

---

Last week we shipped the **harness loop** — a 7-stage reactive collaboration pipeline (INTAKE → TRIAGE → QUEUE → GATE → EXECUTE → VERIFY → REFLECT) built entirely from GraphReFly primitives. It worked. Then it ran out of memory.

This post is the story of how we found the bug, what tools we used, and why the experience convinced us that **inspectable reactive processes aren't a nice-to-have — they're the whole point.**

## The symptom

Our test suite has 1,370 tests. One of them — "fast-retry exhaustion" — caused an OOM crash that killed the entire Vitest process. The test exercised the retry path: when an LLM-backed execution fails with a self-correctable error, the harness re-ingests the item for another attempt, up to a configurable maximum.

The retry limit was set to 3. The process ran until the heap was gone.

## The wrong turns

The first instinct (and we're being honest here) was to **throw workarounds at the problem**. We tried:

- Wrapping retry logic in guards
- Adding defensive null checks
- Tweaking operator wiring order

None of it worked, because none of it was diagnostic. We were treating symptoms without understanding the system's actual state.

## The turning point: read the composition guide

GraphReFly ships a [Composition Guide](/composition-guide/) with a "Debugging composition" section — a 5-step procedure for diagnosing OOM, infinite loops, and silent failures in composed graphs. The steps are:

1. **Isolate** — run the failing scenario alone, not in a full suite
2. **Profile** — use `graphProfile()` / `harnessProfile()` to inspect node counts, retained values, queue depths
3. **Trace** — use `describe()` to dump the topology and check for unexpected edges
4. **Bisect** — disable stages to find which one accumulates state
5. **Fix at the root** — don't patch the symptom

We had built these tools. We just hadn't used them first.

## What the inspection tools revealed

Once we actually ran `harnessProfile()` on the isolated test, the picture was immediate:

- **Queue depths**: the retry queue was growing without bound
- **Strategy entries**: stable (not the problem)
- **Node count**: 46 nodes — normal for a harness graph
- **Retained values**: the retry-tracking `Map` was accumulating keys that never matched

The `Map` was the smoking gun.

## The root cause: identity drift

The retry mechanism worked like this:

1. An item fails verification
2. The harness prepends `[RETRY 1/3]` to the item's summary
3. It re-ingests the modified item
4. On the next failure, it tries to find the retry count by stripping the prefix with a regex

The regex was supposed to recover the original summary: `summary.replace(/^\[RETRY \d+\/\d+\] /, "")`. But the retry path also appended ` — Previous attempt failed: <findings>`. The regex didn't strip that suffix.

So each retry created a **new tracking key**. The retry counter for the original item was never found. The "max 3 retries" check always saw 0. The loop ran forever, each iteration adding a new key to the Map, until the heap was exhausted.

## The fix: three layers of defense

### 1. Stable identity via `trackingKey()`

Instead of parsing summaries with regex, items now carry their identity explicitly:

```typescript
function trackingKey(item: { summary: string; relatedTo?: string[] }): string {
  return item.relatedTo?.[0] ?? item.summary;
}
```

The `relatedTo` field is set once at intake and never mutated. Retries reference the same key regardless of how the summary is rewritten.

### 2. Item-carried retry counter

Instead of an external `Map<string, number>`, the retry count travels with the item:

```typescript
interface TriagedItem {
  // ...existing fields...
  _retries?: number;
}
```

On retry, the counter increments: `_retries: (item._retries ?? 0) + 1`. No external state to get out of sync.

### 3. Global circuit breaker

Even if per-item tracking somehow fails, a global counter caps total retries across all items:

```typescript
const totalRetries = state(0);
const maxTotalRetries = Math.min(opts.maxTotalRetries ?? maxRetries * 10, 100);
```

The `state(0)` node is a reactive primitive — it's visible to `graphProfile()` and `harnessProfile()`. No more invisible mutable state.

## Why this matters beyond the bug

The OOM bug was a conventional software defect. What made it interesting was **how we found it** and what that says about building systems that LLMs help operate.

### Inspection tools aren't optional

We built `graphProfile()` and `harnessProfile()` as development aids. During this debugging session, they were the difference between "blindly retry workarounds for an hour" and "see the problem in one function call." If a human developer needs these tools, an LLM collaborator needs them even more — an LLM can't intuit system state from vibes.

### Mutable state must be visible to the graph

The original retry tracker was a plain `Map` — invisible to the reactive graph, invisible to profiling, invisible to `describe()`. When we converted it to `state(0)` nodes, the retry and reingestion counters became **first-class graph citizens**: observable, profilable, and part of the topology that any inspector (human or LLM) can query.

This is a general principle: **if state affects behavior, it should be in the graph.** Hidden side-channels are where bugs hide.

### The debugging procedure is the product

We wrote the "Debugging composition" procedure in the Composition Guide *after* this experience. But it's not just documentation — it's a **protocol that LLMs can follow**. An LLM collaborating on a GraphReFly project can read the guide, call `harnessProfile()`, interpret the output, and suggest targeted fixes. The same procedure that helped us is the procedure that helps the AI.

This is pillar #2 of our [positioning](/): **"Trust AI by Understanding It."** You can't trust an AI's output if neither you nor the AI can explain what happened inside the system. GraphReFly makes every decision traceable — not through log dumps, but through structural causality that persists across sessions and is queryable by both humans and machines.

## The meta-lesson

We built GraphReFly on the thesis that reactive processes should be **describable, inspectable, and explainable** — not just by developers staring at source code, but by LLMs that need to reason about system state.

Then we hit a bug where we forgot to use our own tools. The moment we remembered, the bug was obvious.

The tools we build from our own battles are the tools that actually work. And if they work for us debugging at 2 a.m., they'll work for an LLM collaborator that never sleeps.

---

*The harness loop, `graphProfile`, `harnessProfile`, and the Composition Guide are all part of [GraphReFly](https://github.com/graphrefly) — a reactive graph protocol for human + LLM co-operation. Both [TypeScript](https://github.com/graphrefly/graphrefly-ts) and [Python](https://github.com/graphrefly/graphrefly-py) implementations are available.*
