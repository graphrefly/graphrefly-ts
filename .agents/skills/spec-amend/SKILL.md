---
name: spec-amend
description: "Spec-first protocol amendment flow for the clean-slate GraphReFly redesign. Use BEFORE changing any wave-protocol behavior (tiers, wave semantics, diamond/equals/SENTINEL, batch, push-on-subscribe, ctx.up/down contract). Enforces F-NO-IMPL-DEFINED: amend spec/rules.jsonl + formal/*.tla + spec/conformance.jsonl FIRST, then implement in each language package. Triggers: 'amend the spec', 'change the protocol', 'add a tier', 'spec change', 'new wave rule', 'this changes protocol behavior'. NOT for sugar/operator/inspection changes — those are per-language, never touch spec."
---

You are executing **spec-amend** for the clean-slate GraphReFly redesign.

**Authority repo:** `~/src/graphrefly` (clean-slate branch) holds the language-neutral spec.
Per-language packages (`graphrefly-{ts,rust,py}`) implement it; they NEVER define protocol behavior.

## Iron rule (F-NO-IMPL-DEFINED, decision D14/D19)

Protocol behavior is **spec-first**. No "implementation defines what happens." Order is fixed:

1. **Amend the spec data** (before any code):
   - `~/src/graphrefly/spec/rules.jsonl` — append a normative rule revision (`{id, revision, area, tier?, statement, rationale, introduced_by:["D#"], activated_by?:["D#"], transition?}`). Rule decision refs are root-context refs because protocol locks are root-owned. Never edit a published revision in place. Use an explicit `transition` (`replace`/`retire`) from a later revision when the trace set changes. Coverage is derived from conformance records' forward `covers` refs; rules do not carry `covers_by`.
   - `~/src/graphrefly/formal/*.tla` (+ MC config) — model the behavior; add the invariant; run TLC. (formalization γ, D14.)
   - `~/src/graphrefly/spec/conformance.jsonl` — add the behavioral scenario(s) that pin the new rule (`covers:[rule-id]`, `runtimes:{ts:"todo",rust:"todo",py:"todo"}`, `status:"required"`).
2. **Record the decision** if this is a new architectural lock: protocol/cross-project locks are root-owned, so append the approved root `D#` and reference its root-context id from `introduced_by`/`activated_by`. Use `~/src/graphrefly/authority/ledgers.jsonl` to verify the owner rather than copying the decision elsewhere.
3. **Run the consistency gate:** `node ~/src/graphrefly/dashboard/build.mjs --check` (no broken links/orphans).
4. **THEN implement** in each language package to make the conformance scenarios pass. Use `/dev-dispatch` per package. Until the D784 commit-bound evidence-receipt ledger is separately designed and approved, report exact test/commit evidence but do not present mutable `runtimes.<lang>` fields as authoritative conformance status or invent a receipt path.

## Closed-set guardrails (do not bypass)

- **9 tiers are a closed set** (D9). Adding a tier is a constitutional change — requires explicit user lock + TLA+ re-model, not a casual amend.
- **onMessage/onSubscribe are substrate-fixed** (D19) — they are NOT user-replaceable hooks; "amend" means changing the spec'd behavior, not adding a config knob.
- **equals fires only single-DATA-wave** (D15); **ctx.up is control-tier only** (R-ctx-up); **restore ≠ fresh-lifecycle wipe** (R-restore). Re-read these rules before touching adjacent behavior.

## Code-intelligence routing

Before estimating or implementing each runtime delta, call `codegraph_explore` in every indexed affected
implementation repo before raw source Read/`rg`. Query the changed rule's protocol symbols and journey
endpoints for exact source, call paths, callers/dependents, existing conformance/property tests, public
boundaries, and blast radius. Treat returned source as already read and query again only for uncovered paths.
Read rules/conformance jsonl, decisions, TLA+, configs, git diff, untracked files, and stale/unindexed files
directly. If an index is absent or disabled, use direct inspection and never initialize it autonomously.
Codegraph scopes the implementation work; the amended spec, TLC, scenarios, compiler, and runtime gates decide
correctness.

## Output

A spec-amendment plan: which rule(s) change, the TLA+ invariant delta, the conformance scenario(s) added, the D# (new or referenced), and the per-language implementation order. HALT for user approval before writing TLA+/code if the change touches a closed-set guardrail.

After the spec data lands and `--check` is clean, hand off to `/dev-dispatch` per language package and `/conformance` to drive the scenarios green.
