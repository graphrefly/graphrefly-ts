// Phase 13.9.A shim — `@graphrefly/graphrefly` is a thin re-export layer over the
// chosen impl. Until `@graphrefly/native` (napi binding) ships its publishable
// package shape and per-Rust-milestone swap-overs land, every subpath delegates
// to `@graphrefly/legacy-pure-ts` (the frozen pure-TS impl, source of truth at
// 0.44.x). See `docs/implementation-plan.md` Phase 13.9 and
// `archive/docs/SESSION-rust-port-architecture.md` Part 12 for the cleave story.
export * from "@graphrefly/legacy-pure-ts";
