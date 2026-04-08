---
title: "Why AI Can't Debug What It Can't See — And How We Fixed That"
date: 2026-04-07T10:00:00
authors:
  - david
tags:
  - engineering
  - inspectability
  - ai-collaboration
  - harness
---

# Why AI Can't Debug What It Can't See — And How We Fixed That

*An AI-assisted debugging session that proved a simple thesis: give AI the right inspection tools, and it finds the problem in seconds — not hours.*

---

Here's something most people don't realize about working with AI on real software: **AI doesn't actually know what's happening inside your system.** It can read your code. It can reason about what your code *should* do. But when something goes wrong at runtime — when the system is burning memory or stuck in an infinite loop — the AI is just as blind as a developer who hasn't opened the debugger yet.

We learned this the hard way. And what we built to solve it might change how you think about AI-assisted operations.

## The setup: a 7-stage automation pipeline

We recently shipped the **harness loop** — a multi-stage automation pipeline built with GraphReFly. Think of it as a sophisticated workflow engine: tasks come in, get triaged, queued, executed, verified, and reflected on. Each stage is a reactive node in a graph, with data flowing automatically from one stage to the next.

It worked beautifully in development. Then, in production testing, **it ran out of memory and crashed.**

## Why AI struggled with this (at first)

Our first move was natural: ask the AI to help debug it. The AI read the source code, understood the architecture, and started suggesting fixes.

The problem? **Every suggestion was a guess.**

The AI could see the code — the retry logic, the queue management, the state tracking. But it couldn't see the *runtime state*: How deep was the queue? How many retries had actually fired? Was the state tracker growing or stable?

Without that runtime visibility, the AI did what any smart collaborator would do without enough information: it suggested plausible-sounding workarounds.

- "Maybe add a guard around the retry logic?"
- "Perhaps there's a null-check missing?"
- "Try changing the wiring order?"

All reasonable. All wrong. All treating symptoms instead of diagnosing the disease.

**This is the fundamental gap.** AI can reason about code structure brilliantly. But code structure and runtime behavior are two different things. A function that *looks* correct in the source can behave pathologically when composed with other functions at scale. The AI simply didn't have the runtime context to know the difference.

## The breakthrough: inspection tools that AI can use

GraphReFly ships built-in inspection tools — `graphProfile()` and `harnessProfile()` — designed to give a structured, queryable snapshot of the system's runtime state. They're not log dumps or stack traces. They're purpose-built diagnostic tools that output clean, structured data about:

- **Queue depths** — how much work is waiting at each stage
- **Node counts** — how many processing units exist in the graph
- **Retained values** — what data is being held in memory, and where
- **State entries** — the contents of every stateful tracker

Here's the key insight: **these tools were designed to be usable by both humans and AI.** The output is structured, not a wall of text. It tells you *what* is wrong and *where* to look, without requiring you to already know the answer.

When we pointed the AI at `harnessProfile()` output instead of source code, the result was night and day.

## From hours of guessing to seconds of clarity

The `harnessProfile()` output showed the picture immediately:

| Metric | Value | Status |
|--------|-------|--------|
| Queue depth | Growing unbounded | Problem |
| Strategy entries | Stable | Normal |
| Node count | 46 | Normal |
| Retry tracking map | Accumulating unmatched keys | **Root cause** |

The AI read this output and identified the root cause in one pass: the retry-tracking map was growing without bound because each retry attempt was creating a *new* tracking key instead of reusing the original one.

No guessing. No workarounds. One inspection call, one answer.

## What actually went wrong (the technical story)

For those who want the details: the retry mechanism worked by modifying an item's summary text on each retry attempt — prepending `[RETRY 1/3]` and appending failure details. The system then tried to recover the original identity by stripping these additions with a regex pattern.

But the regex only stripped the prefix, not the suffix. So each retry created a new tracking key. The "max 3 retries" check always saw zero previous attempts. The loop ran forever, each iteration adding a new key to the map, until the system's memory was exhausted.

This is a class of bug that is **nearly invisible in source code review.** The regex looks correct. The retry logic looks correct. The composition of the two creates an identity drift that only manifests at runtime. It's exactly the kind of bug where reading the code gives you false confidence — and where runtime inspection gives you the truth.

## The fix: making state visible and stable

We applied three changes, each reinforcing the others:

**1. Stable identity.** Items now carry an immutable tracking key set at creation time, rather than deriving identity from mutable text.

**2. Self-carried state.** Instead of tracking retry counts in an external map, each item carries its own counter. No synchronization needed, no drift possible.

**3. Circuit breaker.** A global retry cap — itself a reactive node visible to the profiler — ensures the system can never loop indefinitely, even if per-item tracking somehow fails.

Critically, *every piece of state that affects behavior is now visible in the graph.* The profiler can see it. The AI can query it. There's nowhere for bugs to hide.

## Why this matters for your organization

This isn't just a debugging war story. It reveals something important about how AI will — and won't — work in practice.

### The context gap is real

Today's AI models are remarkably capable at reasoning about code, architecture, and logic. But they have a fundamental limitation: **they can only work with the context they're given.** When that context is source code alone, the AI is missing half the picture. Runtime state, data flow, queue depths, memory patterns — these are invisible without purpose-built tools.

Most systems don't provide this visibility. Debugging means poring over logs, adding print statements, and iterating through hypotheses. That works (slowly) for humans. It's a dead end for AI, which can't interactively poke at a running system the way a developer with a debugger can.

### Inspection tools close the gap

The lesson from our debugging session is simple: **give AI structured inspection tools, and it becomes dramatically more effective.** Not marginally better. Dramatically.

With source code alone, the AI spent time generating plausible but incorrect fixes. With `harnessProfile()` output, it identified the root cause in a single pass. The difference wasn't in the AI's reasoning ability — it was in the quality of the information it had to reason about.

This is a design principle we've baked into GraphReFly: every process, every state change, every decision point is **inspectable by default.** Not as an afterthought or a debug-mode feature, but as a core property of the system. When something goes wrong, you don't go searching for clues — you call a function and get the answer.

### Invisible state is where bugs hide

The root cause of our bug was a plain data structure — a `Map` — that lived outside the reactive graph. It was invisible to profiling, invisible to inspection, invisible to AI. The moment we moved that state into the graph, it became observable, queryable, and diagnosable.

This is a general principle worth remembering: **if state affects behavior, it should be visible to your tools.** Hidden side-channels — internal variables, closure-captured maps, off-graph caches — are exactly where the hardest bugs live. Making state visible isn't just good hygiene. It's the difference between an AI that can help you and an AI that can only guess.

### The debugging procedure *is* the product

We documented the debugging steps in a Composition Guide — a structured procedure that works the same way whether a human or an AI follows it:

1. **Isolate** — run the failing scenario alone
2. **Profile** — call the inspection tools to see runtime state
3. **Trace** — examine the topology for unexpected connections
4. **Bisect** — disable stages to find which one accumulates state
5. **Fix at the root** — don't patch the symptom

This procedure isn't just documentation. It's a protocol that any AI collaborator can follow autonomously. An AI working with GraphReFly can read the guide, call `harnessProfile()`, interpret the structured output, and suggest targeted fixes — the same way a senior engineer would approach the problem, but in seconds rather than hours.

## What this means for adopting AI in your workflows

If you're evaluating how AI fits into your engineering organization — or any process-heavy operation — here's the takeaway:

**AI effectiveness depends on system inspectability.**

The smartest AI in the world can't debug a black box. It can't optimize a process it can't measure. It can't explain a decision it can't trace. The bottleneck isn't AI capability — it's whether your systems are built to give AI (and humans) the visibility they need.

GraphReFly is built on this principle from the ground up. Every reactive process is describable, inspectable, and explainable. Not just by developers reading source code, but by AI collaborators that need structured runtime context to do their best work.

We built these inspection tools because *we* needed them at 2 a.m. It turned out they're exactly what AI needs too.

---

*GraphReFly is a reactive graph protocol for human + AI co-operation. The inspection tools described here — `graphProfile`, `harnessProfile`, and the Composition Guide — ship with both the [TypeScript](https://github.com/graphrefly/graphrefly-ts) and [Python](https://github.com/graphrefly/graphrefly-py) implementations. [Learn more →](https://github.com/graphrefly)*
