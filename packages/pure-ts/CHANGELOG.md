# Changelog — @graphrefly/pure-ts

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
