---
name: qa
description: "Review project changes and verify affected behavior or required phase gates. Apply fixes only within an implementation or QA-and-fix request."
metadata:
  argument-hint: "[--skip-docs] [optional context about what was implemented]"
---

Read `~/.codex/skills/bmad-build/references/qa.md` for the shared review lenses, five-way triage and
repair loop. Integrate the domain checks below into that one review; retain this repository's canonical
completion verdict. Review-only remains read-only, including documentation and authority records.
Finish with `~/.codex/skills/bmad-checkpoint-preview/SKILL.md` in build-handoff mode unless interactive
review was requested.

You are executing the **qa** workflow for the **clean-slate GraphReFly** redesign.

This repo is **`@graphrefly/ts`** — the self-contained TypeScript implementation (D32); clean-slate code lives in **`packages/ts/src/`**. Siblings (each self-contained, cross-language = wire bridge, never in-process): `@graphrefly/rust` (`~/src/graphrefly-rs`), `@graphrefly/py` (`~/src/graphrefly-py`). The language-neutral authority (spec / decisions / plan / conformance / formal) lives in **`~/src/graphrefly`** (branch `clean-slate`) as jsonl — when this skill and that repo disagree, that repo wins (AGENTS.md).

> **Stale-infra guard.** Do NOT reach for the retired port-model surfaces: `packages/pure-ts/**` (frozen read-only reference only, D41), `docs/implementation-plan.md` / `implementation-plan-13.6-*.md` / `optimizations.md` / `roadmap.md` / `test-guidance.md` / `docs-guidance.md`, `GRAPHREFLY-SPEC.md` / `COMPOSITION-GUIDE.md` (migrated to `spec/rules.jsonl` + `guide/guide.jsonl`, B7), the `@graphrefly/graphrefly` shim + its 4-file subpath rule, the `Impl`/facade/actor model, the Rust `migration-status.md` / `porting-deferred.md` / canonical-spec-13.6 registries. The clean-slate authority is the `~/src/graphrefly` jsonl.

Context from user: $ARGUMENTS

### Flag detection
If `$ARGUMENTS` contains `--skip-docs`, skip Phase 4 (Documentation Updates).

### Repo detection
Inspect the diff to detect which package(s) are touched: `packages/ts/` (this repo), `~/src/graphrefly-py`, `~/src/graphrefly-rs`. The cross-language contract is **behavioral conformance (D24)**, not symbol parity — review each arm against the SAME `spec/rules.jsonl` + `spec/conformance.jsonl`, per-language idioms aside.

---

## Phase 1: Adversarial Code Review

### 1a. Gather the diff

Run `git diff` for uncommitted changes; if the chat's work was already committed, diff against the chat's baseline commit (`git log --oneline` to find it, then `git diff <base>..HEAD`). Include relevant untracked files (read them). Concentrate the review on the **substantive hand-written code** — formally-verified TLA+ (already TLC-checked), generated artifacts, and jsonl data are lower bug-risk than imperative substrate/graph code.

For changed implementation source in a repository with a live `.codegraph` index, call
`codegraph_explore` after gathering the diff and before raw source Read/`rg`. Query the changed symbols or
flow endpoints for exact source, callers/callees, dependents, relevant tests, export/build boundaries, and
blast radius. Treat returned source as already read; use a second targeted query only for uncovered paths.
Read the diff, untracked/stale files, authority jsonl, docs, configs, and generated artifacts directly. If
the index is absent/disabled or reports stale files, follow its fallback guidance and never initialize it
autonomously. Codegraph does not replace diff review, compiler/typecheck, tests, lint, build, or export gates.

Also load the clean-slate context the review must NOT contradict:
- `~/src/graphrefly/spec/rules.jsonl` — the protocol 宪法 (R-* rules); the behavior authority. Cite R-ids in findings.
- `~/src/graphrefly/authority/ledgers.jsonl` + the resolved owner ledger — the governing origin-qualified D# (or `/decision-guard`); the F-* floor + durable values.
- `~/src/graphrefly/plan/backlog.jsonl` + `plan/antipatterns.jsonl` — **already-acknowledged deferred concerns (B#) and known anti-patterns. DO NOT raise a finding that matches an existing deferred B# or antipattern** — those are accepted. DO raise a finding that *contradicts* a deferred entry's stated scope.
- `~/src/graphrefly/spec/conformance.jsonl` — the C-* scenarios the change must keep green (+ their `runtimes` status).
- `~/src/graphrefly/formal/*.tla` — when the change implements a formally-modeled rule, cross-check the impl against the TLC-verified model.

### 1b. Review, triage and repair

Apply the shared BMAD QA reference once, using the original acceptance, governing R-id / D# and this
diff. Use its blind-hunter, edge-case and verification-gap lenses, then classify validated findings as
`intent_gap`, `bad_spec`, `patch`, `defer`, or `reject`. Preserve spec-first and owner-first boundaries:
a `bad_spec` finding never authorizes changing protocol, semantics or a locked design. Collect material
questions for the user; apply clear in-scope fixes when authorized. Trace protocol behavior and lifecycle
against conformance and the formal model where relevant. Reuse the final checks below in that repair loop.

---

## Phase 2: Apply Review Fixes
Apply the approved fixes. Cite the governing R-id / D# in any new test expectations.

---

## Phase 3: Final Checks
Run all checks for the affected package(s) and fix failures (do NOT skip/ignore):

**TypeScript (`@graphrefly/ts`):**
1. `pnpm --filter @graphrefly/ts test` (vitest) — all pass.
2. `pnpm run lint` (biome + layer-boundary + typecheck gates); `pnpm run lint:fix` to auto-format.
3. `pnpm run build` (tsup ESM/CJS/DTS) when public API changed.

**Sibling packages (only if touched):** run that package's own test/lint/type gate in its repo (`~/src/graphrefly-py` / `~/src/graphrefly-rs`) following its local conventions. The cross-language contract is behavioral conformance (D24) — a substrate behavior change should drive its `spec/conformance.jsonl` arm green per runtime.

**jsonl touched (`~/src/graphrefly`):** `node ~/src/graphrefly/dashboard/build.mjs --check` — the consistency gate (non-zero on broken links / orphans).

**TLA+ touched:** re-run the affected model (`cd ~/src/graphrefly/formal && java -cp <tla2tools.jar> tlc2.TLC -config <name>.cfg <name>`); for a new invariant, mutation-verify it is load-bearing (break the guard → confirm it trips) before claiming it.

**Long / heavy commands** (full test sweeps, Rust gates, TLC): run them so they're observably-finishing, not a false-hang — prefer a run-logged wrapper + monitor a guaranteed DONE sentinel (never a guessed progress string, never `sleep`-poll). If this QA runs in a spawned subagent, run such commands **synchronously** (wait for the sentinel) or tear them down (kill by process group) **before returning** — never leak a live background process as a stale "running" entry. (memories `feedback_long_command_observation`, `feedback_subagent_bg_hygiene`, `feedback_no_chained_background_cargo`.)

If a failure exposes a design question, **HALT** and raise it before fixing.

---

## Phase 4: Documentation Updates

**Skip if `--skip-docs` was passed.** Update only what behavior/API actually changed; clean-slate docs are jsonl (single source of truth):

- **`spec/rules.jsonl`** — only if the protocol itself was intentionally revised → that is a `/spec-amend`, not a casual edit (amend rules + `formal/*.tla` + `spec/conformance.jsonl` together). Flip a conformance-backed rule `draft → active` once its scenario is green on the reference arm + formal lands (cite the precedent).
- **Owner decision ledger** — a new architectural lock surfaced by QA → `/design-review` → user approval → resolve the owner from `authority/ledgers.jsonl` and append an origin-qualified `D#`; update a session's `locks` only when that session owns the narrative.
- **`spec/conformance.jsonl`** — add a new C-* scenario for a new behavioral rule; `covers` is the sole canonical coverage edge and dashboard views derive the reverse relation. Record exact runtime/test/commit evidence, but until the D784 receipt-ledger design is separately approved do not treat mutable `runtimes.<arm>` fields as authoritative status.
- **`plan/phases.jsonl`** — update the CSP-* phase `status`/`note` the change advances.
- **`plan/backlog.jsonl`** — add new deferred items (B# + concrete trigger) surfaced by QA.
- **`plan/antipatterns.jsonl`** — a recurring anti-pattern (+ a `feedback_*` memory if generalizable).
- **`formal/README.md`** — when a TLA+ module was added/changed (module-map row + a mutation-verified note).
- **Structured JSDoc** on new exported public symbols (`packages/ts/src/<area>`); cite the governing R-id/D# when the API encodes a spec invariant.
- **`guide/guide.jsonl`** (G-test / G-composition / G-docs / G-contribute) — if a new test/composition pattern or doc convention was established.
- **`~/src/graphrefly/AGENTS.md`** — only if a fundamental workflow/command changed.

After any `~/src/graphrefly` jsonl edit, re-run `node ~/src/graphrefly/dashboard/build.mjs --check`.

When done, briefly list files changed + new exports, the fixes applied vs deferred (with B# pointers), and the gate results.
