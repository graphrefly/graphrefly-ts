# @graphrefly/legacy-pure-ts

**Frozen pure-TypeScript implementation of GraphReFly. Parity oracle for the Rust port — not for new feature work.**

This package preserves the pure-TS implementation of GraphReFly that was the sole impl through v0.44.0. It exists to drive parity tests against `@graphrefly/native` (the napi-rs binding compiled from `~/src/graphrefly-rs/`) through 1.0, and to serve as a transparent fallback for platforms where the native binding cannot run.

## Lifecycle

- **Status:** frozen at the 0.44.x line.
- **Allowed changes:** parity-fix backports (Rust port surfaces a divergence; fix lands on both impls in lockstep) and spec-amendment lockstep updates (`~/src/graphrefly/GRAPHREFLY-SPEC.md` evolves; both impls move together). No new features. No refactors that don't have a parity-driven reason.
- **Sunset:** removed from the workspace when 1.0 ships parity-stable across N consecutive zero-divergence releases on the parity job. After sunset the package is npm-deprecated (with a pointer to `@graphrefly/graphrefly`) but remains installable for users on banned-native-binary platforms who haven't migrated to WASM.

## Why this exists (Phase 13.9, locked 2026-05-05)

See `archive/docs/SESSION-rust-port-architecture.md` Part 12 (Q1–Q7) and `docs/implementation-plan.md` Phase 13.9 in the repository root for the architectural narrative and the operational sequencing. Short version:

1. The 2780-test suite is the highest-fidelity behavior oracle for the Rust port. Deleting it before 1.0 throws away the most valuable regression-detection asset on the project.
2. The Rust port is mid-migration (M1 closed, M2–M6 ahead). Until each milestone closes, the public package needs a fallback for surfaces the binding doesn't cover yet.

## What consumers should use

**You probably want `@graphrefly/graphrefly`**, which transparently delegates to the right impl per platform. Use `@graphrefly/legacy-pure-ts` directly only if you need the zero-native-dep build pinned (e.g. CI for a sandboxed platform, deterministic supply-chain audit).

## Public API

Identical to `@graphrefly/graphrefly@0.44.x`. See the project README and the `website/` docs for usage. The exports map mirrors the `@graphrefly/graphrefly` exports map exactly.

## Source layout

`src/` — full surface as of v0.44.0: `core/` + `graph/` + `extra/` + `patterns/` + `compat/`. See the project root `CLAUDE.md` for the layered structure. Tests live colocated and under `src/__tests__/`; benches under `src/__bench__/`.

## Build

```bash
pnpm --filter @graphrefly/legacy-pure-ts build
pnpm --filter @graphrefly/legacy-pure-ts test
pnpm --filter @graphrefly/legacy-pure-ts bench
```

The `tsup.config.ts` post-build guardrail (`assertBrowserSafeBundles`) enforces that universal entry points do not transitively import `node:*` builtins. See `docs/docs-guidance.md` § "Browser / Node / Universal split" in the repo root.
