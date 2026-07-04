# TypeScript Docs

This directory contains package-local documentation for the TypeScript
implementation, `@graphrefly/ts`.

The local policy is `docs/docs.jsonl`. The language-neutral authority lives in
`~/src/graphrefly`: protocol rules, decisions, conformance scenarios, formal
models, guide records, public website architecture, blog, and dashboard/control
views.

## Current Scope

This repo owns:

- `@graphrefly/ts` install, package, and release guidance.
- TypeScript public API JSDoc and generated TypeScript API reference artifacts.
- TypeScript examples and demos.
- Package-local docs automation.
- Local tombstones for retired TypeScript packages or demos when they prevent
  accidental revival.

This repo does not own:

- The shared `graphrefly.dev` website shell.
- Shared public docs architecture or blog content.
- Python or Rust package docs.
- Language-neutral protocol, decision, guide, conformance, or dashboard records.

## Active Local Docs

| File | Role |
| --- | --- |
| `docs.jsonl` | Package-local docs policy and verification contract. |
| `known-issues.md` | Local tombstones and resolved package-specific issues. |
| `coming-from-rxjs.md` | Package-local migration guide for TypeScript users. |
| `benchmark.md` | TypeScript benchmark guidance. |
| `test-guidance.md` | Historical test guidance; prefer `~/src/graphrefly/guide/` and current package tests when they differ. |

## Historical Records

Older planning, audit, implementation, and Rust-port files remain here as
history. They are not clean-slate authority and must not be used to revive the
old root package, pure-ts package, structural `Impl` parity, cross-track-ledger
workflow, old port model, or TypeScript-owned public website model.

Examples include:

- `implementation-plan*.md`
- `implementation-plan-DS-13.5/`
- `audit-plan.md`
- `batch-review/`
- `roadmap.md`
- `optimizations.md`
- `cross-track-ledger.md`
- `rust-port-decisions.md`
- `rust-port-quality-strategy.md`

When current work needs a decision, protocol rule, guide, or sequencer update,
edit `~/src/graphrefly` through the appropriate flow instead of updating these
historical records as authority.

## Generated Docs

Generated TypeScript API pages are emitted by
`website/scripts/gen-api-docs.mjs` from `packages/ts` exports and source JSDoc.
Do not hand-edit generated API pages or the generated sidebar.

```bash
pnpm run docs:gen
pnpm run docs:gen:check
pnpm run docs:gen:missing
```
