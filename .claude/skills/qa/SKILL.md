---
name: qa
description: "Adversarial code review, apply fixes, final checks (test/lint/build), and doc updates. Run after /dev-dispatch or any manual implementation. Use when user says 'qa', 'review', or 'code review'. Supports --skip-docs to skip documentation phase."
disable-model-invocation: true
argument-hint: "[--skip-docs] [optional context about what was implemented]"
---

You are executing the **qa** workflow for **graphrefly-ts** (GraphReFly TypeScript implementation).

Context from user: $ARGUMENTS

### Flag detection

If `$ARGUMENTS` contains `--skip-docs`, skip Phase 4 (Documentation Updates).

---

## Phase 1: Adversarial Code Review

### 1a. Gather the diff

Run `git diff` to get all uncommitted changes. If there are also untracked files relevant to the task, read and include them.

### 1b. Launch parallel review subagents

Launch these as parallel Agent calls. Each receives the diff and the context from $ARGUMENTS (what was implemented and why).

**Subagent 1: Blind Hunter** — Pure code review, no project context:
> You are a Blind Hunter code reviewer. Review this diff for: logic errors, off-by-one errors, race conditions, resource leaks, missing error handling, security issues, dead code, unreachable branches. Output each finding as: **title** | **severity** (critical/major/minor) | **location** (file:line) | **detail**. Be adversarial — assume bugs exist.

**Subagent 2: Edge Case Hunter** — Has project read access:
> You are an Edge Case Hunter. Review this diff in the context of **GraphReFly** (`docs/GRAPHREFLY-SPEC.md`): unhandled message sequences (DIRTY without follow-up, DATA vs RESOLVED), diamond resolution (recompute once), COMPLETE/ERROR terminal rules, forward-unknown-types, batch semantics (DATA deferred, DIRTY not), reconnect/teardown leaks, meta companion nodes, and graph mount/signal propagation when `Graph` is in scope. For each finding: **title** | **trigger_condition** | **potential_consequence** | **location** | **suggested_guard**.

### 1c. Triage findings

Classify each finding into:
- **patch** — fixable code issue. Include the fix recommendation.
- **defer** — pre-existing issue, not caused by this change.
- **reject** — false positive or noise. Drop silently.

For each **patch** and **defer** finding, evaluate fix priority (most to least important):
1. **Spec alignment** — matches `docs/GRAPHREFLY-SPEC.md`
2. **Semantic correctness** — protocol and node contract
3. **Completeness** — edge cases covered
4. **Consistency** — patterns elsewhere in graphrefly-ts
5. **Level of effort**

**Optional:** Compare tricky operator behavior with **callbag-recharge** at `~/src/callbag-recharge` for precedent — GraphReFly still wins on spec conflicts.

### 1d. Present findings (HALT)

Present ALL patch and defer findings to the user. Treat both equally. For each finding:
- The issue and its location
- **Recommended fix** with pros/cons
- Whether it affects architecture (flag these)
- Whether it needs user decision or can be auto-applied

Group findings:
1. **Needs Decision** — architecture-affecting or ambiguous fixes
2. **Auto-applicable** — clear fixes that follow existing patterns

**Cross-language decision log:** For **Needs Decision** items that are architectural or affect TS/Python parity, note them in **`docs/optimizations.md`** (e.g. **Open design decisions** or **Cross-language implementation notes**). If **`graphrefly-py`** is available alongside this repo, add the same bullet to **`graphrefly-py/docs/optimizations.md`**. If not available, call out mirroring for the user.

**Wait for user decisions on group 1. Group 2 can be applied immediately if user approves the batch.**

---

## Phase 2: Apply Review Fixes

Apply the approved fixes from Phase 1.

---

## Phase 3: Final Checks

Run all of these and fix any failures (do NOT skip or ignore):

1. `pnpm test` — all tests must pass
2. `pnpm run lint:fix` — fix lint issues
3. `pnpm run build` — check for DTS/build problems

If a failure is related to an implementation design question, **HALT** and raise it to the user before fixing.

---

## Phase 4: Documentation Updates

**Skip this phase if `--skip-docs` was passed.**

**Authoritative checklist:** follow **`docs/docs-guidance.md`** end-to-end (authority order, Tier 0–5, JSDoc tag table, `gen-api-docs.mjs` REGISTRY, `docs:gen` / `docs:gen:check`, `sync-docs`, when to edit which file).

Update documentation when behavior or public API changed:

- **`docs/docs-guidance.md`** — if documentation *conventions* or generator workflow change, update this file so `/qa` and contributors stay aligned
- **`docs/GRAPHREFLY-SPEC.md`** — only if the **spec** itself is intentionally revised (rare; use semver rules in spec §8)
- **`docs/optimizations.md`** — when this review records **open architectural decisions** or cross-language parity notes; mirror substantive entries to **`graphrefly-py/docs/optimizations.md`** if that repo is in the workspace
- **Structured JSDoc** on exported public APIs (Tier 1 — parameters, returns, examples per `docs-guidance`; source of truth for generated API pages)
- **New public symbols** — barrel export + **`website/scripts/gen-api-docs.mjs` REGISTRY** entry, then `pnpm --filter @graphrefly/docs-site docs:gen` (or `docs:gen:check` in CI)
- **`docs/test-guidance.md`** — if new test patterns are established
- **`docs/roadmap.md`** — check off completed items when appropriate
- **`CLAUDE.md`** — only if fundamental workflow/commands changed

Do **not** hand-edit **`website/src/content/docs/api/*.md`** — regenerate from JSDoc via `docs:gen` per **`docs/docs-guidance.md`**.
