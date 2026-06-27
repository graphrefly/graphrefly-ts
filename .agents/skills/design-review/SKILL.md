---
name: design-review
description: "Validate the design of a new primitive or API surface against the 5-question lens (Q5–Q9 from the per-unit review format). Use BEFORE coding (or right after a sketch lands) when adding a new public API / pattern factory / domain primitive. Triggers: 'design review', 'review the design', 'is this the right shape', 'before I implement'. Different from /qa — that finds bugs in landed code; this validates abstraction + long-term shape + reactive composability + alternatives."
argument-hint: "[<file path> | <symbol> | --diff] [optional context]"
---

You are executing the **design-review** workflow for the **clean-slate GraphReFly** redesign.

This skill applies the 5 design-review questions (Q5–Q9 of the 9-question per-unit format) to a **single-symbol / single-file / single-diff** review. Use it BEFORE coding a new public API / sugar factory / operator / inspection surface — or right after a sketch lands, before tests. Different from `/qa` (finds bugs in landed code) and `/decision-guard` (recalls locked decisions); this validates abstraction + long-term shape + reactive composability + alternatives, and its output may become a new `D#` (architectural lock → user approval → append `decisions.jsonl`).

Clean-slate code lives in **`packages/ts/src/`** (`@graphrefly/ts`, D32). The language-neutral authority is **`~/src/graphrefly`** jsonl (branch `clean-slate`) — when this skill and that repo disagree, that repo wins (AGENTS.md).

> **Stale-infra guard.** Do NOT cite the retired port-model: `packages/pure-ts/**` (frozen read-only reference only, D41), `docs/implementation-plan.md` / `optimizations.md` / `roadmap.md` / `test-guidance.md` / `docs-guidance.md`, `GRAPHREFLY-SPEC.md` / `COMPOSITION-GUIDE.md` (migrated to `spec/rules.jsonl` + `guide/guide.jsonl`, B7), `describe({format})` (D39: renderers are pure fns over the snapshot, NOT a `format` option), the `Impl`/facade/actor model.

**When to use:** before a new public symbol in `packages/ts/src/graph/` (sugar / operator / inspection) or a new substrate primitive in `packages/ts/src/{node,dispatcher,ctx,protocol,batch}/`; right after sketching a factory; when two implementations exist and you need a principled pick; when `/dev-dispatch` Phase 2 needs to go deeper than its default template.
**When NOT:** bug fixes / pure refactors → `/qa`; already-approved work → proceed; trivial additive changes (a JSDoc field, a docstring).

User context: $ARGUMENTS

---

## Phase 0: Scope resolution

Resolve the target(s) from `$ARGUMENTS`:

1. **`--diff` / no args** — review the new public symbols in the uncommitted diff. Enumerate via `git diff --name-only HEAD` + `git status --short`, filtered to `packages/ts/src/**` files that introduce new exports.
2. **`<file path>`** — public symbols in that file.
3. **`<symbol name>`** — Grep-locate, then review.
4. **Multiple targets** — apply Q5–Q9 to each, then add Phase 2 synthesis.

Read in parallel before reviewing (clean-slate authority):

- `~/src/graphrefly/spec/rules.jsonl` — the R-* rules your target touches (the design invariants).
- `~/src/graphrefly/decisions/decisions.jsonl` — the governing D# (or `/decision-guard` to recall the floor/values).
- `~/src/graphrefly/plan/phases.jsonl` — the CSP-* phase the target belongs to (locked vs open-design); if the target isn't sequenced yet, the review's output may need a new phase / backlog entry.
- `~/src/graphrefly/guide/guide.jsonl` (G-composition) — composition patterns (lazy activation, subscription order, SENTINEL/prevData guards, feedback cycles).
- `~/src/graphrefly/sessions/active/SESSION-clean-slate-redesign.md` (DS-1) — the F-* constraints + the why behind locks.
- The target file(s) + 1–2 closest existing primitives in the same dir (precedent).
- **Frozen reference (D41):** `packages/pure-ts/**` + `~/src/callbag-recharge` for analogous prior art (operator behavior, edge cases, test structure) — NOT the authority.

---

## Phase 1: Per-target review (Q5–Q9)

For each target, produce a structured report covering all five questions. Be specific, quote `file:line`. Cap each answer ~150 words.

### Q5 — Is this the right abstraction? Could it be more generic?

- **Layer placement.** Substrate (`node`/`dispatcher`/`ctx`/`protocol`/`batch` — a protocol primitive, must stay thin per R-node-thin) vs graph-layer (`graph/` — sugar / operator / inspection, per-language per D6/D24)? Mismatched layer is the most common drift signal. A new **verb** is a constitutional change (8-verb closed set, D4) — almost certainly the target is sugar, not a verb.
- **Decomposition.** Could the body split into 2+ smaller primitives that compose? (F-NO-WEDGE-CUT: each must serve ≥2 segments.)
- **Generalization.** A 2+ similar primitive nearby hinting at a shared abstraction? Could `T = number` be `T = unknown` without losing safety?
- **Naming.** Does the name describe what it **returns/produces** (composable) or what it does internally (rots)? D6 real factory names show in `describe`.

> **Layer / Decomposition / Generalization / Naming:** …

### Q6 — Right long-term solution? Caveats? Maintenance burden?

- **6-month lens.** What forces this to evolve — spec/conformance changes, rust/py arm parity (D24), F-PERF budget?
- **Hidden invariants** the type system can't express — list each as `INVARIANT: …` (subscribe order before kick; first-run gate; SENTINEL = `prevData === undefined`; sync-vs-async strategy; stable refs; equals identity).
- **Constraint locks** (positional args can't grow options; hardcoded enum can't extend).
- **Doc debt** (contract knowable from JSDoc, or only from the body?).

> **6-month risk / Hidden invariants / Constraint locks / Doc debt:** …

### Q7 — Can we simplify it? Reactive, composable, explainable?

The **explainability check** — a primitive's reactive shape is only as good as its `describe()` snapshot (D39).

- **Wire a minimal composition** (≥2 sources → target → ≥1 sink). Predict `describe()` — a flat JSON-serializable snapshot; renderers (pretty/mermaid/d2) are pure fns over it (D39), NOT a `describe({format})` option. If you can't predict the output, the topology is too imperative.
- **Island check.** A node with zero in-edges AND zero out-edges (not an entry/exit) is a smell.
- **Imperative escape paths.** Search for: emit/set/callback wiring that bypasses the graph (R-no-imperative); `.cache` reads inside reactive fn bodies (R-data-not-peek — data moves via messages); raw `Promise`/`setTimeout`/`queueMicrotask` outside a source/pool (R-no-raw-async / F-SYNC-CORE); hardcoded `type === "DATA"` instead of `messageTier` (R-tier); an inline fn bypassing the dispatcher (R-dispatch-all).
- **SENTINEL / prevData guards.** Never-emitted detection via `ctx.prevData[i] === undefined` (the canonical detector); fix eager-placeholder upstreams rather than bolting on companions.
- **Feedback cycles.** A fn that re-drives its own dep mid-wave is a wave-level ERROR (D37/R-reentrancy), not iteration; legit accumulation = `ctx.state` (scan), not a topological cycle.

> **Topology / Imperative leaks / cache reads / Feedback cycles / Simplifications:** …

### Q8 — Alternative implementations (A / B / C)

Sketch **≥2** named alternatives. For each: **Shape** (1–3 line pseudo-sig), **Pros** (2–4), **Cons** (2–4), **Precedent** — does the shape exist in the frozen `packages/pure-ts/**` reference (D41), `callbag-recharge`, or RxJS? Cite if so. Don't pick a winner yet — that's Q9.

> **A. {name}** — sketch / Pros / Cons / Precedent
> **B. {name}** — …

### Q9 — Recommendation + coverage check

Pick the recommended alternative; build a coverage matrix (each Q5–Q8 concern → recommended alt covers it? yes / partially / no — because …). For any `partially`/`no`, name the residual risk: accept it (justify), add a `backlog.jsonl` follow-up, or pick a different alternative. End with:

> **Recommendation:** {alt}, because {2–3 reasons grounded in Q5–Q8}.
> **Residual risks:** {none, OR 1–2}.
> **Implementation guidance:** {next step — usually a draft `D#` for approval, or a sub-decision the user must answer first}.

If the design is an architectural lock, draft the `D#` (`{id, layer, date, question, decision, rationale, supersedes, status}`) for the user to approve BEFORE append — do NOT auto-lock (no-autonomous-decisions). A wave-protocol behavior change routes to `/spec-amend` (spec-first), not a direct edit.

---

## Phase 2: Cross-cutting synthesis (multi-target only)

Apply only when reviewing multiple targets in one pass:

- **Naming consistency** (`extract` vs `select` vs `pick` for the same role = drift).
- **Argument-shape consistency** (options-bag vs positional applied the same way).
- **Composition direction** (do the targets' input/output shapes line up to compose?).
- **Repeated patterns** (the same SENTINEL-gate / subscribe-order / batch-on-write in 2+ places → a shared helper candidate).

Output a numbered list, each finding with the pattern, where it appears (file:line × N), and a proposed unifying shape.

---

## Phase 3: Decisions log

- **Architectural lock** (clear) → draft a `D#` for `~/src/graphrefly/decisions/decisions.jsonl`; append only after user approval, then update the DS-1 `locks` in `sessions/sessions.jsonl` and run `node ~/src/graphrefly/dashboard/build.mjs --check`.
- **Deferred / no clear answer** → append to `~/src/graphrefly/plan/backlog.jsonl` (B# + concrete trigger).
- **Recurring anti-pattern** → `~/src/graphrefly/plan/antipatterns.jsonl` (+ a `feedback_*` memory if generalizable).
- **Protocol-behavior change** surfaced → route to `/spec-amend` (spec-first), not a direct code change.

---

## Output discipline

- Be concrete. Quote `file:line` refs.
- Don't write "this looks good" — say WHICH Q5–Q9 dimensions clear and why.
- Don't pad. If Q6 has no caveats, write `**Hidden invariants:** none surfaced.` and move on.
- Don't second-guess the user's stated intent — Q8 alternatives are options to compare; Q5–Q7 probe the recommended shape.
- Skim-readable: headers per question, bullets within.

---

## Authority hierarchy

1. `~/src/graphrefly/spec/rules.jsonl` — the protocol 宪法.
2. `~/src/graphrefly/decisions/decisions.jsonl` (+ DS-1 narrative) — locked decisions + F-* floor + durable values.
3. `~/src/graphrefly/plan/phases.jsonl` — the CSP-* sequencer (phase locks).
4. `~/src/graphrefly/guide/guide.jsonl` (G-test / G-composition) — testability + composition shape.
5. Existing patterns in `packages/ts/src/` — only when the above are silent.

If a finding conflicts with a higher-authority doc, surface it explicitly — DO NOT silently override (no-autonomous-decisions).

---

## What to do AFTER this skill completes

- Lock approved → `/dev-dispatch` (or `--light`) with the locked design; a protocol-behavior change goes through `/spec-amend` first.
- Decisions deferred → leave them in `backlog.jsonl` and move on.
- Needs more thought → HALT, summarize, let the user think.

This skill produces a report; it modifies no implementation files (it only appends to `~/src/graphrefly` jsonl after explicit user approval of a `D#`).
