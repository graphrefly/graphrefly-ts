/**
 * Rust-via-napi impl arm — DEFERRED.
 *
 * Activates when `@graphrefly/native` (the napi-rs binding compiled from
 * `~/src/graphrefly-rs/crates/graphrefly-bindings-js/`) publishes its
 * publishable package shape (root `package.json`, per-platform `npm/<plat>`
 * sub-packages, `optionalDependencies` matrix). At that point this module
 * will export a `rustImpl: Impl` shaped identically to `legacyImpl` and
 * scenarios in `scenarios/**` will switch from `[legacyImpl]` to
 * `[legacyImpl, rustImpl]` in the `describe.each` parameterization.
 *
 * The napi crate exists at `~/src/graphrefly-rs/crates/graphrefly-bindings-js/`
 * but has no `package.json` yet — only `Cargo.toml`, `build.rs`, and `src/`.
 * Benches load it via absolute path
 * (`~/src/graphrefly-rs/target/release/graphrefly_bindings_js.node`); that
 * path is not a publishable package, so we cannot meaningfully import it
 * here through the workspace.
 *
 * See `docs/implementation-plan.md` Phase 13.9 step 3 (`@graphrefly/native`
 * package) and `archive/docs/SESSION-rust-port-architecture.md` Part 12 (Q6)
 * for the activation sequence.
 */

import type { Impl } from "./types.js";

export const rustImpl: Impl | null = null;
