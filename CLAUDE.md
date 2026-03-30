# graphrefly-ts — agent context

**GraphReFly** — reactive graph protocol for human + LLM co-operation. This package is the TypeScript implementation (`@graphrefly/graphrefly-ts`).

## Canonical references (read these)

| Doc | Role |
|-----|------|
| `~/src/graphrefly/GRAPHREFLY-SPEC.md` | **Behavior spec** — messages, `node`, `Graph`, invariants |
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
- `src/extra/` — operators and sources (Phase 2+)

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
