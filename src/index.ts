// `@graphrefly/graphrefly` is a thin re-export layer over the chosen sibling
// impl (per PART 13 of `archive/docs/SESSION-rust-port-architecture.md`).
// Three siblings (D082): `@graphrefly/native` (napi-rs, Node fast path),
// `@graphrefly/wasm` (wasm-bindgen, browser fast path opt-in subpath),
// `@graphrefly/pure-ts` (universal fallback, permanent first-class peer per
// D084). Until the facade build lands (Deferred 1 of PART 13), this shim
// delegates everything to `@graphrefly/pure-ts` directly.
export * from "@graphrefly/pure-ts";
