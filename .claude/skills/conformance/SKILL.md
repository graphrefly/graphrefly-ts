---
name: conformance
description: "Behavioral conformance check across GraphReFly language runtimes (ts/rust/py) for the clean-slate redesign. Replaces the old structural 'parity' diff. Parity = does each runtime satisfy the wave-protocol behavior (conformance scenarios) + dispatcher contract — NOT 'do the symbol sets match'. Use after implementing/changing substrate behavior in any runtime, or when adding a new protocol rule. Authors/runs language-agnostic scenarios and updates conformance.jsonl runtime status. Triggers: 'conformance', 'cross-lang check', 'does rust match', 'parity', 'run the conformance suite', 'is the substrate behavior consistent'."
disable-model-invocation: true
argument-hint: "[rule-id | scenario-id | 'full'] [optional: runtime ts|rust|py]"
---

You are executing **conformance** for the clean-slate GraphReFly redesign.

**Parity is behavioral, not structural (D24).** There is NO `Impl` symbol-set to diff and NO
cross-track-ledger. Operators / sugar / inspection are **per-language and never in parity**
(D6/D27 — graph-layer wraps everything to `(ctx)=>void` before register). The ONLY parity
surface is: **wave-protocol behavior + dispatcher contract + handle format**. Conformance =
each runtime passes the same language-agnostic scenarios.

## Authority

| Source | Role |
|---|---|
| `~/src/graphrefly/spec/conformance.jsonl` | The scenario registry: `{id, name, covers:[rule-id], runtimes:{ts,rust,py}, status, note}`. |
| `~/src/graphrefly/spec/rules.jsonl` | The rules scenarios pin (`covers` must resolve here). |
| `~/src/graphrefly/spec/protocol.proto` | Protocol-contract IDL (DR-2) — the light structural anchor codegen'd into each runtime's interface stub. |
| `~/src/graphrefly/formal/*.tla` | TLA+ model (γ); property tests mirror its invariants. |

## Scope from $ARGUMENTS

- **rule-id** (e.g. `R-diamond`) → all scenarios whose `covers` includes it.
- **scenario-id** (e.g. `C-1`) → that scenario.
- **full** → every `status:"required"` scenario.
- optional **runtime** → restrict to one arm.

## Phase 1 — scenario integrity

1. Load `conformance.jsonl` + `rules.jsonl`. Verify every `covers` rule-id resolves (else HALT — fix the scenario or add the rule via `/spec-amend`).
2. List the **DR-5 required hard scenarios** and their status: `C-1` cross-graph diamond, `C-2` async-result-at-paused-node, `C-3` INVALIDATE×ctx.state×onInvalidate, `C-4` mixed sync/async diamond, `C-5` PAUSE-lockset multi-source. These are the load-bearing ones — behavioral parity is a blank cheque until they're green on each shipped runtime.

## Phase 2 — run / verify per runtime

For each in-scope `(scenario, runtime)`:
1. Locate/author the scenario harness in that runtime's conformance test dir (language-agnostic spec → per-runtime adapter; the scenario describes observable wave behavior, not a symbol call).
2. Run it. Record outcome.
3. Update `conformance.jsonl` `runtimes.<rt>`: `"todo" | "poc-pass" | "pass" | "fail"`.
4. Mirror the invariant as a property test (fast-check ts ↔ proptest rust ↔ hypothesis py) where the rule is property-shaped (L5-Q2 / D14).

## Phase 3 — report

| scenario | covers | ts | rust | py | verdict |
|---|---|---|---|---|---|

- **Behavior drift** = same scenario, different observable outcome across runtimes → this is the ONLY kind of parity gap. File it as a substrate bug in the lagging runtime (route fix via `/dev-dispatch` on that package).
- **Missing scenario** for a rule (rule's `covers_by` empty) → author it (this is the real risk under behavioral parity: untested behavior can drift silently — D24 residual). Flag via `/dashboard` Gaps (uncoveredRules).
- **NOT a gap:** a runtime having a different operator set / different sugar / different inspection ergonomics. Those are per-language by design — do not report them.

## Phase 4 — gate

Run `node ~/src/graphrefly/dashboard/build.mjs --check` (scenario↔rule links intact). For a runtime
to be declared "conformant", all `status:"required"` scenarios must be `"pass"` on its arm.

## Boundaries

Does NOT diff symbol sets (that's the retired structural model). Does NOT touch operators/sugar/inspection
(per-language). New protocol behavior must go through `/spec-amend` FIRST (scenario authored before code).
