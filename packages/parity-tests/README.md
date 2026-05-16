# @graphrefly/parity-tests

Cross-implementation parity test runner for the GraphReFly Rust port.

## Phase 13.9.A interim shape (current)

Parameterized vitest runner via `describe.each(impls)`. The set of impls in
`impls/registry.ts` widens per Rust-milestone close:

| Milestone | Impls registered | Notes |
|---|---|---|
| Phase 13.9.A cleave | `[pureTsImpl]` | rust arm deferred until `@graphrefly/native` publishes |
| **Phase E rustImpl activation (D074, 2026-05-07)** | **`[pureTsImpl, rustImpl]` when `@graphrefly/native` is built locally; otherwise `[pureTsImpl]`** | **All scenario tests are now async-shaped per D077; legacy wraps in `Promise.resolve()`. Rust arm activates after `pnpm --filter @graphrefly/native build` produces the host `.node` artifact.** |
| M2 Slice E close (Graph container) | + Graph constructor, mount/unmount, describe, observe, snapshot scenarios | shim swap-over for Graph topology |
| M3 Slice C-1 transform (landed 2026-05-06) | + `scenarios/operators/transform.test.ts` (8 scenarios — map/filter/scan/reduce/distinctUntilChanged/pairwise) | substrate landed in `graphrefly-operators`; rust arm activates with napi operator wiring |
| M3 Slice C-2 combinator (landed 2026-05-06) | + `scenarios/operators/combine.test.ts` (6 scenarios — combine/withLatestFrom/merge) | substrate landed in `graphrefly-operators`; rust arm activates with napi operator wiring |
| M3 close (✅ active 2026-05-07) | + flow / subscription / higher-order operators | substrate landed; rust arm activates per Phase E above |
| M4 close | + storage tier dispatch (Node-only) | shim swap-over for storage |
| M5 close | + reactive data structures + Phase 14 op-log changesets | shim swap-over for structures |
| N1 infra behavioral parity (Finding 8, 2026-05-15) | + `scenarios/core/n1-infra.test.ts` — `sha256Hex` (UTF-8 string/`Uint8Array` encoding contract), `RingBuffer` (drop-oldest FIFO eviction), `ResettableTimer` (`pending`/cancel/reset-supersede) cross-impl | closes the "N1 `as Impl` cast enforces *presence* but no scenario asserts *behavior*" gap. `describeNode` rust-skipped/deferred — Core-projection shape diverges from pure-ts `DescribeNodeOutput` by design (see `~/src/graphrefly-rs/docs/porting-deferred.md` § "Option C … known limitations" → describeNode); a field-equality assertion would be a false regression. |
| M6 close | + cross-language traces (TS ↔ PY ↔ Rust) | requires Phase 13.9.B harness |
| 1.0 ship | (full surface) | sunset trigger for `@graphrefly/pure-ts` |

## Async-shaped Impl interface (D077)

Phase E (2026-05-07) widened `Impl` so every dispatcher-touching method
returns a `Promise`. The legacy impl wraps its sync API in
`Promise.resolve()` (negligible overhead); the rust impl exposes the
napi async methods directly.

**Sink-completion semantics:** `await impl.subscribe(cb)` resolves
AFTER the handshake's sink callback has fired (per the rust binding's
`bridge_sync_unit` discipline). So `expect(seen).toContain(initial)`
works synchronously after the await.

**`@graphrefly/native` build:** wired into the workspace via
`packages/parity-tests/package.json` as a `link:` dependency to
`../../../graphrefly-rs/crates/graphrefly-bindings-js`. Run
`pnpm --filter @graphrefly/native build` (requires `@napi-rs/cli` +
the local Rust toolchain) before `pnpm test:parity` for the rust arm
to activate. If the `.node` artifact isn't found, `rustImpl` is `null`
and the registry filters it out — scenarios run against legacy only,
no test failures from the missing arm.

**Skipped scenarios (Phase E carry-forward):** reactive describe /
observe-all-reactive / `g.derived(name, deps, fn)` with arbitrary JS
fn / cross-Core mount. See `~/src/graphrefly-rs/docs/porting-deferred.md`
"Phase E rustImpl activation — carry-forward divergences" for details.

Divergences fail loud and gate main-branch merges. The CI parity job
materializes once the rust arm activates — until then, `pnpm test` from this
package is equivalent to running the (narrow) parity scenarios against
pure-ts only.

## Parity scenarios are the consumer-pressure signal (D196, locked 2026-05-14)

Per `archive/docs/SESSION-rust-port-layer-boundary.md` Unit 4 (Q9.1 = B), this
repo's scenarios are the **canonical pressure signal** that triggers napi
widening on the Rust side. A Rust-core substrate surface gets a napi binding
when EITHER:

1. A non-pattern JS/TS consumer materializes outside the parity-tests harness,
   OR
2. A scenario in `scenarios/<layer>/<feature>.test.ts` exercises it
   cross-impl via `describe.each(impls)`.

If you're authoring a scenario that references a Rust-core symbol whose napi
binding doesn't yet exist:

- Confirm the symbol is **substrate** per the layering predicate in
  `~/src/graphrefly-rs/CLAUDE.md` § "Layering predicate — substrate vs
  presentation". Presentation symbols never enter `impls/types.ts` `Impl`
  and never bind to napi.
- If substrate: file (or update) the corresponding entry in
  `~/src/graphrefly-rs/docs/porting-deferred.md` so the binding work is
  visible in the next-slice candidate list.
- Until the binding lands, narrow the scenario to the legacy arm with a
  comment pointing at the gating Rust deferred-item ID (F18, F20, F24, etc.).
  When the binding lands, drop the gate and the scenario activates
  cross-impl.

This is why F18 (`ReactiveLog::view`/`scan`/`attach`) and F20
(`ReactiveIndex::range_by_primary`) stay deferred — no parity scenario
exercises them yet, even though the Rust substrate is shipped. The honest
reason for "no binding" is "no parity scenario," not "no consumer pressure."

Presentation symbols (everything in `@graphrefly/graphrefly` per the
three-package install-time model — `patterns/*`, `extra/io/*`,
`extra/composition/*` except `stratify`, `extra/mutation/*`,
`extra/sources/event/{fromEvent, fromRaf}`, graph-sugar, `compat/*`)
are **not part of the substrate contract**. They get their own parity
scenarios parameterized via the two substrate impls — but they never become
methods on `Impl` themselves; instead, scenarios import them directly from
`@graphrefly/graphrefly` while reaching for substrate via `impl.*`.

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
    legacy.ts       — pure-ts arm
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
