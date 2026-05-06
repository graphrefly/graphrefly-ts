---
name: parity
description: "Cross-language parity check + adversarial QA pass across graphrefly-ts and graphrefly-py. Run after /dev-dispatch + /qa on both repos. Use when user says 'parity', 'cross-lang check', or 'sync repos'."
disable-model-invocation: true
argument-hint: "[feature area or 'full'] [optional: path to sibling repo]"
---

You are executing the **parity** workflow, comparing **graphrefly-ts** (this repo) against **graphrefly-py** (`~/src/graphrefly-py` unless overridden in $ARGUMENTS).

**This repo is the single source of truth** for all operational docs (roadmap, optimizations, test-guidance, docs-guidance, archive). Both repos' docs are maintained here.

Context from user: $ARGUMENTS

---

## Phase 1: Scope & Gather

Determine scope from $ARGUMENTS:
- If a **feature area** is given (e.g. "Graph 1.3", "batch", "node lifecycle"), focus on that area only.
- If `full`, scan all implemented phases in both repos.

> **PY parity is currently PARKED until 1.0** per the 2026-04-30 re-prioritization in `docs/implementation-plan.md` § Parked. Run `/parity` only when explicitly invoked by the user (e.g. for a one-off audit), or when post-1.0 work resumes. Findings during the parked window get filed to `optimizations.md` under a `[py-parity-*]` tag and are NOT scheduled for implementation until the umbrella reopens.

Read in parallel:
- **Operational docs (this repo):** `docs/implementation-plan.md` (canonical pre-1.0 sequencer; the matching phase tells you what's locked vs in-flight), `docs/optimizations.md` (active items + deferred, line-item state for `[py-parity-*]` carries), `archive/optimizations/*.jsonl` (cross-language notes, resolved decisions — search with `grep`), `docs/roadmap.md` (vision context only; do NOT use as the sequencer), `~/src/graphrefly/GRAPHREFLY-SPEC.md` (relevant sections)
- **Composition guide:** `~/src/graphrefly/COMPOSITION-GUIDE.md` — **mandatory** when the scoped area includes `packages/legacy-pure-ts/src/patterns/` or `packages/legacy-pure-ts/src/compat/` in either repo. Composed factories require understanding lazy activation, subscription ordering, null guards, wiring order, feedback cycles, and SENTINEL gate patterns.
- **TS source:** `packages/legacy-pure-ts/src/` and `packages/legacy-pure-ts/src/__tests__/` in the scoped area
- **PY source:** `~/src/graphrefly-py/src/graphrefly/` and `~/src/graphrefly-py/tests/` in the scoped area

**Important:** Read `archive/optimizations/cross-language-notes.jsonl` entries with `id` prefix `divergence-`. These are **confirmed intentional divergences** — do NOT re-raise them as parity gaps or QA findings. Filter them out before presenting results.

---

## Phase 2: Diff — API Surface

For the scoped area, compare:

1. **Public API** — method names, signatures, options/kwargs, return types
2. **Error behavior** — what throws/raises, error messages, error types
3. **Edge cases** — boundary conditions, validation rules (e.g. name constraints, duplicate handling)
4. **Default behavior** — what happens when optional args are omitted
5. **Subpath tier (TS-only; informational for PY)** — for each symbol, note its TS tier: universal (browser + Node safe), `<x>/node` (Node-only), or `<x>/browser` (DOM-only). See `docs/docs-guidance.md` § "Browser / Node / Universal split". Record this column even though PY has no equivalent split yet — when PY adds a comparable feature (e.g. `fileStorage`), the decision should match TS (filesystem I/O goes in a Node-only module). Treat tier mismatches where PY exposes something from a "universal"-shaped module that TS places under `<x>/node` as a flag for future PY-side consideration, not as a blocking divergence today.

Present a table:

| Aspect | TypeScript | Python | Verdict |
|--------|-----------|--------|---------|
| ... | ... | ... | aligned / TS ahead / Py ahead / intentional divergence |

Mark **intentional divergences** (language idiom, concurrency model, etc.) separately from **unintentional gaps**.

---

## Phase 3: Diff — Behavioral Semantics

For unintentional gaps found in Phase 2, dig deeper:

1. Read the **implementation** on both sides
2. Read the **tests** on both sides
3. Identify the **spec-correct** behavior per `~/src/graphrefly/GRAPHREFLY-SPEC.md`
4. For items not covered by the spec, check `docs/optimizations.md` open design decisions

For each gap, classify:
- **spec-decided** — spec says what the behavior should be; one side is wrong
- **convention-decided** — `optimizations.md` cross-language notes already aligned on this
- **needs-decision** — neither spec nor optimizations.md covers this; flag for user

---

## Phase 4: Cross-Repo Adversarial QA

This is a **second QA pass** that catches issues the per-repo `/qa` missed — bugs that only surface when you read both implementations side by side.

### 4a. Gather both diffs

Run `git diff` in **both** repos. Also read any untracked files in the scoped area.

### 4b. Launch parallel review subagents

Each subagent receives the diffs from **both** repos plus the cross-language notes from `docs/optimizations.md`.

**Subagent 1: Parity Semantic Hunter** — Has read access to both repos:
> You are a Parity Semantic Hunter reviewing **two implementations** of the same reactive graph protocol (graphrefly-ts and graphrefly-py). Both repos just had independent `/dev-dispatch` + `/qa` runs. First, read `archive/optimizations/cross-language-notes.jsonl` and collect all entries with `id` prefix `divergence-` — these are **confirmed intentional divergences** that must NOT be raised as findings. Then review the diffs side by side for: message ordering mismatches between ports, settlement/batch timing differences, edge cases where one port handles a scenario the other doesn't, validation rules present in one but missing from the other, test coverage asymmetry (scenario tested on one side but not the other), naming or path convention drift. For each finding: **title** | **severity** (critical/major/minor) | **which repo** | **detail** | **suggested fix**.

**Subagent 2: Spec Conformance Hunter** — Has read access to both repos + spec:
> You are a Spec Conformance Hunter. Read `~/src/graphrefly/GRAPHREFLY-SPEC.md` and both diffs. First, read `archive/optimizations/cross-language-notes.jsonl` and collect all entries with `id` prefix `divergence-` — these are **confirmed intentional divergences** that must NOT be raised as findings. Check whether either implementation drifted from the spec during implementation: incorrect message ordering, wrong terminal behavior, batch semantics that don't match spec §2, node lifecycle violations, graph composition contracts (§3) not met, `describe`/`observe` output that doesn't match Appendix B. Also check design invariant violations (spec §5.8–5.12): polling patterns, imperative triggers bypassing graph topology, raw async primitives (Promises/microtasks in TS, asyncio.ensure_future/create_task in PY) for reactive scheduling, direct time API usage instead of central clock, hardcoded message type checks instead of messageTier/message_tier, and Phase 4+ APIs leaking protocol internals. Also check whether `docs/optimizations.md` cross-language decisions are actually implemented correctly on both sides. For each finding: **title** | **severity** | **spec section** | **which repo(s)** | **detail**.

### 4c. Triage QA findings

Classify each finding:
- **patch** — fixable code issue; include which repo needs the fix
- **defer** — pre-existing, not caused by this round of changes
- **reject** — false positive

---

## Phase 5: Present Findings (HALT)

Present ALL findings from Phase 2–4 to the user, grouped:

### Group 1: Parity Gaps — Auto-fixable
For each: the gap, which repo needs the fix, the fix description, effort (S/M/L).

### Group 2: QA Findings — Auto-fixable
For each: the issue, which repo, the fix, effort (S/M/L).

### Group 3: Needs Decision
For each: the gap or issue, both behaviors, spec/convention silence, recommended resolution.

### Group 4: Intentional Divergences (FYI)
Language-specific differences correct on both sides (thread safety, `|` operator, etc.).

**Wait for user approval before proceeding.**

---

## Phase 6: Apply Fixes

After user approves:

1. Apply fixes to **this repo** (graphrefly-ts) — code + tests
2. Run `pnpm test` — fix failures
3. If fixes approved for the **sibling repo**, apply those too:
   - Code + tests in `~/src/graphrefly-py/`
   - Run `cd ~/src/graphrefly-py && uv run pytest` — fix failures
4. Update `docs/optimizations.md` (this repo — single source of truth for both):
   - Add new open decisions under "Active work items" (line-item state for any new `[py-parity-*]` carry).
   - **Actively sweep:** scan for any fully-resolved items (all sub-tasks DONE, no remaining TODOs) and archive them to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log". Remove archived content from `optimizations.md`.
5. Update `docs/implementation-plan.md` (canonical sequencer):
   - When a `[py-parity-*]` item lands or its scope shifts, mark it ✅ in the matching phase entry (or note "PY parity carry" within the relevant Phase 11–16 sub-section). When PY parity reopens post-1.0, the phase entry is where future agents pick up scope.
   - If a parity pass closes the **last in-flight item from a Phase**, archive the phase body to `archive/roadmap/phase-<n>-*.jsonl` and replace with a 2–4-line summary + archive pointer per `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/implementation-plan.md`". Single residual follow-ups move to `optimizations.md` with a back-link.
   - Do NOT add new sequencing here during the parked window; just record state changes.
6. `docs/roadmap.md` is **vision context only** per 2026-04-30 migration — do NOT track item-level state here. Wave-completion archival to `archive/roadmap/*.jsonl` (with a one-line pointer left behind) still applies per `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/roadmap.md`" but rarely fires during /parity.

---

## Phase 7: Final Checks

Run all checks on both repos and fix any failures:

**TypeScript:**
```bash
pnpm test && pnpm run lint:fix && pnpm run build
```

`pnpm run build` runs `assertBrowserSafeBundles` post-build. If it fails, a TS change leaked a Node builtin into a universal entry — fix per `docs/docs-guidance.md` § "Browser / Node / Universal split" before closing the parity pass.

**Python:**
```bash
cd ~/src/graphrefly-py && uv run pytest && uv run ruff check --fix src/ tests/ && uv run mypy src/
```

Report results. If any failures relate to a design question, HALT.
