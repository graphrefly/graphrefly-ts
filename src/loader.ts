// Phase 13.9.A native-loader marker (no-op).
//
// When `@graphrefly/native` (the napi-rs binding compiled from
// `~/src/graphrefly-rs/crates/graphrefly-bindings-js/`) publishes its
// per-platform packages and the per-Rust-milestone swap-overs land
// (`docs/implementation-plan.md` Phase 13.9 step 2), this file becomes the
// shim's resolution mechanism: try `@graphrefly/native` first, fall back to
// `@graphrefly/legacy-pure-ts` when the native binary is unavailable
// (sandboxed JS, restricted enterprise, edge runtimes without WASM).
//
// Until the binding scaffolds its publishable shape (currently the napi crate
// has no `package.json`; benches load it via absolute path), this file is a
// no-op marker. The shim's individual subpath entries directly re-export from
// `@graphrefly/legacy-pure-ts`. Do NOT add `@graphrefly/native` to
// `optionalDependencies` until that package actually publishes — npm install
// will fail loud rather than skip an unfindable optional dep.
//
// No public exports until the loader actually activates — keeping the symbol
// shape open avoids locking consumers to a const that future dynamic
// detection would have to break (see `archive/docs/SESSION-rust-port-architecture.md`
// Part 12 Q6 for the shim selection contract).

export {};
