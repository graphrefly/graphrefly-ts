# Changelog — @graphrefly/pure-ts

## Unreleased — package rename + framing reset (PART 13 of `archive/docs/SESSION-rust-port-architecture.md`)

- Renamed: `@graphrefly/legacy-pure-ts` → `@graphrefly/pure-ts` (D082).
- Reframed: pure-TS is now a permanent first-class peer (D084), not a deprecation track. The "frozen pure-TS oracle" / "Sunset trigger Q4" framing in the 0.44.0 entry below is superseded — pure-TS continues post-1.0 as the universal fallback alongside `@graphrefly/native` (napi) and `@graphrefly/wasm` (wasm-bindgen).
- Behavior unchanged.

## 0.44.0 — 2026-05-05 (Phase 13.9.A cleave, originally published as @graphrefly/legacy-pure-ts)

Initial release of the cleaved pure-TS package. Surface identical to `@graphrefly/graphrefly@0.44.0`; the implementation moved to `packages/legacy-pure-ts/` via `git mv` (history preserved). No behavioral change.

Future entries land here for parity-fix backports (Rust port surfaces a divergence), spec-amendment lockstep updates, and (post-D084) feature parity with native + wasm siblings. See [README.md](./README.md) § Lifecycle.
