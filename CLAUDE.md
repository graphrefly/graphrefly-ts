# graphrefly — unified agent context

**GraphReFly** — reactive graph protocol for human + LLM co-operation. This repo (`graphrefly-ts`) is the **single source of truth** for operational docs, skills, roadmap, and optimization records across both the TypeScript and Python implementations.

## Repos

| Repo | Path | Role |
|------|------|------|
| **graphrefly-ts** | this repo | TypeScript implementation + **all operational docs** |
| **graphrefly-py** | `~/src/graphrefly-py` | Python implementation (must stay in parity) |
| **graphrefly** (spec) | `~/src/graphrefly` | `GRAPHREFLY-SPEC.md`, `COMPOSITION-GUIDE.md` |
| **callbag-recharge** | `~/src/callbag-recharge` | TS predecessor (patterns/tests, NOT spec authority) |
| **callbag-recharge-py** | `~/src/callbag-recharge-py` | PY predecessor (concurrency patterns, subgraph locks) |

## Canonical references (read these)

| Doc | Role |
|-----|------|
| `~/src/graphrefly/GRAPHREFLY-SPEC.md` | **Behavior spec** — messages, `node`, `Graph`, invariants |
| `~/src/graphrefly/COMPOSITION-GUIDE.md` | **Composition guide** — insights, patterns, recipes for Phase 4+ factory authors. **Read before building factories that compose primitives.** Covers: lazy activation, subscription ordering, null guards, feedback cycles, promptNode SENTINEL, wiring order. |
| `docs/implementation-plan.md` | **CANONICAL pre-1.0 sequencer** — Phases 11–16 + Parked + Open design sessions. Tier 1–10 historical record + the active Phase 11–16 plan locked 2026-04-30 (cleanup → consolidation → multi-agent → changesets/diff → roadmap residuals → eval → launch). Read this FIRST when picking up "what's next." Phase 13 covers multi-agent + intervention substrate (sources: `archive/docs/SESSION-multi-agent-gap-analysis.md` + `SESSION-human-llm-intervention-primitives.md`). |
| `docs/optimizations.md` | **Active backlog (line-item state)** — open work items, anti-patterns, deferred follow-ups, proposed improvements. Item-level provenance for entries that the implementation-plan.md phases reference. Add new items here. |
| `archive/optimizations/` | **Optimizations archive** — built-in optimizations, resolved design decisions, cross-language parity notes. Check before introducing new optimizations or debugging perf issues. **Backlog/proposed items belong in `docs/optimizations.md`, not here.** |
| `docs/roadmap.md` | **Vision / wave context** (no longer the active sequencer per 2026-04-30 migration — see `implementation-plan.md`). Useful for the strategic frame: Wave 0/1/2/3 announcement structure, harness engineering positioning, eval-story narrative. New items go to `implementation-plan.md`, not here. |
| `docs/docs-guidance.md` | How to document APIs and long-form docs (covers both TS and PY) |
| `docs/test-guidance.md` | How to write and organize tests (covers both TS and PY) |
| `archive/docs/SESSION-graphrefly-spec-design.md` | Design history and migration from callbag-recharge |
| `archive/docs/SESSION-reactive-collaboration-harness.md` | **Active** — 7-stage reactive collaboration loop (INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT), gate port from callbag-recharge, `promptNode` factory, `valve` rename, strategy model (`rootCause × intervention → successRate`), `harnessLoop()` factory. Source of truth for §9.0. |
| `archive/docs/SESSION-DS-14.5-A-narrative-reframe.md` | **Active (canonical post-2026-05-04)** — spec-as-projection reframe, multi-agent subgraph ownership protocol (L0–L3 staircase), catalog reframed as user-host concern, Wave 2 narrative shift away from "harness builder". L1–L8 + Q1–Q10 locks. **Read this before editing README / Wave 2 launch copy / MCP server framing.** |
| `archive/docs/SESSION-DS-14-changesets-design.md` | **Active (locked 2026-05-05)** — universal `BaseChange<T>` envelope, `mutations` companion bundles, `mutate(act, opts)` factory, lifecycle-aware diff restore. Substrate for op-log changesets / worker-bridge wire B / `lens.flow` delta / `reactiveLog.scan` / `restoreSnapshot mode "diff"`. Source of truth for Phase 14 implementation. |
| `archive/docs/SESSION-harness-engineering-strategy.md` | **SUPERSEDED 2026-05-04 by DS-14.5.A** for Wave 2 narrative framing. Original 8-requirement coverage analysis + harness engineering landscape preserved as historical context. New positioning lives in `SESSION-DS-14.5-A-narrative-reframe.md`. |
| `archive/docs/SESSION-marketing-promotion-strategy.md` | **Active** — positioning pillars (pain-point-first), wave-based announcement plan, pain-point reply marketing playbooks, xiaohongshu strategy, Future AGI competitive intel (§16), prompt optimization algorithm analysis (§17), blog content plan (§18). Source of truth for public-facing copy. **Wave 2 framing should rebase on DS-14.5.A.** |

## Commands

**TypeScript (this repo) — post-Phase-13.9.A cleave:**
```bash
pnpm test                  # legacy-pure-ts test suite + parity-tests
pnpm test:legacy           # just packages/legacy-pure-ts (~2980 tests)
pnpm test:parity           # just packages/parity-tests
pnpm run lint              # biome check (workspace-wide)
pnpm run lint:fix          # biome check --write
pnpm run build             # legacy-pure-ts build → root shim build
pnpm run build:shim        # only the shim (assumes legacy already built)
pnpm bench                 # legacy-pure-ts vitest bench
```

For watch-mode work inside the legacy package: `pnpm --filter @graphrefly/legacy-pure-ts test:watch`.

**Python (`~/src/graphrefly-py`):**
```bash
uv run pytest                          # tests
uv run ruff check src/ tests/         # lint
uv run ruff check --fix src/ tests/   # lint fix
uv run ruff format src/ tests/        # format
uv run mypy src/                       # type check
```

Python workspace managed by mise. `mise trust && mise install` to set up uv. `uv sync` to install dependencies. Distribution name: `graphrefly-py`, import path: `graphrefly`.

## Documentation workflow (critical)

- `docs/docs-guidance.md` is the cross-language documentation standard.
- `website/src/content/docs/api/*.md` is generated output. Do not hand-edit.
- For API docs updates:
  1. Update source JSDoc/docstrings.
  2. Run docs generation in the respective repo (`pnpm --dir website docs:gen`).
  3. Validate with `pnpm --dir website docs:gen:check` and `pnpm --dir website sync-docs:check`.
- `llms.txt` is an AI index; keep it high-signal and avoid drift-prone, exhaustive inline API inventories.

## Layout

**TypeScript (`graphrefly-ts`) — post-Phase-13.9.A cleave (2026-05-05):**
- Root `src/` — thin **shim** for `@graphrefly/graphrefly`. Each entry is a one-liner re-export from `@graphrefly/legacy-pure-ts/<subpath>`. Nothing else lives here. Until per-Rust-milestone swap-overs land, every public-API import flows through these re-exports.
- `packages/legacy-pure-ts/src/` — the **frozen pure-TS implementation**. All real source code lives here. Layered structure unchanged from pre-cleave:
  - `core/` — message protocol, `node` primitive, batch, sugar constructors (Phase 0)
  - `graph/` — `Graph` container, describe/observe, snapshot (Phase 1+)
  - `extra/` — operators, sources, data structures, resilience (Phase 2–3). Browser-safe by default; Node-only additions in `extra/node.ts`, browser-only additions in `extra/browser.ts`.
  - `patterns/` — domain-layer APIs (Phase 4+). Each domain is its own folder (`patterns/<name>/index.ts`). Node-only in `<name>/node.ts`, browser-only in `<name>/browser.ts`.
  - `compat/` — framework adapters: NestJS (Phase 5+)
- `packages/parity-tests/` — cross-impl parity scenarios (vitest `describe.each([legacyImpl, rustImpl])`). Currently legacy-only; the rust arm activates when `@graphrefly/native` publishes. See `packages/parity-tests/README.md` for the per-Rust-milestone surface widening schedule.
- `packages/cli`, `packages/mcp-server` — workspace consumers of `@graphrefly/graphrefly`. Their vitest configs alias `@graphrefly/graphrefly` directly to `packages/legacy-pure-ts/src/index.ts` (the shim is just re-exports; nothing new to test through it).

The cleave is governed by Phase 13.9.A in `docs/implementation-plan.md` and Part 12 of `archive/docs/SESSION-rust-port-architecture.md`. Sunset trigger (Q4): on 1.0 ship with parity stable across N consecutive zero-divergence releases, `git mv packages/legacy-pure-ts → archive/legacy-pure-ts/` and the shim drops the legacy fallback.

### Browser / Node / Universal subpath convention (TS)

Public TS APIs are split into three tiers so browser and Node consumers pull only runnable code:

- **Universal default** (`@graphrefly/graphrefly`, `@graphrefly/graphrefly/extra`, `@graphrefly/graphrefly/patterns/<domain>`) — browser + Node safe. Zero `node:*` imports, zero DOM globals.
- **Node-only** (`@graphrefly/graphrefly/extra/node`, `@graphrefly/graphrefly/patterns/<domain>/node`) — may import `node:*`. Use for `fileStorage`, `sqliteStorage`, `fromGitHook`, `fromFSWatch`, the node `fallbackAdapter` variant, etc.
- **Browser-only** (`@graphrefly/graphrefly/extra/browser`, `@graphrefly/graphrefly/patterns/<domain>/browser`) — may use DOM globals. Use for `indexedDbStorage`, `webllmAdapter`, `chromeNanoAdapter`, browser cascade presets.

The build enforces this via `assertBrowserSafeBundles` in `packages/legacy-pure-ts/tsup.config.ts` `onSuccess` — any universal entry that transitively imports a Node builtin fails the build with a `via X → Y → Z` chain. Adding a new subpath requires updating BOTH `packages/legacy-pure-ts/tsup.config.ts` `ENTRY_POINTS` (+ `nodeOnlyEntries` when Node-only) AND `packages/legacy-pure-ts/package.json` `exports`, then mirroring the entry in the root shim (`tsup.config.ts` + `package.json` `exports` + a one-liner `src/<subpath>.ts`). See `docs/docs-guidance.md` § "Browser / Node / Universal split" for the full convention.

**Python (`graphrefly-py`):**
- `src/graphrefly/core/` — message protocol, `node` primitive, batch, sugar constructors (Phase 0)
- `src/graphrefly/graph/` — `Graph` container, describe/observe, snapshot (Phase 1+)
- `src/graphrefly/extra/` — operators, sources, data structures, resilience (Phase 2–3)
- `src/graphrefly/patterns/` — domain-layer APIs: orchestration, messaging, memory, AI, CQRS, reactive layout (Phase 4+)
- `src/graphrefly/compat/` — async runners: asyncio, trio (Phase 5+)
- `src/graphrefly/integrations/` — framework integrations: FastAPI (Phase 5+)

## Design invariants (spec §5.8–5.12)

These are non-negotiable across all implementations. Validate every change against them.

*Summary; canonical text in `~/src/graphrefly/GRAPHREFLY-SPEC.md` §5.8–5.12. Treat that as the authority if anything below disagrees.*

1. **No polling.** State changes propagate reactively via messages. Never poll a node's value on a timer or busy-wait for status. Use reactive timer sources (`fromTimer`/`from_timer`, `fromCron`/`from_cron`) instead.
2. **No imperative triggers.** All coordination uses reactive `NodeInput` signals and message flow through topology. No event emitters, callbacks, or `setTimeout`/`threading.Timer` + `set()` workarounds. If you need a trigger, it's a reactive source node.
3. **No raw async primitives in the reactive layer.** TS: no bare `Promise`, `queueMicrotask`, `setTimeout`, or `process.nextTick`. PY: no bare `asyncio.ensure_future`, `asyncio.create_task`, `threading.Timer`, or raw coroutines. Async boundaries belong in sources (`fromPromise`/`from_awaitable`, `fromAsyncIter`/`from_async_iter`) and the runner layer, not in node fns or operators.
4. **Central timer and `messageTier`/`message_tier` utilities.** TS: use `clock.ts` for all timestamps. PY: use `clock.py`. Use `messageTier`/`message_tier` utilities for tier classification — never hardcode type checks for checkpoint or batch gating.
5. **Phase 4+ APIs must be developer-friendly.** Domain-layer APIs (orchestration, messaging, memory, AI, CQRS) use sensible defaults, minimal boilerplate, and clear errors. Protocol internals (`DIRTY`, `RESOLVED`, bitmask) never surface in primary APIs — accessible via `.node()` or `inner` when needed.

## Time utility rule

- **TS:** all timestamps go through `src/core/clock.ts`. Internal/event-order durations: `monotonicNs()`. Wall-clock attribution: `wallClockNs()`.
- **PY:** same rule with `src/graphrefly/core/clock.py`. Functions: `monotonic_ns()` and `wall_clock_ns()`.

## Auto-checkpoint trigger rule

- For persistence auto-checkpoint behavior, gate saves by `messageTier`/`message_tier >= 3`.
- Do not describe this as DATA/RESOLVED-only; terminal/teardown lifecycle tiers are included.

## Debugging composition (mandatory procedure)

When debugging OOM, infinite loops, silent failures, or unexpected values in composed factories, follow the **"Debugging composition"** section in `~/src/graphrefly/COMPOSITION-GUIDE.md`. That is the single source of truth for the procedure. Do not skip or improvise around it.

## Dry-run equivalence rule

**Dry-run must be behaviorally identical to the real run except for the actual LLM wire call.** Every observability surface the real run exercises — stage trace, budget stream, `graph.describe`, `graph.explain`, `observe`, stats readouts — must also be exercised in dry-run on the same graph topology. Regressions in `describe`/`explain`/`observe` or in graph wiring must surface in dry-run BEFORE the user pays for a real run.

When building an example or demo that has a dry-run path:
- Construct the exact same graph as the real run; only the adapter differs (shipped `dryRunAdapter` or a shaped mock swapped in via `withDryRun`).
- Call every inspection / explainability method the real run calls. If the real run prints a causal chain, so must dry-run. If the real run subscribes to `budget.totals`, so must dry-run (totals at zero is fine — presence is the point).
- On regression, exit non-zero from dry-run with a diagnostic so the user sees the bug *before* the confirmation prompt.
- Inspection tools to reach for first (all shipped): `graph.describe({ format: "pretty" | "mermaid" | "d2" })`, `graph.explain(from, to)`, `graph.observe(path)`, `reachable(graph, from)`, `graphProfile(graph)`, `harnessProfile(graph)`. If you need a new inspection tool that isn't in this list, flag it in `docs/optimizations.md` as a library candidate before shipping ad-hoc scripts.

## Python-specific invariants

- **Thread safety:** Design for GIL and free-threaded Python. Per-subgraph `RLock`, per-node `_cache_lock`. Core APIs documented as thread-safe (see roadmap Phase 0.4).
- **No `async def` / `Awaitable` in public APIs.** All public functions return `Node[T]`, `Graph`, `None`, or a plain synchronous value.
- **Diamond resolution** via unlimited-precision Python `int` bitmask (TS uses `Uint32Array` + `BigInt` for fan-in >31).
- **Context managers:** PY uses `with batch():` instead of TS's `batch(() => ...)`.
- **`|` pipe operator:** PY `Node.__or__` maps to TS `pipe()`.

## Claude skills (workflows)

Project-local skills live under `.claude/skills/`. These skills operate on **both** TS and PY repos when relevant:

- **dev-dispatch** — plan, align with spec, implement, self-test
- **qa** — adversarial review, fixes, test + lint + build, doc touch-ups
- **design-review** — Q5–Q9 design lens (abstraction, long-term shape, reactive composability, alternatives, coverage). Use BEFORE coding for new primitives; complementary to `/qa` (which finds bugs in landed code).
- **parity** — cross-language parity check (TS vs PY)

Invoke via the user's Claude Code slash commands or skill names when relevant.
