---
title: "RESOLVED: The Signal That Skips Entire Subtrees"
description: "After DIRTY, not every node emits DATA. RESOLVED completes the wave with no new value — clearing bitmasks and letting memoization skip work that would otherwise rerun."
date: 2026-03-24T13:00:00
authors: [david]
tags: [architecture, performance, correctness]
---

# RESOLVED: The Signal That Skips Entire Subtrees

![RESOLVED Signal](/blog-heroes/hero-12.png)

*Arc 4, Post 12 — Architecture v3: The Type 3 Breakthrough*

---

**DIRTY** tells downstream: *prepare — a dependency is in flux.* **DATA** delivers the next value. **RESOLVED** is the third outcome: *I was part of that pending wave, and I have nothing new to ship.*

If that sounds like a small detail, try implementing **multi-dep operators** without it. Every convergence node tracks **which** dependencies were dirty. When the last pending bit clears, the node must either **emit** or **explicitly settle** the wave. Silence is not neutral — silence is a **stuck bitmask** and a downstream graph waiting forever.

## What RESOLVED means mechanically

- Send **RESOLVED** only after you participated in the current dirty cycle (you forwarded DIRTY, or you are absorbing a branch of the wave).
- Never send RESOLVED "cold" without a matching DIRTY story — it is not a generic heartbeat.
- When **`equals(prev, next)`** is true after a derived recompute, we do not emit duplicate DATA. We send **RESOLVED** so parents and siblings can clear **their** dirty state without redoing heavy work.

That last point is where **subtree skipping** comes from. Push-phase memoization is not only "avoid allocating a new object." It is **avoid waking children** when the mathematical output is unchanged — and RESOLVED is the message that carries that decision through the same protocol as DIRTY/DATA.

## Diamond resolution stays glued together

At a join node, multiple upstream branches can go dirty. The bitmask waits until **all** relevant deps have reported **DATA or RESOLVED**. Only then does the join recompute — and if its own output is unchanged, it can RESOLVED in turn. The cascade matches the **phase-one / phase-two** story from v2, but with an explicit **no-value completion** on STATE instead of inferring it from absence.

## Why "just filter out emissions" was not enough

Pull-time equality **after** compute still paid for the compute. v3's goal was to make **"no change"** a first-class **push** decision, visible to the graph: downstream sees RESOLVED, not silence, not a duplicate value.

## Further reading

- [From Pull-Phase to Push-Phase Memoization](./09-push-phase-memoization) — the v2 memoization story RESOLVED completes
- [Why Control Signals Don't Belong in the Data Stream](./11-why-control-signals-dont-belong-in-the-data-stream) — why suppression uses STATE
- [Architecture](/architecture/) — diamond resolution and bitmask rules
- Session context: push-phase memoization debate (`ce974b95` in `docs/blog-strategy.md` inventory)

---

*Next: [Five primitives, two tiers, zero schedulers](./13-five-primitives-two-tiers-zero-schedulers).*
