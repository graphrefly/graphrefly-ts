---
name: porting-to-rs
description: "Port a slice of GraphReFly from TS to Rust (graphrefly-rs). Use when user says 'port to rust', 'porting-to-rs', or provides a task to add/extend functionality in the Rust workspace. Mirrors /dev-dispatch's plan→halt→implement→self-test loop, specialized for cross-repo Rust port work. Run /qa afterward for adversarial review."
disable-model-invocation: true
argument-hint: "[--light] [task description or context]"
---

You are executing the **porting-to-rs** workflow — implementing or extending a slice of the **GraphReFly** Rust port (`graphrefly-rs`, `~/src/graphrefly-rs`) against the canonical TS spec living in `graphrefly-ts` (this repo).

This skill is the Rust-port counterpart to `/dev-dispatch`. Same plan→halt→implement→self-test shape, but the canonical authority and invariants are different: the Rust port targets the **post-Phase 13.6.A consolidated canonical spec** (single document), not the multi-file TS spec + composition guides.

The user's task/context is: $ARGUMENTS

### Mode detection

If `$ARGUMENTS` contains `--light`, this is **light mode** — skip Phase 2 HALT unless escalation triggers (see Phase 2 below). Otherwise, this is **full mode** with mandatory architecture discussion before implementation.

---

## Phase 1: Context & Planning

Load context and plan the implementation in a single pass. **Parallelize all reads.**

### Canonical authorities (READ FIRST)

These supersede / consolidate the multi-file TS authority for Rust port purposes:

- **`docs/implementation-plan-13.6-canonical-spec.md`** — *single-document* canonical spec for the Rust port. Folds `~/src/graphrefly/GRAPHREFLY-SPEC.md` + all four `COMPOSITION-GUIDE-*.md` files into one read-once handoff. **This is THE behavior authority for the Rust impl.** Use the rule-ID convention (`R<section>.<sub>[.letter]`) for cross-references in commits, comments, test names. Sections of interest:
  - §1 Message Protocol — tier table (R1.3.7.b), message variants, payload-handle discipline
  - §2 Node — lifecycle (R2.2.7 resubscribable, R2.5.3 first-run gate, R2.6 PAUSE/RESUME, R2.6.4 TEARDOWN-precedes-COMPLETE)
  - §3 Graph — container, mount/unmount, sugar
  - §5 Design Principles (R5.1–R5.12)
  - §6 Implementation Guidance — explicit TS / PY / Rust deltas
  - §11 Implementation Deltas — known TS-vs-canonical-spec drift; the Rust port targets the canonical, NOT the current TS code
- **`docs/implementation-plan-13.6-flowcharts.md`** — Mermaid diagrams visualizing every internal method, property, and process referenced by the canonical spec. Cross-referenced via rule IDs. Use when:
  - A spec rule needs to be implemented and you need to see the call/data flow shape
  - A red 🟥 node flags TS-vs-canonical drift (the Rust port should match canonical)
  - A yellow 🟨 node flags not-yet-implemented features (out-of-scope for current slice unless explicitly part of $ARGUMENTS)
  - **Especially Batch 7 — Rewire substrate** (Phase 13.8; experimental TS impl mirrored in `graphrefly-rs/crates/graphrefly-core/tests/setdeps.rs`)

### Rust port operational docs (READ NEXT)

- **`~/src/graphrefly-rs/docs/migration-status.md`** — **canonical milestone tracker** for the 6-milestone Rust port. Read FIRST to know:
  - What landed (M1 dispatcher, M1 parity Slice A+B, etc.)
  - What's blocked / in-progress
  - The closing section format (each closed milestone gets a `## M<n> — closed YYYY-MM-DD` block summarizing what landed, what was deferred, and how it maps back to the migration plan)
  - The "Carried forward" pointer to porting-deferred.md
- **`~/src/graphrefly-rs/docs/porting-deferred.md`** — running registry of audit-surfaced concerns deferred to evidence-driven slices. Read to know:
  - Which §10 perf simplifications are deliberately deferred (and why — Pass 5 bench evidence)
  - v1 dispatcher limitations (re-entrance, sink-fire lock discipline, recursion stack overflow, etc.)
  - Spec divergences acknowledged in v1 (e.g., pause-buffer overflow not synthesizing ERROR; alloc_lock_id collision risk)
  - Open questions from `archive/docs/SESSION-rust-port-architecture.md` Part 6
  - Audit fixes that landed (so we don't re-introduce them)

### Cross-repo context (READ AS NEEDED)

- **`archive/docs/SESSION-rust-port-architecture.md`** — the migration plan: 6-milestone phasing, layer-by-layer port recommendation, deferral guardrails. Read FIRST when picking up port work in a new area.
- **`docs/research/handle-protocol.tla` + `handle_protocol_MC.tla`** — TLA+ refinement of `wave_protocol.tla` over the handle abstraction. The Rust port must satisfy the same invariants.
- **`docs/research/handle-protocol-audit-input.md`** — per-rule classification (which 13.6 invariants are Core-internal vs binding-layer). Use as the layer-classification key during M1–M5.
- **`packages/legacy-pure-ts/src/__experiments__/handle-core/core.ts` + `bindings.ts`** — TS prototype reference impl (~370 lines each, 22 invariant tests). The Rust port mirrors this module-for-module for the M1 dispatcher slice. (Post-Phase-13.9.A cleave: the pure-TS impl moved from root `src/` to `packages/legacy-pure-ts/src/`. The root `src/` is now the `@graphrefly/graphrefly` shim — re-exports only, no logic.)
- **`packages/legacy-pure-ts/src/core/node.ts` + supporting files** — TS production dispatcher. Reference for parity behavior, NOT for code structure (the Rust port follows the canonical spec, not the current TS shape — see §11 Implementation Deltas).
- **`packages/parity-tests/`** — cross-impl parity scenarios (Phase 13.9.A). When a Rust slice closes a milestone listed in `packages/parity-tests/README.md` schedule (M1 dispatcher, M2 Slice E Graph, M3 operators, M4 storage, M5 structures), the slice should ALSO add corresponding scenarios to `packages/parity-tests/scenarios/<layer>/<feature>.test.ts` parameterized via `describe.each(impls)`. The `rustImpl` arm currently exports `null` and activates when `@graphrefly/native` (the napi binding) publishes its package shape — until then, scenarios run against `legacyImpl` only but the structural parameterization is in place.
- **`docs/implementation-plan.md`** Phase 13.7 / 13.8 / 13.9 — Rust M1 bench feasibility study + TS rewire integration tests + the parity oracle cleave. Cross-reference for what bench data exists / what's been tested in TS / how the cleaved package architecture works.

### Rust workspace layout

```
~/src/graphrefly-rs/
├── crates/graphrefly-core/          # M1: dispatcher, message tiers, batch, wave engine
├── crates/graphrefly-graph/         # M2: Graph container, snapshot, content addressing
├── crates/graphrefly-operators/     # M3: built-in operator types
├── crates/graphrefly-storage/       # M4: tier dispatch + Node-only persistence (redb)
├── crates/graphrefly-structures/    # M5: reactiveMap/List/Log/Index (imbl)
├── crates/graphrefly-bindings-js/   # M1+: napi-rs JS bindings
├── crates/graphrefly-bindings-py/   # M6: pyo3 Python bindings
└── crates/graphrefly-bindings-wasm/ # WASM target
```

`cargo build` / `cargo test` (no `--workspace`) excludes the bindings crates by default — `default-members` skips them since they need their own toolchains (napi-rs, maturin, wasm-pack). Use `cargo test -p graphrefly-core` for the typical Rust-only test loop.

### Reads to perform in parallel

- `~/src/graphrefly-ts/docs/implementation-plan-13.6-canonical-spec.md` (deep-read sections relevant to $ARGUMENTS)
- `~/src/graphrefly-ts/docs/implementation-plan-13.6-flowcharts.md` (find the batch matching the slice)
- `~/src/graphrefly-rs/docs/migration-status.md` (every time, no exceptions)
- `~/src/graphrefly-rs/docs/porting-deferred.md` (every time, no exceptions)
- `~/src/graphrefly-rs/CLAUDE.md` (Rust-specific invariants)
- Any files the user referenced in $ARGUMENTS
- Existing Rust source for the area (`~/src/graphrefly-rs/crates/<crate>/src/`)
- Existing Rust tests for the area (`~/src/graphrefly-rs/crates/<crate>/tests/`)
- `~/src/graphrefly-ts/archive/docs/SESSION-rust-port-architecture.md` if entering a new milestone (M1→M2 transition, etc.)

### Rust-specific invariants (validate proposed changes against these)

These come from `~/src/graphrefly-rs/CLAUDE.md` and are non-negotiable:

1. **No `unsafe`. Anywhere. Enforced by `#![forbid(unsafe_code)]` at every crate root.** If a feature seems to need unsafe, find a safe abstraction (parking_lot, dashmap, imbl, redb, napi-rs / pyo3 wrappers). Escalate before allowing the lint.
2. **Compiler-enforced thread safety.** `Send` + `Sync` discipline applies to every public type. No `Rc<T>` / `RefCell<T>` in shared state — use `Arc<T>` + `Mutex<T>` / `parking_lot::ReentrantMutex<T>`.
3. **Per-subgraph `parking_lot::ReentrantMutex`** (planned; mirrors graphrefly-py per-subgraph RLock parity goal).
4. **No async runtime in Core.** Core dispatcher is sync. `tokio` only enters in `graphrefly-storage` and bindings; never in `graphrefly-core`.
5. **No `unwrap()` / `expect()` on user-facing paths.** Domain errors via `thiserror`-derived enums. `unwrap` only in tests, build scripts, or impossible-by-construction paths (with comment).
6. **`#[must_use]` on every public fn that returns a value.**
7. **`clippy::pedantic` + `rust_2018_idioms` warn-by-default.** Allow on a per-need basis with a comment, never silently.
8. **Public types live behind newtype wrappers** (`NodeId(u64)`, `HandleId(u64)`, etc.). Don't expose raw integers — they collide structurally.
9. **Snapshot serialization uses `serde_ipld_dagcbor`** for content-addressed paths, `ciborium` for non-content-addressed snapshots. Never mix codec choice with content-addressing semantics.

### Cross-language invariants (also apply to Rust port)

- **Handle-protocol cleaving plane.** Core operates on opaque `HandleId` integers. User values `T` live in the binding-side registry; they never enter Core types. The `BindingBoundary` trait is the only mandatory FFI crossing per fn-fire.
- **No polling.** Use reactive timer sources, not `std::thread::sleep` loops or `tokio::interval` busy-checks against state.
- **No imperative triggers in public API.** All coordination via message flow. Imperative methods only on the L2.35 controller-with-audit primitives.
- **First-run gate** (R2.5.3) — compute node does NOT fire fn until every dep has delivered at least one real handle.
- **Equals-substitution under `equals: 'identity'` is zero-FFI** — `HandleId` u64 compare in pure Rust. Custom equals crosses the binding boundary; opt-in only.
- **DIRTY before DATA/RESOLVED** (R1.3.1.b two-phase push) in the same wave.
- **Tier ordering** (R1.3.7.b) — Tier 0 START, Tier 1 DIRTY, Tier 2 PAUSE/RESUME, Tier 3 DATA/RESOLVED, Tier 4 INVALIDATE, Tier 5 COMPLETE/ERROR, Tier 6 TEARDOWN. Tier 3+4 buffer under PAUSE; others bypass.
- **§10 simplifications** (from `archive/docs/SESSION-rust-port-architecture.md` Part 10) — apply where they fit the slice; do NOT blindly transliterate TS patterns. Defer perf-tier §10 items (10.3 / 10.4 / 10.5 / 10.6 / 10.13) until bench evidence justifies; record deferrals in `porting-deferred.md`.

### When to compare against TS for parity vs spec

- **Behavior parity:** the Rust port must satisfy the same invariants as the canonical spec. The TS production code is a **reference for behavior**, not a structural template. When TS code disagrees with the canonical spec, **the canonical spec wins** (see §11 Implementation Deltas — explicit list of TS-vs-canonical drift).
- **Test parity:** when porting a feature with TS tests, mirror the test scenarios in Rust. Each test should reference the canonical spec rule it covers (e.g., a comment or test name like `r2_6_4_teardown_auto_precedes_complete`).
- **Bench parity:** if the slice claims a perf win, validate via criterion bench. Pre-existing `dispatcher.rs` bench shapes are the canonical comparison harness.

Do NOT start implementing yet.

---

## Phase 2: Architecture Discussion

### Full mode — HALT

**HALT and report to the user before implementing.** Present:

1. **Current state confirmation** — what's already in `graphrefly-rs` for this area (cite migration-status.md milestone status; cite specific files / line ranges; verify `cargo test -p <crate>` is clean before changes).
2. **Slice scope** — what the slice will and will NOT include. Slices should be:
   - Coherent (single feature or audit-fix bucket)
   - Reasonably small (~500–2000 lines including tests for a typical M1-style slice)
   - Tied to a milestone via the `migration-status.md` table
   - Aligned with §10 simplifications where applicable (call out which ones apply, which defer)
3. **Architecture choices** — for each new public API: signature, error variants, lock discipline, refcount discipline, handle-protocol boundary semantics. Cite canonical spec rules (`R<x.y.z>`) for behavior decisions.
4. **Open questions** — surface any spec ↔ canonical-spec ↔ TS-drift conflicts BEFORE coding. Per the user-feedback memory: "no autonomous decisions — surface spec↔code conflicts instead of silently picking."
5. **Acceptance bar** — what needs to be green before the slice closes:
   - All existing tests still pass
   - New tests cover the canonical-spec rules touched
   - `cargo clippy -p <crate> --all-targets` clean
   - `cargo fmt --check` clean
   - `#![forbid(unsafe_code)]` preserved
   - `migration-status.md` updated
   - New limitations / divergences added to `porting-deferred.md`

Prioritize (in order):
1. **Spec alignment** — matches `docs/implementation-plan-13.6-canonical-spec.md` (canonical post-13.6.A). Where canonical disagrees with current TS impl, follow canonical.
2. **Refcount + lock discipline** — Rust impl must NOT introduce refcount leaks or lock-ordering bugs. The §10.2 PauseState pattern (retain on buffer-push, release on drain/overflow) is the canonical example.
3. **Test coverage** — every public API surface gets a test. Edge cases (terminal interactions, pause cross-cuts, set_deps validation) get explicit tests.
4. **Consistency** — patterns elsewhere in `graphrefly-core` (RAII Subscription via `Weak<Mutex<CoreState>>`, `parking_lot::Mutex`, single state lock).
5. **Simplicity** — don't pre-optimize. v1 single-mutex is fine; perf-tier §10 simplifications wait for bench evidence.

Do NOT consider backward compatibility at this early stage (pre-1.0).

**Cross-repo decision log:** If Phase 1–2 surface an architectural or product-level question (canonical-spec ambiguity, parity divergence, refcount discipline gap), record it under "Active work items" in `docs/optimizations.md` (the graphrefly-ts source of truth for cross-language decisions). Rust-specific deferrals go in `~/src/graphrefly-rs/docs/porting-deferred.md`. Mark cross-references both ways.

**Decision logging:** For each question you ask during HALT, after the user answers, append the decision to `docs/rust-port-decisions.md` using the format:

```markdown
### DXXX — [short title]
- **Date:** YYYY-MM-DD
- **Context:** [what prompted the question]
- **Options:** A) … B) … C) …
- **Decision:** [what user chose]
- **Rationale:** [why]
- **Affects:** [which modules/milestones]
```

**Wait for user approval before proceeding.**

### Light mode — Skip unless escalation needed

Proceed directly to Phase 3 **unless** Phase 1 reveals any of these:
- Changes to **message protocol** (new tier, new variant, payload semantics)
- Changes to **`BindingBoundary` trait** (new method, signature change)
- Changes to wave engine, batch coalescing, or dispatch order
- New public types in `graphrefly-core` (especially RAII handles, error enums)
- Multiple viable approaches with non-obvious trade-offs
- Drift between canonical spec and current `graphrefly-rs` impl that needs an explicit reconciliation call
- Touching anything flagged in `porting-deferred.md` as a deferred concern

If any apply, escalate: HALT and present findings as in full mode.

---

## Phase 3: Implementation & Self-Test

After user approves (full mode) or after Phase 1 (light mode, no escalation):

### 3a. Implement

1. Treat `docs/implementation-plan-13.6-canonical-spec.md` as non-negotiable for behavior. If existing Rust code drifts from canonical, align toward canonical as part of the change.
2. Cross-reference rule IDs in code comments where the design is non-obvious (e.g., `// R2.6.4 / Lock 6.F: TEARDOWN auto-precedes COMPLETE`).
3. Apply §10 simplifications where they fit the slice; defer perf-tier ones with a note in `porting-deferred.md`.
4. Maintain the handle-protocol cleaving plane: Core sees `HandleId`, never `T`. If a temptation arises to leak `T` into Core (e.g., for debugging), use a `BindingBoundary::deref_for_debug` shape instead.
5. Refcount discipline:
   - Every `retain_handle` paired with a `release_handle`.
   - When buffering a handle (PauseState, terminal slot, dep_terminals slot), retain on store, release on remove.
   - Cross the boundary OUTSIDE the state lock when feasible (mirrors `Core::resume` Phase 2 pattern), to avoid binding-vs-Core lock ordering issues.

### 3b. Tests

1. Put tests in the most specific existing file under `~/src/graphrefly-rs/crates/<crate>/tests/`. Common patterns:
   - One file per feature: `pause.rs`, `invalidate.rs`, `terminal.rs`, etc.
   - Use the shared `tests/common/mod.rs` `TestRuntime` + `TestBinding` + `Recorder` infrastructure.
   - Use `RecordedEvent::*` for high-level message assertions (resolves handles to values automatically).
2. Cover the edge cases the canonical spec calls out — e.g., R1.4 idempotency-within-wave for INVALIDATE; R2.6.4 idempotency on duplicate TEARDOWN.
3. For refcount-touching changes, use `TestBinding::refcount_of(handle)` to verify retain/release pairs balance (don't rely on `live_handles()` alone — handles stay alive when ANY share remains).
4. Test names should reference the canonical rule when covering a specific invariant (e.g., `dynamic_rewire_refires_fn_on_new_deps` covers a Phase 13.8 audit fix; `r1_4_invalidate_idempotent_within_wave` covers a spec rule).

### 3c. Self-check

Run from `~/src/graphrefly-rs`:

```bash
cargo test -p graphrefly-core            # core tests
cargo test                               # default-members workspace
cargo clippy -p graphrefly-core --all-targets
cargo fmt --check                        # or `cargo fmt && cargo fmt --check`
```

When the slice touches bindings:
```bash
cd crates/graphrefly-bindings-js && pnpm build      # napi-rs build
cd crates/graphrefly-bindings-py && maturin develop # pyo3 build
cd crates/graphrefly-bindings-wasm && wasm-pack build
```

Fix any failures. **Do NOT use `--workspace`** for `cargo build` / `cargo test` unless you have all binding toolchains installed — the workspace excludes bindings from default-members for this reason.

### 3d. Widen the parity-test surface (when slice closes a milestone or adds public API)

If the slice closes (or partially fills) a milestone row in the `packages/parity-tests/README.md` schedule table, add cross-impl scenarios under `~/src/graphrefly-ts/packages/parity-tests/scenarios/<layer>/`:

1. Pick the layer subfolder (`scenarios/core/` for M1 dispatcher, `scenarios/graph/` for M2 Slice E, `scenarios/operators/` for M3, etc. — create the folder if needed).
2. Write the scenario as `describe.each(impls)("<rule-id> parity — $name", (impl) => { test(...); })`. Reference symbols only via `impl.<name>`, not direct imports — that's what makes the scenario impl-agnostic.
3. If the scenario references new symbols not yet in `packages/parity-tests/impls/types.ts` `Impl`, widen the interface (and provide the field on `legacyImpl` in `impls/legacy.ts`). Until `@graphrefly/native` publishes, `rustImpl` is `null` and scenarios only run against `legacyImpl` — but the parameterization stays in place so activation only requires a one-line `rust.ts` flip.
4. Test: `pnpm --filter @graphrefly/parity-tests test`. Scenario must pass against `legacyImpl`. When `rustImpl` activates later, mismatches fail loud.

**Skip this step** if the slice is an internal refactor that doesn't change public surface (e.g., a §10 perf simplification under an unchanged API). The parity-tests layer is for surface-visible behavior, not internals.

### 3e. Document the slice

Update both Rust-side operational docs as the work lands:

1. **`~/src/graphrefly-rs/docs/migration-status.md`** — the canonical milestone tracker:
   - When a sub-bucket lands: mark it ✅ in the M-table or the entry checklist.
   - When a milestone closes: update the M-table row to ✅, add a `## M<n> — closed YYYY-MM-DD` section documenting what landed, what was deferred, what was carried forward.
   - Update the test count (per-file breakdown helps future readers).
   - Cross-reference any cargo-tagged release: `git tag -a vM<n>.0.0 -m "M<n> complete"` + bump `[workspace.package].version`.

2. **`~/src/graphrefly-rs/docs/porting-deferred.md`** — the running registry of deferred concerns:
   - When the slice surfaces a new perf concern that you DON'T fix: add a section with what / why-deferred / source.
   - When the slice surfaces a v1 dispatcher limitation: add to "v1 dispatcher limitations".
   - When the slice acknowledges a TS-spec divergence: add to "Spec divergences acknowledged in v1".
   - When the slice CLOSES a previously-deferred concern: move that entry's content to "Audit fixes landed in Slice X" (or the milestone's closing section in `migration-status.md`) and remove from the active deferred list.

3. **TS-side `docs/implementation-plan.md`** — only when a TS-side phase entry is affected (e.g., a Phase 13.7 / 13.8 sub-item closing). The Rust port does NOT add Phase 11–16 sub-bullets; the migration-status.md is the canonical Rust tracker.

4. **TS-side `docs/optimizations.md`** — only when the slice surfaces a cross-language design question that needs to be tracked alongside TS / PY work. Rust-only deferrals go in `porting-deferred.md`, not `optimizations.md`.

### 3f. Closing the slice

When done, produce these deliverables:

**A. Behavioral trace table** — for each new/changed module, show a plain-English table:

```
Module: [name] (milestone)
Scenario: [description of the most representative scenario]

Step | Event              | Internal state change        | Observable output
1    | ...                | ...                          | ...
```

The user verifies this against the spec without reading Rust. If the trace is correct AND parity tests pass, the impl is correct.

**B. Simplification delta** — table showing what the Rust version does differently from TS:

| TS pattern | Rust replacement | Why simpler / Why different |
|---|---|---|

Flag any entry where Rust is MORE complex than TS — that's a potential over-engineering signal.

**C. Deferred item stubs** — for each new deferred item, confirm a `#[ignore]` test exists in the Rust source:

```rust
#[test]
#[ignore = "deferred: <description> (<spec ref>)"]
fn <test_name>() { /* impl when feature lands */ }
```

**D. Standard closing checklist:**

1. List files changed and new public types / methods added.
2. Cite the migration-status.md row this slice closes (or moves toward closing).
3. Cite the canonical-spec rules covered.
4. Cite any new entries in porting-deferred.md.
5. Suggest running `/qa` for adversarial review and final checks.

If implementation **closes a milestone** in `migration-status.md`:
1. Move the milestone's row from "🚧 in progress" to "✅ landed".
2. Add the closing section per the existing template (see M1 dispatcher / M1 parity sections for the canonical format).
3. Sweep `porting-deferred.md` for items resolved by this milestone — move them to the closing section.

If implementation **closes a Rust-side milestone-pre-condition** in `docs/implementation-plan.md` (Phase 13.7 / 13.8 / similar): mark ✅ in the matching TS-side phase entry per `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/implementation-plan.md`".

---

## Quick reference: typical slice flow

1. Read canonical spec section + flowchart batch covering the feature
2. Read migration-status.md to know the milestone context + what's landed
3. Read porting-deferred.md to know what NOT to re-introduce
4. (Full mode) Halt with architecture proposal citing R<x.y.z> rules
5. (User approval) Implement + tests + clippy + fmt
6. **If the slice closes a milestone or adds public API:** widen `~/src/graphrefly-ts/packages/parity-tests/scenarios/<layer>/` with new `describe.each(impls)` scenarios; verify `pnpm --filter @graphrefly/parity-tests test` green
7. Update migration-status.md + porting-deferred.md
8. Suggest `/qa`
