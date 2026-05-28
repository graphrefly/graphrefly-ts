---
name: decision-guard
description: "GraphReFly clean-slate decision-consistency check. Loads the user's locked values/principles + the unified D-numbered decision log (decisions.jsonl) + recurring decision-process patterns. Use BEFORE answering any question of the form 'is this consistent with our decisions?', 'should I pick option A/B/C?', 'what about this proposed fix?', 'is X part of our scope?', 'is this a regression on a prior decision?'. Triggers: 'decision check', 'drift check', 'align check', 'is this consistent', 'should I pick', 'what about this', 'is this in scope', 'consistency review'."
argument-hint: "[short context of what you're being asked about — paste the proposal if relevant]"
---

# decision-guard — recall and apply locked decisions, values, invariants (clean-slate)

**Purpose.** Conversations lose context-window state quickly. This is the canonical recall
surface for the **clean-slate** redesign: invoke BEFORE answering decision questions to anchor
against the user's locked positions and prevent silent drift — especially when a chat proposes
a scope expansion mid-implementation, presents A/B/C as a fork, uses "completeness" to justify
expanding a locked slice, or builds on a premise that may be stale.

> **Clean-slate retired the old port model.** Do NOT reach for `rust-port-decisions.md`,
> `cross-track-ledger.md`, the `Impl` parity contract, `BindingBoundary`, the actor model, or
> 3-digit D### port decisions — those are old-`main` history. The clean-slate decision
> authority is below.

## Sources (load in order)

| Source | Role |
|---|---|
| `~/src/graphrefly/decisions/decisions.jsonl` | **Unified D# log** (D1–D33 + DR-*). Canonical record: `{id, layer, question, decision, rationale, supersedes, status}`. |
| `~/src/graphrefly/sessions/active/SESSION-clean-slate-redesign.md` (DS-1) | Full design narrative + 8 forced constraints + spec-amendment list + conformance hard scenarios. |
| `~/src/graphrefly/plan/antipatterns.jsonl` | Lessons / anti-patterns to flag against. |
| `~/src/graphrefly/spec/rules.jsonl` | Protocol rules — for "does the spec already pin this?". |
| Memory `feedback_*` files | The user's durable values/principles (below). |

## Locked values (durable — cite by name)

1. **No backward compat** (pre-1.0): structurally cleaner option, no legacy shims. `feedback_no_backward_compat`.
2. **No imperative triggers** in public API: reactive `ctx.up`/signals, not emitters/callbacks/timers+set; remove imperative paths when no caller depends. `feedback_no_imperative`.
3. **Single source of truth**: one canonical per concern; index points, never duplicates. `feedback_single_source_of_truth`.
4. **No autonomous decisions** (hard rule): surface spec↔code conflicts; don't silently pick; file-by-file review for multi-file rewrites. `feedback_no_autonomous_decisions`.
5. **No implement without approval**: decisions locked ≠ implementation approved. `feedback_no_implement_without_approval`.
6. **Verify premise before greenfield**: design tables lag code — grep symbols + check landed markers before a 9Q; stale premise = HALT. `feedback_verify_premise_before_greenfield`.
7. **Latest versions + context7** for current API docs. `feedback_latest_versions_context7`.
8. **Long-command observation discipline** (run-logged + DONE sentinel; no tail; no sleep-poll) and **subagent bg hygiene** (sync-verify or teardown before return). `feedback_long_command_observation`, `feedback_subagent_bg_hygiene`.

## Clean-slate floor (never violate)

**Sacred (L0.7):** topology declarative/serializable/inspectable · wave protocol is a public spec ·
wave protocol impl is **sync** · all fn go through dispatcher.

**Forced (F-*):** F-PERF (budget every abstraction) · F-PROTO-SPEC (spec+TLA++property) ·
F-SYNC-CORE (dispatcher.invoke sync void) · F-DISPATCH-ALL (no inline-fn bypass) ·
F-GRAPH-FIRST-API · F-NO-WEDGE-CUT (every primitive ≥2 segments) ·
F-NO-IMPL-DEFINED (spec-locked or explicitly undefined-by-design) · F-NO-LLM-ONLY.

**Red flags (HALT if proposed):** async in the sync wave core (async lives only in pools/wire-bridge) ·
inline-fn bypassing dispatcher · a primitive serving only LLM workflows · a protocol behavior left
"implementation-defined" · user-replaceable onMessage/onSubscribe · adding a 10th tier casually ·
graph-level shared mutable state accessed implicitly (must be explicit node + dep).

## Decision-process patterns (apply in order)

1. **Identify the governing D#.** Grep `decisions.jsonl` by `layer`/keyword. Is the proposal within a locked D's scope? Mid-implementation scope expansion = anti-pattern unless promoted to a NEW D#.
2. **Check the spec.** Does `rules.jsonl` pin the behavior? If yes, follow it — divergence is a bug, not a design call. If silent/ambiguous → real design HALT.
3. **Verify premise (value 6).** Has the symbol/surface already landed? grep before designing new surface.
4. **Apply values + floor.** Especially: no autonomous decisions, no imperative, single source of truth, sync-core/async-at-boundary, F-* constraints.
5. **Verdict:** `consistent (cite D#)` / `regression on D#` / `out-of-scope` / `needs new decision (don't auto-pick)`.
6. **Routing:**
   - New fork, no governing D# → present options + recommend, **do NOT lock** → that's `/design-review` → user approval → append `decisions.jsonl`.
   - Changes protocol behavior → `/spec-amend` (spec-first).
   - Cross-runtime parity concern → `/conformance` (behavioral scenario, not structural diff).

## Common decision shapes

- **A/B/C (fix shape):** default = the option that **structurally extends an existing pattern** beats per-site workarounds.
- **Completeness vs discipline:** if a proposal closes a real semantic gap → formalize as a NEW D# (don't continue under the original D's banner). If speculative scope expansion → revert.
- **Orthogonal sub-decisions:** before locking two "orthogonal" sub-decisions, sketch ONE input exercising BOTH — confirm orthogonality survives the example (antipatterns.jsonl; the 30-second check that catches coupling at design-time).

## Scope boundaries

Read-mostly. Loads decisions + values + patterns; produces **decision + reasoning + relay-ready text**.
Does NOT run gates, apply fixes, or author scenarios — those are `/dev-dispatch` / `/qa` / `/conformance`
after a decision locks. Invoke when the question is "what should I decide?", not "what should I do?".

## Update protocol

When a new D# locks (after user approval): append to `~/src/graphrefly/decisions/decisions.jsonl`
(`{id, layer, date, question, decision, rationale, supersedes, status:"locked", session}`), update the
session's `locks` in `sessions.jsonl`, and run `node ~/src/graphrefly/dashboard/build.mjs --check`.
When a new anti-pattern recurs: append to `~/src/graphrefly/plan/antipatterns.jsonl` (+ a `feedback_*`
memory if generalizable). When a new durable value surfaces: add a `feedback_<name>.md` memory + a
pointer line here.
