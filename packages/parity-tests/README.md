# @graphrefly/parity-tests

Cross-implementation parity test runner for the GraphReFly Rust port.

## Phase 13.9.A interim shape (current)

Parameterized vitest runner via `describe.each(impls)`. The set of impls in
`impls/registry.ts` widens per Rust-milestone close:

| Milestone | Impls registered | Notes |
|---|---|---|
| Phase 13.9.A cleave (now) | `[legacyImpl]` | rust arm deferred until `@graphrefly/native` publishes |
| `@graphrefly/native` first publish | `[legacyImpl, rustImpl]` | activates per-Rust-milestone surface coverage below |
| M2 Slice E close (Graph container) | + Graph constructor, mount/unmount, describe, observe, snapshot scenarios | shim swap-over for Graph topology |
| M3 Slice C-1 transform (landed 2026-05-06) | + `scenarios/operators/transform.test.ts` (8 scenarios — map/filter/scan/reduce/distinctUntilChanged/pairwise) | substrate landed in `graphrefly-operators`; rust arm activates with napi operator wiring |
| M3 Slice C-2 combinator (landed 2026-05-06) | + `scenarios/operators/combine.test.ts` (6 scenarios — combine/withLatestFrom/merge) | substrate landed in `graphrefly-operators`; rust arm activates with napi operator wiring |
| M3 close | + remaining operator modules (temporal/flow/switching/gating/resilience) | shim swap-over for operators |
| M4 close | + storage tier dispatch (Node-only) | shim swap-over for storage |
| M5 close | + reactive data structures + Phase 14 op-log changesets | shim swap-over for structures |
| M6 close | + cross-language traces (TS ↔ PY ↔ Rust) | requires Phase 13.9.B harness |
| 1.0 ship | (full surface) | sunset trigger for `@graphrefly/legacy-pure-ts` |

Divergences fail loud and gate main-branch merges. The CI parity job
materializes once the rust arm activates — until then, `pnpm test` from this
package is equivalent to running the (narrow) parity scenarios against
legacy-pure-ts only.

## Phase 13.9.B target shape (deferred)

Trace-record / trace-replay — record an event trace from one impl, assert
byte-equal sequence against the other. Per the rigor-infrastructure Project 2
harness in `archive/docs/SESSION-rigor-infrastructure-plan.md`. That harness
has not landed yet; when it does, `scenarios/**/*.test.ts` migrates from
`describe.each` to trace-record + trace-replay, and the parameterized runner
scaffolding deletes.

See `docs/implementation-plan.md` Phase 13.9.B in the repo root for the
acceptance bar.

## Layout

```
packages/parity-tests/
  impls/
    types.ts        — Impl interface (narrow public surface)
    legacy.ts       — legacy-pure-ts arm
    rust.ts         — rust-via-napi arm (currently null; activates with @graphrefly/native publish)
    registry.ts     — exported set of active impls (filters out null)
  scenarios/
    core/
      dispatcher.test.ts  — M1 push-on-subscribe DATA
    (graph/, operators/, storage/, structures/ — added per milestone close)
```

## Running

```bash
pnpm --filter @graphrefly/parity-tests test
```

From the repo root, this is wired into `pnpm test` and is part of the parity
gate for main-branch merges (see `docs/implementation-plan.md` Phase 13.9
step 6).

## Adding a scenario

1. Pick the layer (`scenarios/core/`, `scenarios/graph/`, …) — create the
   folder if it doesn't exist.
2. Use `describe.each(impls)` to parameterize over all active impl arms.
3. Reference symbols only via `impl.<name>`, not direct imports — that's
   what makes the scenario impl-agnostic.
4. Widen `impls/types.ts` with any new surface you reference. Both the
   legacy and rust arms must populate the new field; if the rust arm can't
   yet, narrow the scenario to the legacy arm with a comment pointing at the
   gating Rust milestone.
