# graphrefly-ts — agent context

**GraphReFly** — reactive graph protocol for human + LLM co-operation. This package is the TypeScript implementation (`@graphrefly/graphrefly-ts`).

## Canonical references (read these)

| Doc | Role |
|-----|------|
| `~/src/graphrefly/GRAPHREFLY-SPEC.md` | **Behavior spec** — messages, `node`, `Graph`, invariants |
| `~/src/graphrefly/COMPOSITION-GUIDE.md` | **Composition guide** — insights, patterns, recipes for Phase 4+ factory authors. **Read before building factories that compose primitives.** Covers: lazy activation, subscription ordering, null guards, feedback cycles, promptNode SENTINEL, wiring order. |
| `~/src/graphrefly/composition-guide.jsonl` | Machine-readable composition entries (appendable) |
| `archive/optimizations/` | **Optimizations archive** — built-in optimizations, resolved design decisions, cross-language parity notes, proposed improvements. Check before introducing new optimizations or debugging perf issues. |
| `docs/roadmap.md` | Phased implementation checklist |
| `docs/docs-guidance.md` | How to document APIs and long-form docs |
| `docs/test-guidance.md` | How to write and organize tests |
| `archive/docs/SESSION-graphrefly-spec-design.md` | Design history and migration from callbag-recharge |

## Predecessor repo (help, not spec)

The **callbag-recharge** codebase at **`~/src/callbag-recharge`** is the mature predecessor (operators, tests, docs site patterns). Use it when you need:

- Analogous **operator** behavior, edge cases, or regression ideas
- **Test** structure inspiration (adapt to GraphReFly APIs and message tuples)
- **Documentation** pipeline ideas (`docs/docs-guidance.md` defers to that repo where graphrefly-ts has not yet added the same tooling)

**Do not** treat callbag-recharge as the authority for GraphReFly behavior. Always reconcile with `~/src/graphrefly/GRAPHREFLY-SPEC.md`.

## Layout

- `src/core/` — message protocol, `node` primitive, batch, sugar constructors (Phase 0)
- `src/graph/` — `Graph` container, describe/observe, snapshot (Phase 1+)
- `src/extra/` — operators, sources, data structures, resilience (Phase 2–3)
- `src/patterns/` — domain-layer APIs: orchestration, messaging, memory, AI, CQRS, reactive layout (Phase 4+)
- `src/compat/` — framework adapters: NestJS (Phase 5+)

## Design invariants (spec §5.8–5.12)

These are non-negotiable across all implementations. Validate every change against them.

1. **No polling.** State changes propagate reactively via messages. Never poll a node's value on a timer or busy-wait for status. Use reactive timer sources (`fromTimer`, `fromCron`) instead.
2. **No imperative triggers.** All coordination uses reactive `NodeInput` signals and message flow through topology. No event emitters, callbacks, or `setTimeout` + `set()` workarounds. If you need a trigger, it's a reactive source node.
3. **No raw Promises or microtasks.** Do not use bare `Promise`, `queueMicrotask`, `setTimeout`, or `process.nextTick` to schedule reactive work. Async boundaries belong in sources (`fromPromise`, `fromAsyncIter`) and the runner layer, not in node fns or operators.
4. **Central timer and `messageTier` utilities.** Use `clock.ts` for all timestamps (see rule below). Use `messageTier` utilities for tier classification — never hardcode type checks for checkpoint or batch gating.
5. **Phase 4+ APIs must be developer-friendly.** Domain-layer APIs (orchestration, messaging, memory, AI, CQRS) use sensible defaults, minimal boilerplate, and clear errors. Protocol internals (`DIRTY`, `RESOLVED`, bitmask) never surface in primary APIs — accessible via `.node()` or `inner` when needed.

## Time utility rule

- Use `src/core/clock.ts` utilities for all timestamps.
- Internal/event-order durations must use `monotonicNs()`.
- Wall-clock attribution payloads must use `wallClockNs()`.
- Do not call `Date.now()` / `performance.now()` directly outside `core/clock.ts`.

## Auto-checkpoint trigger rule

- For persistence auto-checkpoint behavior, gate saves by `messageTier >= 2`.
- Do not describe this as DATA/RESOLVED-only; terminal/teardown lifecycle tiers are included.

## Commands

```bash
pnpm test          # vitest run
pnpm run lint      # biome check
pnpm run lint:fix   # biome check --write
pnpm run build     # tsup
```

## Claude skills (workflows)

Project-local skills live under `.claude/skills/`:

- **dev-dispatch** — plan, align with spec, implement, self-test (`pnpm test`)
- **qa** — adversarial review, fixes, `pnpm test` + lint + build, doc touch-ups

Invoke via the user's Claude Code slash commands or skill names when relevant.
