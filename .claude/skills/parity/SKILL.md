---
name: parity
description: "Cross-language parity check between graphrefly-ts and graphrefly-py. Run after /dev-dispatch + /qa on both repos to catch behavioral divergences. Use when user says 'parity', 'cross-lang check', or 'sync repos'."
disable-model-invocation: true
argument-hint: "[feature area or 'full'] [optional: path to sibling repo]"
---

You are executing the **parity** workflow, comparing **graphrefly-ts** (this repo) against **graphrefly-py** (`~/src/graphrefly-py` unless overridden in $ARGUMENTS).

Context from user: $ARGUMENTS

---

## Phase 1: Scope & Gather

Determine scope from $ARGUMENTS:
- If a **feature area** is given (e.g. "Graph 1.2", "batch", "node lifecycle"), focus on that area only.
- If `full`, scan all implemented phases in both roadmaps.

Read in parallel:
- **This repo:** `docs/optimizations.md` (cross-language §1–14 + gaps table), `docs/roadmap.md`
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
3. Identify the **spec-correct** behavior per `docs/GRAPHREFLY-SPEC.md`
4. For items not covered by the spec, check `docs/optimizations.md` open design decisions

For each gap, classify:
- **spec-decided** — spec says what the behavior should be; one side is wrong
- **convention-decided** — `optimizations.md` cross-language notes already aligned on this
- **needs-decision** — neither spec nor optimizations.md covers this; flag for user

---

## Phase 4: Present Findings (HALT)

Present ALL gaps to the user, grouped:

### Group 1: Auto-fixable (spec or convention decided)
For each: the gap, which repo needs the fix, the fix description, effort estimate (S/M/L).

### Group 2: Needs Decision
For each: the gap, both behaviors, spec silence or ambiguity, recommended resolution.

### Group 3: Intentional Divergences (FYI)
Language-specific differences that are correct on both sides (e.g. thread safety, `|` operator in Python).

**Wait for user approval before proceeding.**

---

## Phase 5: Apply Fixes

After user approves:

1. Apply fixes to **this repo** (graphrefly-ts) — code + tests
2. Run `pnpm test` — fix failures
3. If the user approved fixes to the **sibling repo**, apply those too:
   - Code + tests in `~/src/graphrefly-py/`
   - Run `cd ~/src/graphrefly-py && uv run pytest` — fix failures
4. Update `docs/optimizations.md` in **both** repos:
   - Remove resolved gaps from the cross-language table
   - Add any new decisions to the appropriate section

---

## Phase 6: Verify

Run final checks on both repos:

**TypeScript:**
```bash
pnpm test && pnpm run lint:fix && pnpm run build
```

**Python:**
```bash
cd ~/src/graphrefly-py && uv run pytest && uv run ruff check --fix src/ tests/ && uv run mypy src/
```

Report results. If any failures relate to a design question, HALT.
