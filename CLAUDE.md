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
| `docs/optimizations.md` | **Active backlog** — open work items, anti-patterns, deferred follow-ups, proposed improvements. Add new items here. |
| `archive/optimizations/` | **Optimizations archive** — built-in optimizations, resolved design decisions, cross-language parity notes. Check before introducing new optimizations or debugging perf issues. **Backlog/proposed items belong in `docs/optimizations.md`, not here.** |
| `docs/roadmap.md` | Phased implementation checklist (covers both TS and PY) |
| `docs/docs-guidance.md` | How to document APIs and long-form docs (covers both TS and PY) |
| `docs/test-guidance.md` | How to write and organize tests (covers both TS and PY) |
| `archive/docs/SESSION-graphrefly-spec-design.md` | Design history and migration from callbag-recharge |
| `archive/docs/SESSION-reactive-collaboration-harness.md` | **Active** — 7-stage reactive collaboration loop (INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT), gate port from callbag-recharge, `promptNode` factory, `valve` rename, strategy model (`rootCause × intervention → successRate`), `harnessLoop()` factory. Source of truth for §9.0. |
| `archive/docs/SESSION-harness-engineering-strategy.md` | **Active** — harness engineering category positioning, 8-requirement coverage analysis, GraphReFly vs LangGraph, three-wave announcement plan, MCP Server as distribution priority. Source of truth for §9.1–9.7 direction. |
| `archive/docs/SESSION-marketing-promotion-strategy.md` | **Active** — positioning pillars (pain-point-first), wave-based announcement plan, pain-point reply marketing playbooks, xiaohongshu strategy, Future AGI competitive intel (§16), prompt optimization algorithm analysis (§17), blog content plan (§18). Source of truth for public-facing copy. |

## Commands

**TypeScript (this repo):**
```bash
pnpm test          # vitest run
pnpm run lint      # biome check
pnpm run lint:fix   # biome check --write
pnpm run build     # tsup
```

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

**TypeScript (`graphrefly-ts`):**
- `src/core/` — message protocol, `node` primitive, batch, sugar constructors (Phase 0)
- `src/graph/` — `Graph` container, describe/observe, snapshot (Phase 1+)
- `src/extra/` — operators, sources, data structures, resilience (Phase 2–3)
- `src/patterns/` — domain-layer APIs: orchestration, messaging, memory, AI, CQRS, reactive layout (Phase 4+)
- `src/compat/` — framework adapters: NestJS (Phase 5+)

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
- **parity** — cross-language parity check (TS vs PY)

Invoke via the user's Claude Code slash commands or skill names when relevant.
