---
name: qa
description: "Adversarial code review, apply fixes, final checks (test/lint/build), and doc updates. Run after /dev-dispatch or any manual implementation. Use when user says 'qa', 'review', or 'code review'. Supports --skip-docs to skip documentation phase."
argument-hint: "[--skip-docs] [optional context about what was implemented]"
---

You are executing the **qa** workflow for the **clean-slate GraphReFly** redesign.

This repo is **`@graphrefly/ts`** — the self-contained TypeScript implementation (D32); clean-slate code lives in **`packages/ts/src/`**. Siblings (each self-contained, cross-language = wire bridge, never in-process): `@graphrefly/rust` (`~/src/graphrefly-rs`), `@graphrefly/py` (`~/src/graphrefly-py`). The language-neutral authority (spec / decisions / plan / conformance / formal) lives in **`~/src/graphrefly`** (branch `clean-slate`) as jsonl — when this skill and that repo disagree, that repo wins (CLAUDE.md).

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

Also load the clean-slate context the review must NOT contradict:
- `~/src/graphrefly/spec/rules.jsonl` — the protocol 宪法 (R-* rules); the behavior authority. Cite R-ids in findings.
- `~/src/graphrefly/decisions/decisions.jsonl` — the governing D# (or `/decision-guard`); the F-* floor + durable values.
- `~/src/graphrefly/plan/backlog.jsonl` + `plan/antipatterns.jsonl` — **already-acknowledged deferred concerns (B#) and known anti-patterns. DO NOT raise a finding that matches an existing deferred B# or antipattern** — those are accepted. DO raise a finding that *contradicts* a deferred entry's stated scope.
- `~/src/graphrefly/spec/conformance.jsonl` — the C-* scenarios the change must keep green (+ their `runtimes` status).
- `~/src/graphrefly/formal/*.tla` — when the change implements a formally-modeled rule, cross-check the impl against the TLC-verified model.

### 1b. Launch parallel review subagents

Launch as parallel Agent calls. Each receives the diff + the context from $ARGUMENTS (what was implemented and why). Tell each to do a STATIC review (no servers, no test runs) and return ONLY a findings list.

**Subagent 1: Blind Hunter** — pure code review, no project context:
> You are a Blind Hunter code reviewer. Review this diff for: logic errors, off-by-one, race/re-entrancy hazards, resource leaks (unclosed subscriptions, unbounded registries), stale-closure / index-desync bugs, missing error handling, dead/unreachable code, sparse-array holes, security issues. For Python, also check thread/free-threaded safety. Be adversarial — assume bugs exist; trace the suspicious paths concretely. If a suspicious path is actually correct, say so in one line rather than raising noise. Output each finding as: **title** | **severity** (critical/major/minor) | **location** (file:line) | **detail** (trigger + consequence + suggested fix).

**Subagent 2: Edge Case Hunter** — clean-slate spec-aware:
> You are an Edge Case Hunter reviewing a change against the GraphReFly clean-slate SPEC. The authority is `~/src/graphrefly` jsonl (branch clean-slate) — NOT any docs/*.md or packages/pure-ts (retired port-model; ignore). Read the relevant `spec/rules.jsonl` R-* rules + `decisions/decisions.jsonl` D# for the area under review, and the matching `spec/conformance.jsonl` C-* + `formal/*.tla` model if the change implements a spec-locked behavior.
>
> Check protocol/wave invariants against the rules: message tuples `[[Type,Data?]]`, one array = one wave (R-msg-format); DIRTY-before-DATA in the same wave (R-dirty-before-data); two-phase glitch-free diamond, recompute-once (R-two-phase/R-diamond); ctx.up control-tier-only (R-ctx-up); SENTINEL = absence-of-DATA, never-emitted detector `prevData===undefined` (R-sentinel); equals DATA→RESOLVED only on a single-DATA wave (R-equals); first-run gate (R-first-run-gate); INVALIDATE idempotent + lifecycle-continue (R-invalidate-idempotent); terminal-is-forever / resubscribable reset (R-terminal); ROM/RAM cache (R-rom-ram); PAUSE lockset + modes (R-pause-lockset/R-pause-modes); reentrancy reject (R-reentrancy/D37).
>
> Flag floor violations: imperative side-channel triggers (R-no-imperative — emitters/callbacks/timers+set instead of ctx.up/message flow); polling/busy-wait (R-no-polling); bare async in the sync core (R-no-raw-async / F-SYNC-CORE — async only in sources / pool / wire bridge); inline-fn bypassing the dispatcher (R-dispatch-all / F-DISPATCH-ALL); peeking a dep `.cache` to seed compute (R-data-not-peek); hardcoded `type === "DATA"` instead of messageTier (R-tier); protocol internals (DIRTY/RESOLVED/bitmask) leaking into value-level sugar (R-primary-api-clean / DR-1); counters/inspection on the thin node (R-node-thin); a new verb (D4 closed set) or a 10th tier (D9) introduced casually; graph-level shared mutable state accessed implicitly instead of an explicit node+dep (D22/D23); cross-graph in-process coupling instead of a wire bridge (D22/D32).
>
> If the change implements a formally-modeled rule, identify any place the impl DIVERGES from the `formal/*.tla` model (cite the invariant). Surface real-but-unmodeled cross-axis interactions (e.g. X×batch, X×pause) and say whether each is a genuine gap or acceptably-deferred. DROP any finding that matches an already-acknowledged `plan/backlog.jsonl` B# or `plan/antipatterns.jsonl` entry. Output each finding as: **title** | **severity** | **location** (file:line or R-id) | **detail** (the rule/D# it relates to + what the impl does + divergence/gap/ok).

Scale the reviewer count to the change: 2 is the default; for a large or high-risk substrate change add a third reviewer on a specific axis (e.g. concurrency/pool, or a perspective-diverse second spec reviewer).

### 1c. Triage findings
Classify each: **patch** (fixable, caused by this change — include the fix) · **defer** (pre-existing or out-of-scope — note it) · **reject** (false positive / noise — drop silently). Cross-check every finding against `plan/backlog.jsonl` + `plan/antipatterns.jsonl`; a match to an accepted deferral → **reject** silently.

Fix priority (most→least): 1) **spec alignment** (`spec/rules.jsonl` / the F-* floor — a rule wins over current impl) · 2) **semantic correctness** (protocol + node contract) · 3) **completeness** (edge cases) · 4) **consistency** (patterns already in `packages/ts/src/`) · 5) **level of effort**. (Frozen `packages/pure-ts/**` + `~/src/callbag-recharge` are read-only precedent only — the clean-slate spec wins on any conflict.)

### 1d. Present findings (HALT)
Present ALL patch + defer findings (treat equally). For each: the issue + location, the **recommended fix** (pros/cons), whether it affects architecture, and whether it needs a user decision or can be auto-applied. Group:
1. **Needs Decision** — architecture-affecting or ambiguous (route per the floor: architectural lock → `/design-review` → D#; wave-protocol behavior change → `/spec-amend`; an open question with no clear answer → `plan/backlog.jsonl` B#).
2. **Auto-applicable** — clear fixes following existing patterns.

**Wait for user decisions on group 1.** Group 2 may be applied on the user's batch approval. Do NOT silently pick on a needs-decision item (no-autonomous-decisions).

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
- **`decisions/decisions.jsonl`** — a new architectural lock surfaced by QA → `/design-review` → user approval → append a `D#` (update the DS-1 `locks` in `sessions/sessions.jsonl`).
- **`spec/conformance.jsonl`** — flip `runtimes.<arm>` → `pass` when an arm lands green; add a new C-* scenario for a new behavioral rule; keep `covers` ↔ rule `covers_by` bidirectionally consistent.
- **`plan/phases.jsonl`** — update the CSP-* phase `status`/`note` the change advances.
- **`plan/backlog.jsonl`** — add new deferred items (B# + concrete trigger) surfaced by QA.
- **`plan/antipatterns.jsonl`** — a recurring anti-pattern (+ a `feedback_*` memory if generalizable).
- **`formal/README.md`** — when a TLA+ module was added/changed (module-map row + a mutation-verified note).
- **Structured JSDoc** on new exported public symbols (`packages/ts/src/<area>`); cite the governing R-id/D# when the API encodes a spec invariant.
- **`guide/guide.jsonl`** (G-test / G-composition / G-docs / G-contribute) — if a new test/composition pattern or doc convention was established.
- **`~/src/graphrefly/CLAUDE.md`** — only if a fundamental workflow/command changed.

After any `~/src/graphrefly` jsonl edit, re-run `node ~/src/graphrefly/dashboard/build.mjs --check`.

When done, briefly list files changed + new exports, the fixes applied vs deferred (with B# pointers), and the gate results.
