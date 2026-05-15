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
| `archive/docs/SESSION-DS-14.5-A-narrative-reframe.md` | **Active (canonical post-2026-05-04)** — spec-as-projection reframe, multi-agent subgraph ownership protocol (L0–L3 staircase), catalog reframed as user-host concern, Wave 2 narrative shift away from "harness builder". L1–L8 + Q1–Q10 locks. **Read this before editing README / Wave 2 launch copy.** |
| `archive/docs/SESSION-DS-14-changesets-design.md` | **Active (locked 2026-05-05)** — universal `BaseChange<T>` envelope, `mutations` companion bundles, `mutate(act, opts)` factory, lifecycle-aware diff restore. Substrate for op-log changesets / worker-bridge wire B / `lens.flow` delta / `reactiveLog.scan` / `restoreSnapshot mode "diff"`. Source of truth for Phase 14 implementation. |
| `archive/docs/SESSION-harness-engineering-strategy.md` | **SUPERSEDED 2026-05-04 by DS-14.5.A** for Wave 2 narrative framing. Original 8-requirement coverage analysis + harness engineering landscape preserved as historical context. New positioning lives in `SESSION-DS-14.5-A-narrative-reframe.md`. |
| `archive/docs/SESSION-marketing-promotion-strategy.md` | **Active** — positioning pillars (pain-point-first), wave-based announcement plan, pain-point reply marketing playbooks, xiaohongshu strategy, Future AGI competitive intel (§16), prompt optimization algorithm analysis (§17), blog content plan (§18). Source of truth for public-facing copy. **Wave 2 framing should rebase on DS-14.5.A.** |

## Commands

**TypeScript (this repo) — post-Phase-13.9.A cleave:**
```bash
pnpm test                  # pure-ts test suite + parity-tests
pnpm test:pure-ts          # just packages/pure-ts (~2980 tests)
pnpm test:parity           # just packages/parity-tests
pnpm run lint              # biome check (workspace-wide)
pnpm run lint:fix          # biome check --write
pnpm run build             # pure-ts build → root shim build
pnpm run build:shim        # only the shim (assumes pure-ts already built)
pnpm bench                 # pure-ts vitest bench
```

For watch-mode work inside the pure-ts package: `pnpm --filter @graphrefly/pure-ts test:watch`.

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

**TypeScript (`graphrefly-ts`) — cleave A executed 2026-05-15 (slices A1–A4); install-time model locked 2026-05-14:**

Three published packages with an explicit substrate-vs-presentation split (see "Three-package install-time model" below). **Cleave A is DONE** — see `archive/docs/SESSION-DS-cleave-A-file-moves.md` for the file-move record + post-execution corrections.

- Root `src/` — the **presentation package `@graphrefly/graphrefly`**. Post-cleave it owns the 4-layer structure (`base/ utils/ presets/ solutions/`) + `compat/`, and `src/index.ts` re-exports substrate from `@graphrefly/pure-ts` (peer) for ergonomic single-import UX. Substrate provider is chosen at install time: install `@graphrefly/pure-ts` (default) OR redirect to `@graphrefly/native` via npm/pnpm `overrides` (Q28 lock = option c). Legacy Phase-13.9.A shim folders (`src/{patterns,extra,core,graph,testing}/*`) were deleted — no backward-compat paths.
- `packages/pure-ts/src/` — the **pure-TS substrate implementation**. Permanent first-class peer alongside `@graphrefly/native` (and a future `@graphrefly/wasm` if a consumer surfaces; see Unit 6 note below). Substrate-only post-cleave:
  - `core/` — message protocol, `node` primitive, batch, sugar constructors (Phase 0). `core/_internal/` holds substrate-internal utilities (`ring-buffer`, `sizeof`, `timer`/`ResettableTimer`) used by `graph/` + reactive structures.
  - `graph/` — `Graph` container, describe/observe, snapshot (Phase 1+)
  - `extra/` — operators, sync sources, `sources/event/timer` (`fromTimer`), data structures, storage (Node tiers), `composition/{stratify,topology-diff,pubsub}`, `sources/async` (`fromPromise`/`fromAsyncIter`/`fromAny`), `sources/_keepalive`. **Substrate-vs-presentation classification per `extra/` row is locked in `~/src/graphrefly-rs/CLAUDE.md` § "extra/ row classification"; post-execution corrections to A1 doc Q4/Q7/Q8 are recorded in `archive/docs/SESSION-DS-cleave-A-file-moves.md`.**
  - `patterns/`, `compat/` — **removed from pure-ts.** All `patterns/*` are presentation (D193) and now live in `@graphrefly/graphrefly` (root `src/{utils,presets}/`); `compat/*` moved to root `src/compat/`.
- `packages/parity-tests/` — cross-impl parity scenarios (vitest `describe.each([pureTsImpl, rustImpl])`). Currently pure-ts-only; the rust arm activates when `@graphrefly/native` publishes. See `packages/parity-tests/README.md` for the per-Rust-milestone surface widening schedule + the "parity scenarios are the consumer pressure signal" rule (D196). **`packages/parity-tests/impls/types.ts` `Impl` interface IS the public-API contract** for the substrate peers (`@graphrefly/pure-ts` and `@graphrefly/native`) — widening it is a public API decision.
- `packages/cli` — workspace consumer of `@graphrefly/graphrefly`. Imports presentation (e.g. `SurfaceError`) from the root package barrel; substrate flows through the root shim's `export * from "@graphrefly/pure-ts"`.

### Three-package install-time model (Unit 6 D198, locked 2026-05-14)

| Package | Contains | Build artifact | Substrate or presentation? |
|---|---|---|---|
| `@graphrefly/pure-ts` | Full TS implementation of the Rust-portable substrate: `core/`, `graph/`, `extra/operators/`, `extra/sources/sync` + `fromTimer`, `extra/data-structures/`, `extra/storage/` (Node tiers), `extra/composition/stratify`. | TS only — browser + Node | substrate |
| `@graphrefly/native` | Rust impl of the same substrate via napi. Thin TS wrapper exposes the napi surface. | `.node` binary + TS wrapper | substrate (Node-only) |
| `@graphrefly/graphrefly` | The parts that **never go to Rust**: `patterns/*`, `extra/io/*`, `extra/composition/*` (except `stratify`), `extra/mutation/*`, `extra/sources/event` (`fromEvent`, `fromRaf`), browser sources, graph-sugar (`graph.log/list/map/index`), `compat/*`. | TS only | presentation |

```
@graphrefly/graphrefly  ← presentation only
       │  peerDependency: pick ONE substrate provider
       ▼
@graphrefly/pure-ts   OR   @graphrefly/native
```

Both substrate packages MUST expose the same public API — enforced by `packages/parity-tests/`. **No facade with runtime fallback**: the user picks at install time. Supersedes PART 13 Deferred 1's `optionalDependencies` facade plan. `@graphrefly/wasm` is deferred — adds when a browser-Rust consumer surfaces; until then `@graphrefly/pure-ts` is the universal fallback.

Layering predicate that decides which package gets a new symbol lives in `~/src/graphrefly-rs/CLAUDE.md` § "Layering predicate — substrate vs presentation" (single source of truth, D193).

### 4-layer model inside `@graphrefly/graphrefly` (Unit 8 D200, locked 2026-05-14)

Strict top-down dependency layering (CI-enforced via Biome custom rule, D201):

| Layer | Charter | Examples |
|---|---|---|
| `base/` | **Domain-agnostic infrastructure.** Helpers with NO domain semantics. | io (http/ws/sse/webhook), composition helpers (verifiable, distill, pubsub, backpressure, externalProducer), mutation wrappers (lightMutation, auditLog), worker bridge, browser/runtime sources (fromEvent, fromRaf, fromGitHook, fromFSWatch), meta (domainMeta, keepalive) |
| `utils/` | **Domain building blocks.** Single-purpose factories returning a `Node` or `Graph` (was consolidation-plan's "building blocks"). | messaging (topic, subscription, hub, topicBridge), orchestration (pipelineGraph, approvalGate, humanInput, tracker, classify, catch), cqrs, reduction, memory, ai/{prompts, agents, safety, extractors, adapters}, inspect, harness (stage types, evalSource, beforeAfterCompare) |
| `presets/` | **Opinionated compositions of utils** (≥3 utils typically). Single-factory products. Vocabulary preserved from consolidation plan. | agentLoop, agentMemory, resilientPipeline, harnessLoop, refineLoop, spawnable, inspect (composite), guardedExecution, reactiveFactStore, taggedContextPool, heterogeneousDebate, actorPool |
| `solutions/` | **User-facing packaged products.** Top-level barrel re-exports presets + per-vertical multi-preset starter kits (D202 = (c) both). | `solutions/index.ts` barrel re-exports; vertical folders (`solutions/customer-support-bot/`, `solutions/code-review-agent/`, etc.) deferred until consumer pressure |
| `compat/` | External framework adapters (NestJS, React, Vue, Solid, Svelte, ag-ui translator, a2ui). | sits alongside the 4 layers; depends on solutions/presets/utils/base in top-down order |

Dependency rules:

```
substrate (@graphrefly/pure-ts | @graphrefly/native)
   ▲
   │
base/         (no domain semantics)
   ▲
   │
utils/        (domain building blocks)
   ▲
   │
presets/      (opinionated compositions of utils)
   ▲
   │
solutions/    (user-facing packaged products)
   ▲
   │
compat/       (external framework adapters)
```

Within a layer: free composition (e.g., `utils/orchestration/human-input.ts` may import `utils/messaging/topic.ts` — both utils). Cross-layer: strictly top-down. Circular within-layer rejected. Layer-placement rubric: "zero domain → base; single-domain primitive returning Node/Graph → utils; ≥3 utils composition → preset; ≥2 presets or full vertical with adapters/storage wiring → solution."

Source: `archive/docs/SESSION-rust-port-layer-boundary.md` Units 6, 8 (user-locked 2026-05-14).

### Browser / Node / Universal subpath convention (TS)

Public TS APIs are split into three tiers so browser and Node consumers pull only runnable code:

- **Universal default** (`@graphrefly/graphrefly`, `@graphrefly/graphrefly/extra`, `@graphrefly/graphrefly/patterns/<domain>`) — browser + Node safe. Zero `node:*` imports, zero DOM globals.
- **Node-only** (`@graphrefly/graphrefly/extra/node`, `@graphrefly/graphrefly/patterns/<domain>/node`) — may import `node:*`. Use for `fileStorage`, `sqliteStorage`, `fromGitHook`, `fromFSWatch`, the node `fallbackAdapter` variant, etc.
- **Browser-only** (`@graphrefly/graphrefly/extra/browser`, `@graphrefly/graphrefly/patterns/<domain>/browser`) — may use DOM globals. Use for `indexedDbStorage`, `webllmAdapter`, `chromeNanoAdapter`, browser cascade presets.

The build enforces this via `assertBrowserSafeBundles` in `packages/pure-ts/tsup.config.ts` `onSuccess` — any universal entry that transitively imports a Node builtin fails the build with a `via X → Y → Z` chain. Adding a new subpath requires updating BOTH `packages/pure-ts/tsup.config.ts` `ENTRY_POINTS` (+ `nodeOnlyEntries` when Node-only) AND `packages/pure-ts/package.json` `exports`, then mirroring the entry in the root shim (`tsup.config.ts` + `package.json` `exports` + a one-liner `src/<subpath>.ts`). See `docs/docs-guidance.md` § "Browser / Node / Universal split" for the full convention.

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
