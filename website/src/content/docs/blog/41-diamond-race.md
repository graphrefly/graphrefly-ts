---
title: "The Diamond Race That Almost Cost 10× Retries — And the Structural Fix That Doesn't Rot"
description: "A depth-first delivery ordering bug in our harness loop caused retry tracking to use stale item identity on every cycle. Here's the root cause, why a patch would have rotted, and how declaring the right topology fixed it permanently."
date: 2026-04-22T09:00:00
authors:
  - david
tags:
  - correctness
  - harness
  - architecture
  - debugging
---

# The Diamond Race That Almost Cost 10× Retries — And the Structural Fix That Doesn't Rot

*Arc 7, Post 41 — BUG-F1: harness fast-retry exhaustion*

---

The most dangerous bugs in reactive systems are the ones that look like logic bugs. They appear as wrong values, as unexpected behavior, as "this should be 3 but it's 20." The code looks fine. The logic looks right. The test passes in isolation.

Then you run the system under load and something explodes.

We found one of these in our harness loop during v0.4 hardening. The symptom: a task that should have retried 3 times was retrying 20 times. The cause: a depth-first delivery race creating a diamond coordination failure. The fix: one new node, no special cases, no defensive checks that will silently break when the topology changes.

## The harness loop structure

The harness loop is a 7-stage reactive pipeline: INTAKE → TRIAGE → QUEUE → GATE → EXECUTE → VERIFY → REFLECT. For retries, a `retryTopic` feeds back into the EXECUTE stage.

The specific topology around VERIFY looked like this:

```
executeInput ──────────────────────► executeNode
                                          │
                                          ▼
                             executeNode ──► verifyNode
                                          │
                             executeInput ─┘ (withLatestFrom secondary)
                                          │
                                          ▼
                                     verifyContext
```

`verifyContext` was `withLatestFrom(verifyWithExec, executeInput)`. The intent: pair the verified result with the original input item so the verification stage knows which item it's verifying (and, critically, how many times it's been retried).

## The depth-first delivery race

When `retryTopic.publish(retryItem)` fires, it emits DATA to `executeInput`. `executeInput` has two subscribers: `executeNode` (declared dep) and `verifyContext` (secondary dep via `withLatestFrom`).

JavaScript's event loop is synchronous and depth-first. Subscribers are notified in subscription order. The sequence was:

1. `executeInput` emits `DATA(retryItem)` to subscribers.
2. **`executeNode` fires first** (it subscribed first) and processes the item.
3. `executeNode`'s DATA triggers `verifyNode`, which fires, which triggers `verifyWithExec`, which reaches `verifyContext` — all synchronously.
4. **`verifyContext` fires** with the verified result. But its secondary dep (`executeInput`) hasn't received its DATA update yet — it's still in step 1's subscriber queue.
5. `verifyContext`'s `withLatestFrom` falls back to its previous `latestData` for `executeInput`: the original (pre-retry) item. `_retries` is `undefined` on the original item.

The `fastRetry` logic checked `item._retries` and found `undefined` on every cycle. It computed `1` as the next retry count. The item never appeared to exceed `maxRetries: 2`. The loop ran to the global cap of 20.

The per-run result was always the original item identity — the stale snapshot from before the retry was published.

## Why a patch would have rotted

The obvious patch: in `verifyContext`'s `fn`, check if `executeInput.cache` matches the current wave's executeNode output. Use the cache if not.

But that's a cross-node inspection (P3 violation in v0.4). More importantly, it's a patch that requires the reader to understand exactly which subscription ordering race it's compensating for. Add one node to the topology — a new subscriber to `executeInput` that fires before `executeNode` — and the patch silently breaks.

Patches like this rot. They're correct for the current topology and wrong for future topologies. The failure is silent until production.

## The structural fix: declare the right topology

The correct fix is to express the dependency accurately. `verifyContext` needs `executeNode`'s output **paired with the `executeInput` item that triggered it**, not with whatever `executeInput` happened to have when `verifyContext` fired.

```typescript
// Before: verifyContext races with depth-first delivery
const verifyContext = withLatestFrom(verifyWithExec, executeInput);

// After: executeContextNode fires exactly once per execute-wave,
// after BOTH executeInput and executeNode have settled
const executeContextNode = withLatestFrom(executeNode, executeInput);
const verifyContext = withLatestFrom(verifyNode, executeContextNode);
```

`executeContextNode` is declared as `withLatestFrom(executeNode, executeInput)`. Because `executeNode` has `executeInput` as a declared dep, `executeContextNode` can only settle after both have delivered DATA in the same wave. It fires exactly once per execute-wave with the correct pair.

`verifyContext` now depends only on `executeContextNode`. Its secondary is `executeContextNode`, which already carries the paired `(execOutput, item)`. The retry count comes from the paired item — the one that was actually processed in this wave.

The fix is entirely topological. No special cases. No defensive checks. No version-guarding of cache reads. The new node expresses the actual causal relationship — "I need the output and the input that produced it, together" — and the framework's diamond resolution guarantees they arrive together.

## The broader principle: topology as correctness proof

This bug is a specific instance of a general problem: using a node's latest value (`withLatestFrom` secondary semantics) when you actually need the value from the specific wave you're processing.

`withLatestFrom` is correct for "give me the latest value of X as a side-channel while I process primary events." It's wrong for "give me the value of X that corresponds to this specific primary event." The latter requires declaring X as a proper dep of the combined node.

The topological fix is proof, not defense. If the topology correctly expresses causal relationships, the framework enforces them. You don't need to remember to check for stale values. You don't need to document "this node assumes executeInput fires before executeNode in subscriber order." The diamond resolution just works.

When we audit reactive harness bugs, the pattern we see most often is exactly this: a node that uses `withLatestFrom` where it should use a declared dep, because the author knew the timing would usually be right and didn't want the overhead of a diamond. The "usually" is the footgun.

In a long-running agent loop — one that runs thousands of retry cycles over hours — "usually" isn't good enough.

Next: [One describe() for Diagrams, Dumps, and Debugging](/blog/42-one-describe) — how introspection consolidation reduces cognitive overhead for agent teams.
