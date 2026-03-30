---
name: parity
description: "Cross-language parity check + adversarial QA pass across graphrefly-ts and graphrefly-py. Run after /dev-dispatch + /qa on both repos. Use when user says 'parity', 'cross-lang check', or 'sync repos'."
disable-model-invocation: true
argument-hint: "[feature area or 'full'] [optional: path to sibling repo]"
---

You are executing the **parity** workflow, comparing **graphrefly-ts** (this repo) against **graphrefly-py** (`~/src/graphrefly-py` unless overridden in $ARGUMENTS).

Context from user: $ARGUMENTS

---

## Phase 1: Scope & Gather

Determine scope from $ARGUMENTS:
- If a **feature area** is given (e.g. "Graph 1.3", "batch", "node lifecycle"), focus on that area only.
- If `full`, scan all implemented phases in both roadmaps.

Read in parallel:
- **This repo:** `docs/optimizations.md` (cross-language notes + gaps), `docs/roadmap.md`, `~/src/graphrefly/GRAPHREFLY-SPEC.md` (relevant sections)
- **Sibling repo:** `~/src/graphrefly-py/docs/optimizations.md`, `~/src/graphrefly-py/docs/roadmap.md`
- Source files in the scoped area from **both** repos
- Test files in the scoped area from **both** repos

---

## Phase 2: Diff — API Surface

For the scoped area, compare:

1. **Public API** — method names, signatures, options/kwargs, return types
2. **Error behavior** — what throws/raises, error messages, error types
3. **Edge cases** — boundary conditions, validation rules (e.g. name constraints, duplicate handling)
4. **Default behavior** — what happens when optional args are omitted

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
> You are a Parity Semantic Hunter reviewing **two implementations** of the same reactive graph protocol (graphrefly-ts and graphrefly-py). Both repos just had independent `/dev-dispatch` + `/qa` runs. Review the diffs side by side for: message ordering mismatches between ports, settlement/batch timing differences, edge cases where one port handles a scenario the other doesn't, validation rules present in one but missing from the other, test coverage asymmetry (scenario tested on one side but not the other), naming or path convention drift. For each finding: **title** | **severity** (critical/major/minor) | **which repo** | **detail** | **suggested fix**.

**Subagent 2: Spec Conformance Hunter** — Has read access to both repos + spec:
> You are a Spec Conformance Hunter. Read `~/src/graphrefly/GRAPHREFLY-SPEC.md` and both diffs. Check whether either implementation drifted from the spec during implementation: incorrect message ordering, wrong terminal behavior, batch semantics that don't match spec §2, node lifecycle violations, graph composition contracts (§3) not met, `describe`/`observe` output that doesn't match Appendix B. Also check whether `docs/optimizations.md` cross-language decisions are actually implemented correctly on both sides. For each finding: **title** | **severity** | **spec section** | **which repo(s)** | **detail**.

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
4. Update `docs/optimizations.md` in **both** repos:
   - Remove resolved gaps from cross-language tables
   - Add any new decisions to the appropriate section

---

## Phase 7: Final Checks

Run all checks on both repos and fix any failures:

**TypeScript:**
```bash
pnpm test && pnpm run lint:fix && pnpm run build
```

**Python:**
```bash
cd ~/src/graphrefly-py && uv run pytest && uv run ruff check --fix src/ tests/ && uv run mypy src/
```

Report results. If any failures relate to a design question, HALT.
