# Batch 18 — Documentation Sweep + Critical Remediation (TS)

Date: 2026-04-10
Scope: `graphrefly-ts` full docs sweep with critical fixes only.
Baseline: `docs/docs-guidance.md`, `docs/roadmap.md`, `docs/batch-review/batch-9.md`

## Audit summary

- COMPLETE — `website/scripts/sync-docs.mjs` outputs are current (`sync-docs:check` passes).
- COMPLETE — Generated API pages are current for registered symbols (`docs:gen:check` passes for all existing symbols).
- FIXED (`website/scripts/gen-api-docs.mjs#REGISTRY`) — removed stale `gate` registry entry that referenced a non-existent export in `src/extra/operators.ts`.
- STALE (`website/src/content/docs/api/gate.md`) — orphan generated page removed because backing export no longer exists.

## Critical findings

1) Registry mismatch (critical)
- Finding: `docs:gen:check` reported `No exported function or class 'gate' found in src/extra/operators.ts`.
- Impact: API generator registry contained a stale entry, causing docs generation warnings and drift from actual public API.
- Resolution: Remove `gate` from TypeScript docs generator registry and remove the orphan generated page.

## Command verification

Executed in `graphrefly-ts`:

```bash
pnpm --dir website sync-docs:check
pnpm --dir website docs:gen:check
```

Result after fix:
- `sync-docs:check` passes.
- `docs:gen:check` passes with no missing export warnings.

## Deferred (non-critical)

- MISSING (deferred) — optional style-level JSDoc refinements not affecting docs generation or API correctness.
