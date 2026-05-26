# Changelog — @graphrefly/pure-ts

## 0.49.0

### Minor Changes

- [`4230039`](https://github.com/graphrefly/graphrefly-ts/commit/4230039498f97be2d5213d76cb8ce8f72a073b9a) Thanks [@clfhhc](https://github.com/clfhhc)! - widen batch bindings

## 0.48.1

## 0.48.0

### Minor Changes

- [`9b3554b`](https://github.com/graphrefly/graphrefly-ts/commit/9b3554b659ccb5aaf1f45dbd1ed933129d691171) Thanks [@clfhhc](https://github.com/clfhhc)! - fix reactive-layout in RN and clear napi

### Patch Changes

- [`cfb1500`](https://github.com/graphrefly/graphrefly-ts/commit/cfb1500250504391683557a0b75cec381ca8e201) Thanks [@clfhhc](https://github.com/clfhhc)! - clean up

## 0.47.2

### Patch Changes

- [`fda9432`](https://github.com/graphrefly/graphrefly-ts/commit/fda94326c6656c27008c2733f305a5c077f8ff09) Thanks [@clfhhc](https://github.com/clfhhc)! - fix legacy cleanup

## 0.47.1

### Patch Changes

- [`76d35c7`](https://github.com/graphrefly/graphrefly-ts/commit/76d35c73eb84a2871ac34907a10a0514674745ca) Thanks [@clfhhc](https://github.com/clfhhc)! - fix dead queue

## 0.47.0

### Minor Changes

- [`f08b7cf`](https://github.com/graphrefly/graphrefly-ts/commit/f08b7cf8b62ad522a1da5c4664ef719e19e5d7f0) Thanks [@clfhhc](https://github.com/clfhhc)! - memo:Re consumer follow-ups (rebuildable-projection story + ergonomics):

  - **`reactiveFactStore`** — opt-in `recordIngest?: boolean` config exposes a
    payload-carrying `ingestLog: ReactiveLogBundle<MemoryFragment<T>>`.
    `attachStorage` it (with `bigintJsonCodecFor`) and replay entries into
    `config.ingest` on restart to rebuild a byte-identical store (cascade
    `validTo` is now deterministically derived from the triggering root).
  - **`appendLogStorage`** — new `mode?: "append" | "overwrite"` option
    (`"append"` default = accumulate/read-merge, unchanged; `"overwrite"` =
    snapshot, replace key per flush). Contradictory JSDoc clarified — it is a
    true logical append log; callers do not need a custom tier.
  - **`ReactiveLogBundle.attach`** — new `attach(upstream, { skipCachedReplay })`
    option to drop the push-on-subscribe cached-replay burst (avoids
    double-counting when attaching after a replay).

  Migration note: `harnessLoop` moved export paths — it is now
  `@graphrefly/graphrefly/presets/harness` (was
  `@graphrefly/pure-ts/patterns/harness`, which now errors with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`). The root barrel re-export is unchanged.

### Patch Changes

- [`36ff7df`](https://github.com/graphrefly/graphrefly-ts/commit/36ff7df3e4fd843ce630ad388921ff33e64a37e1) Thanks [@clfhhc](https://github.com/clfhhc)! - fix rxjs dependencies and data dispatch in agentic memory

## 0.46.0

### Minor Changes

- [`23c1eba`](https://github.com/graphrefly/graphrefly-ts/commit/23c1eba88c55be7ab925eaf8b704bc6604a0ec57) Thanks [@clfhhc](https://github.com/clfhhc)! - substrate changes

## 0.45.0

### Minor Changes

- [`64ab268`](https://github.com/graphrefly/graphrefly-ts/commit/64ab26858804265f60f169f69f95343793e5afde) Thanks [@clfhhc](https://github.com/clfhhc)! - minor fix

## Unreleased — package rename + framing reset (PART 13 of `archive/docs/SESSION-rust-port-architecture.md`)

- Renamed: `@graphrefly/legacy-pure-ts` → `@graphrefly/pure-ts` (D082).
- Reframed: pure-TS is now a permanent first-class peer (D084), not a deprecation track. The "frozen pure-TS oracle" / "Sunset trigger Q4" framing in the 0.44.0 entry below is superseded — pure-TS continues post-1.0 as the universal fallback alongside `@graphrefly/native` (napi) and `@graphrefly/wasm` (wasm-bindgen).
- Behavior unchanged.

## 0.44.0 — 2026-05-05 (Phase 13.9.A cleave, originally published as @graphrefly/legacy-pure-ts)

Initial release of the cleaved pure-TS package. Surface identical to `@graphrefly/graphrefly@0.44.0`; the implementation moved to `packages/legacy-pure-ts/` via `git mv` (history preserved). No behavioral change.

Future entries land here for parity-fix backports (Rust port surfaces a divergence), spec-amendment lockstep updates, and (post-D084) feature parity with native + wasm siblings. See [README.md](./README.md) § Lifecycle.
