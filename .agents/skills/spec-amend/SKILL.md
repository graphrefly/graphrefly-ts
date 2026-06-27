---
name: spec-amend
description: "Spec-first protocol amendment flow for the clean-slate GraphReFly redesign. Use BEFORE changing any wave-protocol behavior (tiers, wave semantics, diamond/equals/SENTINEL, batch, push-on-subscribe, ctx.up/down contract). Enforces F-NO-IMPL-DEFINED: amend spec/rules.jsonl + formal/*.tla + spec/conformance.jsonl FIRST, then implement in each language package. Triggers: 'amend the spec', 'change the protocol', 'add a tier', 'spec change', 'new wave rule', 'this changes protocol behavior'. NOT for sugar/operator/inspection changes — those are per-language, never touch spec."
argument-hint: "[short description of the protocol behavior to change]"
---

You are executing **spec-amend** for the clean-slate GraphReFly redesign.

**Authority repo:** `~/src/graphrefly` (clean-slate branch) holds the language-neutral spec.
Per-language packages (`graphrefly-{ts,rust,py}`) implement it; they NEVER define protocol behavior.

## Iron rule (F-NO-IMPL-DEFINED, decision D14/D19)

Protocol behavior is **spec-first**. No "implementation defines what happens." Order is fixed:

1. **Amend the spec data** (before any code):
   - `~/src/graphrefly/spec/rules.jsonl` — add/edit the normative rule (`{id, area, tier?, statement, rationale, status, since:"D#", covers_by:[]}`). Mark `status:"draft"` until conformance + code land, then `"active"`.
   - `~/src/graphrefly/formal/*.tla` (+ MC config) — model the behavior; add the invariant; run TLC. (formalization γ, D14.)
   - `~/src/graphrefly/spec/conformance.jsonl` — add the behavioral scenario(s) that pin the new rule (`covers:[rule-id]`, `runtimes:{ts:"todo",rust:"todo",py:"todo"}`, `status:"required"`).
2. **Record the decision** if this is a new architectural lock: append a `D#` to `~/src/graphrefly/decisions/decisions.jsonl` (or reference the existing one in `since`).
3. **Run the consistency gate:** `node ~/src/graphrefly/dashboard/build.mjs --check` (no broken links/orphans).
4. **THEN implement** in each language package to make the conformance scenarios pass; flip `runtimes.<lang>` → `"pass"` as each lands. Use `/dev-dispatch` per package.

## Closed-set guardrails (do not bypass)

- **9 tiers are a closed set** (D9). Adding a tier is a constitutional change — requires explicit user lock + TLA+ re-model, not a casual amend.
- **onMessage/onSubscribe are substrate-fixed** (D19) — they are NOT user-replaceable hooks; "amend" means changing the spec'd behavior, not adding a config knob.
- **equals fires only single-DATA-wave** (D15); **ctx.up is control-tier only** (R-ctx-up); **restore ≠ fresh-lifecycle wipe** (R-restore). Re-read these rules before touching adjacent behavior.

## Output

A spec-amendment plan: which rule(s) change, the TLA+ invariant delta, the conformance scenario(s) added, the D# (new or referenced), and the per-language implementation order. HALT for user approval before writing TLA+/code if the change touches a closed-set guardrail.

After the spec data lands and `--check` is clean, hand off to `/dev-dispatch` per language package and `/conformance` to drive the scenarios green.
