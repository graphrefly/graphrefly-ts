# graphrefly — unified agent context

**GraphReFly** — reactive graph protocol for human + LLM co-operation. This repo (`graphrefly-ts`) is the **single source of truth** for operational docs, skills, roadmap, and optimization records across both the TypeScript and Python implementations.

## Canonical references (read these)

| Doc | Role |
|-----|------|
| `~/src/graphrefly/GRAPHREFLY-SPEC.md` | **Behavior spec** — messages, `node`, `Graph`, invariants |
| `docs/roadmap.md` | Phased implementation checklist (covers both TS and PY) |
| `docs/optimizations.md` | Cross-language notes, open design decisions |
| `docs/test-guidance.md` | How to write and organize tests (both TS and PY) |
| `docs/demo-and-test-strategy.md` | Demo plans, acceptance criteria, test layers |

## Repos

| Repo | Path | Role |
|------|------|------|
| **graphrefly-ts** | this repo | TypeScript implementation + **all operational docs** |
| **graphrefly-py** | `~/src/graphrefly-py` | Python implementation (must stay in parity) |
| **graphrefly** (spec) | `~/src/graphrefly` | `GRAPHREFLY-SPEC.md`, `COMPOSITION-GUIDE.md` |
| **callbag-recharge** | `~/src/callbag-recharge` | TS predecessor (patterns/tests, NOT spec authority) |
| **callbag-recharge-py** | `~/src/callbag-recharge-py` | PY predecessor (concurrency patterns) |

## Layout

**TypeScript (`graphrefly-ts`):**
- `src/core/` — message protocol, `node` primitive, batch, sugar constructors (Phase 0)
- `src/graph/` — `Graph` container, describe/observe, snapshot (Phase 1+)
- `src/extra/` — operators and sources (Phase 2+)
- `src/patterns/` — domain layer factories (Phase 4+)

**Python (`graphrefly-py`):**
- `src/graphrefly/core/` — message protocol, `node` primitive, batch, sugar constructors
- `src/graphrefly/graph/` — `Graph` container, describe/observe, snapshot
- `src/graphrefly/extra/` — operators and sources
- `src/graphrefly/patterns/` — domain layer factories
- `src/graphrefly/compat/` — async runners: asyncio, trio

## Commands

**TypeScript:**
```bash
pnpm test          # vitest run
pnpm run lint      # biome check
pnpm run lint:fix  # biome check --write
pnpm run build     # tsup
```

**Python:**
```bash
uv run pytest                          # tests
uv run ruff check src/ tests/         # lint
uv run ruff check --fix src/ tests/   # lint fix
uv run mypy src/                       # type check
```

## Key invariants

- Messages are always `[[Type, Data?], ...]` (TS) / `list[tuple[Type, Any] | tuple[Type]]` (PY) — no single-message shorthand.
- DIRTY before DATA/RESOLVED in two-phase push; batch defers DATA, not DIRTY.
- Unknown message types forward — do not swallow.
- TS: No `Promise<T>` in public API return types. PY: No `async def` / `Awaitable`.
- TS: Use `src/core/clock.ts`. PY: Use `src/graphrefly/core/clock.py`. (`monotonicNs()`/`monotonic_ns()` for event order, `wallClockNs()`/`wall_clock_ns()` for attribution).
- PY: Thread safety mandatory. Per-subgraph `RLock`.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` is the behavior authority, not the TS or Python code.

## Agent skills

Project-local skills live under `.gemini/skills/`:

- **dev-dispatch** — implement feature/fix with planning, spec alignment, and self-test. Always halts for approval before implementing. Works on both TS and PY.
- **parity** — cross-language parity check (TS vs PY, read-only until approved)
