---
name: dev-dispatch
description: "Implement feature/fix with planning and self-test. Use when user says 'dispatch', 'dev-dispatch', or provides a task with implementation context. Supports --light flag for bug fixes and small changes. Run /qa afterward for code review and final checks."
argument-hint: "[--light] [task description or context]"
---

You are executing the **dev-dispatch** workflow for **GraphReFly** (cross-language: TypeScript + Python).

Operational docs, roadmap, optimizations, and skills all live in **graphrefly-ts** (this repo). Implementation may target `graphrefly-ts`, `graphrefly-py` (`~/src/graphrefly-py`), or both.

The user's task/context is: $ARGUMENTS

### Mode detection

If `$ARGUMENTS` contains `--light`, this is **light mode**. Otherwise, this is **full mode**. Differences are noted inline per phase.

---

## Phase 1: Context & Planning

Load context and plan the implementation in a single pass. **Parallelize all reads.**

Read in parallel:
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — behavior authority; deep-read sections relevant to the task
- `~/src/graphrefly/COMPOSITION-GUIDE.md` — **composition patterns and insights** (read when building Phase 4+ factories that compose primitives — covers lazy activation, subscription ordering, null guards, Versioned navigation, factory wiring order)
- `docs/implementation-plan.md` — **CANONICAL pre-1.0 sequencer**. Find the phase this task belongs to (Phase 11 cleanup / Phase 12 consolidation / Phase 13 multi-agent / Phase 14 changesets / Phase 14.5 residuals / Phase 15 eval / Phase 16 launch). The phase entry tells you what's locked, what's still open-design (DS-#), and what cross-references back to `optimizations.md` for line-item state. Read this FIRST so you know whether you're picking up a NOW item or one tagged WAIT/POST-1.0.
- `docs/optimizations.md` — **line-item state for individual deferred carries**, anti-patterns, and **deferred follow-ups** (read when touching protocol, batch, node lifecycle, or parity, OR when the implementation-plan phase entry references an optimization-id). Resolved decisions are archived in `archive/optimizations/*.jsonl` — search there for historical context (see `docs/docs-guidance.md` § "Optimization decision log")
- `docs/test-guidance.md` — checklist for the relevant layer (core protocol, node, graph, extra)
- `docs/roadmap.md` — **vision / wave context only** (no longer the sequencer per 2026-04-30 migration — implementation-plan.md is canonical). Read for the strategic frame on a feature, not to find what's next.
- Any files the user referenced in $ARGUMENTS
- Relevant source files in the area you'll modify (TS: `packages/pure-ts/src/`, PY: `~/src/graphrefly-py/src/graphrefly/`)
- Existing tests for the area (TS: `packages/pure-ts/src/__tests__/`, PY: `~/src/graphrefly-py/tests/`)

**Mandatory for patterns/ work:** If the task touches any file in `packages/pure-ts/src/patterns/` or `packages/pure-ts/src/compat/`, reading `~/src/graphrefly/COMPOSITION-GUIDE.md` is **mandatory**, not optional. The harness, orchestration, messaging, and all Phase 4+ code are composed factories — modifying their tests or implementation requires understanding composition patterns (lazy activation, subscription ordering, feedback cycles, SENTINEL gate).

**Roadmap §2.3 (sources & sinks):** implement as thin wrappers over the **`node` primitive** (`node`, `producer`, `derived`, `effect`) and the message protocol — no parallel source/sink protocol outside `node`.

While planning, explicitly validate proposed changes against these invariants (from the spec and roadmap):
- **Tier placement (TS)** — every new TS public symbol picks a tier: **universal** (default, browser + Node safe), **node-only** (`<x>/node` subpath, may import `node:*`), or **browser-only** (`<x>/browser` subpath, may use DOM globals). See `docs/docs-guidance.md` § "Browser / Node / Universal split". If the symbol imports `node:fs`, `node:path`, `node:crypto`, `node:sqlite`, `node:child_process`, etc., it belongs in `<x>/node` — NOT in the universal barrel. If it imports `window` / `document` / `indexedDB` / DOM types, it belongs in `<x>/browser`. Adding a new subpath means updating `packages/pure-ts/tsup.config.ts` `ENTRY_POINTS` (+ `nodeOnlyEntries` for node-only) AND `packages/pure-ts/package.json` `exports`.
- **Control flows through the graph** — lifecycle and coordination use messages and topology, not imperative bypasses around the graph (spec §5.1).
- **Messages are always** `[[Type, Data?], ...]` — no single-message shorthand.
- **DIRTY before DATA/RESOLVED** in the same logical update where two-phase push applies; **batch** defers DATA, not DIRTY.
- **Unknown message types forward** — do not swallow unrecognized tuples.
- Prefer **composition (nodes + edges)** over monolithic configuration objects.
- For **diamond** topologies, recomputation happens once per upstream change after all deps settle.
- **No polling** — never poll node values on a timer or busy-wait. Use reactive sources (`fromTimer`/`from_timer`, `fromCron`/`from_cron`) instead (spec §5.8).
- **No imperative triggers** — no event emitters, callbacks, or `setTimeout`/`threading.Timer` + `set()` workarounds. All coordination uses reactive `NodeInput` signals (spec §5.9).
- **No raw async primitives** — TS: no bare `Promise`, `queueMicrotask`, `setTimeout`, `process.nextTick`. PY: no bare `asyncio.ensure_future`, `asyncio.create_task`, `threading.Timer`, or raw coroutines. Async belongs in sources and the runner layer (spec §5.10).
- **Central timer and `messageTier`/`message_tier`** — TS: use `core/clock.ts`. PY: use `core/clock.py`. Never hardcode type checks (spec §5.11).
- **Phase 4+ APIs must be developer-friendly** — sensible defaults, minimal boilerplate, clear errors. Protocol internals never surface in primary APIs (spec §5.12).
- **PY: Thread safety** — design for GIL and free-threaded Python where core APIs are documented as thread-safe. Per-subgraph `RLock` (see roadmap Phase 0.4).
- **PY: No `async def` in public APIs** — all public functions return `Node[T]`, `Graph`, `None`, or a plain synchronous value.

Do NOT start implementing yet.

**Optional context:** The predecessor codebase **callbag-recharge** at `~/src/callbag-recharge` has mature patterns, tests, and docs. Use it for **analogous** operator behavior, edge cases, and test structure — then map concepts to GraphReFly (unified message tuples, `node`, `Graph`, `describe`/`observe`). It is not the behavior spec; `~/src/graphrefly/GRAPHREFLY-SPEC.md` is.

---

## Phase 2: Architecture Discussion

### Full mode — HALT

**HALT and report to the user before implementing.** Present:

1. **Architecture assumptions** — how this fits into `packages/pure-ts/src/core/`, `packages/pure-ts/src/graph/`, `packages/pure-ts/src/extra/`
2. **New patterns** — any new patterns not yet in this repo
3. **Options considered** — alternatives with pros/cons
4. **Recommendation** — preferred approach and why

Prioritize (in order):
1. **Correctness** — matches `~/src/graphrefly/GRAPHREFLY-SPEC.md` and protocol invariants
2. **Completeness** — edge cases (errors, completion, reconnect, diamonds)
3. **Consistency** — matches patterns already in the target repo
4. **Simplicity** — minimal solution
5. **Thread safety** (PY) — where concurrent `get()` / propagation applies

Do NOT consider backward compatibility at this early stage (pre-1.0).

**Cross-language decision log:** If Phase 1–2 surface an **architectural or product-level** question (protocol semantics, batch/node invariants, parity between ports, or anything that needs a spec/product call), **jot it down** in **`docs/optimizations.md`** under **"Active work items"** (this repo is the single source of truth for both TS and PY). When the decision is **resolved**, move it to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log".

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
   - Put tests in the most specific existing file under `packages/pure-ts/src/__tests__/` (or colocated `*.test.ts` per project convention)
   - Use **`Graph.observe()`** / **`graph.observe()`** for live message assertions when the Graph API exists; until then, test at the **node** and **message** level per test-guidance
3. Run checks:
   - **TS:** `pnpm test` — and when the change touches `packages/pure-ts/src/extra/` or `packages/pure-ts/src/patterns/<x>/`, also `pnpm run build` so the post-build `assertBrowserSafeBundles` guardrail catches any Node-builtin that leaked into a universal entry.
   - **PY:** `cd ~/src/graphrefly-py && uv run pytest && uv run ruff check src/ tests/ && uv run mypy src/`
4. Fix any failures

If implementation leaves an **open architectural decision** (deferred behavior, parity caveat, or “needs spec” item), add it to **`docs/optimizations.md`** under “Active work items” (this repo is the single source of truth). When resolved, archive to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md`.

If implementation **closes the last in-flight item from a Phase 11–16 sub-section** in `docs/implementation-plan.md`, mark the sub-section ✅ inline. If it closes the **last in-flight item in a whole Phase**, also archive the phase body to the matching `archive/roadmap/phase-<n>-*.jsonl` and replace the phase body with a 2–4-line summary + archive pointer per `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/implementation-plan.md`". Single residual follow-ups move to `docs/optimizations.md` with a back-link to the archived phase id. Same convention applies to fully-completed waves / sections in `docs/roadmap.md`.

When done, briefly list files changed and new exports added. Then suggest running `/qa` for adversarial review and final checks.
