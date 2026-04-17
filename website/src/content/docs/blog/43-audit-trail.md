---
title: "The Audit Trail Your Compliance Team Will Ask For: SENTINEL, Equals, and Causal Trace by Design"
description: "GraphReFly v0.4 makes the distinction between 'nothing happened' and 'something happened and it's the same' explicit and auditable. For regulated industries and AI systems that need to explain decisions, this is the foundation of a compliance story."
date: 2026-04-24T09:00:00
authors:
  - david
tags:
  - compliance
  - auditing
  - correctness
  - spec-v0.4
  - ai-collaboration
---

# The Audit Trail Your Compliance Team Will Ask For: SENTINEL, Equals, and Causal Trace by Design

*Arc 7, Post 43 — SENTINEL, Equals Substitution, and `explainPath`*

---

There's a question that comes up in regulated industries — finance, healthcare, legal — when AI systems start making decisions that affect people: "Why did this happen?"

Not "what happened" (logs can answer that). Not "what value did the system produce" (monitoring can answer that). But: what was the causal chain from input to decision? Which upstream values contributed? When did each change? And critically: are we confident that "nothing changed" actually means nothing changed, or does it mean "we didn't check"?

GraphReFly v0.4 makes this distinction explicit at the protocol level. Here's how, and why it matters for any system that needs to explain its decisions.

## The problem with "no change" in most reactive systems

Most reactive frameworks distinguish two states: a value changed (emit the new value) or the computation didn't run (emit nothing). What they often don't distinguish is: **a value was recomputed and produced the same result** vs. **a value wasn't recomputed at all**.

This distinction matters for auditing. "The risk score remained at 0.3 this cycle" could mean:
- The inputs changed, we recomputed, and got 0.3 again (computation ran, stable result)
- The inputs didn't change, so we didn't recompute (computation skipped, result assumed stable)
- The framework skipped the computation for an internal reason (computation absent)

In an audit, these are three different situations that need three different explanations.

## RESOLVED: the explicit "recomputed, same result" signal

GraphReFly's two-phase push model gives every computation a way to explicitly signal "I ran, and my result is unchanged": the `RESOLVED` message.

When a node's dependency emits DIRTY (value about to change) and then emits RESOLVED (value unchanged after all), the framework propagates RESOLVED downstream. Downstream nodes that receive only RESOLVED from all their deps in a wave know that nothing they care about changed — and they can emit RESOLVED themselves, propagating this signal through the chain.

In v0.4, equals substitution is a **dispatch-layer invariant**: every emission path — user `actions.emit(v)`, passthrough forwarding, even error recovery — runs through a single `_emit` waist that checks the new value against `.cache`. On match, the DATA tuple is rewritten to RESOLVED. This happens unconditionally, on every path. There are no escape hatches where "same value" produces DATA instead of RESOLVED.

From an audit perspective: when you ask "did this node recompute?", RESOLVED means "yes, and the result was stable." It's a positive signal, not an absence.

## SENTINEL: the explicit "no value yet" state

The other end of the spectrum: a node that has never produced a value. In most reactive systems, this state is represented by `null` or `undefined` — the same values that might be legitimate business values. You need out-of-band context to distinguish "hasn't computed yet" from "computed and produced null."

In v0.4, `undefined` is reserved globally as the SENTINEL value. Valid DATA payloads are `T | null` — `null` is a legitimate value, `undefined` is never one. `.cache === undefined` is a valid, unconditional sentinel guard. No magic string, no separate flag, no null-check-plus-status-check dance.

This matters for the start of an audit trail. When an agent system first activates, before any inputs have been processed, every node is in SENTINEL state. The transition from SENTINEL to first DATA is an observable event — the moment the node became active. An auditor can ask "when did this node first produce a value?" and get a definitive answer.

## `explainPath`: the causal chain as a queryable structure

For V1 nodes (where full history is tracked), `graph.trace(node)` returns the causal chain: this emission had this cid, it came from these dep emissions (by cid), which came from these upstream nodes, and so on.

The result is a structured graph, not a log. You can query it:

```typescript
const chain = graph.trace("risk-score");

// "Which inputs contributed to the current risk score?"
chain.deps.map(d => ({ node: d.path, value: d.value, version: d.version }))

// "When did the primary data source last change?"
chain.upstream("data-source/primary").lastChanged

// "Was this derived from a human-approved value or an AI-generated one?"
chain.upstream("approval-gate").meta.producer
```

This is the "why was this flagged?" question answered structurally, not with log searching. The causal chain is a first-class data structure built from the same protocol that delivers values — not reconstructed from logs after the fact.

## PAUSE/RESUME lockId: who holds the gate

In v0.4, PAUSE/RESUME requires a mandatory `lockId`. Bare `[[PAUSE]]` without a lockId throws. The lockId identifies the entity that paused the node — a specific upstream subsystem, a human approval gate, a rate-limiter.

```typescript
// Each pauser holds a distinct lock
node.down([[PAUSE, "approval-gate"]]); // Human approval required
node.down([[PAUSE, "rate-limiter"]]);  // Also rate-limited

// Resume requires the matching lockId
node.down([[RESUME, "approval-gate"]]); // Human approved — lock released
// Node still paused — rate-limiter lock still held
node.down([[RESUME, "rate-limiter"]]); // Both locks released — node resumes
```

For auditing: "why was this node paused at 14:23?" The lockId answers it. "Who released it?" The RESUME lockId answers it. Multi-pauser correctness is structural: a node can't be un-paused by an entity that didn't pause it.

## The compliance story, assembled

Put these together and you have a compliance-ready audit trail without bolting on a separate observability platform:

1. **SENTINEL** records when a node first became active
2. **DIRTY → DATA / RESOLVED** records every computation: ran-and-changed vs. ran-and-stable
3. **Equals substitution** guarantees DATA means "actually changed" — no false positives in the audit trail
4. **V1 cid chains** link every value to the upstream values that produced it
5. **PAUSE/RESUME lockId** records who gated which outputs and when
6. **`graph.trace()`** makes the causal graph queryable by an auditor (or an LLM asked to explain a decision)

This isn't an afterthought compliance layer. It's the protocol itself. Every value in a GraphReFly system carries provenance, and the graph structure makes that provenance traversable.

For AI systems in regulated contexts — where "the model said so" isn't an acceptable audit response — this is the foundation of an explanation that can satisfy a compliance review.

Next: [Proof Before Promises](/blog/44-proof-before-promises) — TLA+, property-based tests, and the TS↔PY contract.
