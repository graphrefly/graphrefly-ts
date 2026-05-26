# @graphrefly/pure-ts

**Pure-TypeScript substrate for GraphReFly. Permanent first-class peer alongside `@graphrefly/native` — pick one at install time.**

This package is the pure-TypeScript implementation of the substrate that GraphReFly's reactive primitives, `Graph` container, operators, sources, data structures, and storage tiers are built on. It is the sole working **sync** substrate for `@graphrefly/graphrefly` (the presentation package); `@graphrefly/native` is its **async** Rust sibling shipping the same `Impl` contract via napi.

## Lifecycle

- **Status:** permanent first-class peer (D084, 2026-05-08; D198 install-time model, 2026-05-14; D206 sync-substrate role, 2026-05-15).
- **Not a frozen oracle.** Feature parity with the native sibling is maintained indefinitely; new substrate primitives land here in lockstep with the Rust port. The pure-ts tests are still the highest-fidelity behavior oracle for parity (`packages/parity-tests/` runs cross-arm scenarios over both), but pure-ts is also a real shipping substrate, not a sunset target.
- **Supported runtimes:** browser + Node — universal subpath entries are guaranteed to import zero `node:*` builtins (enforced by `assertBrowserSafeBundles` in `tsup.config.ts`). Node-only subpaths live under `extra/node` + `extra/storage/node`; browser-only under `extra/browser` + `extra/storage/browser`.

## Why this exists (D084 → D198, locked 2026-05-08 / 2026-05-14)

See `archive/docs/SESSION-rust-port-architecture.md` Part 12, the `docs/implementation-plan.md` "Three-package install-time model" section, and `docs/rust-port-decisions.md` D198/D206 for the architectural narrative. Short version:

1. The substrate (core protocol, `Graph`, operators, sources, data structures, storage tiers) is portable to Rust; presentation (io adapters, AI patterns, composition helpers, framework adapters) stays in TS. The cleave was executed 2026-05-15 (Cleave A, D193).
2. Consumers pick a substrate provider at **install time**, not at runtime. Install `@graphrefly/pure-ts` (default) OR redirect to `@graphrefly/native` via npm/pnpm `overrides`. Both packages MUST expose the same public API — enforced cross-arm by `packages/parity-tests/`.
3. `@graphrefly/native` is napi-only (Node). `@graphrefly/pure-ts` is the universal fallback — browser, Node, sandboxed runtimes. A future `@graphrefly/wasm` is deferred until a consumer surfaces (D196 consumer-pressure gate).

## What consumers should use

**You probably want `@graphrefly/graphrefly`**, which re-exports this package's surface alongside its own presentation layer. Use `@graphrefly/pure-ts` directly only if you want the substrate without the presentation layer (e.g. a minimal browser embed) or you're authoring a parity-test scenario.

## Public API

The exports map mirrors `@graphrefly/graphrefly`'s substrate surface exactly. Subpaths:

| Subpath | Contents |
|---|---|
| `@graphrefly/pure-ts` | Universal default — full substrate that's safe in browser + Node. |
| `@graphrefly/pure-ts/core` | `node` primitive, `Graph`-bound sugar (`state`/`derived`/`effect`/`producer` as Graph methods), `batch`, `Actor`, `policy`, clock. |
| `@graphrefly/pure-ts/graph` | `Graph` container — `describe` / `observe` / `snapshot` / `restoreSnapshot` / `mount` / `attachSnapshotStorage`. |
| `@graphrefly/pure-ts/extra` | Universal operators, sync sources, data structures (`reactiveMap` / `reactiveList` / `reactiveIndex` / `reactiveLog`), `kvStorage`, `cascadingCache`. |
| `@graphrefly/pure-ts/extra/operators`, `…/sources`, `…/storage` | Subset re-exports for tighter bundles. |
| `@graphrefly/pure-ts/extra/node` | Node-only sources/storage (`fileKv`, `sqliteKv`, etc.). May import `node:*`. |
| `@graphrefly/pure-ts/extra/browser` | Browser-only sources/storage (`indexedDbKv`, etc.). May use DOM globals. |
| `@graphrefly/pure-ts/extra/storage/wal` | Write-ahead-log replay path (D082). |
| `@graphrefly/pure-ts/testing` | Test helpers (only for consumers writing parity / regression suites). |

The parity contract that both substrate peers must satisfy is the `Impl` interface in `packages/parity-tests/impls/types.ts`. Widening it is a public API decision logged in `docs/cross-track-ledger.md`.

## Source layout

```
src/
  core/       — message protocol, `node`, batch, Actor, policy, clock, versioning
  core/_internal/ — substrate-internal utilities (ring-buffer, sizeof, timer)
  graph/      — Graph container, describe/observe/snapshot, storage attachment
  extra/operators/        — 70+ universal operators (transform, combine, timing, …)
  extra/sources/sync/     — `fromIter`, `of`, `empty`, `never`, `throwError`, `cached`, `replay`
  extra/sources/event/timer — `fromTimer`
  extra/sources/async     — `fromPromise`, `fromAsyncIter`, `fromAny`
  extra/data-structures/  — reactiveMap/List/Index/Log, pubsub
  extra/storage/          — kvStorage, cascadingCache, content-addressed, WAL
  extra/composition/      — stratify, topology-diff, pubsub (substrate-portable composition)
```

Presentation-only modules (`patterns/*`, `compat/*`, `extra/io/*`, browser/event sources, render helpers, etc.) live in the root `@graphrefly/graphrefly` package, not here. The classification predicate is documented in `~/src/graphrefly-rs/CLAUDE.md` § "Layering predicate — substrate vs presentation".

## Build

```bash
pnpm --filter @graphrefly/pure-ts build
pnpm --filter @graphrefly/pure-ts test
pnpm --filter @graphrefly/pure-ts test:watch
pnpm --filter @graphrefly/pure-ts bench
```

The `tsup.config.ts` post-build guardrail (`assertBrowserSafeBundles`) fails the build if any universal entry transitively imports `node:*` builtins, with a `via X → Y → Z` chain in the error message. Adding a new subpath requires updating BOTH `packages/pure-ts/tsup.config.ts` `ENTRY_POINTS` (+ `nodeOnlyEntries` when Node-only) AND `packages/pure-ts/package.json` `exports`, then mirroring the entry in the root shim. See `docs/docs-guidance.md` § "Browser / Node / Universal split" in the repo root.
