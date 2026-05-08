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

Plus the parity-oracle / pure-TS distribution (added 2026-05-05; see Part 12 below):

```
@graphrefly/legacy-pure-ts       ← frozen pure-TS impl, oracle    ~150 KB (no native)
                                   sunset on 1.0 ship per Part 12 Q4
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

### Decisions locked 2026-05-05 (post-Phase-14, Rust port greenlit)

8. **Rust port greenlit.** Phase 14 landed on main; preconditions satisfied.
9. **Part 10 simplifications approved** — all §10.1–10.18 simplifications are locked design direction for the Rust port.
10. **Versioning (V0–V3) unified with mutate** — `MutationGuard::drop()` advances version + computes blake3 CID + emits changeset atomically. V2/V3 become trait bounds and struct fields, not separate machinery.
11. **Guard/ABAC moves to core as data** — `Policy` is a serializable struct (not a closure), enforced at subgraph level. Ownership claim = policy mutation. V3 caps = CID of `Policy`.
12. **Subgraph IS the enforcement boundary** — `&mut Subgraph` acquisition checks policy. No per-node guard stacking.
13. **L0–L3 staircase in core** — expiry/heartbeat logic is a `u64` compare in the write-path guard; `ownershipController()` convenience stays binding-side.

### Decisions locked 2026-05-05 (parity oracle Q1–Q7)

14. **Pure-TS preserved as parity oracle.** Current TS implementation does NOT migrate to a thin shim immediately; instead, it survives as `@graphrefly/legacy-pure-ts` to drive parity tests against the Rust binding through 1.0. See Part 12 for Q1–Q7 lock detail. Implements via Phase 13.9 in `docs/implementation-plan.md`.
15. **Shim package architecture for `@graphrefly/graphrefly`.** Public package becomes a thin TS layer delegating to `@graphrefly/native` (napi binding) with fallback to `@graphrefly/legacy-pure-ts` when native binary is unavailable (sandboxed JS, edge runtimes without WASM, restricted enterprise environments).
16. **Sunset on 1.0 ship.** The pure-TS oracle is 1.0-bound infrastructure; archived to `archive/legacy-pure-ts/` after 1.0 ships and parity has held across N consecutive zero-divergence releases. Restores the working-assumption end-state from `graphrefly-rs/CLAUDE.md` ("TS impl migrates to a thin shim").

## DECISIONS DEFERRED (NOT MADE THIS SESSION)

- ~~Whether to actually commit to the Rust port (waiting for 13.6 + Phase 14 close).~~ **RESOLVED 2026-05-05:** Phase 14 landed; Rust port greenlit.
- Whether to ship a parallel pure-TS distribution post-Rust-port (probably no — feature-gated Rust + WASM serves all the same use cases).
- Specific MSRV (Minimum Supported Rust Version) — pin during M1.
- Whether to publish to crates.io for direct Rust-user consumption, or only via the language bindings.

---

## PART 10: RUST SIMPLIFICATION ANALYSIS (2026-05-05, post-Phase-14 lock)

Phase 14 landed on `main`. This section catalogs concrete simplifications Rust enables — TS workarounds that disappear, data structures that collapse, protocol mechanisms that become cheaper or cleaner.

### 10.1 Message Protocol → Enum Dispatch (eliminates array allocations)

**TS:** Messages are `[type, payload?]` tuples — each emit allocates `[[DATA, v]]` wrapper arrays. Inner tuples are heap-allocated objects. Type discrimination is `m[0] === DATA` integer comparison after array dereference.

**Rust:**
```rust
#[repr(u8)]
enum Message<T> {
    Dirty,
    Data(T),
    Resolved,
    Invalidate,
    Complete,
    Error(Box<dyn Error>),
    Pause(LockId),
    Resume(LockId),
    Start,
    Teardown,
}
```

Stack-allocated for small `T`. Zero wrapper indirection. Pattern matching is exhaustive — impossible to forget a message type. Estimated 100+ ns → 10–20 ns per dispatch.

### 10.2 PAUSE/RESUME → State Enum + VecDeque (eliminates 4 fields)

**TS:** Four separate fields: `_pauseLocks: Set<unknown>`, `_pauseBuffer: Messages[] | null`, `_pauseDroppedCount: number`, `_pauseOverflowed: boolean`, `_pauseStartNs: number`.

**Rust:**
```rust
enum PauseState {
    Active,
    Paused {
        locks: SmallVec<[LockId; 2]>,  // typically 1–2 locks
        buffer: VecDeque<Message<HandleId>>,
        dropped: u32,
        started_at: u64,
    },
}
```

- Impossible to access buffer fields when not paused (compiler refuses).
- `VecDeque` is a ring buffer natively — O(1) push/pop, no `Array.shift()` O(n).
- `LockId` is a newtype `u64` — no collision risk, no `Set<unknown>` runtime overhead.
- Replay on resume: `while let Some(msg) = self.buffer.pop_front() { ... }` — no array copy.

### 10.3 Diamond Resolution → Explicit Bitmask (eliminates overloaded `undefined`)

**TS:** Uses `_cached === undefined` to mean BOTH "never populated" AND "reset this wave." Counter-correctness depends on `dep.dirty` pre-check ordering. No explicit bitmask.

**Rust:**
```rust
struct WaveTracker {
    settled: u64,           // bit per dep (up to 64; BitVec for more)
    all_deps_mask: u64,     // precomputed at subscribe time
}

impl WaveTracker {
    fn mark_settled(&mut self, dep_idx: usize) { self.settled |= 1 << dep_idx; }
    fn is_complete(&self) -> bool { self.settled == self.all_deps_mask }
    fn reset(&mut self) { self.settled = 0; }
}
```

- Single atomic compare for "all deps settled" — O(1) instead of O(n) scan.
- No semantic overloading; cache state is a separate enum:
```rust
enum CacheState<T> {
    Never,         // first-run gate holds
    Invalidated,   // reset this wave
    Live(T),       // has value
}
```

### 10.4 DepRecord → Struct with Compile-Time Guarantees

**TS:** `_deps.indexOf(record)` is O(n) per callback because `_setDeps` can reorder. Each DepRecord has 6 mutable fields with subtle interaction ordering.

**Rust:**
```rust
struct DepRecord {
    node_id: NodeId,
    slot_index: u32,        // stable index into parent's dep array
    prev_data: HandleId,    // NO_HANDLE = sentinel
    dirty: bool,
    involved_this_wave: bool,
    data_batch: SmallVec<[HandleId; 1]>,  // typically 0–1 items
    terminal: Option<Terminal>,
}

enum Terminal { Complete, Error(HandleId) }
```

- `slot_index` is assigned at subscribe-time and never changes — O(1) lookup always.
- `SmallVec<[HandleId; 1]>` avoids heap allocation for the common case (single DATA per wave).
- `Option<Terminal>` replaces overloaded `undefined` / `true` / error-payload triple.

### 10.5 Batch Coalescing → Generational Arena (eliminates per-node closure hooks)

**TS:** Each node registers a flush closure in a global `flushHooks[]` array on first emit during batch. N active nodes = N closures. `_batchPendingMessages: Message[] | null` per node.

**Rust:**
```rust
struct BatchFrame {
    pending: Vec<(NodeId, SmallVec<[Message<HandleId>; 4]>)>,
    // OR: arena-allocated flat buffer
}

thread_local! {
    static BATCH: RefCell<Option<BatchFrame>> = RefCell::new(None);
}
```

- Single allocation for the frame, not per-node.
- No closure captures — flush iterates the `pending` vec directly.
- `SmallVec<[Message; 4]>` keeps small batches on the stack.

### 10.6 Multi-Sink Delivery → Iterator (eliminates `[...Set]` spread)

**TS:** `const snapshot = [...this._sinks]; for (const sink of snapshot) sink(messages);` — allocates array copy every delivery to handle mid-iteration unsub.

**Rust:**
```rust
// Option A: epoch-based iteration
struct SinkList {
    sinks: Vec<Option<SinkFn>>,  // None = tombstoned
    epoch: u64,
}

// Option B: SmallVec with swap-remove
// Option C: generational arena (thunderdome crate)
```

- Tombstone + epoch avoids all per-delivery allocation.
- For typical 1–3 sinks: `SmallVec<[SinkFn; 4]>` keeps everything on the stack.

### 10.7 `T | Node<T>` → Trait-Based Resolution (eliminates `isNode()`)

**TS:** Runtime `instanceof NodeImpl` / `x.subscribe !== undefined` duck-typing scattered across patterns, resilience, memory factories.

**Rust:**
```rust
trait IntoNodeInput<T> {
    fn into_input(self, graph: &Graph) -> NodeId;
}

impl<T: Send + Sync + 'static> IntoNodeInput<T> for T {
    fn into_input(self, graph: &Graph) -> NodeId {
        graph.state(self)  // wrap plain value in state node
    }
}

impl<T> IntoNodeInput<T> for NodeId {
    fn into_input(self, _: &Graph) -> NodeId { self }
}
```

Compile-time resolution. Zero runtime checks. Callers pass either — compiler monomorphizes.

### 10.8 Reactive Data Structures → `imbl` + RAII MutationGuard

**TS pain points eliminated:**
1. **O(n) snapshot copies** → `imbl::HashMap::clone()` is O(1) structural sharing
2. **`wrapMutation` try-finally × 4 structures** → single `MutationGuard` with `Drop` impl
3. **`pendingChanges` buffer** → inline append to mutation log (snapshot is cheap)
4. **Ring buffer for logs** → `VecDeque<T>` (IS a ring buffer natively)
5. **Keepalive `subscribe(() => {})`** → `Arc<Subscription>` drops automatically
6. **View cache LRU** → `lru::LruCache` with `Drop`-based cleanup
7. **Backend version tracking** → `AtomicU64::fetch_add` (single CPU instruction)

### 10.9 Resilience State Machines → Enums (eliminates flag fields)

**Retry:**
```rust
enum RetryState {
    Connecting { attempt: u32 },
    Running { sub: Subscription },
    WaitingBackoff { attempt: u32, delay: Duration, timer: Timer },
    Completed,
    Errored(Box<dyn Error>),
    Cancelled,
}
```

**Circuit Breaker:**
```rust
enum CircuitState {
    Closed { failure_count: u32 },
    Open { opened_at: Instant, cooldown: Duration, cycle: u32 },
    HalfOpen { attempts: u32, max: u32 },
}
```

- State data lives IN the variant — no separate `_failureCount`, `_lastOpenedAt`, `_halfOpenAttempts` fields.
- Pattern match is exhaustive — impossible to read `_halfOpenAttempts` in `Closed` state.
- Transitions are explicit `match + return new variant` — no stale field accumulation.

### 10.10 Timer Cleanup → RAII (eliminates ResettableTimer)

**TS:** `ResettableTimer` class with generation counter to detect stale callbacks. Every operator that uses timers manually calls `timer.cancel()` in cleanup.

**Rust:**
```rust
struct Timer {
    handle: Option<JoinHandle<()>>,  // or tokio::time::Sleep
}

impl Drop for Timer {
    fn drop(&mut self) {
        if let Some(h) = self.handle.take() { h.abort(); }
    }
}
```

- Goes out of scope → cancelled. No manual `.cancel()` calls.
- No generation counter needed — ownership proves freshness.

### 10.11 Backpressure → Channel Semantics (simplifies rate limiter)

**TS:** Manual `pending` queue + `syncState()` emission + `droppedCount` companion node + watermark controller with Symbol-based lockIds.

**Rust:** The core dispatcher can use bounded channels internally:
```rust
struct BackpressureSlot<T> {
    sender: crossbeam::Sender<T>,  // blocks when full (sync) or returns TrySendError
    capacity: usize,
}
```

- Backpressure is structural (channel capacity) rather than advisory (PAUSE/RESUME signals).
- For the reactive layer, PAUSE/RESUME still exists as protocol messages, but the implementation is backed by real bounded queues rather than manual bookkeeping.

### 10.12 Subscription Lifecycle → RAII (eliminates unsub arrays)

**TS:** `const unsubs: (() => void)[] = []; ... for (const u of unsubs) u();` repeated in every operator.

**Rust:**
```rust
struct SubscriptionSet {
    subs: Vec<Subscription>,  // Subscription implements Drop
}

impl Drop for SubscriptionSet {
    fn drop(&mut self) {
        // Each Subscription::drop() unsubscribes automatically
    }
}
```

No manual iteration. No forgetting to call unsub. Scope exit = cleanup.

### 10.13 First-Run Gate → Bitmask (O(1) instead of O(n) scan)

**TS:** O(n) scan over `_deps` checking `d.dataBatch.length === 0 && d.prevData === undefined && d.terminal === undefined` for each dep.

**Rust:** Same bitmask as diamond resolution:
```rust
fn check_first_run_gate(&self) -> bool {
    self.wave_tracker.settled != 0 || self.has_called_fn  // one compare
}
```

Or a dedicated `received_mask: u64` that tracks "has ever received DATA" per dep. First-run gate holds until `received_mask == all_deps_mask`.

---

### 10.14 Optimizations.md Items Resolved by Rust

| Item | Status | How Rust Resolves |
|---|---|---|
| **Lock 4.B** (transactional rollback) | Deferred | Ownership + Drop = zero-cost auto-rollback |
| **DF4** (V8 backing-store deopt) | Deferred | No V8; stable memory layout |
| **DF3** (HeadIndexQueue 3× memory) | Deferred | Custom allocators; predictable resize |
| **DF5** (rateLimiter lazy-activation) | Deferred | Monomorphic codegen eliminates dead paths |
| **DF7** (policyGate PY sync) | Deferred | Borrow checker proves safety; no RLock |
| **Fan-out scaling** (179 ns/emit) | Profiled | Arena + epoch iteration; 3–6× improvement |
| **Message array allocs** | Partial | Enum dispatch + stack alloc; 5–10× improvement |
| **Lock 2.D** (cross-tier atomicity) | Deferred | Type-system enforcement |
| **Worker bridge deltas** | Post-1.0 | Structural sharing + bincode; 5–10× wire savings |

---

### 10.15 What Does NOT Simplify

- **Wave protocol semantics** — same invariants regardless of language
- **Batch phase ordering** (tier 0–6 drain sequence) — algorithmic, not language-bound
- **Retention scoring** — still O(n log n) sort
- **Graph topology bookkeeping** — same `describe`/`observe`/`explain` logic
- **Custom equals oracle** — still crosses FFI boundary per check
- **User fn execution** — still crosses FFI per fire

### 10.16 Versioning (V0–V3) → Unified with Mutate + Ownership

**Current TS state:** V0 (id + monotonic counter) and V1 (+ CID + prev link) shipped. V2 (schema validation at boundaries) and V3 (caps = serialized guard policy + cross-graph refs) are post-1.0.

**TS pain points:**
1. Version advancement is a side-effect inside `_emit()` — buried in node.ts line ~3383, conditional on `lastDataIdx` position.
2. CID computation uses vendored sync SHA-256 + JSON canonicalization — slow (JSON.stringify + sort keys + hash) and cross-language determinism is fragile.
3. `NodeVersionInfo = V0 | V1` union requires runtime `"cid" in info` checks.
4. Version info is separate from mutations/changesets — no unified "this mutation advanced version X → X+1" record.

**Rust simplification:**

```rust
enum VersionInfo {
    V0 { id: Uuid, version: u64 },
    V1 { id: Uuid, version: u64, cid: Blake3Hash, prev: Option<Blake3Hash> },
    V2 { /* V1 + schema: SchemaId */ },
    V3 { /* V2 + caps: PolicyCid, refs: Vec<GraphRef> */ },
}
```

Key wins:
1. **CID computation = blake3** — single-pass, zero-copy, parallelizable. No JSON canonicalization needed: hash the dag-cbor bytes directly (deterministic by construction). ~100× faster than SHA-256-of-JSON.
2. **Version advancement inside `MutationGuard::drop()`** — the same RAII guard that pushes snapshots also advances version. No buried side-effect in emit path.
3. **Unified with `BaseChange<T>`** — each change record already carries `version: number`. In Rust, the `MutationGuard` produces `(new_version, cid, change_record)` as an atomic triple. Version/CID/changeset are one operation, not three scattered sites.
4. **V2 schema validation** becomes a compile-time trait bound: `trait SchemaValidated { fn validate(&self) -> Result<(), SchemaError>; }`. Nodes parameterized by schema run validation in the guard, not at "boundaries" (which are vague in TS).
5. **V3 caps (serialized guard policy)** — falls out naturally when guards are Rust-native (see §10.17 below). A cap = a serialized `Policy` struct identified by its blake3 CID. Cross-graph refs = `(GraphId, NodeId)` tuples — trivial in Rust's type system.
6. **`prev` chain → Merkle DAG for free** — blake3 CID of each version links to prev CID. This IS an IPLD-style linked list. With `serde_ipld_dagcbor`, the version chain is a content-addressed DAG natively — no extra work.

**Net effect:** V0–V3 collapse into a single enum that's a field on the Rust `NodeState`. `mutate()` guard advances it. Changesets record it. All three concerns (version, mutation, changeset) are unified in one code path.

### 10.17 Guard / ABAC → Trait-Based Enforcement in Subgraph Lock

**Current TS state:**
- `NodeGuard = (actor: Actor, action: GuardAction) => boolean` — function type
- `policy((allow, deny) => { ... })` — builder pattern returns a `NodeGuard`
- `_guard` + `_extraGuards: Set<NodeGuard>` per node — AND semantics (all must pass)
- `policyGate` in inspect pattern — mounts guards dynamically via `_pushGuard()`
- Ownership protocol (L5–L6 from DS-14.5.A) → claim auto-mounts policy guard on subgraph

**TS pain points:**
1. Guards are opaque functions — can't serialize, can't content-address (V3 caps blocked by this).
2. `_extraGuards: Set<NodeGuard>` is a runtime-growable set — no static analysis of what policies apply.
3. `_pushGuard()` / topology watching for dynamic coverage is complex plumbing (~400 lines in `audit.ts`).
4. Ownership claim → guard update is a multi-step side-effect chain (claim event → derive new policy → push to node → update topology watch).
5. No structural relationship between guard and subgraph boundary — guards are per-node, ownership is per-subgraph.

**Rust simplification — guards as first-class subgraph-level trait:**

```rust
/// A policy is data, not a closure — serializable, content-addressable.
#[derive(Clone, Serialize, Deserialize, Hash)]
struct Policy {
    rules: Vec<PolicyRule>,
}

#[derive(Clone, Serialize, Deserialize, Hash)]
struct PolicyRule {
    effect: Effect,           // Allow | Deny
    actions: ActionSet,       // bitflags: Write | Signal | Observe
    actor_filter: ActorFilter, // ByType, ById, ByClaims, Any
}

/// Subgraph carries its own policy (not individual nodes)
struct Subgraph {
    nodes: Vec<NodeId>,
    owner: Option<OwnershipClaim>,
    policy: Policy,           // enforced at subgraph boundary
    // ...
}

/// Ownership claim IS a policy mutation
impl Subgraph {
    fn claim(&mut self, actor: ActorId, level: OwnershipLevel, opts: ClaimOpts) {
        self.owner = Some(OwnershipClaim { actor, level, expires_at: opts.ttl_ns, .. });
        // Policy auto-derives from ownership — single source of truth
        self.policy = Policy::from_ownership(&self.owner);
    }

    fn check_write(&self, actor: &Actor) -> Result<(), GuardDenied> {
        self.policy.evaluate(actor, Action::Write)
    }
}
```

Key wins:

1. **Policy is data, not closure** — serializable → content-addressable → V3 caps for free. `Policy` struct has a blake3 CID. Cross-graph "can this graph write to that graph?" becomes CID comparison.

2. **Subgraph-level enforcement** — guards check at subgraph boundary, not per-node. Ownership IS a policy — no separate plumbing. Claim/release/override mutate the subgraph's `Policy` field directly.

3. **No `_pushGuard` / `_extraGuards`** — single `Policy` per subgraph, derived from ownership state. AND-composition becomes `Policy::merge(base, overlay)` — a pure data operation.

4. **Ownership → Guard is structural, not reactive wiring:**
   - TS: claim event → subscription → derive policy fn → pushGuard → topology watch for new nodes
   - Rust: `subgraph.claim(actor, level)` → `self.policy = Policy::from_ownership(...)` — one field assignment

5. **L0–L3 staircase maps to enum cleanly:**
```rust
enum OwnershipLevel {
    Static,      // L0: spec annotation only, no runtime expiry
    Ttl,         // L1: expires_at checked on each write
    Heartbeat,   // L2: renewed by heartbeat; expires on miss
    Supervisor,  // L3: always wins regardless of timestamp
}

impl OwnershipClaim {
    fn is_valid(&self, now_ns: u64) -> bool {
        match self.level {
            Static => true,
            Ttl => now_ns < self.expires_at,
            Heartbeat => now_ns < self.last_heartbeat_ns + self.ttl_ns,
            Supervisor => true, // never expires; explicit release only
        }
    }
}
```

6. **Heartbeat (L2) = reactive source into Rust core:**
   - Binding-side creates a reactive source (timer or activity-derived)
   - Each emission crosses FFI as `core.heartbeat(subgraph_id)` → updates `last_heartbeat_ns`
   - Expiry check is a single `u64` compare in the write-path guard — zero allocation

7. **`validateOwnership` PR lint** — in Rust, spec snapshots carry `Policy` CID per subgraph. Diff two snapshots → any subgraph whose policy CID changed AND committer ≠ owner → fail. Pure data comparison, no function evaluation.

**Integration with `mutate()` guard:**

```rust
/// The MutationGuard checks ownership + policy in one path
struct MutationGuard<'a> {
    subgraph: &'a mut Subgraph,
    actor: ActorId,
    prev_version: u64,
}

impl<'a> MutationGuard<'a> {
    fn new(subgraph: &'a mut Subgraph, actor: ActorId) -> Result<Self, GuardDenied> {
        // 1. Check ownership validity (TTL/heartbeat expiry)
        if let Some(ref claim) = subgraph.owner {
            if !claim.is_valid(monotonic_ns()) {
                subgraph.release_expired();
            }
        }
        // 2. Check policy
        subgraph.check_write(&actor)?;
        // 3. Return guard that will advance version on drop
        Ok(Self { subgraph, actor, prev_version: subgraph.version() })
    }
}

impl Drop for MutationGuard<'_> {
    fn drop(&mut self) {
        if self.subgraph.version() != self.prev_version {
            // Version advanced, CID computed, changeset emitted — all in one place
            self.subgraph.advance_version_and_emit();
        }
    }
}
```

**Net effect:** The write path becomes: `MutationGuard::new()` → checks ownership expiry + policy → allows/denies → on success, caller mutates → guard drops → version advances + changeset emits. One code path unifies: guard check, ownership enforcement, version advancement, and changeset emission.

### 10.18 Revised Port Scope Adjustments

| Original Milestone | Adjustment |
|---|---|
| M5 (`graphrefly-structures`) was late | **Pull earlier to M2–M3 timeframe** — `imbl` + `VecDeque` makes structures simpler than TS, and Phase 14 `mutations` companion bundles are part of the same substrate |
| Patterns stay binding-side | **Confirmed** — but `mutate()` factory is generic enough to be a core primitive (it's just RAII guard + batch + audit append) |
| `T \| Node<T>` is binding-side | **Moves to core** — becomes `IntoNodeInput<T>` trait resolved at compile time |
| Resilience operators stay binding-side | **Reconsidered** — state machines are Rust's strength; port to `graphrefly-operators` crate. Only the `NodeOrValue<T>` option-mirror pattern stays binding-side |
| Guard enforcement is patterns-layer | **Moves to core** — policy is data (not closure); enforcement at subgraph level in `graphrefly-core`. V3 caps become CID of the `Policy` struct |
| Versioning is separate from mutations | **Unified** — `MutationGuard::drop()` advances version + emits changeset atomically. V0–V3 is one enum field on node/subgraph state |
| Ownership is patterns-layer preset | **Split** — L0–L3 staircase logic (expiry check, heartbeat tracking) moves to `graphrefly-core` (it's just a `u64` compare in the guard path). `ownershipController()` convenience API stays binding-side |

---

## PART 11: IMPLEMENTATION DIRECTIVE — ACTIVE OPTIMIZATION MINDSET

**This section is a standing directive for all agents working on the Rust port.**

### Correctness first, then exploit Rust's advantages

The Rust port must maintain **complete behavioral parity** with the TS implementation — every invariant in `GRAPHREFLY-SPEC.md`, every TLA+-verified property, every composition-guide rule. The existing TS test suite (translated) is the correctness oracle.

However: **do not blindly transliterate TS patterns into Rust.** At each implementation stage, actively ask:

1. **"Does this TS workaround exist because of a language limitation?"** If yes, replace it with the idiomatic Rust solution. Examples:
   - `T | Node<T>` runtime checks → `IntoNodeInput<T>` trait (§10.7)
   - `_pauseLocks: Set<unknown>` + 4 flags → `PauseState` enum (§10.2)
   - `[...this._sinks]` spread → epoch iteration (§10.6)
   - Try-finally version check → `MutationGuard` Drop (§10.8)
   - `Array.shift()` replay buffer → `VecDeque` (§10.2)

2. **"Can Rust's type system enforce this invariant at compile time?"** If yes, encode it. Examples:
   - Diamond resolution → bitmask with `is_complete()` (§10.3)
   - Cache state overloading → `CacheState` enum (§10.3)
   - State machine flags → enum variants with embedded data (§10.9)
   - Guard closure → serializable `Policy` struct (§10.17)

3. **"Does this allocation exist because JS/TS forces heap allocation here?"** If yes, use stack/SmallVec/arena. Examples:
   - Message tuples → `enum Message<T>` on stack (§10.1)
   - Per-dep `dataBatch: unknown[]` → `SmallVec<[HandleId; 1]>` (§10.4)
   - Per-node batch hooks → single `BatchFrame` vec (§10.5)
   - Subscription arrays → `SubscriptionSet` with Drop (§10.12)

4. **"Can these separate concerns be unified in Rust?"** Examples:
   - Version + mutation + changeset → single `MutationGuard::drop()` (§10.16)
   - Guard + ownership + subgraph lock → `&mut Subgraph` acquisition (§10.17)
   - Snapshot copy + structural sharing → `imbl::HashMap::clone()` O(1) (§10.8)

5. **"Is there a zero-cost abstraction that eliminates this runtime cost?"** Examples:
   - `messageTier()` utility → compile-time tier from enum discriminant
   - `isNode()` runtime check → monomorphized trait impl
   - Lazy-activation violation (DF5) → dead-code elimination on unused paths
   - V8 backing-store deopt (DF4) → stable memory layout by construction

### What NOT to optimize

- **Do not sacrifice readability for micro-optimization.** Rust's compiler optimizes aggressively — write clear code and let LLVM work.
- **Do not break the handle-protocol cleaving plane.** Core sees `HandleId`, never `T`. User values stay in the binding-side registry.
- **Do not add unsafe without justification.** If you reach for `unsafe`, document exactly which invariant you're upholding and why safe Rust can't express it.
- **Do not pre-optimize hot paths before profiling.** Use `criterion` benchmarks to identify actual bottlenecks. The §10 analysis identifies *likely* wins — verify with data.

### Per-milestone checklist

At the start of each milestone (M1–M6), review the relevant §10.x sections for that layer. At the end, verify:
- [ ] No TS workaround transliterated without justification
- [ ] All state machines use enums (not flag fields)
- [ ] All cleanup uses RAII (not manual unsub/dispose)
- [ ] All buffers use appropriate size (SmallVec/VecDeque/arena, not blind Vec)
- [ ] All version/guard/changeset concerns unified where applicable
- [ ] Benchmark comparison against TS baseline for the ported layer

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

---

## PART 12: PARITY ORACLE STRATEGY (2026-05-05, post-M1, M2 Slice D opening)

This part documents the locked strategy for preserving the current pure-TS implementation as a frozen parity oracle alongside the napi-rs binding. Implementation lives in Phase 13.9 of `docs/implementation-plan.md`. This part is the architectural narrative; that phase is the operational sequencing.

### Why an oracle (not just a shim)

The default working assumption in `~/src/graphrefly-rs/CLAUDE.md` was: "TS impl migrates to a thin shim over the napi-rs binding once Rust port reaches parity." That assumption has two problems for the M1→1.0 stretch:

1. **Behavioral parity is asserted, not verified.** The Rust impl ports the spec + the TS test suite; both are static reference points. But the *living TS impl* — battle-tested across 2780 tests, the existing patterns layer, the existing examples and demos — is the highest-fidelity behavior oracle available. Deleting it before 1.0 ships throws away the most valuable regression-detection asset on the project.
2. **Coverage gap during the cleave.** M1 closed the dispatcher; M2/M3/M4/M5/M6 are still ahead. Each Rust milestone exposes a slice of the surface; the binding's user-visible API only reaches the current TS surface around M5–M6. Until then, "the public package" needs a story for surfaces the binding doesn't cover yet. Either the public package's API regresses (unacceptable; pre-1.0 we can break, but the *features* shouldn't disappear) OR it transparently delegates to the pure-TS for un-ported surfaces.

The oracle resolves both. The pure-TS package becomes the parity reference (#1) AND the fallback impl during the cleave (#2). It sunsets when 1.0 ships full surface parity verified across N consecutive zero-divergence releases.

### Locked decisions (Q1–Q7, all 2026-05-05)

| # | Question | Lock | Rationale |
|---|---|---|---|
| Q1 | Naming | `@graphrefly/legacy-pure-ts` | "legacy" reads as sunset signal; deliberate — communicates this is reference / oracle scope, not the long-term distribution strategy. |
| Q2 | Location | `packages/legacy-pure-ts/` in this monorepo | pnpm workspace already in place (`pnpm-workspace.yaml` `packages/*` glob); cross-package tests trivial; CI matrix simple. Spec-amendment lockstep updates land in the same PR as the legacy-pure-ts edit. |
| Q3 | Scope | Full surface — `core/` + `graph/` + `extra/` + `patterns/` + `compat/` | Maximum oracle value. Catches divergence in operators, patterns, compat layers — exactly the surfaces where Rust port can drift in subtle ways. Cost: every Rust-side feature must reach parity through the relevant milestone before its TS counterpart can be considered authoritative. |
| Q4 | Lifetime | Sunset on 1.0 ship | Oracle exists to land 1.0 with high confidence. After 1.0, the Rust impl + spec + TLA+ are sufficient regression substrate. Trade-off: removes the safety net for post-1.0 Rust regressions; mitigated by the fact that the parity test suite either retires or migrates against the Rust impl only. |
| Q5 | Test architecture | Contract-trace (rigor-infra Project 2 shape); interim parameterized runner | Trace-replay is the right long-term shape (highest fidelity, cross-language compatible TS↔PY↔Rust). Blocks on `archive/docs/SESSION-rigor-infrastructure-plan.md` Project 2. Phase 13.9.A interim ships parameterized vitest `describe.each` over both impls; Phase 13.9.B migrates to traces when the harness lands. |
| Q6 | Public package shape | Shim package — `@graphrefly/graphrefly` delegates to `@graphrefly/native` (napi binding) with `@graphrefly/legacy-pure-ts` fallback | Composes with Part 9 multi-distribution model. Users on platforms that ban native binaries (sandboxed JS, restricted enterprise, edge runtimes without WASM) get the pure-TS fallback transparently. Users on supported platforms get the Rust binding without thinking about it. |
| Q7 | Spec ↔ impl authority | Spec authority lives in `~/src/graphrefly/`; both impls implement against the spec. Pure-TS is a *historical implementation*, not a spec source. | Eliminates the ambiguity that "the TS impl is *de facto* spec." After cleave, spec edits land in `GRAPHREFLY-SPEC.md` + TLA+ first, then propagate to BOTH impls in the same lockstep PR. |

### Three-layer package architecture (post-cleave)

```
┌─────────────────────────────────────────────────────────────┐
│ @graphrefly/graphrefly (public; thin TS shim)               │
│   - Selects native impl per platform / availability         │
│   - Re-exports the chosen impl's surface                    │
└──────┬──────────────────────────────────────────┬───────────┘
       │ default                                  │ fallback
       ▼                                          ▼
┌──────────────────────┐                 ┌────────────────────────┐
│ @graphrefly/native   │                 │ @graphrefly/            │
│ (napi-rs binding)    │                 │   legacy-pure-ts        │
│ - linux-x64-gnu      │                 │ - frozen 0.44.x impl    │
│ - linux-arm64-gnu    │                 │ - parity-fix backports  │
│ - darwin-arm64       │                 │ - spec-amendment        │
│ - darwin-x64         │                 │   lockstep updates      │
│ - win32-x64-msvc     │                 │ - sunsets on 1.0 ship   │
│ - wasm (edge / WASM) │                 │                         │
└──────────────────────┘                 └────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│ Rust workspace (~/src/graphrefly-rs/)                        │
│   crates/graphrefly-{core,graph,operators,storage,structures}│
│   crates/graphrefly-bindings-{js,py,wasm}                    │
└──────────────────────────────────────────────────────────────┘
```

**`@graphrefly/native` selection** — the public package uses the napi-rs `optionalDependencies` convention: per-platform binary packages (`@graphrefly/native-linux-x64-gnu` etc.) listed as optional deps; npm installs only the matching one; runtime `require` resolves it. If no native binary matches the platform AND `@graphrefly/native-wasm` doesn't satisfy (e.g. CJS-only runtime, WASM disabled), the shim falls back to `@graphrefly/legacy-pure-ts`.

**`@graphrefly/legacy-pure-ts` consumption surface** — direct import is supported (users who want the zero-native-dep build can pin `@graphrefly/legacy-pure-ts` directly). This is also the migration path for users on banned-native-binary platforms even after sunset (the package ships its 0.44-frozen API for the duration of 1.0; post-1.0 sunset means npm-deprecated, not removed).

### Coverage growth model (per-milestone parity expansion)

The parity test surface widens per Rust milestone close. Each milestone gates on:

| Milestone | Rust crate | Parity-tests added | Shim swap-over |
|---|---|---|---|
| M1 (closed 2026-05-05) | `graphrefly-core` | dispatcher, lifecycle, PAUSE/RESUME, INVALIDATE, terminal cascade, TEARDOWN, meta companions, RAII Subscription, set_deps | (none — no public surface yet) |
| M2 Slice D (opened 2026-05-05) | `graphrefly-graph` (Graph container) | Graph constructor, sugar constructors, lifecycle pass-throughs | (none — Slice D is internal) |
| M2 Slice E (M2 close) | `graphrefly-graph` (full) | mount/unmount, describe, observe, snapshot, namespace, mutate() | `Graph` constructor + topology APIs |
| M3 close | `graphrefly-operators` | all `extra/operators/*` | operators surface |
| M4 close | `graphrefly-storage` | tier dispatch, Node-only persistence | storage surface |
| M5 close | `graphrefly-structures` | reactive data structures, Phase 14 op-log changesets | structures + changeset surface |
| M6 close | `graphrefly-bindings-py` | (cross-language) | (parallel to `graphrefly-py` cleave) |
| 1.0 ship | (full surface) | (all) | (sunset trigger — see below) |

**Until each milestone closes, the shim's swap-over for that surface delegates to `@graphrefly/legacy-pure-ts`.** Users see no API regression; they see the implementation backing each surface flip from pure-TS to Rust as milestones close.

### Sunset trigger (Q4 = sunset on 1.0)

> **Superseded by PART 13 (D084, 2026-05-08).** `@graphrefly/pure-ts` (renamed from `legacy-pure-ts`) is now a permanent first-class peer alongside `@graphrefly/native` and `@graphrefly/wasm` — not an oracle that gets npm-deprecated at 1.0. The parity-test mechanics described in PART 12 still apply; only the sunset framing changes. Read PART 13 first; this section is preserved for historical record.

Once 1.0 ships AND parity has held across N consecutive zero-divergence releases on the parity job (specific N TBD during 1.0 release planning):

1. `git mv packages/legacy-pure-ts/ archive/legacy-pure-ts/` — preserves history.
2. `pnpm remove` from workspace.
3. npm package `@graphrefly/legacy-pure-ts` deprecated with a pointer to `@graphrefly/graphrefly`. NOT removed — still installable for users on banned-native-binary platforms who haven't migrated to WASM.
4. Parity test suite either retires (parity-job CI gate removed) OR migrates into `src/__tests__/` running against the Rust impl only.
5. `@graphrefly/graphrefly` shim drops its legacy-pure-ts fallback path. Native + WASM only. `optionalDependencies` matrix becomes the sole resolution mechanism.

Post-sunset state matches the original `graphrefly-rs/CLAUDE.md` working assumption: "TS impl migrates to a thin shim over the napi-rs binding."

### Q5-interim (parameterized → trace-replay migration path; locked 2026-05-05)

The contract-trace approach (Q5=c lock) is gated on the rigor-infrastructure Project 2 harness in `archive/docs/SESSION-rigor-infrastructure-plan.md`. That harness has not landed yet, and the cleave does NOT block on it:

- **Phase 13.9.A** ships `packages/parity-tests/` with vitest `describe.each([{ impl: legacyImpl }, { impl: rustImpl }])` over the existing test files. Same coverage as today's `src/__tests__/`; doubles test runtime; modest scaffolding cost. Lands per the Phase 13.9 timing schedule (see `docs/implementation-plan.md` Phase 13.9); gates main-branch merges.
- **Phase 13.9.B** migrates `packages/parity-tests/scenarios/*` from `describe.each` to trace-record + trace-replay. Parameterized runner deletes. Same parity-job CI gate, now driven by trace-replay. Lands when rigor-infra Project 2 ships — asynchronous to the M-milestones.

### Why Q4=sunset (rebuttal to Q4=perpetual)

Perpetual oracle has real product value: some platforms ban native binaries (sandboxed JS environments, restricted enterprise, certain edge runtimes without WASM). Keeping `@graphrefly/legacy-pure-ts` as a permanent zero-native-dep distribution alongside Rust would serve those users.

The rebuttal: WASM coverage is the right answer for those platforms, not a parallel pure-TS impl. By 1.0 ship, `@graphrefly/native-wasm` should cover all the platform-restriction cases; if it doesn't, that's a Rust-port gap to fix, not a perpetual TS-impl maintenance burden. Sunset trigger explicitly conditional on parity-stability metric — if parity wobbles, sunset waits.

The deprecated-but-installable status (sunset step 3 above) preserves the migration on-ramp for stragglers. Post-sunset, the package is npm-deprecated but resolvable; users who can't move to WASM yet keep pinning it; new users get `@graphrefly/graphrefly` which is native-or-WASM only.

### What this part does NOT cover

- **The Python parity oracle** — analogous `@graphrefly/legacy-pure-py` story. Separate decision; depends on `graphrefly-py` Rust binding progress (M6).
- **WASM distribution shape beyond placeholder** — `@graphrefly/native-wasm` packaging, edge-runtime testing matrix, COOP/COEP requirements for SharedArrayBuffer. Lands per M-roadmap, not in this part.
- **Multi-distribution lite/standard/full feature-gated builds** — Part 9 strategy. Orthogonal to oracle existence; both layers compose. The lite/standard/full split lives within `@graphrefly/native-*`; the public `@graphrefly/graphrefly` shim selects the right variant per platform AND per consumer's feature tier.
- **Sunset of `@graphrefly/cli` / `@graphrefly/mcp-server`** — those track the public API and continue to consume `@graphrefly/graphrefly` (which transparently delegates). Not affected by the cleave.

---

## PART 13: PUBLIC PACKAGE ARCHITECTURE — POST-PORT END-STATE (2026-05-08, post-Phase-E)

**Context.** Captures the post-port public-package architecture decisions surfaced during a planning conversation on 2026-05-08, after Phase E `rustImpl` activation (D074) landed. Supersedes PART 12 §"Sunset trigger" — pure-TS becomes a permanent first-class peer, not a deprecated parity oracle. PART 12's parity-test mechanics (`packages/parity-tests/`, three-arm registry, milestone-gated coverage growth) still apply.

**Premise change from PART 12.** PART 12 framed `@graphrefly/legacy-pure-ts` as a parity oracle that gets npm-deprecated at 1.0 sunset, with WASM positioned as "the right answer for banned-native-binary platforms." This part rejects that framing: pure-TS continues post-1.0 as the universal fallback because (a) WASM still has bundle-size and instantiation-cost overhead pure-TS doesn't, (b) a real subset of users will choose to never depend on Rust artifacts (security audits, restricted runtimes, simplicity preference), and (c) the maintenance cost of permanent feature parity is real but accepted.

### Decisions locked this conversation

| ID | Decision | Rationale |
|---|---|---|
| **D080** | Async-everywhere public API across all three sibling impls. | Phase E (D077) already locked async-everywhere for the parity contract because Rust+napi requires it. Extending to public API is the natural conclusion: WASM init is also async, so the contract is forced async whenever the user might run on either fast path. Once locked, this is also load-bearing for hiding WASM's `__wbg_init()` step behind every public method call. |
| **D081** | Facade package keeps the name `@graphrefly/graphrefly`. | Zero migration churn for existing consumers. The name carries no architectural meaning; renaming pre-1.0 is allowed but unnecessary. |
| **D082** | Three sibling impls: `@graphrefly/native` (napi-rs), `@graphrefly/wasm` (wasm-bindgen), `@graphrefly/pure-ts` (renamed from `legacy-pure-ts`). | Symmetric model: Node fast path (native) + browser fast path (wasm) + universal fallback (pure-ts). Each sibling exposes the same public TS shape; structural conformance via the `Impl` interface (see Item B below). |
| **D083** | Browser resolution: **opt-in via subpath**, not auto-fallback. Default browser bundle = pure-TS; consumers who want WASM `import { ... } from "@graphrefly/graphrefly/wasm"`. | Pure-TS in browsers is small + tree-shakable + instant. Forcing every browser consumer to fetch+instantiate WASM (auto-fallback) is a bad default. Mirrors lightningcss / swc / esbuild — Node auto-fast, browser opt-in. |
| **D084** | Pure-TS is a permanent first-class peer, not a deprecation track. PART 12 §"Sunset trigger" replaced. | A real subset of users will choose zero-Rust-dep installs indefinitely. Pure-TS serves them. Maintenance cost: every new operator/pattern/storage adapter lands in pure-TS too. Default policy is strict feature parity; tiered parity revisited at 1.0 if cost exceeds value. |

### Sibling end-state shape (replaces PART 12 §"Sunset trigger")

```
@graphrefly/native        — napi-rs Rust binding (Node only)
                            per-platform sub-packages via napi-rs convention
                            (@graphrefly/native-darwin-arm64, etc.)
                            async TS surface; `--dts` generated from #[napi] attrs

@graphrefly/wasm          — wasm-bindgen Rust binding (browsers/Workers/Deno/Bun)
                            single package; .wasm artifact + glue
                            async TS surface; `--typescript` generated from Rust
                            init promise hidden behind every public method
                            (D080 async-everywhere is load-bearing for this)

@graphrefly/pure-ts       — pure TypeScript implementation (universal)
                            published rename of packages/legacy-pure-ts
                            sync internals; published surface async-wrapped via Promise.resolve()
                            zero Rust toolchain anywhere in dep tree

@graphrefly/graphrefly    — facade (kept name)
                            optionalDependencies: @graphrefly/native (Node fast path)
                            dependencies: @graphrefly/pure-ts (universal fallback)
                            "exports" conditions:
                              - "node":    try-require native; catch → pure-ts
                              - "browser": pure-ts
                              - "./wasm":  forces @graphrefly/wasm (browser opt-in subpath)
                            re-exports the resolved Impl

@graphrefly/patterns/*    — peerDependencies: @graphrefly/graphrefly
                            no native/wasm/pure-ts awareness
                            inherits whatever the facade resolved
```

### Pre-port slice (NEXT — picked up via `/porting-to-rs`)

**Goal.** Land the cheap-now-expensive-later structural work BEFORE continuing M2 → M3 → M4 → M5. Two items: rename pure-ts to its publication name, and promote the parity-test `Impl` interface to public-API-grade policy. Defers all genuinely premature work (facade build, wasm impl, `exports` conditions) to near-1.0.

**Why pre-port.** Each milestone close (M2 Slice E, M3, M4, M5) widens `Impl` and adds `legacy-pure-ts` references in tests/docs/examples. Doing the rename + policy lock now means every subsequent milestone lands into the canonical shape; doing it later means a single bigger refactor sweeping all milestone-era artifacts.

**Why these two and no more.** Building the facade now requires resolution code for two impls that don't fully exist. Building `@graphrefly/wasm` now requires the underlying Core/Graph/operator features to be ported first. Both are wasted iteration. The rename + policy lock are the only items that grow more expensive linearly with milestone count.

#### Item A: Rename `packages/legacy-pure-ts` → `packages/pure-ts` and republish as `@graphrefly/pure-ts`

**Scope.** Rename the package directory, update the npm name, update all references across the workspace + docs. Sync internals stay sync — the async-wrapped published face is deferred to facade-build time (Deferred 1 below).

**File-by-file changes:**

1. `git mv packages/legacy-pure-ts packages/pure-ts`
2. `packages/pure-ts/package.json` — set `"name": "@graphrefly/pure-ts"`. Sweep description / keywords for "legacy" wording.
3. `packages/pure-ts/tsup.config.ts` — verify `assertBrowserSafeBundles` paths still resolve (no hardcoded `legacy-pure-ts` strings in error messages).
4. Root `package.json` (shim) — replace `@graphrefly/legacy-pure-ts` deps + scripts referencing the package path.
5. Root `src/*.ts` — change every one-liner `from "@graphrefly/legacy-pure-ts/*"` → `from "@graphrefly/pure-ts/*"`.
6. Root `tsup.config.ts` — any remaining path/build references.
7. `packages/parity-tests/`:
   - `package.json` — replace dep.
   - `impls/types.ts` — `import type * as legacy from "@graphrefly/pure-ts"`. Optionally rename the local alias `legacy` → `pureTs` for clarity (not load-bearing; can defer if it adds churn).
   - `impls/legacy.ts` → rename file to `impls/pure-ts.ts`. Rename export `legacyImpl` → `pureTsImpl`. Update `impl.name` from `"legacy-pure-ts"` to `"pure-ts"`. The "legacy" framing was specifically PART 12's parity-oracle frame; under PART 13 framing this arm IS the pure-TS first-class peer.
   - `impls/registry.ts` — update import + export name.
   - `scenarios/**/*.test.ts` — update any `impl.name === "legacy-pure-ts"` checks; update any imports.
   - `README.md` — sweep "legacy" wording where it referred to the parity-oracle frame; preserve where it refers to historical Phase 13.9.A timing.
8. `packages/cli/`:
   - `package.json` — replace dep.
   - `vitest.config.ts` — alias path `packages/legacy-pure-ts/src/index.ts` → `packages/pure-ts/src/index.ts`.
   - source / test imports — rename.
9. `packages/mcp-server/` — same pattern as cli.
10. `pnpm-lock.yaml` — regenerate via `pnpm install`.
11. `pnpm-workspace.yaml` — verify `packages/*` glob still matches (it will).
12. **`CLAUDE.md`** (this repo): global find/replace `legacy-pure-ts` → `pure-ts`. Update the cleave-architecture paragraph: drop "frozen pure-TS implementation" + "Sunset trigger (Q4)" framing. Cite PART 13 of this session doc as authority for the new framing (pure-TS as permanent peer).
13. **Docs:**
    - `docs/implementation-plan.md` Phase 13.9.A entries — language sweep.
    - `archive/docs/SESSION-rust-port-architecture.md` — DO NOT mass-edit historical content. PART 12 already has the "Superseded by PART 13" callout; leave the rest of PART 12 intact.
    - Other `archive/docs/SESSION-*.md` — leave alone (historical sessions; future readers cross-reference PART 13).
14. `~/src/graphrefly-rs/docs/migration-status.md` — language sweep where it references the TS package by name. Add a single-line note that 13.9.A's "legacy" framing is superseded.
15. `~/src/graphrefly-rs/CLAUDE.md` — language sweep if it references the TS package by name.

**Acceptance criteria:**

- `pnpm test` green (pure-ts test suite + parity-tests).
- `pnpm test:parity` green (with rust arm activation if `@graphrefly/native` is built; without otherwise).
- `pnpm run lint` clean.
- `pnpm run build` clean (root shim builds against renamed `@graphrefly/pure-ts`).
- `pnpm bench` runs (no broken refs).
- Grep verify no remaining `legacy-pure-ts` references in non-historical files: `git grep -i "legacy-pure-ts" -- ':!archive/'` returns zero results.
- The renamed parity-tests arm exports `pureTsImpl`; `scenarios/` use `impl.name === "pure-ts"` if any check exists.

**Out of scope for this slice:**

- Adding the async-wrapped published face (deferred to facade-build slice).
- Building `@graphrefly/graphrefly` facade (deferred to near-1.0).
- Building `@graphrefly/wasm` (deferred to post-M5).
- `exports` conditions / browser opt-in subpath (deferred to facade-build).
- Migration tooling / codemod for external users (pre-1.0 — no external users to migrate).

#### Item B: Promote `Impl` interface to public-API-grade policy (no code move)

**Scope.** A docstring update + a CLAUDE.md note establishing that `Impl` interface widening IS a public-API decision, not a "test scaffolding" addition. No code structure changes; no file moves; no contract package extraction.

**File-by-file changes:**

1. `packages/parity-tests/impls/types.ts` top-of-file docstring — replace the "narrow public surface a parity scenario uses" framing with: "**Canonical public-API contract for the three sibling impls.** Every method here is part of GraphReFly's public surface and must be implemented by `@graphrefly/pure-ts`, `@graphrefly/native`, and `@graphrefly/wasm`. Widening this interface is a public-API decision; treat additions deliberately." Reference PART 13 of this session doc as authority.
2. **`CLAUDE.md`** — add a one-line note under the parity-tests bullet in §Layout: "`packages/parity-tests/impls/types.ts` `Impl` interface IS the public-API contract — widening it is a public API decision (cite PART 13 of `archive/docs/SESSION-rust-port-architecture.md`)."

**Acceptance criteria:**

- The docstring is in place at `packages/parity-tests/impls/types.ts`.
- The CLAUDE.md note is in place.
- No code changes; no test changes.

**Why no extraction to a separate `@graphrefly/contract` package.** TS structural typing means impls don't need to import a separate contract module — they conform structurally. A contract package adds maintenance cost without correctness gain. The `Impl` location at `packages/parity-tests/impls/types.ts` is fine; only the policy framing changes.

### Deferred to near-1.0 (after M5 close, public-release prep)

These items wait until the Rust port is feature-complete (M5 closed). Building any earlier means writing resolution code / bindings for features that don't exist yet.

#### Deferred 1: Build the `@graphrefly/graphrefly` facade with three-way resolution

- `try { require("@graphrefly/native") } catch { import("@graphrefly/pure-ts") }` for Node.
- `package.json` `exports` conditions:
  - `"node"`: native fall-through to pure-ts.
  - `"browser"`: pure-ts only.
  - `"./wasm"`: forces `@graphrefly/wasm` regardless of env (browser opt-in subpath, per D083).
- Re-export the resolved Impl as the package's public surface.
- Async-wrap the pure-TS internals (`Promise.resolve()` shim) — published surface is async-everywhere across all three siblings (D080).

#### Deferred 2: Implement `@graphrefly/wasm` from the wasm-bindgen scaffold

- Scaffold lives at `~/src/graphrefly-rs/crates/graphrefly-bindings-wasm/` (currently feature-flagged, no real impl).
- Surface mirrors `@graphrefly/native`'s napi-rs binding (same `Impl`-conformant TS exports), via wasm-bindgen.
- `wasm-bindgen --typescript` generates `.d.ts` from Rust attrs (analogous to napi `--dts`).
- WASM init wrinkle: every public method is intercepted with a one-time init promise. First call awaits `__wbg_init()`; subsequent calls hit a resolved promise. Hidden from user. **Load-bearing on D080.**
- Feature-gated builds (lite / standard / full per PART 9) compose with the wasm crate — D082's sibling layer is orthogonal to PART 9's feature-tier layer.

#### Deferred 3: parity-tests three-arm registry

- `packages/parity-tests/impls/registry.ts` widens to `[pureTsImpl, rustImpl, wasmImpl]` filtered for null.
- `wasmImpl` adapter file mirrors `rustImpl` shape but loads `@graphrefly/wasm`.
- jsdom or happy-dom env for the wasm arm test environment.
- Three-way divergences fail loud across all three impls — meaningful correctness multiplier (wasm-bindgen has different marshalling + GC timing + init semantics from napi-rs).

#### Deferred 4: Pure-TS feature-parity policy

D084 commits pure-TS to permanent feature parity. Real cost: every new operator/pattern/storage adapter lands in pure-TS too. **Open decision** for near-1.0:

- **Strict parity** (default): every public API has a pure-TS implementation, possibly slow.
- **Tiered parity**: core protocol + common operators in pure-TS; high-perf adapters native+wasm only with pure-TS getting a "no-op or naive" implementation that throws or degrades gracefully.

Default to strict parity until evidence forces tiering. Worth revisiting at 1.0.

#### Deferred 5: Migration messaging

- README + website framing of "three siblings, one facade."
- Patterns docs: clarify that `import from "@graphrefly/graphrefly"` is the always-correct choice; subpath-import only for explicit WASM opt-in.
- Wave 2 launch copy: depending on `archive/docs/SESSION-DS-14.5-A-narrative-reframe.md` framing, may need adjustment if pure-TS-as-permanent-peer affects positioning.

### Open questions (revisit at or near 1.0)

- **Browser resolution model.** D083 locked browser opt-in via subpath (model 2). Could later evolve to auto-fallback (model 1) if user demand justifies forcing every browser consumer to use WASM.
- **WASM single-package vs feature-split.** PART 9 sketched lite/standard/full WASM builds. Whether `@graphrefly/wasm` is one package (with feature-gated runtime opts) or three peer packages (`@graphrefly/wasm-lite`, `@graphrefly/wasm-standard`, `@graphrefly/wasm-full`) is a separate decision deferred to the wasm-impl slice.
- **Pure-TS feature parity policy** (Deferred 4 above).
- **Python parity oracle.** Analogous `@graphrefly/legacy-pure-py` story for the Python side. Separate decision; depends on `graphrefly-py` Rust binding progress (M6). Not addressed here.

### Cross-references

- **PART 12 §"Sunset trigger"** — superseded by D084 (one-line callout added in PART 12).
- **PART 9 §"Use cases + distribution strategy"** — feature-gated build matrix still applies; composes with D082 (sibling layer is orthogonal to feature-tier layer).
- **Phase 13.9.A in `docs/implementation-plan.md`** — needs a follow-up entry referencing PART 13 / Item A as the pre-port slice that lands before M2 Slice E continues.
- **`archive/docs/SESSION-DS-14.5-A-narrative-reframe.md`** — Wave 2 messaging may need adjustment if pure-TS-as-permanent-peer affects positioning. Flagged in Deferred 5; not assumed.

### Slice handoff for `/porting-to-rs`

When `/porting-to-rs` picks this up next:

1. Read PART 13 in full (this section).
2. Phase 1: read CLAUDE.md, `packages/parity-tests/impls/types.ts`, `packages/parity-tests/impls/legacy.ts`, `packages/legacy-pure-ts/package.json`, root `package.json`, root `src/index.ts` and any other shim entry points to enumerate the rename surface.
3. Phase 2 (HALT): present the file-by-file rename plan with any deltas from §"File-by-file changes" above (e.g., files that exist now but didn't when this PART was written). Confirm `@graphrefly/legacy-pure-ts` references in `~/src/graphrefly-rs/docs/migration-status.md` and `~/src/graphrefly-rs/CLAUDE.md` are still in scope.
4. Phase 3: implement Items A + B together as one PR (rename + policy update). Land BEFORE the next M-milestone slice opens.
5. After: log decisions D080–D084 in `docs/rust-port-decisions.md`. Add a Phase 13.9.A follow-up entry in `docs/implementation-plan.md` cross-referencing this PART.

This slice is **not a Rust-port slice** — no canonical-spec rules touched, no `~/src/graphrefly-rs/` source changes (only doc updates). Pure refactor + policy lock. The skill's Phase 2 HALT is still warranted because the multi-file rename touches public-facing surfaces.

---

## PART 14: RELEASE PROCESS — REGISTRIES, CI, PRE-PORT ACTION ITEMS (2026-05-08)

**Context.** Companion to PART 13 covering the release/CI process for the three-sibling-plus-facade architecture. Captures registry semantics (crates.io flat namespace, no orgs), what's published where, the two-stage automated pipeline shape, and a pre-port action-item list of cheap-now items separate from PART 13's pre-port slice.

### Registry semantics

| Registry | Namespacing | Reservation | Notes |
|---|---|---|---|
| **crates.io** | Flat global namespace, first-come-first-served. **No orgs / scopes.** | Publish at least once at any version; that claims the name. Owners can be added via `cargo owner --add github:<user>/<team>`. | One account per publisher; auth via `cargo login <token>`. PyPI-style ownership but flatter. |
| **npm** | Scoped (`@graphrefly/*`) — scope-owner controls all sub-package names. | Scope `@graphrefly` already owned (you have `@graphrefly/legacy-pure-ts`). Just publish new sub-packages. | Per-platform sub-packages for napi-rs are also `@graphrefly/*` — no extra ownership concerns. |
| **PyPI** | Flat namespace (orgs exist but optional, don't affect naming). | Publish at any version to claim. | Will be `graphrefly-py` per current naming; M6+. |

### What gets published WHERE

| Artifact | Registry | Format | Notes |
|---|---|---|---|
| `graphrefly-core` | crates.io | Rust crate | Foundational — must publish first in dep order |
| `graphrefly-graph` | crates.io | Rust crate | Depends on `-core` |
| `graphrefly-operators` | crates.io | Rust crate | Depends on `-core` |
| `graphrefly-storage` | crates.io | Rust crate | Depends on `-core`, `-graph` |
| `graphrefly-structures` | crates.io | Rust crate | Depends on `-core`, `-graph` |
| `graphrefly` (umbrella, optional) | crates.io | Rust crate | Re-exports the above for one-import Rust consumers (decision deferred — ship if Rust users emerge) |
| `graphrefly-bindings-js` | **`publish = false`** | — | Built locally → `@graphrefly/native-*` |
| `graphrefly-bindings-wasm` | **`publish = false`** | — | Built locally → `@graphrefly/wasm` |
| `graphrefly-bindings-py` | **`publish = false`** | — | Built locally → `graphrefly-py` |
| `@graphrefly/native` | npm | umbrella JS package | Tiny loader; picks per-platform sub-package at runtime |
| `@graphrefly/native-darwin-arm64` | npm | per-platform binary | Built by napi-rs on a darwin-arm64 runner |
| `@graphrefly/native-darwin-x64` | npm | per-platform binary | |
| `@graphrefly/native-linux-x64-gnu` | npm | per-platform binary | |
| `@graphrefly/native-linux-arm64-gnu` | npm | per-platform binary | |
| `@graphrefly/native-linux-x64-musl` | npm | per-platform binary | |
| `@graphrefly/native-win32-x64-msvc` | npm | per-platform binary | |
| `@graphrefly/wasm` | npm | single .wasm + glue | Platform-independent; one artifact |
| `@graphrefly/pure-ts` | npm | pure JS/TS | Standard npm publish |
| `@graphrefly/graphrefly` | npm | facade | Re-exports resolved sibling; depends on `@graphrefly/pure-ts` (always), `@graphrefly/native` (optional) |
| `graphrefly-py` | PyPI | per-platform wheels | Built by maturin on matrix runners (M6+) |

**Key insight:** the bindings crates (`-bindings-js`, `-bindings-wasm`, `-bindings-py`) **never go to crates.io.** They're Cargo workspace members purely so they can consume the user-facing crates as path deps at build time. Their output is npm/PyPI artifacts. Mark them `publish = false` defensively to prevent accidental publish.

### Two-stage CI release pipeline

```
Stage 1 — Rust libraries → crates.io
  Triggered by: release-plz PR merge OR git tag push (e.g. v0.5.0)

  release-plz handles:
    - Compute version bumps from conventional commits
    - Generate changelogs
    - cargo publish -p graphrefly-core         (foundational; no in-workspace deps)
    - wait for crates.io index (~30s–2min)
    - cargo publish -p graphrefly-graph        (depends on -core)
    - cargo publish -p graphrefly-operators
    - cargo publish -p graphrefly-storage
    - cargo publish -p graphrefly-structures
    - cargo publish -p graphrefly              (umbrella, if shipping)

Stage 2 — npm packages → npm
  Depends on: Stage 1 (some packages reference crate versions in build).

  @graphrefly/pure-ts:
    one runner → tsup build → npm publish

  @graphrefly/native (matrix build):
    GH Actions matrix:
      darwin-arm64, darwin-x64,
      linux-x64-gnu, linux-arm64-gnu, linux-x64-musl,
      win32-x64-msvc
    each runner: cargo build --release + napi build → upload .node artifact
    final job: download all artifacts → napi prepublish → npm publish per-platform + umbrella

  @graphrefly/wasm:
    one linux runner → wasm-pack build → npm publish

  @graphrefly/graphrefly (facade, last):
    one runner → tsup build → npm publish

Stage 3 — PyPI (M6+, parallel matrix via maturin publish)
```

### Tool recommendations

- **[`release-plz`](https://release-plz.dev/)** — Rust side. PR-based versioning + automated `cargo publish` in dep order. Modern, GH-integrated, well-maintained. Roughly the Rust analog of `changesets`.
- **[`changesets`](https://github.com/changesets/changesets)** — npm side. Per-package version bumps + changelogs from intent files. Standard for monorepos.
- **[`@napi-rs/cli`](https://napi.rs)** — provides `napi build`, `napi prepublish`, and a default GH Actions workflow template. Don't write the platform matrix from scratch.
- **[`wasm-pack`](https://rustwasm.github.io/wasm-pack/)** — one-command build + publish for `@graphrefly/wasm`.
- **[`maturin`](https://www.maturin.rs/)** — analogous role for `graphrefly-py` (M6+).

### One-time manual setup (genuinely manual, ~30 min total)

```
A. crates.io account
  1. Create account at https://crates.io (link via GitHub OAuth).
  2. Generate API token; cargo login <token> on local machine.
  3. Add CRATES_IO_TOKEN to GitHub Actions secrets for CI bot.
  4. After first publish per crate, run:
       cargo owner --add github:graphrefly/<bot-team-name> graphrefly-core
     (or whichever team you give CI publish access to)

B. npm scope @graphrefly
  Already owned. Just confirm GH Actions bot has publish rights:
    npm token list (under your npm account)
  Add NPM_TOKEN to GitHub Actions secrets if not present.

C. GitHub Actions secrets
  - CRATES_IO_TOKEN (Stage 1)
  - NPM_TOKEN       (Stage 2)
  - PYPI_TOKEN      (Stage 3, M6+)

D. Reserve crate names on crates.io (cheap-now, prevents squatting)
  See "Pre-port action items" below — Item C.
```

### Pre-port action items (do BEFORE next M-milestone slice opens)

These are PART 14's pre-port items, complementary to PART 13's Item A (rename) and Item B (Impl policy). Order doesn't matter; can land in same PR or separately.

#### Item C: Mark bindings crates as `publish = false`

**Why now:** defensive. Prevents accidental publish to crates.io of crates that have no business being there. Also signals intent to anyone reading `Cargo.toml`. Cost: trivial. Three edits.

**Files:**
- `~/src/graphrefly-rs/crates/graphrefly-bindings-js/Cargo.toml` — add `publish = false` to `[package]`.
- `~/src/graphrefly-rs/crates/graphrefly-bindings-py/Cargo.toml` — same.
- `~/src/graphrefly-rs/crates/graphrefly-bindings-wasm/Cargo.toml` — same.

**Acceptance:** `cargo check` clean (no functional change); `cargo publish --dry-run -p graphrefly-bindings-js` errors with "this package is marked publish = false."

#### Item D: Reserve `graphrefly-*` crate names on crates.io

**Why now:** crates.io is flat global namespace — anyone can claim `graphrefly-core` if you wait. Niche name + low-traffic project means real squatting risk is small, but reservation is ~10 minutes once `cargo login` is set up. Cheapest insurance available.

**Prerequisite:** A crates.io account + `cargo login <token>` on a publishing machine (your local machine is fine for the reservation publish; CI takes over from there).

**Steps (manual; requires your auth):**

```bash
# One-time:
#   1. https://crates.io → "Account Settings" → "API Tokens" → New Token
#   2. cargo login <token>
#   3. Bump workspace.version from "0.0.0" to "0.0.1" in
#      ~/src/graphrefly-rs/Cargo.toml — crates.io accepts 0.0.x but the
#      0.0.0 placeholder is unpublishable on some setups; 0.0.1 is the
#      minimum sane reservation version.

# Reservation script (run from ~/src/graphrefly-rs/):
cargo publish -p graphrefly-core
sleep 60   # wait for crates.io index propagation
cargo publish -p graphrefly-graph
cargo publish -p graphrefly-operators   # only depends on -core
sleep 30
cargo publish -p graphrefly-storage
cargo publish -p graphrefly-structures

# After successful reservation, you can roll workspace.version forward
# whenever you want — these reservations don't lock the version.
```

A helper script lives at `~/src/graphrefly-rs/scripts/reserve-crate-names.sh` with the same flow + dry-run support.

**What gets published:** the actual current state of each crate at version 0.0.1. This is real code on crates.io. Pre-1.0 + license + repository are set, so this is a legitimate (if early) release. Subsequent dev continues at 0.0.x or whatever you bump to.

**Acceptance:** `cargo search graphrefly-core` shows your crate; same for the other four. Each crate page on crates.io shows the README excerpt + link to your repo.

**Defer if:** you're not ready to make `~/src/graphrefly-rs` public yet (the repo URL in `Cargo.toml` becomes a clickable link from crates.io). In that case, swap the `repository` field to a placeholder before publish + revert after, OR simply defer reservation until the repo is public.

#### Item E: Add `release-plz` workflow scaffold (optional, defer if rushed)

Stub the GH Actions workflow at `.github/workflows/release-plz.yml` so future-you doesn't context-switch when 1.0 approaches. release-plz auto-generates a starter via `cargo binstall release-plz && release-plz init`.

Cost: ~15 min. Benefit: future-you isn't reading release-plz docs at 1.0 launch time.

**Defer if:** Rust port still has months to run. Easier to set up release-plz against a stable workspace shape than against one that's still moving.

### What this part does NOT cover

- **Per-platform npm sub-package reservation.** `@graphrefly/native-darwin-arm64` etc. are within your scope; nobody can squat them. Defer.
- **release-plz / changesets configuration tuning.** Default templates work fine; per-project tuning waits for real release pressure.
- **CHANGELOG generation policy.** release-plz uses conventional commits by default. If you want a different convention, configure later.
- **Code signing / SBOM / supply-chain attestation.** Material at scale; not blocking on initial release.
- **Yanking / version retraction policy.** crates.io and npm both support `cargo yank` / `npm deprecate`. Establish policy if/when needed.

### Cross-references

- **PART 13 §"Pre-port slice"** — Items A (rename) + B (Impl policy). Items C–E here are independent; can land in same or separate PR.
- **PART 9 §"Use cases + distribution strategy"** — feature-gated WASM builds (lite/standard/full) compose with the per-package release flow described here. Deferred to wasm-impl slice.
- **`docs/implementation-plan.md`** — Phase 13.9.A and the Rust-port phases reference this part for release prerequisites once M5 closes.

### Slice handoff for `/porting-to-rs` (extends PART 13's handoff)

When `/porting-to-rs` picks up the pre-port work:

1. PART 13 Items A + B (rename + policy) — primary slice.
2. PART 14 Item C (`publish = false` on bindings) — small enough to fold into the same PR.
3. PART 14 Item D (reserve crate names) — REQUIRES user's crates.io auth; agent prepares the script and instructions, user runs after `cargo login`.
4. PART 14 Item E (release-plz scaffold) — defer unless user explicitly wants it now.
