---
title: "Proof Before Promises: TLA+, Property Tests, and a TS↔PY Contract for Agent Runtimes"
description: "GraphReFly's rigor infrastructure plan: property-based testing for the reactive core, a TLA+ spec for protocol invariants, and an executable TS↔PY behavioral contract. What it is, why it matters for enterprise adoption, and how we got here."
date: 2026-04-25T09:00:00
authors:
  - david
tags:
  - testing
  - correctness
  - spec-v0.4
  - cross-language
  - enterprise
---

# Proof Before Promises: TLA+, Property-Based Tests, and a TS↔PY Contract for Agent Runtimes

*Arc 7, Post 44 — Rigor Infrastructure*

---

Most open-source libraries prove correctness with unit tests. Unit tests are valuable. They also have a well-known limitation: they prove what you thought to test, not what you didn't think of.

For a reactive graph protocol that needs to handle diamond resolution, concurrent PAUSE locks, equals substitution, wave-phase ordering, and versioning upgrades — all interacting — unit tests are necessary but not sufficient.

Here's where GraphReFly's rigor plan goes beyond unit tests, and why it matters if you're making a bet on this infrastructure.

## The verification gap we found

The v0.4 work produced 1,600+ passing tests. It also produced something more uncomfortable: we found bugs that had been present for months, all confirmed by unit tests that were "correct" — they matched the implementation's behavior, including the broken parts.

The `mergeMap` memory leak (inner ERROR not cleaning up its slot) had tests that exercised inner ERROR. Those tests didn't check that the slot was cleaned up — they checked that the error was forwarded. The behavior being tested was correct; the side effect that mattered wasn't.

The `autoTrackNode` stale closure bug had tests that passed because the tests happened to run in an order where stale closures fired before the sentinel guard triggered. Different test ordering, different result.

The diamond race in the harness fast-retry loop (post 41) had tests that verified the retry count — but only for cases where the subscription order happened to be correct.

These are the bugs that property-based testing and formal verification are designed to catch.

## Property-based testing for the reactive core

Property-based testing generates random inputs and checks that invariants hold for all of them. For a reactive protocol, the relevant invariants include:

- **Wave completeness:** every DIRTY must be followed by exactly one of DATA or RESOLVED, never neither
- **Diamond resolution:** for any diamond topology, fn runs exactly once after all deps settle
- **PAUSE/RESUME consistency:** a node with held PAUSE locks never emits tier-3/4 messages
- **Equals substitution coverage:** if a node emits DATA with the same value as `.cache`, downstream receives RESOLVED not DATA
- **Subscription commutativity:** the order in which deps are subscribed should not affect the first-stable value

The property-based test suite generates random graphs (random topologies, random dep counts, random batching), random input sequences, random subscription orders, and checks that these invariants hold for every generated case.

This catches the class of bugs that unit tests miss: the interaction between two correct behaviors that produces an incorrect combined behavior. The unit tests verified that DIRTY propagation was correct. They verified that PAUSE buffering was correct. The property tests can verify that DIRTY propagation interacts correctly with PAUSE buffering — something no unit test explicitly exercised.

## A TLA+ spec for the core protocol

TLA+ (Temporal Logic of Actions) is a specification language for describing and verifying concurrent systems. You write a model of the system's state and transitions, and the model checker exhaustively explores all reachable states to verify your safety and liveness properties.

For GraphReFly's core protocol, the TLA+ spec models:

- Node states: `sentinel | active | paused | errored | completed | torn-down`
- Message delivery: DIRTY, DATA, RESOLVED, PAUSE, RESUME, TEARDOWN, COMPLETE, ERROR
- Wave tracking: dirty-count, sentinel-count, data accumulation
- Lock sets: the set of lockIds currently held on a node

The safety properties to verify:
- No DATA emission without prior DIRTY (or from an unparseable raw-emit path that synthesizes DIRTY)
- No fn invocation when any dep is in sentinel state
- No emission from a node with non-empty lock set (PAUSE guarantee)
- Lock set membership: RESUME only releases a lock held by the same lockId

TLA+'s model checker runs exhaustively: every state reachable from every initial state under every valid transition ordering. It doesn't sample. It doesn't use heuristics. If a safety violation exists within the state space you've modeled, it will find it.

The checked-in models live in the GraphReFly **monorepo** under [`formal/`](https://github.com/graphrefly/graphrefly/tree/main/formal) (for example `wave_protocol.tla` and TLC configs alongside them) — next to the TypeScript and Python packages, not inside `graphrefly-ts` alone.

The spec doesn't replace the implementation — it constrains it. The implementation must be consistent with the spec. When the spec says PAUSE with a lockId that isn't held is a no-op (for dispose idempotency), the implementation must follow that exactly. When we change the implementation, we verify the change against the spec first.

## The TS↔PY behavioral contract

GraphReFly ships in TypeScript and Python. The two implementations must be behaviorally identical: the same graph topology, the same inputs, the same ordering of events, must produce the same outputs on both platforms.

Achieving this without a shared runtime is harder than it sounds. TypeScript's event loop and Python's GIL have different concurrency models. Python's `int` is unlimited precision (used for the diamond-resolution bitmask); TypeScript uses `Uint32Array + BigInt` for fan-in >31. The implementations have diverged on edge cases before.

The TS↔PY contract is an executable specification: a set of test scenarios with exact input sequences and expected output sequences, encoded as platform-neutral JSON. The CI pipeline runs each scenario against both the TypeScript and Python implementations and compares outputs.

```json
{
  "scenario": "diamond-resolution",
  "topology": { "A": [], "B": ["A"], "C": ["A"], "D": ["B", "C"] },
  "sequence": [
    { "emit": "A", "value": 1 },
    { "expect": "D", "value": 2, "via": "one-fn-call" }
  ]
}
```

The scenario file is the source of truth. If TypeScript produces the correct output and Python doesn't (or vice versa), the parity gap is surfaced immediately, not discovered in production.

This is particularly important for teams deploying agent systems across environments: a Python-based agent that needs to interoperate with a TypeScript-based orchestrator needs to know that the protocol they share means the same thing in both languages.

## What this means for enterprise evaluation

Enterprise procurement of infrastructure libraries typically involves three questions about correctness: How is it tested? How are invariants verified? What happens when you find a bug?

Unit tests answer the first question. Property-based tests and TLA+ answer the second. The TS↔PY contract answers the third: when a bug is found in one implementation, the contract catches whether the other implementation shares the bug or needs the same fix.

We're not claiming the system is bug-free — that would be a lie. We're claiming that the bugs that exist are increasingly hard to reach, that the invariants we care about are formally specified and model-checked, and that when we find a bug (as we inevitably will), we have the infrastructure to understand its scope and verify the fix.

"Proof before promises" means: the assertions we make about correctness are backed by verification, not just optimism.

Next: [From AI-Assisted to AI-First Engineering](/blog/45-ai-first-engineering) — what the harness infrastructure means for how engineering teams work with AI.
