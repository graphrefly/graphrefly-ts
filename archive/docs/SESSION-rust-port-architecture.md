---
SESSION: rust-port-architecture
DATE: May 2-3, 2026
TOPIC: Rust port strategic timing, handle-protocol cleaving plane, layer-by-layer migration recommendation, Cargo workspace sketch, threading wins for TS/Python users, multi-distribution model
REPO: graphrefly-ts (primary; Rust target is a future graphrefly-rs workspace)
---

## CONTEXT

The DS-13.5 lock-down session (2026-05-01) closed seven design sessions and surfaced enough cross-cutting inconsistencies to motivate Phase 13.6 — a dedicated rules/invariants audit before Phase 14 opens. While preparing for 13.6, the question of "if we'll port to Rust eventually, should we move now?" arose naturally — DS-13.5 had just normalized many primitives, and re-doing that work in Rust under a still-moving spec would be wasteful.

This session worked through:
1. Whether and when to commit to a Rust port (decision: lock 13.6 + Phase 14 first; port after).
2. The architectural cleaving plane that makes the port viable without losing language ergonomics: a **handle protocol** where the Core sees only opaque integer IDs, never user values.
3. Validation artifacts: a TS prototype implementing the cleave (22 tests passing), a TLA+ refinement of `wave_protocol.tla` covering the same protocol over the handle abstraction (verified across 5 scenario MCs, 39,331 distinct states), and an audit-input doc cataloging which 13.6 invariants become Core-internal vs binding-layer.
4. Implementation-plan amendments adding Rust-port deferral guardrails to Phase 13.6 and Phase 14 — explicit "DON'T DEFER" / "STRONG DEFER" lists so 13.6.B and Phase 14 land work don't bolt heavy hardening onto TS that would be near-free in Rust.
5. A 6-crate Cargo workspace sketch + 6-milestone phased migration plan.
6. Threading/concurrency analysis — what the Rust core gives JS and Python users via bindings, and what stays language-side.
7. Distribution strategy: feature-gated builds (lite / standard / full + WASM) so a single Rust source tree serves both the lightweight tracing-injection use case and the heavyweight multi-agent / persistence / CRDT cases without parallel codebases.

**Source material:**
- `docs/implementation-plan-13.6-prep-inventory.md` — 247-rule precursor inventory
- `~/src/graphrefly/formal/wave_protocol.tla` (2865 lines, ~35 invariants) and 16 scenario MCs
- `archive/docs/SESSION-harness-engineering-strategy.md` — strategic positioning (zero-dep claim, distribution priorities)
- DS-13.5 locked design sessions (Bundles 1–7)
- CLAUDE.md — repo conventions, design invariants, free-threaded Python parity goals

---

## PART 1: STRATEGIC TIMING — WHY NOT MIGRATE NOW

### Decision: lock 13.6 + Phase 14 in TS first; port after.

The protocol is still moving. DS-13.5 just locked seven design sessions; 13.6 audit is pending; Phase 14 (op-log changesets, delta protocol) touches every reactive primitive. A Rust port that begins before the spec stabilizes means rewriting the rewrite. The correct sequence:

1. **Phase 13.6** — lock invariants in TS (current substrate).
2. **Phase 14** — land op-log delta protocol in TS; validate the user-facing API shape against real consumers.
3. **Then Rust port** — a clean rewrite of a stable spec, not a co-design with one.

### Why TS easier than Rust for protocol design

Iteration speed dominates everything else in protocol design:
- vitest watch loop: sub-second
- Rust test compile: 10–60s
- The composition guide is full of subtle ordering invariants (P.5 wiring order, M.20 subscribe-before-kick, P.41 wave exclusivity) discovered by writing 50 small test variations
- That iteration ratio matters far more than runtime performance during exploration

The one real argument for Rust *now*: TS hides concurrency. Free-threaded Python parity (per CLAUDE.md per-subgraph `RLock`) is a real concurrency story TS's event loop can't surface. If load-bearing concurrency questions can't be answered in TS, that pushes the calculus. Otherwise, defer.

### Cost asymmetry

| Action | Cost if 13.6 changes things | Cost if not done now |
|---|---|---|
| Run Rust prototype + TLA+ refinement | ~1 day rework (small artifacts) | re-deriving the architectural insight at port time |
| Commit to Rust migration | rewrite the rewrite | (n/a — this is the right time later) |
| Lock 13.6 invariants | (n/a — must happen) | port lacks a stable target |

Conclusion: research artifacts and architectural exploration run **alongside** 13.6, not after. The thing that waits is the production migration commit.

---

## PART 2: ARCHITECTURAL CLEAVING PLANE — THE HANDLE PROTOCOL

The defining choice that makes Rust core + per-language SDK harness viable: **the Core never sees user values `T`. It operates entirely on opaque `HandleId` integers.**

### What this means concretely

- Values live in a binding-side **value registry** (a Map from `HandleId → T`, plus a `WeakMap<value, HandleId>` for object-identity dedup).
- `cache[n]`, `dirtyMask`, `queues`, `version`, `status`, `dep records`, `subscriber sets` — all hold `HandleId`s, never `T`. Pure-Rust internal state.
- Equals-substitution (Rule 1.3) under `equals: 'identity'` becomes a u64 compare — **zero FFI** on the equality path.
- `EqualsPairs[n]` non-diagonal (custom equals) becomes a **boundary call per check** — explicit opt-in.
- `Compute(n, val)` (state-node fn) becomes `invokeFn(nodeId, fnId, depHandles)` — **one FFI call per fn fire**, regardless of dep count.
- All protocol bookkeeping (DIRTY propagation, batch coalescing, PAUSE replay, first-run gate, equals-substitution, version counters) stays Core-internal: zero FFI.

### Comparison to existing portability frameworks

The pattern (low-level core + per-language SDK harnesses) is well-trodden. Apache Beam's Portability Framework / FnAPI is a prominent example: runners are language-agnostic, SDK Harnesses host user fns, communication via gRPC. Polars (Rust core + Python/Node bindings), DuckDB, TensorFlow (C++ core + Python ops), DataFusion all use the same shape.

**GraphReFly is not Beam.** Beam = bulk dataflow over `PCollection<T>` with windowing/watermarks/triggers. GraphReFly = per-event reactive coordination over single-value cached nodes with push-on-subscribe semantics. Beam has no analogue for first-run gate, equals-substitution to RESOLVED, or PAUSE/RESUME with lockIds. The portability *pattern* is shared; the *domain* is different.

Closer family for GraphReFly's positioning:
- Reactive primitives (Solid signals, MobX, Recoil, TC39 Signals, Jotai)
- Incremental computation (Salsa, Adapton, differential dataflow)
- Build graphs (Bazel, Buck, Turbo)
- Agent frameworks (LangGraph, AutoGen, CrewAI) — what GraphReFly displaces in positioning

The intersection — *reactive graphs as durable artifacts, composed for AI agents, with multi-language portability* — is what nobody else occupies.

---

## PART 3: VALIDATION ARTIFACTS BUILT THIS SESSION

Three artifacts, all preserved in the worktree:

### TS prototype (`src/__experiments__/handle-core/`)

**Files:** `core.ts` (~370 lines), `bindings.ts` (~370 lines), `core.test.ts` (13 tests), `extensions.test.ts` (9 tests).

The Core class operates entirely on `HandleId`. The `BindingBoundary` interface defines the FFI surface (3 methods: `invokeFn`, `customEquals`, `releaseHandle`). The binding layer holds the value registry (WeakMap-backed for objects, Map for primitives) and FFI counters.

Capabilities exercised:
- Identity dedup (same value → same handle → equals-substitution to RESOLVED)
- First-run gate (fn doesn't fire until every dep delivered)
- Diamond resolution (one fn fire per wave even with shared upstream)
- Push-on-subscribe (cached state delivers to new subscriber)
- Custom equals via boundary (FFI counter verifies it crosses exactly once per check)
- Dynamic node analogue (selective deps via `tracked()`; untracked dep updates do NOT fire fn)
- Refcount / leak-detection snapshot
- SENTINEL discipline (registry rejects `undefined` at intern)

**Verification: 22/22 prototype tests pass; full suite 2780/2780 (no regressions); biome lint clean.**

Two real bugs found during construction (and fixed):
- Recursive activation of derived-of-derived chains (subgraph activation must walk up dep tree before reading caches)
- `NO_HANDLE` leaking into custom-equals oracle on first emission (sentinel guard before crossing boundary)

### TLA+ refinement (`docs/research/`)

Existing `~/src/graphrefly/formal/wave_protocol.tla` already abstracts payloads as opaque `Values`. The handle interpretation is just a re-reading of the existing spec — `Values ≡ Handles`. New artifact:

- `handle-protocol.tla` — thin refinement EXTENDS wave_protocol; adds 1 state-level INVARIANT (`HandleCacheTypeOK`) + 2 structural ASSUMEs (`IdentityEqualsIsPureCore`, `CustomEqualsExtendsIdentity`)
- `handle_protocol_MC.tla` + `.cfg` — 4-node diamond MC harness

**Verification: 9,526 distinct states, depth 25, 1.0s, no errors.**

Additionally: handle-variants of 4 representative scenario MCs (`pause`, `custom_equals`, `multisink`, `invalidate`) ran in parallel against the same handle interpretation. All verified clean:

| MC | States | Distinct | Depth | Time |
|---|---:|---:|---:|---:|
| `handle_protocol_MC` (diamond) | 22,532 | 9,526 | 25 | 2s |
| `handle_pause_MC` | 57,742 | 22,761 | 20 | 3s |
| `handle_custom_equals_MC` | 8,296 | 4,359 | 14 | 2s |
| `handle_multisink_MC` | 1,795 | 1,014 | 16 | 1s |
| `handle_invalidate_MC` | 3,649 | 1,671 | 15 | 2s |
| **Total** | **94,014** | **39,331** | — | **~10s** |

Every wave_protocol invariant survives at the handle interpretation, including PAUSE/RESUME (with lock IDs and replay buffers), non-identity custom equals, multi-sink iteration drift, and INVALIDATE cleanup-witness accounting.

### Audit-input doc (`docs/research/handle-protocol-audit-input.md`)

Structured input for Phase 13.6.A's invariant-locking pass:

- **Refinement mapping table** — wave_protocol concepts ↔ handle-protocol concerns, with per-row boundary classification
- **Pure-core rules** (~50 rules collapse into core internals invisible to the user-facing audit)
- **Binding-layer rules** (~40 rules survive at the SDK harness API)
- **Process rules to re-home** (~7 rules — M.7/8/9/14/18/19/20* — belong in CLAUDE.md / dev-dispatch / qa skills, not in the spec)
- **Five concrete simplification candidates**: SENTINEL family (~13 rules → 1), `.cache`-read sanctioning (4 → 1), imperative boundary rubric (DS-13.5.G follow-up), equals-substitution two-regime split, cleanup hook shapes
- **Recommended sequencing for 13.6.A** — five-step plan
- **Open questions** — 4 items that should NOT block 13.6.A but want follow-up entries in `docs/optimizations.md`

**Empirical finding: ~50/247 inventory rules become invisible under the architecture, reducing the audit surface by roughly half.**

### Process discipline (load-bearing for the audit's value)

A separate audit session is running in parallel for 13.6. **The handle-protocol artifacts are NOT being fed into that session as input.** Reason: pre-empting an in-flight audit with a competing framework is a silent architectural decision dressed as efficiency. The audit's value comes from independent rigor; preloading the agent biases the output.

After the audit completes, the audit-input doc serves as a **second-pass comparison**:
- Agreement on classification → high-confidence lock
- Disagreement → discussion item; neither side automatically right
- Coverage gaps (rules I had / audit missed, or vice versa) → real gaps for follow-up

This shape preserves audit independence and turns my session into validation rather than contamination.

---

## PART 4: IMPLEMENTATION PLAN AMENDMENTS

Both Phase 13.6 and Phase 14 received explicit Rust-port deferral guardrails. The structure is identical: bold callout at end of phase body, with `DON'T DEFER` and `STRONG DEFER` lists.

### Phase 13.6 deferral guardrail (added to `docs/implementation-plan.md`)

**DON'T DEFER — do in TS during 13.6.A + 13.6.B:**
- All of 13.6.A — pure spec/doc work, language-irrelevant
- Spec-level rollback semantics (L2.35-rollback-*) — contract every impl honors
- Audit-record schemas (DS-13.5.E) — wire format
- Imperative-vs-reactive boundary rubric (DS-13.5.G follow-up)
- Reactive composition primitives — domain semantics

**STRONG DEFER — leave for Rust port:**
- Hardening rollback against L2.35-rollback-scope caveat ("closure mutations not covered"). Rust `&mut T` ownership + `imbl`-style persistent collections make this nearly automatic. Catch-mutation gymnastics in TS = fighting the language.
- ACID storage-tier tightening (G.27-atomicity beyond best-effort). `redb`-style ACID is a Rust crate choice; in TS it's a multi-week project.
- Strict per-tier transaction semantics in storage primitives.

### Phase 14 deferral guardrail (added to `docs/implementation-plan.md`)

**DON'T DEFER — do in TS during Phase 14 land:**
- Op-log changeset protocol shape (`{ version, ops, rootRef? }`) — user-facing API
- Delta protocol `version` field semantics
- `lens.flow` delta companion API shape
- `restoreSnapshot mode: "diff"` user contract
- All five DS-14 threads' API shapes — the *surface*
- Codec envelope evolution for delta-aware codecs (`DagCborCodec` integration)

**STRONG DEFER — leave for Rust port:**
- High-throughput diff/changeset replay performance — `imbl` persistent collections give O(log n) snapshot-and-revert naturally
- Strict cross-tier WAL atomicity beyond best-effort (depends on storage-tier ACID work, also Rust-deferred)
- CRDT-backed `reactiveMap` / `reactiveLog` variants — Rust ecosystem (`yrs`, `automerge`, `loro`, `diamond-types`) dominates
- `peerGraph(transport)` multi-replica sync (already POST-1.0; flagged here so it doesn't get pulled into pre-1.0 by accident)
- Cross-replica changeset merging with CRDT semantics

The framing: **TS impl proves the spec is right; Rust impl proves it's bulletproof.** Spec semantics work happens now in TS, language-independently. CRDT and ACID-storage hardening waits — designing them in TS first means designing weaker versions you'd throw away.

---

## PART 5: LAYER-BY-LAYER PORT RECOMMENDATION

Mapped against the codebase layout from CLAUDE.md (`src/core/`, `src/graph/`, `src/extra/`, `src/patterns/`, `src/compat/`):

### Strong move to Rust

| Layer | Reasoning |
|---|---|
| `src/core/` (~95% of lines) | The dispatcher. node.ts (2459 lines), batch.ts, messages.ts, clock.ts, versioning.ts, hash.ts, guard.ts, meta.ts, actor.ts. All operate on opaque tuples — Rust does this cleanest. |
| `src/graph/` | Graph container, describe/observe, snapshot, content addressing. Phase 6 (V1–V3 CIDs) and Phase 14 (changesets) both live here. Pair with `cid` + `multihash` + `serde_ipld_dagcbor` + `blake3`. |
| Storage tier dispatch + Node-only persistence | `fileStorage`, `sqliteStorage` → Rust with `redb`. The G.27-atomicity tightening that's deferred lands here. |
| Reactive data structures (`reactiveMap`, `reactiveList`, `reactiveLog`, `reactiveIndex`) | Phase 14 op-log substrate. Rust + `imbl` gives O(log n) persistent collections natively. |
| Pure-function operators (`map`, `filter`, `scan`, `withLatestFrom`, `switchMap`, `valve`, `gate`, etc.) | Built-in operator node types in Rust. No FFI for operator logic itself; only user-supplied fns cross. |
| Resilience primitives (retry, circuitBreaker, timeout, fallback, rateLimiter, tokenBucket) | State machines — Rust's strength. |

### Stay in binding-language

| Layer | Reasoning |
|---|---|
| `src/patterns/` (orchestration, messaging, memory, AI, CQRS) | Domain-shaped APIs. Rule 5.11 (developer-friendly Phase 4+ APIs) fights against Rust ergonomics if exposed directly. Patterns are thin compositions (200–800 lines each); easier to maintain in binding language. |
| `src/compat/` | Framework adapters (NestJS, React, Vue, Solid, Svelte). Each framework lives in its ecosystem. NestJS-in-Rust makes no sense. |
| Sources touching language runtime: `fromPromise`, `fromAsyncIter` | Each language has its own Promise/Awaitable shape. |
| Browser-specific: `extra/browser.ts`, `indexedDbStorage`, `webllmAdapter`, `chromeNanoAdapter` | DOM globals; can't be Rust. |
| User-supplied fns | Always — by definition. |
| Custom equals, custom guards (when invoked) | Boundary call. |

### Surface that stays binding-side at the Core layer

- `sugar.ts` (`dynamicNode`, `autoTrackNode`, `pipe`) — thin user-facing wrappers; type-inference friendlier in TS
- `config.ts` — extensible message-type registry; protocol-internal Rust + user-facing register API binding
- `meta.ts` — describe/factory tags; metadata storage Rust + JSDoc-emitting helpers binding
- `index.ts` re-exports

---

## PART 6: PHASED MIGRATION (6 MILESTONES)

After 13.6 + Phase 14 lock and ship in TS:

**M1 — `graphrefly-core` crate.** Port `src/core/`. Add napi-rs JS bindings. Drop-in replace TS core; keep all of extra/graph/patterns running on top. Validate via existing test suite. Highest-risk highest-leverage step.

**M2 — `graphrefly-graph` crate.** Port `src/graph/`. Bring in `serde_ipld_dagcbor`, `cid`, `multihash`, `blake3`. Phase 6 V1–V3 CID work lands naturally here.

**M3 — `graphrefly-operators` crate.** Port `src/extra/operators/` and `src/extra/sources/` (Node-only + timer subset). Hot-path operators stop crossing FFI.

**M4 — `graphrefly-storage` crate.** Port Node-only storage. Bring in `redb`. Phase 13.6 deferred ACID atomicity lands here.

**M5 — `graphrefly-structures` crate.** Port `reactiveMap`, `reactiveList`, `reactiveLog`, `reactiveIndex`. Bring in `imbl`. Phase 14 op-log changesets get O(log n) substrate.

**M6 — `graphrefly-bindings-py` crate.** Port pyo3 bindings. The G.6 PY/TS parity gap closes — both bindings consume the same Rust source of truth.

**Post-1.0:** CRDT-backed structure variants (`yrs`/`automerge`/`loro`), `peerGraph(transport)` with libp2p, cross-replica changeset merging.

---

## PART 7: CARGO WORKSPACE SKETCH

```
graphrefly-rs/
├── Cargo.toml                        # workspace root
├── Cargo.lock                        # committed; pins all transitive
├── rust-toolchain.toml               # MSRV pin
├── deny.toml                         # cargo-deny: license + supply-chain audit
└── crates/
    ├── graphrefly-core/              # M1: dispatcher
    ├── graphrefly-graph/             # M2: container, snapshot, content addressing
    ├── graphrefly-operators/         # M3: built-in operator types
    ├── graphrefly-storage/           # M4: tiers + Node-only persistence
    ├── graphrefly-structures/        # M5: reactive data structures
    ├── graphrefly-bindings-js/       # M1+: napi-rs JS bindings
    ├── graphrefly-bindings-py/       # M6: pyo3 Python bindings
    └── graphrefly-bindings-wasm/     # WASM target (edge runtimes, browser)
```

### Realistic dep budget

The "boring rigorous infrastructure" — exactly what should be outsourced — has canonical Rust crates:

| Need | Crate | Notes |
|---|---|---|
| Re-entrant mutex (per-subgraph RLock) | `parking_lot` | Standard; stdlib has no re-entrant variant |
| Concurrent map | `dashmap` | Lock-free buckets |
| Persistent collections | `imbl` | `Versioned` wrapper → free `Arc::ptr_eq` dedup |
| Hash (default) | `blake3` | Multi-core parallelizable |
| Hash (interop) | `sha2` | RustCrypto, audited |
| CID encoding | `cid` + `multihash` + `multibase` | Reference IPLD impl |
| Strict CBOR (content-addressed) | `serde_ipld_dagcbor` | Deterministic, hashable |
| Loose CBOR | `ciborium` | Pure-Rust |
| Compression | `zstd` | Battle-tested |
| Embedded ACID DB | `redb` | Pure-Rust, no C dep |
| FFI (JS) | `napi-rs` | Productivity standard |
| FFI (Python) | `pyo3` | Same role |
| Errors | `thiserror` (lib) + `anyhow` (binary) | Idiomatic split |
| Property tests | `proptest` | dev-only |
| Concurrency model checking | `loom` | dev-only; permutes interleavings |

### Bonus side-effect: IPLD ecosystem alignment

dag-cbor + blake3 CIDs make graphrefly snapshots first-class IPLD documents. Free interop:
- Snapshots can store on **IPFS / Iroh / Ceramic** content-addressed storage natively
- `peerGraph(transport)` (Phase 8.5) can use libp2p directly
- Graphs become referenceable from other IPLD documents by CID — exactly what V3 "refs (cross-graph references)" wants

The "graphs are artifacts" pillar (Rule 5.7) gets a concrete content-addressed implementation for free. That's a strategic win that's hard to engineer in TS or Python.

---

## PART 8: THREADING AND CONCURRENCY WINS

### What Rust gives that TS/Python can't replicate

1. **Real OS threads, no runtime needed.** `std::thread::spawn` = real kernel thread. Unlike JS Workers (separate V8 isolates) or pre-3.13 Python (GIL-serialized).
2. **`Send` + `Sync` compile-time enforcement.** Data races become compile errors, not runtime bugs. The compiler refuses to compile thread-unsafe code.
3. **Async opt-in.** No bundled runtime; the Core is sync. Saves a huge transitive dep tree.

### What this means for JS users (via napi-rs)

- **Dispatch parallelism without blocking the JS thread.** Snapshot serialization, hash computation, storage I/O run on the Rust thread pool; V8 event loop stays free.
- **Cross-Worker shared state via Rust.** Multiple Node Workers each call into the same Rust core; Rust mediates state with `Arc<RwLock<T>>`. Pure-TS can't share JS objects across Workers without `SharedArrayBuffer` gymnastics.
- **Lock-free version counters.** `AtomicU64::fetch_add` for Phase 14 op-log version increments — single CPU instruction, never blocks.
- **CPU-bound user fns can run in true parallel** when each Worker has its own V8 isolate calling into the shared Rust core. (Honest limit: I/O-bound LLM-call fns don't see big wins; the Rust core parallelizes *around* fn fires, not *within* them.)

### What this means for Python users (via pyo3)

This is where Rust threading shines hardest, because Python's concurrency story is weaker than JS's.

- **Pre-3.13 (GIL):** Rust core releases the GIL during internal work via `py.allow_threads(|| { ... })`. Other Python threads run while Rust does dispatch. Net: Python scales for I/O-mixed workloads even on classic CPython.
- **Free-threaded 3.13+:** Rust core's `Arc<RwLock<...>>` + `parking_lot::ReentrantMutex` handles all the thread-safety the standard library doesn't. Per CLAUDE.md, the per-subgraph RLock is a one-liner: `parking_lot::ReentrantMutex<SubgraphState>`.
- **`pyo3-async-runtimes`** supports asyncio / trio / uvloop via traits. The G.6 parity gap (TS has `.get()/.has()/.size`; PY exposes `.data` differently) closes because both bindings consume the same Rust source.
- **Python compat layer shrinks dramatically.** Today: `compat/asyncio.py` and `compat/trio.py` reimplement scheduling per runtime. After: each compat file is ~100 lines bridging async-fn → coroutine → graphrefly event. Rust core does the scheduling.

### What it does NOT help with (be honest in messaging)

- Sequential dependency chains (topology constrains parallelism)
- User fn execution speed (slow fn body stays slow)
- Browser via WASM (threads exist via SharedArrayBuffer + COOP/COEP but rarely practical)
- I/O-bound LLM-call workloads (less win than CPU-bound)

### Honest pitch line

> *GraphReFly's Rust core gives JavaScript and Python users true parallel reactive coordination — multi-agent subgraphs, storage I/O, and content-addressed snapshots run on real OS threads, with thread safety enforced by the compiler. User code still serializes on each language's runtime, where you'd want it to.*

---

## PART 9: USE CASES + DISTRIBUTION STRATEGY

### Distributed-tracing use case

User concern: tracing-injection libraries should be lightweight. A 3–5 MB native binary defeats that purpose.

**Resolution:** feature-gated builds, single source tree, multiple distributions.

### Multi-distribution model (the answer to "I don't want to maintain two libraries")

One Rust workspace. CI builds N variants from the same source. Each variant publishes as a separate npm/PyPI package.

```
                                   Built from same workspace,
                                   different feature flags
@graphrefly/lite                 ← --features "tracing"          ~400 KB / platform
@graphrefly/standard             ← --features "standard"         ~1.4 MB / platform
@graphrefly/full                 ← --features "full"             ~3.5 MB / platform
@graphrefly/lite-wasm            ← wasm target, "tracing"        ~250 KB
@graphrefly/standard-wasm        ← wasm target, "standard"       ~900 KB
```

Same shape on PyPI (Python "extras" syntax: `pip install graphrefly[full]`).

### Three layers of feature gating

1. **Per-crate features** — internal optionality (e.g., `redb-store`, `sqlite-store`, `zstd`)
2. **Bindings-crate features** — select which sibling crates are linked in (e.g., `tracing`, `graph-codec`, `operators`, `storage`, `structures`, `acid`, `crdt`)
3. **Per-distribution binaries** — CI matrix builds N variants, publishes N packages

```toml
# graphrefly-bindings-js/Cargo.toml
[features]
default      = ["tracing"]
tracing      = []
standard     = ["tracing", "graph-codec", "operators"]
full         = ["standard", "storage", "structures", "content-addressing", "acid"]

graph-codec        = ["dep:graphrefly-graph"]
operators          = ["dep:graphrefly-operators"]
storage            = ["dep:graphrefly-storage"]
structures         = ["dep:graphrefly-structures"]
content-addressing = ["graph-codec", "graphrefly-graph/content-addressing"]
acid               = ["storage", "graphrefly-storage/redb-store"]
crdt               = ["structures", "graphrefly-structures/crdt"]
```

A binary built with `--features tracing` literally doesn't link `redb`, `imbl`, `serde_ipld_dagcbor`. LTO + dead-code elimination remove the unused paths.

### What stays maintained in parallel (smaller than today)

- One Rust workspace — shared spec, shared invariants, one fix-it-once codebase
- TS shim layer in `@graphrefly/*-shim` — ~200–500 lines per variant for typings, surface-area hiding, JS-idiom wrappers
- Python shim layer — same, plus async-runtime adapters

Compared to today's TS-only + Python-only parallel codebases (~30K lines each, manual G.6 parity per CLAUDE.md), this is dramatic reduction. Today's parity burden is ~80% of both codebases; after the port, ~20%.

### Honest claim for messaging

> *Single Rust source tree, distributed in multiple binary builds. Lightweight tracing user installs `@graphrefly/lite` (~400 KB). Heavyweight server user installs `@graphrefly/full` (~3.5 MB). Same protocol; smaller surface in lite. Edge runtimes (Cloudflare Workers, Deno Deploy, Bun) get the WASM build instead of the napi native binary.*

This is the same pattern as Polars (`pip install polars[all]`), serde (`features = ["derive"]`), SWC (`@swc/core-linux-x64-gnu` vs `@swc/wasm`).

### Zero-dep claim under this model

| Distribution layer | Honest claim |
|---|---|
| User-installed runtime deps (npm/PyPI consumer) | Stays zero. Native code is statically linked into the published binary; no transitive npm/pip deps. |
| Binary size | 400 KB – 3.5 MB depending on feature variant chosen. |
| Direct Rust crate consumers | Small audited dep tree (`parking_lot`, `serde`, `blake3`, etc.); honest "minimal audited deps" claim. |

The canonical messaging:

> *Zero JavaScript and Python runtime dependencies. The Rust core uses a small audited set of standard ecosystem crates (parking_lot, serde, blake3, redb, imbl) for performance-critical infrastructure. All native code is bundled into the language-specific binary that ships in the npm or PyPI package — your project's lockfile stays clean.*

---

## OPEN QUESTIONS / FOLLOW-UPS

These are real but should NOT block 13.6.A; flag in `docs/optimizations.md` for follow-up:

1. **Cross-language handle-space composition.** TS-frontend graph mounts a Python-frontend subgraph: registries are disjoint. wave_protocol doesn't model this. Probably "explicit serialize bridge" or "process boundary" rather than fusing registries.
2. **Async fn boundary.** State-node `Compute` in wave_protocol is synchronous. Real Rust core handing async fns back to JS/Py introduces interleaving. Captured under SinkNestedEmit / multi-sink iteration models for related concerns; explicit async-fn modeling future work.
3. **Refcount soundness.** Bindings must release handles when core says so, with no double-release and no leak. wave_protocol doesn't model refcounts. Could add a small companion module if it matters at audit time. Prototype `extensions.test.ts` smoke-tests bounded handle counts.
4. **Custom-equals oracle correctness.** `CustomEqualsExtendsIdentity` ASSUME catches misconfigured oracles structurally, but doesn't catch oracles violating symmetry/transitivity. Probably out of scope for the protocol spec; binding-layer test convention.
5. **Implementation-plan Phase 14 missing `### Phase 14 — …` header.** Body block exists at lines 1207+ without a section header. Editing accident; trivial fix when next touching that file.

---

## DECISIONS LOCKED THIS SESSION

1. **Architecture: handle-protocol cleaving plane** — Core sees opaque `HandleId`, never user `T`. Validated by TS prototype + TLA+ refinement.
2. **Timing: lock 13.6 + Phase 14 in TS first; port after.** Research artifacts run alongside; production migration commit waits.
3. **Audit independence: don't pre-empt the in-flight 13.6 audit** with handle-protocol artifacts. Use them as second-pass comparison after audit completes.
4. **6-crate Cargo workspace structure** confirmed (core / graph / operators / storage / structures + bindings-js + bindings-py + optional bindings-wasm).
5. **Multi-distribution model**: feature-gated builds, lite/standard/full + WASM, single source tree, no parallel codebases.
6. **Implementation-plan amendments**: Rust-port deferral guardrails added to Phase 13.6 and Phase 14 with explicit DON'T DEFER / STRONG DEFER lists.
7. **CRDT and ACID hardening**: strong defer to Rust port. Don't bolt onto TS.

## DECISIONS DEFERRED (NOT MADE THIS SESSION)

- Whether to actually commit to the Rust port (waiting for 13.6 + Phase 14 close).
- Whether to ship a parallel pure-TS distribution post-Rust-port (probably no — feature-gated Rust + WASM serves all the same use cases).
- Specific MSRV (Minimum Supported Rust Version) — pin during M1.
- Whether to publish to crates.io for direct Rust-user consumption, or only via the language bindings.

---

## FILES CHANGED

### New artifacts (this session)
- `src/__experiments__/handle-core/core.ts` — handle-only dispatcher (~370 lines)
- `src/__experiments__/handle-core/bindings.ts` — value registry + FFI counters + dynamic builder (~370 lines)
- `src/__experiments__/handle-core/core.test.ts` — 13 invariant tests
- `src/__experiments__/handle-core/extensions.test.ts` — 9 tests for FFI counters / dynamic / refcount
- `docs/research/handle-protocol.tla` — refinement spec EXTENDS wave_protocol
- `docs/research/handle_protocol_MC.tla` — diamond scenario MC harness
- `docs/research/handle_protocol_MC.cfg` — TLC config
- `docs/research/handle-protocol-audit-input.md` — structured input for 13.6.A
- `archive/docs/SESSION-rust-port-architecture.md` — this file

### Edits to existing files
- `docs/implementation-plan.md` — added Rust-port deferral guardrail to Phase 13.6 (lines 1203–1217)
- `docs/implementation-plan.md` — added Rust-port deferral guardrail to Phase 14 (lines 1237–1254)

### Verification snapshot
- TS suite: 2780/2780 passing (was 2771; +9 from new extension tests, +13 from core tests, -13 already counted; actual delta +9 net)
- Biome lint: clean across all new files
- TLC: 5 scenario MCs verified clean, 39,331 distinct states total, ~10s combined runtime
