---
title: "What Happened When AI Stress-Tested Our Reactive Protocol"
description: "We gave GraphReFly's spec to an LLM and asked it to compose reactive graphs. It found 4 spec-implementation gaps in 10 scenarios — here's what broke, why, and how SPEC v0.2 fixed everything."
date: 2026-04-09T11:00:00
authors:
  - david
tags:
  - architecture
  - ai-collaboration
  - correctness
  - spec-v0.2
---

# What Happened When AI Stress-Tested Our Reactive Protocol

*Arc 6, Post 35 — GraphReFly SPEC v0.2: The Pure Push Model*

---

Most reactive frameworks test correctness by writing unit tests. We did something different: we handed our spec to an LLM, asked it to compose reactive graphs from scratch, and watched what happened.

The results were humbling. In 10 composition scenarios — zero-shot, no hand-holding — the LLM exposed four spec-implementation gaps that our 1,400+ test suite had missed. Not because our tests were bad, but because **our tests had been written to accommodate broken behavior** without realizing it.

This is the story of Phase 5: the LLM composition validation experiment that broke our protocol — and forced the redesign that became SPEC v0.2.

## The Experiment Design

The premise was simple. GraphReFly positions itself as an AI-native reactive protocol — one that LLMs can reason about and compose without special training. Phase 5 of our roadmap was the acid test:

1. Give an LLM the GRAPHREFLY-SPEC and COMPOSITION-GUIDE
2. Present 10 composition scenarios (diamond topologies, conditional deps, multi-stage pipelines, feedback loops)
3. Ask it to wire the graph — one shot, no corrections
4. Run the composed graphs against the real runtime
5. Evaluate: did the LLM's mental model match the implementation?

If our protocol was truly LLM-composable, the compositions should work. If they did not, the fault was either in the spec (unclear), the implementation (buggy), or both.

It was both.

## Gap 1: Connection-Time Diamond Glitch

The first scenario that broke was a classic diamond:

```
        A (state, initial: 1)
       / \
      B   C    (both derived)
       \ /
        D      (derived: (b, c) => b + c)
```

The LLM composed this correctly from the spec. The spec (§2.7) promises that `D`'s function runs exactly once after all deps settle, producing a consistent snapshot. The implementation did something else entirely.

**What happened:** When `D` subscribed to `B` and `C`, the subscribe calls happened sequentially in JavaScript's synchronous event loop. `B.subscribe(callback)` triggered `B`'s activation, which activated `A`, which pushed DATA through `B` to `D`'s callback — all synchronously, before `C.subscribe()` even ran. `D`'s settlement logic saw "one dep settled" and ran `fn(B_val, undefined)`, producing `NaN`.

Then `C.subscribe()` triggered `C`'s activation, delivered `C`'s value, and `D` recomputed correctly. The final value was right, but the intermediate glitch value (`NaN`) had already propagated to `D`'s subscribers.

**The root cause:** `_onDepSettled` had no awareness of whether all deps had been subscribed yet. It treated subscribe-time settlement identically to propagation-time settlement.

**The fix:** The pre-set dirty mask from SPEC v0.2. On `_connectUpstream`, set every dirty bit to 1. Each dep's DATA clears its bit. `D`'s fn runs only when all bits are clear — which cannot happen until both `B` and `C` have delivered DATA. The diamond resolves correctly on the first activation, not just on subsequent waves.

## Gap 2: Subscribe-Time Double Delivery

The second scenario involved a producer node (a node with a start function that emits values):

```typescript
const counter = producer<number>((emit) => {
  emit(42);
  return () => {}; // cleanup
});
```

The LLM expected subscribers to receive `42` exactly once. They received it twice.

**What happened:** The producer's `_startProducer` function called `emit(42)` synchronously during activation. This pushed DATA to all sinks via `_downToSinks`. Then, the `subscribe()` function's post-activation logic checked "does this node have a cached value?" — yes, `42` — and pushed `[[DATA, 42]]` to the new subscriber again.

**The archaeological evidence:** We found a commit (`f34d71e "chore: fix tests"`) that had changed test assertions from `expect([42])` to `expect([42, 42])`. The tests had been "fixed" to match the broken behavior. The bug became the contract.

**The fix:** START replaces the post-activation push logic entirely. The subscribe flow is now:

1. Emit `[[START]]` to the new sink
2. If `cachedBefore !== SENTINEL` (node was already active with a cached value), emit `[[DATA, cached]]`
3. If the node just activated (was SENTINEL before subscribe), the activation path produces DATA through normal computation — no post-subscribe push needed

The `cachedBefore` snapshot captures whether this subscriber is joining an already-active node (push the cached value) or triggering the activation (let the activation path handle it). Double delivery eliminated.

## Gap 3: SENTINEL Deps Not Gating Computation

The third scenario was a conditional pipeline:

```typescript
const config = state<Config | null>(null);
const processor = derived([config], ([cfg]) => {
  return cfg.validate(); // crashes if cfg is null
});
```

The LLM reasoned correctly from the spec: `processor` should not compute until `config` has a real value. The spec says derived nodes depending on a SENTINEL dep "will not compute until that dep receives a real value" (Composition Guide §1).

**What happened:** `config` started with `null` — a real value, not SENTINEL. But in more complex scenarios with lazy deps (deps that had no subscribers and therefore no cached value), the implementation ran `fn` with `undefined` for the lazy dep's slot. There was no mechanism to distinguish "this dep has a value of `undefined`" from "this dep has never computed."

**The fix:** The pre-set dirty mask again. A dep holding SENTINEL never delivers DATA, so its dirty bit never clears, and `fn` never runs. The node enters **pending** status — a new explicit state in v0.2 — and stays there until every dep has produced at least one real value. No SENTINEL checks in application code. No undefined-vs-null ambiguity.

## Gap 4: Tests Enshrining Incorrect Behavior

This was the most uncomfortable finding. While fixing gaps 1–3, we discovered that several existing tests in our semantic audit suite were asserting **wrong behavior**:

- Tests expecting `NaN` from diamond resolution (the glitch value from gap 1)
- Tests with no actual assertions (testing infrastructure, not behavior)
- Tests with misleading names that described the opposite of what they verified
- Tests asserting implementation optimization as contract (e.g., "reconnect does not recompute" — an optimization, not a spec guarantee)

The LLM had no investment in making the existing tests pass. It reasoned from the spec. When the spec and tests disagreed, the spec was right and the tests were wrong.

**The lesson:** Test suites can become a form of technical debt. When tests are written to match implementation behavior rather than spec contracts, bugs get canonized. The fix-the-test-to-match-the-bug pattern (`f34d71e`) is insidious because it looks like a legitimate correction — the tests go green, CI passes, nobody questions it.

Phase 5's LLM validation worked precisely because the LLM had no knowledge of the existing tests. It was a fresh pair of eyes that had only read the spec.

## The Clean-Room Redesign

After cataloging the gaps, we did not patch. The user's instruction was: "forget about the existing implementation and try to implement from scratch."

The result was a clean-room redesign of the entire node lifecycle:

1. **START protocol message** — deterministic subscribe-time handshake, replacing three boolean flags
2. **Pre-set dirty mask** — unifies first-run gate, SENTINEL gating, and diamond resolution into one mechanism
3. **ROM/RAM cache semantics** — state preserves cache on disconnect (ROM), compute clears it (RAM)
4. **NodeBase abstract class** — shared lifecycle machinery, eliminating code duplication between NodeImpl and DynamicNodeImpl
5. **Tier reshuffle** — START at tier 0, everything else shifts up, batch drain respects new ordering
6. **DynamicNodeImpl rewire buffer** — handles dep changes during computation, bounded by MAX_RERUN=16

The implementation went through 10+ error-and-fix cycles (detailed in the session archive), touching 30+ files across core, operators, adapters, patterns, and compatibility layers. All 1,426 tests passed after the refactor — including corrected versions of the tests that had been enshrining broken behavior.

## Why LLM Validation Works

Traditional testing verifies that the implementation matches the developer's expectations. But the developer's expectations are shaped by the implementation — a circular dependency that lets bugs hide.

LLM validation breaks the circle. The LLM's mental model comes from the **spec**, not the code. When the LLM composes a graph and it fails, there are only three possibilities:

1. **The spec is unclear** — fix the spec
2. **The implementation is buggy** — fix the code
3. **The LLM misunderstood** — fix the spec (if the LLM misunderstood, humans will too)

In all three cases, the right action is to improve the system. There is no "the LLM is wrong and the code is right" outcome that does not also imply a spec deficiency.

This is not a replacement for unit tests, property tests, or integration tests. It is a **complementary validation layer** — one that is uniquely good at finding spec-implementation divergence because it has no access to the implementation.

## What Changed in the Spec

SPEC v0.2 incorporated the fixes directly:

- **§1.2** — START message type added, tier table updated (0–5)
- **§1.3** — Invariant #8: `get()` never triggers computation
- **§2.2** — Subscribe flow rewritten: START handshake, ROM/RAM semantics, pending status, first-run gate via pre-set dirty mask
- **Composition Guide §1** — START + first-run gate + dynamicNode exception documented
- **Composition Guide §9** — Diamond resolution + two-phase protocol for source nodes
- **Composition Guide §10** — SENTINEL vs null-guard cascading pitfalls

The spec and the implementation now agree. The LLM validation experiment was the proof.

## Try It Yourself

If you maintain a reactive framework, a state management library, or any system with a formal spec, here is the experiment:

1. Write a clear spec document describing your protocol's guarantees
2. Give the spec (and only the spec) to an LLM
3. Ask it to compose 10 scenarios that exercise edge cases: diamonds, conditional deps, late subscribers, reconnection, teardown
4. Run the composed code against your implementation
5. Every failure is either a spec bug or an implementation bug — both are worth fixing

You might be surprised how many `"chore: fix tests"` commits are hiding real bugs.

## Further Reading

- [The START Protocol: Every Subscription Deserves a Handshake](./33-the-start-protocol) — the protocol message born from this experiment
- [Pure Push: How GraphReFly Eliminated the Pull Phase](./34-pure-push) — the architecture that START enabled
- [Why AI Can't Debug What It Can't See](./32-debugging-with-your-own-tools) — a related story about AI + reactive system observability

## Frequently Asked Questions

### What is LLM composition validation?

LLM composition validation is a testing technique where you give a language model your system's specification and ask it to compose working programs from scratch. Because the LLM reasons from the spec (not the implementation), failures reveal gaps between what the spec promises and what the code delivers. GraphReFly used this technique to find four spec-implementation gaps that 1,400+ unit tests had missed.

### Can any reactive framework use this validation technique?

Yes, as long as the framework has a written specification. The key ingredient is a document that describes behavior contracts without referencing implementation details. The LLM needs to reason about what *should* happen, not what *does* happen. If your framework's documentation is mostly API reference (function signatures and parameter descriptions), you will need to write a behavioral spec first.

### Did the LLM write the fixes too?

No. The LLM found the bugs by composing graphs that exposed incorrect behavior. The fixes were designed by human engineers through a clean-room redesign of the node lifecycle. LLMs are excellent at finding spec-implementation divergence; the architectural decisions about how to resolve that divergence required human judgment about trade-offs, backwards compatibility, and protocol design.

### How many tests broke during the v0.2 refactor?

The initial implementation caused 68 test failures — expected, since START appears in message sequences and ROM/RAM changes cache behavior on disconnect. After 10+ error-and-fix cycles, all 1,426 tests passed, including corrected versions of tests that had been asserting incorrect behavior. Five tests were identified as enshrining wrong behavior and were rewritten to match spec contracts.

---

*This concludes Arc 6: GraphReFly SPEC v0.2 — The Pure Push Model.*
