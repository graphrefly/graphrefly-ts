---
title: "Diamond Resolution Without Pull-Phase Computation"
description: "How push-phase memoization and DIRTY/RESOLVED control signals solve diamond graphs without reintroducing pull-phase recomputation."
date: 2026-03-25
authors: [david]
tags: [correctness, architecture]
---

# Diamond Resolution Without Pull-Phase Computation

*Chronicle 18 - Arc 6: Correctness Stories*

Diamond dependencies are where reactive systems tell the truth about themselves.

If one upstream change fans out through two paths and rejoins, you either:

- compute once and coordinate correctly, or
- compute repeatedly and hope nobody notices.

In early designs, pull-phase recomputation looked like the safe fallback. In v4, we committed fully to push-phase memoization with control signals instead.

## The old temptation

Pull-phase logic says: "when asked, recompute now." That can feel robust because values seem always fresh. But in diamonds it tends to duplicate work or force ad hoc caching at each branch.

We wanted determinism without fallback recomputation.

## The v4 approach

Correctness comes from coordinated push behavior:

- upstream emits `DIRTY` first
- dependents mark invalid state without recomputing
- values flow once in topological order
- `RESOLVED` signals allow subtrees to skip unnecessary propagation when unchanged

No pull-phase rescue path. If push ordering is right, the graph stays coherent.

## Why this is safer

A single model is easier to reason about than "push usually, pull sometimes."

By avoiding mixed modes, we removed classes of bugs where:

- one branch used cached data while another recomputed
- call ordering differed between equivalent topologies
- correctness depended on incidental subscription timing

The whole graph follows one contract.

## Real-world effect

This strategy improved both trust and throughput:

- fewer duplicate derived computations in fan-out heavy trees
- clearer inspector traces because updates follow one path discipline
- predictable behavior under rapid bursts and cancellation

The important part is not that it is fast. It is that it stays right under stress.

## Takeaway

Diamond resolution is a protocol problem, not a memoization hack.

Once control signals and push-phase ordering are explicit, you can keep computation single-pass without falling back to pull-phase patches.
