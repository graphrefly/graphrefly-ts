# graphrefly-ts — agent context

**GraphReFly** — reactive graph protocol for human + LLM co-operation. This package is the TypeScript implementation (`@graphrefly/graphrefly-ts`).

## Canonical references (read these)

| Doc | Role |
|-----|------|
| `~/src/graphrefly/GRAPHREFLY-SPEC.md` | **Behavior spec** — messages, `node`, `Graph`, invariants |
| `docs/roadmap.md` | Phased implementation checklist |
| `docs/optimizations.md` | Cross-language notes, open design decisions |
| `docs/test-guidance.md` | How to write and organize tests |
| `docs/demo-and-test-strategy.md` | Demo plans, acceptance criteria, test layers |

## Sibling repos

| Repo | Path | Role |
|------|------|------|
| `graphrefly-py` | `~/src/graphrefly-py` | Python implementation (must stay in parity) |
| `graphrefly` (spec) | `~/src/graphrefly` | Contains `GRAPHREFLY-SPEC.md` (behavior authority) |
| `callbag-recharge` | `~/src/callbag-recharge` | Predecessor (patterns/tests, NOT spec authority) |

## Layout

- `src/core/` — message protocol, `node` primitive, batch, sugar constructors (Phase 0)
- `src/graph/` — `Graph` container, describe/observe, snapshot (Phase 1+)
- `src/extra/` — operators and sources (Phase 2+)
- `src/patterns/` — domain layer factories (Phase 4+)

## Commands

```bash
pnpm test          # vitest run
pnpm run lint      # biome check
pnpm run lint:fix  # biome check --write
pnpm run build     # tsup
```

## Key invariants

- Messages are always `[[Type, Data?], ...]` — no single-message shorthand.
- DIRTY before DATA/RESOLVED in two-phase push; batch defers DATA, not DIRTY.
- Unknown message types forward — do not swallow.
- No `Promise<T>` in public API return types — use `Node<T>` or void.
- Use `src/core/clock.ts` for timestamps (`monotonicNs()` for event order, `wallClockNs()` for attribution).
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` is the behavior authority, not the TS or Python code.

## Agent skills

Project-local skills live under `.gemini/skills/`:

- **dev-dispatch** — implement feature/fix with planning, spec alignment, and self-test. Always halts for approval before implementing.
- **parity** — cross-language parity check against `graphrefly-py` (read-only until approved)
