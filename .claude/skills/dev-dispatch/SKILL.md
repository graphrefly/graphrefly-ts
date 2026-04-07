---
name: dev-dispatch
description: "Implement feature/fix with planning and self-test. Use when user says 'dispatch', 'dev-dispatch', or provides a task with implementation context. Supports --light flag for bug fixes and small changes. Run /qa afterward for code review and final checks."
disable-model-invocation: true
argument-hint: "[--light] [task description or context]"
---

You are executing the **dev-dispatch** workflow for **graphrefly-ts** (GraphReFly TypeScript implementation).

The user's task/context is: $ARGUMENTS

### Mode detection

If `$ARGUMENTS` contains `--light`, this is **light mode**. Otherwise, this is **full mode**. Differences are noted inline per phase.

---

## Phase 1: Context & Planning

Load context and plan the implementation in a single pass. **Parallelize all reads.**

Read in parallel:
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — behavior authority; deep-read sections relevant to the task
- `~/src/graphrefly/COMPOSITION-GUIDE.md` — **composition patterns and 坑** (read when building Phase 4+ factories that compose primitives — covers lazy activation, subscription ordering, null guards, Versioned navigation, factory wiring order)
- `docs/optimizations.md` — **active work items**, anti-patterns, and **deferred follow-ups** (read when touching protocol, batch, node lifecycle, or parity). Resolved decisions are archived in `archive/optimizations/*.jsonl` — search there for historical context (see `docs/docs-guidance.md` § "Optimization decision log")
- `docs/test-guidance.md` — checklist for the relevant layer (core protocol, node, graph, extra)
- `docs/roadmap.md` — if this is a new feature or cross-cutting change (active/open items only; completed phases archived to `archive/roadmap/*.jsonl`)
- Any files the user referenced in $ARGUMENTS
- Relevant source files in the area you'll modify
- Existing tests for the area

**Roadmap §2.3 (sources & sinks):** implement as thin wrappers over the **`node` primitive** (`node`, `producer`, `derived`, `effect`) and the message protocol — no parallel source/sink protocol outside `node`.

While planning, explicitly validate proposed changes against these invariants (from the spec and roadmap):
- **Control flows through the graph** — lifecycle and coordination use messages and topology, not imperative bypasses around the graph (spec §5.1).
- **Messages are always** `[[Type, Data?], ...]` — no single-message shorthand.
- **DIRTY before DATA/RESOLVED** in the same logical update where two-phase push applies; **batch** defers DATA, not DIRTY.
- **Unknown message types forward** — do not swallow unrecognized tuples.
- Prefer **composition (nodes + edges)** over monolithic configuration objects.
- For **diamond** topologies, recomputation happens once per upstream change after all deps settle.
- **No polling** — never poll node values on a timer or busy-wait. Use reactive sources (`fromTimer`, `fromCron`) instead (spec §5.8).
- **No imperative triggers** — no event emitters, callbacks, or `setTimeout` + `set()` workarounds. All coordination uses reactive `NodeInput` signals (spec §5.9).
- **No raw Promises or microtasks** — no bare `Promise`, `queueMicrotask`, `setTimeout`, or `process.nextTick` for reactive work. Async belongs in sources and the runner layer (spec §5.10).
- **Central timer and `messageTier`** — use `core/clock.ts` for timestamps, `messageTier` for tier classification. Never hardcode type checks (spec §5.11).
- **Phase 4+ APIs must be developer-friendly** — sensible defaults, minimal boilerplate, clear errors. Protocol internals never surface in primary APIs (spec §5.12).

Do NOT start implementing yet.

**Optional context:** The predecessor codebase **callbag-recharge** at `~/src/callbag-recharge` has mature patterns, tests, and docs. Use it for **analogous** operator behavior, edge cases, and test structure — then map concepts to GraphReFly (unified message tuples, `node`, `Graph`, `describe`/`observe`). It is not the behavior spec; `~/src/graphrefly/GRAPHREFLY-SPEC.md` is.

---

## Phase 2: Architecture Discussion

### Full mode — HALT

**HALT and report to the user before implementing.** Present:

1. **Architecture assumptions** — how this fits into `src/core/`, `src/graph/`, `src/extra/`
2. **New patterns** — any new patterns not yet in this repo
3. **Options considered** — alternatives with pros/cons
4. **Recommendation** — preferred approach and why

Prioritize (in order):
1. **Correctness** — matches `~/src/graphrefly/GRAPHREFLY-SPEC.md` and protocol invariants
2. **Completeness** — edge cases (errors, completion, reconnect, diamonds)
3. **Consistency** — matches patterns already in graphrefly-ts
4. **Simplicity** — minimal solution

Do NOT consider backward compatibility at this early stage (pre-1.0).

**Cross-language decision log:** If Phase 1–2 surface an **architectural or product-level** question (protocol semantics, batch/node invariants, parity between ports, or anything that needs a spec/product call), **jot it down** in **`docs/optimizations.md`** under **"Active work items"**. If the sibling repo **`graphrefly-py`** is available, add a **matching** entry to **`graphrefly-py/docs/optimizations.md`** so both implementations stay visible. If the sibling tree is not in the workspace, tell the user to mirror the note there. When the decision is **resolved**, move it to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log".

**Wait for user approval before proceeding.**

### Light mode — Skip unless escalation needed

Proceed directly to Phase 3 **unless** Phase 1 reveals any of these:
- Changes to **message protocol**, **node** semantics, or **core** push/pull behavior
- New patterns not present anywhere in the codebase
- Multiple viable approaches with non-obvious trade-offs

If any apply, escalate: HALT and present findings as in full mode.

---

## Phase 3: Implementation & Self-Test

After user approves (full mode) or after Phase 1 (light mode, no escalation):

1. Implement the changes
   - Treat `~/src/graphrefly/GRAPHREFLY-SPEC.md` as non-negotiable for behavior
   - If existing code drifts from the spec, align toward the spec as part of the change
2. Create tests following `docs/test-guidance.md`:
   - Put tests in the most specific existing file under `src/__tests__/` (or colocated `*.test.ts` per project convention)
   - Use **`Graph.observe()`** / **`graph.observe()`** for live message assertions when the Graph API exists; until then, test at the **node** and **message** level per test-guidance
3. Run tests: `pnpm test`
4. Fix any test failures

If implementation leaves an **open architectural decision** (deferred behavior, parity caveat, or “needs spec” item), add it to **`docs/optimizations.md`** under “Active work items” and mirror to **`graphrefly-py/docs/optimizations.md`** when that repo is available. When resolved, archive to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md`.

When done, briefly list files changed and new exports added. Then suggest running `/qa` for adversarial review and final checks.
