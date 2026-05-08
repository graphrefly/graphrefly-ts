---
name: design-review
description: "Validate the design of a new primitive or API surface against the 5-question lens (Q5–Q9 from the per-unit review format). Use BEFORE coding (or right after a sketch lands) when adding a new public API / pattern factory / domain primitive. Triggers: 'design review', 'review the design', 'is this the right shape', 'before I implement'. Different from /qa — that finds bugs in landed code; this validates abstraction + long-term shape + reactive composability + alternatives."
disable-model-invocation: true
argument-hint: "[<file path> | <symbol> | --diff] [optional context]"
---

You are executing the **design-review** workflow for **GraphReFly** (cross-language: TypeScript + Python).

This skill applies the 5 design-review questions used in `archive/docs/SESSION-ai-harness-module-review.md` (Q5–Q9 of the 9-question per-unit format). The format originated for module-scope reviews; this skill makes it available for **single-symbol / single-file / single-diff** reviews.

**When to use this skill:**

- Before implementing a new public API in `packages/pure-ts/src/patterns/` or `packages/pure-ts/src/extra/`
- Right after sketching a new factory / bundle / primitive, before tests are written
- When two slightly-different implementations exist and you need a principled pick
- When `/dev-dispatch` Phase 2 (architecture discussion) needs to go deeper than the default 4-question template

**When NOT to use this skill:**

- Bug fixes — use `/qa`
- Pure refactors that don't change the API surface — use `/qa`
- Implementation work that's already been approved at Phase 2 — proceed without this overhead
- Small additive changes (e.g. adding a JSDoc field, fixing a docstring)

User context: $ARGUMENTS

---

## Phase 0: Scope resolution

Determine the review target(s) from `$ARGUMENTS`:

1. **`--diff` (or no args)** — review the new public symbols introduced in the current uncommitted diff. Run `git diff --name-only HEAD` and `git status --short` to enumerate. Filter to files in `packages/pure-ts/src/patterns/`, `packages/pure-ts/src/extra/`, `packages/pure-ts/src/core/`, `packages/pure-ts/src/graph/`, `packages/pure-ts/src/compat/`, or `packages/pure-ts/src/integrations/` that introduce new exports.
2. **`<file path>`** — review the public symbols in that file (single-file scope).
3. **`<symbol name>`** — locate the symbol with Grep, then review it (single-symbol scope).
4. **Multiple targets** — apply Q5–Q9 to each, then add Phase 2 cross-cutting synthesis.

Read these in parallel before reviewing:

- `~/src/graphrefly/GRAPHREFLY-SPEC.md` § 5.8–5.12 (design invariants)
- `~/src/graphrefly/COMPOSITION-GUIDE.md` § 1, 2, 3, 5, 7, 8, 28, 32 (composition patterns)
- `docs/implementation-plan.md` — find the phase the target belongs to (Phase 11–16). The phase entry shows scope locks, design-session IDs (DS-#), and dependencies. If the target's design is locked in a phase, the design review validates against that lock; if not yet locked, the review's output may need to land as a new sub-phase entry or DS-# session.
- `docs/optimizations.md` "Active work items" (related architectural questions in flight, line-item state)
- `docs/roadmap.md` — vision context only (no longer the active sequencer; consult only for the strategic frame)
- The target file(s) themselves
- 1–2 closest existing primitives in the same directory (precedent)
- Optionally `~/src/callbag-recharge/` for analogous prior art (NOT spec authority)

If the target imports anything from `packages/pure-ts/src/patterns/`, `~/src/graphrefly/COMPOSITION-GUIDE.md` is **mandatory** reading — composition primitives have non-obvious load-bearing patterns documented there.

---

## Phase 1: Per-target review (Q5–Q9)

For each target, produce a structured report covering all five questions. Be specific and quote file:line refs. Cap each answer at ~150 words; expand only when the topic genuinely needs it.

### Q5 — Is this the right abstraction? Could it be more generic?

Probe:

- **Layer placement.** Does it belong in `core/` (protocol primitive), `extra/` (operator/source), `patterns/` (Phase 4+ domain factory), or `compat/` (framework adapter)? Mismatched layer is the most common drift signal.
- **Decomposition.** Could the body be split into 2+ smaller primitives that compose into this one? (Smaller pieces are more likely to be reused.)
- **Generalization.** Is there a 2+ similar primitive nearby that hints at a shared abstraction? Could `T = number` be `T = unknown` without losing safety? Could the config object be split into smaller bundles?
- **Naming.** Does the name describe **what it returns / produces**, or **what it does internally**? The former is composable; the latter rots.

Output:

> **Layer:** {core/extra/patterns/compat/integrations} — {fits / mismatches because …}
> **Decomposition:** {already minimal / could split into A + B / over-decomposed}
> **Generalization:** {none surfaced / could collapse with X / over-general}
> **Naming:** {clear / ambiguous because …}

### Q6 — Is this the right long-term solution? What are the caveats? Maintenance burden?

Probe:

- **6-month lens.** What changes in the surrounding codebase would force this to evolve? Spec changes? Phase 5 work? PY parity?
- **Special cases / hidden invariants.** Anything that the type system can't express but the implementation depends on (subscribe order, init-time-vs-runtime, sync-vs-async strategies, stable references, etc.)? List each one explicitly — these become bug-class footguns.
- **Constraint locks.** Does the chosen shape close off future extensions? (E.g. positional-arg constructor → can't add options later without breaking; hard-coded enum → can't extend with custom variants.)
- **Documentation debt.** Is the contract knowable from JSDoc alone, or does it require reading the body? Hidden contracts age badly.

Output:

> **6-month risk:** {low / medium / high — because …}
> **Hidden invariants:** {bullet list, each as `INVARIANT: …`}
> **Constraint locks:** {none / list each}
> **Doc debt:** {complete / requires reading body / undocumented}

### Q7 — Can we simplify it? Make it reactive, composable, explainable?

This is the **explainability check** — borrowed from the pagerduty-demo + AI/harness-module-review insight. **A primitive's reactive shape is only as good as its `describe()` output.**

Probe:

- **Wire a minimal composition.** Imagine `≥2 upstream sources → target → ≥1 downstream sink`. What does `graph.describe({ format: "ascii" })` show? If you can't predict the output, the topology is too imperative.
- **Island check.** Does any node in the target have zero in-edges AND zero out-edges (and isn't an entry/exit)? Smell.
- **Imperative escape paths.** Search for: `.emit()` / `.set()` / `.publish()` calls inside fn bodies (vs effect bodies); `.cache` reads inside reactive fn bodies (COMPOSITION-GUIDE §28); raw `Promise` / `setTimeout` / `queueMicrotask` (spec §5.10); event-emitter or callback wiring that bypasses the graph; hardcoded message-type checks (`type === DATA`) instead of `messageTier` (spec §5.11).
- **Closure-mirror correctness.** If the target captures upstream values via closure subscribe, is the seed correct (COMPOSITION-GUIDE §28)? Is the subscribe ordered before any kick (`feedback_subscribe_before_kick.md`)?
- **Feedback cycles.** If the target writes back to a node it reads, is the cycle broken cleanly (snapshot-on-settle, batch boundaries, §32 state-mirror)?

Output:

> **Topology check:** {clean — describe walks cleanly | islands: X / Y / Z | imperative leaks: …}
> **Imperative escape paths:** {none | list each}
> **Closure / cache reads:** {none | each one's justification}
> **Feedback cycles:** {none | broken by … / NOT broken — concern}
> **Simplification opportunities:** {none | bullet list — each with the cost it would impose}

### Q8 — Alternative implementations (A / B / C)

Sketch **at least 2** named alternatives. For each, give:

- **Shape** — 1–3 lines of pseudo-signature
- **Pros** — 2–4 bullets
- **Cons** — 2–4 bullets
- **Precedent** — does this shape exist in `callbag-recharge`, RxJS, or another reactive lib? Cite if so.

Don't pick a winner yet — that's Q9.

Output:

> **A. {name}**
> ```ts
> // sketch
> ```
> Pros: …
> Cons: …
> Precedent: …
>
> **B. {name}**
> …

### Q9 — Recommendation + coverage check

Pick the recommended alternative from Q8. Then build a coverage matrix:

| Concern from Q5–Q8 | Recommended alt covers it? |
|---|---|
| {abstraction concern} | yes / partially / no — because … |
| {invariant from Q6} | … |
| {feedback cycle from Q7} | … |
| {alternative B's pro that we'd lose} | … |

If any row is **partially** or **no**, name the residual risk explicitly. Either:

- The risk is acceptable (justify why)
- Add a follow-up to `docs/optimizations.md` "Active work items" tracking the gap
- Pick a different alternative

End with a one-paragraph summary the user can act on:

> **Recommendation:** {alternative}, because {2-3 reasons grounded in Q5–Q8}.
> **Residual risks:** {none, OR list 1–2}.
> **Implementation guidance:** {1-3 sentences on what to do next — usually approval to proceed, sometimes a sub-decision the user must answer first}.

---

## Phase 2: Cross-cutting synthesis (multi-target only)

Apply only if reviewing multiple targets in the same pass (e.g. `--diff` mode with 3 new factories).

Cross-cutting checks:

- **Naming consistency.** Are similar concepts named consistently across targets? (`extract` vs `select` vs `pick` for the same role is drift.)
- **Argument shape consistency.** Is the options-bag vs positional-args split applied the same way?
- **Composition direction.** Are the targets meant to compose? If so, do their input/output shapes line up cleanly?
- **Repeated patterns.** Did the same closure-mirror / SENTINEL-gate / batch-on-write pattern appear in 2+ places? That's a candidate for a shared helper.

Output a numbered list of cross-cutting findings, each with:

- The pattern/inconsistency
- Where it appears (file:line × N)
- A proposed unifying shape

---

## Phase 3: Decisions log

For any **architectural** question that doesn't have a clear answer in the synthesis (e.g. "should we generalize X across both Y and Z?"), append it to `docs/optimizations.md` under "Active work items" using the standard shape:

```
- **{Title} ({date}, design-review).** {Question}. Options: {A / B / C}. Tradeoff: {…}. Blocked on: {concrete consumer / spec clarification / further design pass}.
```

Resolved decisions move to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log" (only after the user picks one). When a design decision lands as part of a phase that fully completes, the matching `docs/implementation-plan.md` phase body should also be archived to `archive/roadmap/phase-<n>-*.jsonl` per `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/implementation-plan.md`" — flag this in the recommendation if the design under review closes out a phase.

---

## Output discipline

- Be concrete. Quote `file:line` refs.
- Don't write "this looks good" — if it does, say WHY (which Q5–Q9 dimensions clear).
- Don't pad. If Q6 has no caveats, write `**Hidden invariants:** none surfaced.` and move on.
- Don't second-guess the user's stated intent. Q8 alternatives are options to compare; Q5–Q7 probe the recommended shape.
- Output should be skim-readable: headers per question, bullets within.

---

## Authority hierarchy

1. **`~/src/graphrefly/GRAPHREFLY-SPEC.md`** — protocol contract
2. **`~/src/graphrefly/COMPOSITION-GUIDE.md`** — composition patterns
3. **`docs/implementation-plan.md`** — pre-1.0 phase locks (canonical sequencer); the matching phase entry holds locked design decisions for active work
4. **`docs/test-guidance.md`** — testability shape
5. Existing patterns in `packages/pure-ts/src/` — only when the above are silent
6. **`docs/roadmap.md`** — vision context only; consult for strategic frame, not phase scope

If a finding seems to conflict with a higher-authority document, surface it explicitly — DO NOT silently override.

---

## What to do AFTER this skill completes

- If recommendation is locked: invoke `/dev-dispatch` (or `/dev-dispatch --light` for small changes) with the locked design.
- If decisions are deferred: leave them in `docs/optimizations.md` and move on.
- If the design needs more thought: HALT, summarize, and let the user think.

This skill produces a report; it does NOT modify implementation files (only `docs/optimizations.md` if architectural decisions are logged).
