---
name: qa
description: "Adversarial code review, apply fixes, final checks (test/lint/build), and doc updates. Run after /dev-dispatch or any manual implementation. Use when user says 'qa', 'review', or 'code review'. Supports --skip-docs to skip documentation phase."
disable-model-invocation: true
argument-hint: "[--skip-docs] [optional context about what was implemented]"
---

You are executing the **qa** workflow for **GraphReFly** (cross-language: TypeScript + Python).

Operational docs live in **graphrefly-ts** (this repo). The diff may include changes in `graphrefly-ts` and/or `graphrefly-py` (`~/src/graphrefly-py`).

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
> You are a Blind Hunter code reviewer. Review this diff for: logic errors, off-by-one errors, race conditions, resource leaks, missing error handling, security issues, dead code, unreachable branches. For Python code, also check thread safety (including free-threaded Python without GIL). Output each finding as: **title** | **severity** (critical/major/minor) | **location** (file:line) | **detail**. Be adversarial — assume bugs exist.

**Subagent 2: Edge Case Hunter** — Has project read access:
> You are an Edge Case Hunter. Review this diff in the context of **GraphReFly** (`~/src/graphrefly/GRAPHREFLY-SPEC.md`). First, read `archive/optimizations/cross-language-notes.jsonl` and collect all entries with `id` prefix `divergence-` — these are **confirmed intentional cross-language divergences** that must NOT be raised as findings. Then check: unhandled message sequences (DIRTY without follow-up, DATA vs RESOLVED), diamond resolution (recompute once), COMPLETE/ERROR terminal rules, forward-unknown-types, batch semantics (DATA deferred, DIRTY not), reconnect/teardown leaks, meta companion nodes, and graph mount/signal propagation when `Graph` is in scope. Also flag violations of design invariants (spec §5.8–5.12): polling patterns (busy-wait or setInterval/time.sleep loops on node values), imperative triggers bypassing graph topology, bare Promises/queueMicrotask/setTimeout (TS) or asyncio.ensure_future/create_task/threading.Timer (PY) for reactive scheduling, direct Date.now()/performance.now() (TS) or time.time_ns()/time.monotonic_ns() (PY) usage (must use core/clock.ts or core/clock.py), hardcoded message type checks instead of messageTier/message_tier utilities, and Phase 4+ APIs that leak protocol internals (DIRTY/RESOLVED/bitmask) into their primary surface. **If the change touches `src/patterns/` or `src/compat/`, verify the implementation against COMPOSITION-GUIDE.md categories (§1 lazy activation, §2 subscription ordering, §3 null guards, §5 wiring order, §7 feedback cycles, §8 SENTINEL gate).** **Browser / Node / Universal tier (TS):** if the change adds or moves code in `src/extra/` or `src/patterns/`, confirm (a) any new `node:*` import or `require("<builtin>")` / `fileStorage` / `sqliteStorage` / `child_process` / filesystem API lives in a `<x>/node` subpath source file, not on a universal path; (b) any new DOM global (`window`, `document`, `indexedDB`, `Worker`, `MessagePort` constructor calls) lives in a `<x>/browser` subpath; (c) new subpaths are registered in both `tsup.config.ts` `ENTRY_POINTS` (+ `nodeOnlyEntries` when node-only) and `package.json` `exports`; (d) JSDoc `@example` blocks import from the correct subpath — a Node-only adapter must not suggest the universal barrel in its example. See `docs/docs-guidance.md` § "Browser / Node / Universal split" for the convention. For each finding: **title** | **trigger_condition** | **potential_consequence** | **location** | **suggested_guard**.

### 1c. Triage findings

Classify each finding into:
- **patch** — fixable code issue. Include the fix recommendation.
- **defer** — pre-existing issue, not caused by this change.
- **reject** — false positive or noise. Drop silently.

For each **patch** and **defer** finding, evaluate fix priority (most to least important):
1. **Spec alignment** — matches `~/src/graphrefly/GRAPHREFLY-SPEC.md`
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

**Cross-language decision log:** For **Needs Decision** items that are architectural or affect TS/Python parity, add them to **`docs/optimizations.md`** under "Active work items" (this repo is the single source of truth for both TS and PY). When resolved, archive to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log".

**Wait for user decisions on group 1. Group 2 can be applied immediately if user approves the batch.**

---

## Phase 2: Apply Review Fixes

Apply the approved fixes from Phase 1.

---

## Phase 3: Final Checks

Run all checks for the affected repo(s) and fix any failures (do NOT skip or ignore):

**TypeScript:**
1. `pnpm test` — all tests must pass
2. `pnpm run lint:fix` — fix lint issues
3. `pnpm run build` — checks for DTS errors AND runs `assertBrowserSafeBundles` (fails the build with a `via X → Y → Z` chain if any universal entry transitively imports `node:*` or a bare Node builtin). If it fails, move the offending symbol to a `<x>/node` subpath per `docs/docs-guidance.md` § "Browser / Node / Universal split", don't silence the guardrail.

**Python (if PY code was changed):**
1. `cd ~/src/graphrefly-py && uv run pytest`
2. `cd ~/src/graphrefly-py && uv run ruff check --fix src/ tests/`
3. `cd ~/src/graphrefly-py && uv run ruff format src/ tests/`
4. `cd ~/src/graphrefly-py && uv run mypy src/`

If a failure is related to an implementation design question, **HALT** and raise it to the user before fixing.

---

## Phase 4: Documentation Updates

**Skip this phase if `--skip-docs` was passed.**

**Authoritative checklist:** follow **`docs/docs-guidance.md`** end-to-end (authority order, Tier 0–5, JSDoc tag table, `gen-api-docs.mjs` REGISTRY, `docs:gen` / `docs:gen:check`, `sync-docs`, when to edit which file).

Update documentation when behavior or public API changed:

- **`docs/docs-guidance.md`** — if documentation *conventions* or generator workflow change, update this file so `/qa` and contributors stay aligned
- **`~/src/graphrefly/GRAPHREFLY-SPEC.md`** — only if the **spec** itself is intentionally revised (rare; use semver rules in spec §8)
- **`docs/implementation-plan.md`** — **canonical pre-1.0 sequencer.** When a phase / sub-section item lands, mark it ✅ in the matching Phase 11–16 entry (e.g. "11.1 EC2/EC7 — bridge `value == null` → `=== undefined` ✅ landed") and tag with the date. When all items in a sub-section land, mark the sub-section ✅. When a **whole Phase** lands (every sub-section ✅, no in-flight WAIT/POST-1.0 carries that still need this phase's body to be readable), **archive it**: append a JSONL line per sub-section to the matching `archive/roadmap/phase-<n>-*.jsonl` and replace the in-file body with a 2–4-line summary + archive pointer (id, file). Single residual follow-ups move to `optimizations.md` with a back-link. See `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/implementation-plan.md`". New deferred items surfaced by /qa go to `optimizations.md` (line-item state) and may also need a sub-bullet in the matching implementation-plan phase if they reshape its scope.
- **`docs/optimizations.md`** — add **new open decisions** under "Active work items" (line-item state for the new carry; cross-link from the matching implementation-plan.md phase if relevant). **Then actively sweep:** scan for any fully-resolved items (all sub-tasks DONE, no remaining TODOs) and archive them to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log". Remove archived content from `optimizations.md` — it should contain only active/open items, anti-patterns, and deferred follow-ups.
- **Structured JSDoc** on exported public APIs (Tier 1 — parameters, returns, examples per `docs-guidance`; source of truth for generated API pages). `@example` imports must use the correct subpath for the symbol's tier (universal / `<x>/node` / `<x>/browser`).
- **New public symbols** — barrel export + **`website/scripts/gen-api-docs.mjs` REGISTRY** entry, then `pnpm --filter @graphrefly/docs-site docs:gen` (or `docs:gen:check` in CI). If the symbol introduced a new subpath, also update `tsup.config.ts` (`ENTRY_POINTS` + `nodeOnlyEntries` when node-only) AND `package.json` `exports`.
- **`docs/test-guidance.md`** — if new test patterns are established
- **`docs/roadmap.md`** — **vision / wave context only** per 2026-04-30 migration. Do NOT track item-level state here; that lives in `implementation-plan.md`. Only edit the roadmap when the strategic frame shifts (a wave completes, a positioning lock changes). When a wave or Phase 7.x / 8.x section is fully done, archive its body to `archive/roadmap/*.jsonl` and leave a one-line pointer per `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/roadmap.md`". Most /qa cycles will not touch roadmap.md at all.
- **`CLAUDE.md`** — only if fundamental workflow/commands changed

Do **not** hand-edit **`website/src/content/docs/api/*.md`** — regenerate from JSDoc via `docs:gen` per **`docs/docs-guidance.md`**.
