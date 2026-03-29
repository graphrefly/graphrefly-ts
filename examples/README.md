# examples/

Runnable examples using the public `@graphrefly/graphrefly-ts` API. This directory is the **single source of truth for all library demo code** (Tier 2 in `docs/docs-guidance.md`).

## Rules

- Each file is self-contained and imports from `@graphrefly/graphrefly-ts` (public package name).
- Recipe pages and interactive demos **import from here** — never duplicate code inline.
- Keep examples focused: one concept per file, named descriptively (`basic-counter.ts`, `combine-sources.ts`).

## Running

```bash
pnpm exec tsx examples/<name>.ts
```
