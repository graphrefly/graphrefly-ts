# SESSION — Rust port perf-value investigation

**Status:** OPEN — empirical findings landed 2026-05-16. Strategic
decision (does the Rust port's perf case survive this data) **NOT made
here** — flagged for spec-owner per the no-autonomous-decisions
principle, same posture as D047.

**Filed:** 2026-05-16, prompted by the user question: "how does Rust
compare to pure-ts now? where's the actual bottleneck of the current
parallelism implementation? what are other ways to achieve parallelism
and how do they perform vs current and vs a naive no-lock single-thread
Rust?"

**Authority:** This is an evidence document. It supersedes the
disjoint-regime speedup framing in `graphrefly-rs/docs/porting-deferred.md`
Phase J and the legacy "Rust 2.3–3.4× faster" claim in
`packages/pure-ts/src/__bench__/ffi-cost.bench.local.ts`. It does NOT
rewrite decisions D085–D113; it gives them measured ground truth.

All numbers below: same machine (Apple Silicon), 2026-05-16, back-to-back.

## TL;DR

1. **Rust-the-language is ~3.5× FASTER than the equivalent TS prototype** (minimal single-threaded Rust ~67 ns vs TS prototype ~233 ns). The "production Rust 2.7× slower than the TS prototype" (634 vs 233 ns) is a **~9.5× concurrency-machinery tax** swamping that language advantage — NOT Rust being slow, and NOT a reason to doubt canonical-impl-in-Rust. See §4b (the decisive control). The original §4 framing (production-Rust vs prototype-TS) was apples-to-oranges; §4b corrects it.
2. **The parallelism bottleneck is the Core-global `state.lock()`**, acquired 3+×/emit, NOT the union-find registry. Profiled: ~79% of 4-thread disjoint wall-time is threads parked in the kernel on that one mutex.
3. **The per-partition/registry/union-find machinery is a regime-dependent trade**: it costs a 12–23% per-op tax on cheap state-emit, but buys +81% on expensive-fn disjoint workloads. It is not pure waste, and it is not the contention cause.
4. **The user's "union-find on every sub/unsub is the problem" hypothesis: empirically wrong as stated** — union/split run at register/set_deps, not sub/unsub; the registry *is* a measurable tax (≤23% on state-emit) but threads don't *park* there (tiny critical sections). Park time = hold-time × contention, and `state.lock()` is what's held across real work.
5. **The cross-impl value prop (napi vs pure-ts) remains structurally unmeasurable** through the shipped artifact: `emit_*` is async-only (D206); the existing FFI bench measures Promise-spawn, not emit completion. This is *why* D047 says "UNMEASURED."

## Method

- Honest post-D047 criterion baseline: `cargo bench -p graphrefly-core --bench per_subgraph_parallelism` (warm 0.5s, measure 2s, 20 samples).
- Profile: new `crates/graphrefly-core/examples/profile_disjoint_state_emit.rs` (4t disjoint state-emit, the 2.46× regression regime), `--profile profiling` + `-C force-frame-pointers=yes`, `samply record --save-only`, offline `atos` symbolication + stack-walk attribution to the deepest graphrefly frame. (sudo dtrace unavailable — no TTY; samply child-launch needs no sudo.)
- Naive variant: throwaway `bench_naive` cargo feature (5 cfg-gated edits) — replaces the union-find registry + per-partition `wave_owner` + 4× `registry.lock()` + retry-validate + `held_partitions` with a single process-global `ReentrantMutex`. **Not committed; not a shipping config.**
- Cross-impl: raw `graphrefly-core` criterion `bench_serial_baseline` (constant handle, dedup, subscribed sink) vs `@graphrefly/pure-ts` `handle-core.bench.ts::emit_same_handle` (identical topology). Verified workload-equivalent before comparing.

## 1. Honest post-D047 baseline (current code)

Normalized to equal total work:

| Workload | Serial | 2t-disjoint | 2t-same-part | Reading |
|---|---|---|---|---|
| state-emit 8k | 5.07 ms | 7.54 ms | 7.44 ms | disjoint **1.49× SLOWER**; **= same-partition** (per-partition `wave_owner` buys nothing here) |
| state-emit 16k | 10.64 ms | 26.23 ms (4t) | — | 4t **2.46× SLOWER** — contention worsens with thread count |
| fn-fire 2k | 7.63 ms | 5.14 ms | 9.81 ms | disjoint **1.48× FASTER**; 1.91× disjoint-vs-same separation |

Note: this *corrects the D047 correction* — the doc's "fn-fire disjoint
2.8× slower than serial" was itself a baseline mismatch. On current code,
fn-fire-disjoint parallelism is real (~1.5×, 1.9× separation). The record
was wrong in both directions; this table is the measured truth.

## 2. Profile — where the 4t-disjoint state-emit time goes

`profile_disjoint_state_emit` (6M emits, 9.6 s, 1599 ns/emit vs 634
ns/emit serial = **2.5× slower per emit**):

- **78–81% of self-time = threads parked in `libsystem_kernel.dylib`** (futex/`__psynch` lock-wait). Not computing — sleeping on a lock.
- Stack-attributed (excluding ~25% main-thread `Thread::join` idle, a profiling artifact): **~75% of worker time parks on one mutex** at two sites:
  - ~35% — `try_emit`'s brief validation lock, `self.lock_state()` at `node.rs:3898`
  - ~40% — `commit_emission`'s `self.lock_state()` at `batch.rs:1294`/`1334`
  - Both = the **same single Core-global `self.state.lock()`** (`node.rs:2180`, `MutexGuard<CoreState>`), acquired **3+×/emit**.
- `partition_wave_owner_lock_arc` (registry `lock()`×2 + union-find `find`) **does not appear in the contended-park stacks**. Real per-op overhead, but tiny critical sections → grab-release fast → not where threads wait.

## 3. Naive variant — what the registry/partition machinery costs and buys

Δ vs current (same machine; "naive" = registry+partition machinery removed, one global lock):

| Workload | Current | Naive | Δ | Reading |
|---|---|---|---|---|
| state-emit serial 8k | 5.07 ms | 4.51 ms | **−12%** | machinery is a per-op tax |
| state-emit serial 16k | 10.64 ms | 8.29 ms | **−22%** | tax scales with emits |
| state-emit 2t-disjoint | 7.54 ms | 6.10 ms | **−18%** | |
| state-emit 4t-disjoint | 26.23 ms | 20.12 ms | **−23%** | faster, but still 2.4× slower than its own serial |
| **fn-fire 2t-disjoint** | **5.14 ms** | **9.34 ms** | **+81% REGRESSION** | per-partition `wave_owner` delivers genuine ~1.8× here |
| fn-fire 2t-same-part | 9.81 ms | 9.35 ms | ~0 | serialized either way (expected) |

Conclusions:
- The registry/union-find/4×-`registry.lock()` machinery **is a measurable 12–23% tax on the state-emit regime** (user's intuition correct *as overhead*).
- It is **NOT the disjoint-scaling-regression cause** — naive 4t-disjoint still 2.4× slower than naive serial, because the global `state.lock()` is untouched in both.
- Removing it **forfeits +81% on fn-fire-disjoint** — the per-partition `wave_owner` is real parallelism in the expensive-user-fn regime (the actual GraphReFly workload: LLM calls, extractors).
- **Registry-fix ceiling, hereby bounded:** a perfect registry optimization (keep `wave_owner`, make resolution free) recovers ≤23% on state-emit, ~0 on fn-fire. Modest, not a contention fix. The state-emit contention lever remains the twice-deferred state-mutex sharding (sub-slice 4).

## 4. Cross-impl — raw Rust core vs pure-ts (single-thread)

Workload-equivalent (state→sink, constant handle, dedup hot path), same machine, today:

| | ns/emit |
|---|---|
| `@graphrefly/pure-ts` `emit_same_handle` (V8-JIT'd) | **~233 ns** (4.29M hz) |
| raw `graphrefly-core` current `serial_baseline` | **~634 ns** (5.07 ms/8000) — **2.7× slower** |
| raw `graphrefly-core` naive (no registry) | **~564 ns** (4.51 ms/8000) — **2.4× slower** |

For full DATA dispatch (fresh handle), pure-ts `emit_fresh_handle_each`
≈ 376 ns/emit — still faster than raw Rust's *dedup* path.

- Methodological caveat works **for** pure-ts: vitest charges per-iteration JS/harness overhead; criterion's Rust loop has ~0 per-emit overhead. Pure-ts wins anyway → the gap is conservative.
- Root cause: single-threaded JS needs **no locks**. The Rust port pays its thread-safety tax (`state.lock()` 3+×, `registry.lock()` ~4×, Arc, union-find) on *every* emit including the single-thread common case; V8 JITs monomorphic plain-object access with zero synchronization.
- **napi arm: structurally unmeasurable.** `BenchCore::emit_*` is `pub async fn` (D206, tokio blocking pool via `run_blocking`). `ffi-cost.bench.local.ts` fire-and-forgets the Promise → measures Promise-spawn, not emit. A correct measure must `await` (→ async round-trip latency, not dispatcher throughput) or use a batched sync surface that doesn't exist.

## 4b. CONTROL — minimal-Rust vs TS prototype (the decisive experiment)

§4's "Rust 2.7× slower" compared the **full production dispatcher**
against the **TS *prototype*** (`__experiments__/handle-core`, a lean
single-threaded sketch — no locks, no union-find, no BatchGuard). That
is production-vs-prototype, not Rust-vs-JS. Corrected with a faithful
minimal single-threaded Rust mirror of the *same* TS prototype protocol
(intern+refcount, requireNode, runWave, commitEmission, queueNotify,
flush, per-wave node reset) — plain `&mut self`, zero locks/Arc/
registry/union-find/BatchGuard. `crates/graphrefly-core/benches/minimal_handle_core.rs`.

| `state_emit_identity_dedup` | ns/emit |
|---|---|
| **minimal single-threaded Rust** | **~67 ns** |
| pure-ts prototype `HandleRuntime` | ~233 ns |
| production `graphrefly-core` `serial_baseline` | ~634 ns |

- **Rust-the-language is ~3.5× FASTER than the V8 prototype** (67 vs 233 ns). A lean Rust handle-core crushes JS, as expected. The earlier "Rust slower" was an artifact of comparing the production dispatcher against a prototype.
- **The production dispatcher pays a ~9.5× machinery tax** (67 → 634 ns ≈ 567 ns): 3× `state.lock()`, 4× `registry.lock()`, union-find find, `partition_wave_owner_lock_arc` retry-validate, `held_partitions`, BatchGuard claim/clear, `Arc` clones, PARTITION_CACHE, drain indirection, `Arc<dyn BindingBoundary>` dispatch.
- Net: production-Rust is ~2.7× slower than the lean TS prototype only because a ~9.5× concurrency-machinery tax swamps Rust's ~3.5× language advantage.

**Strategic reframe:** the Rust port's slowness is **not inherent to
Rust and not a reason to doubt the canonical-impl-in-Rust plan**. A
canonical Rust impl would be ~3.5× *faster* than pure-ts IF the
concurrency architecture were lighter. The cost is entirely the
locks-everywhere + union-find-partitioning + BatchGuard-retry design —
which single-thread workloads pay in full but cannot use. The lever is
an architectural rethink of the concurrency model (e.g. single-writer /
actor / RCU / lock-free read paths), not micro-tuning and not "accept
Rust is slower."

## 4c. Full-protocol spike — hypothesis VALIDATED

§4b's minimal mirror was bare state→sink. Extended to the full protocol
(registerDerived, children, subscribe+recursive-activate,
deliverDataToConsumer, pendingFires drain w/ topo gate, fireFn first-run
gate, queueNotify/flush, per-wave reset) and the *exact*
`handle-core.bench.ts` scenarios. `crates/graphrefly-core/benches/minimal_handle_core.rs`.
ns/emit:

| Scenario | min-Rust ST | pure-ts proto | min-Rust vs pure-ts |
|---|--:|--:|--:|
| emit_same_handle | 83 | 233 | 2.8× |
| chain/1 | 552 | ~598 | ~1.1× |
| chain/4 | 1152 | ~1521 | 1.3× |
| chain/16 | 3544 | ~5770 | 1.6× |
| chain/64 | 13167 | ~23640 | 1.8× |
| diamond/2 | 1204 | ~1445 | 1.2× |
| diamond/32 | 10704 | ~14150 | 1.3× |
| fanout/10 | 2099 | ~4166 | 2.0× |
| fanout/100 | 19338 | ~44330 | 2.3× |
| fanout/1000 | 229010 | ~722000 | 3.2× |

Lean single-threaded Rust beats the pure-ts prototype on **every**
scenario (1.1–3.2×, widening with graph size), and production
`graphrefly-core` (634 ns dedup) pays a robust **~7.6× tax** over
min-Rust (83 ns) — apples-to-apples Rust-vs-Rust, same harness,
bias-free. Caveat: `emit_fresh_handle_each` + the `Sum` sink are the
least-faithful mirrors (high variance); the passthrough/dedup/chain/
diamond/fanout scenarios are faithful and decisive. **Hypothesis
validated: a single-threaded substrate is both correct-shaped and a
~7.6× / 1.1–3.2× win.**

## 7. LOCKED DESIGN (2026-05-16, user) — single-threaded substrate + `Option<LockId>` contract

Resolves §6 Q1 (yes, rethink the concurrency model) and Q2 (this
subsumes sub-slice 4). **Supersedes the D3 union-find per-subgraph
design** (`SESSION-rust-port-d3-per-subgraph-parallelism.md`, decisions
D085/D086) as the concurrency model — flagged for the D3 doc's status to
be amended to SUPERSEDED (not done autonomously here).

**The contract:**

- `Node` carries `lock: Option<LockId>`. **Default `None` = single-threaded** — engine uses the lock-free `&mut`/`RefCell` path; the lock-collection + acquire **monomorphize/compile out** when the graph is all-`None`. The ~83 ns floor; ~7.6× faster than production.
- User assigns `LockId` at `register_*` or runtime `set_lock(node, lock)`. Same `LockId` = one serialization group. Engine holds `LockId → Arc<ReentrantMutex<()>>`.
- **Wave acquisition:** seed → walk cascade (bounded) → collect *distinct* touched `LockId`s → dedupe, sort, acquire each `ReentrantMutex` in order → run wave → **release at wave end** (RAII). Same-thread re-entry passes through; disjoint lock-sets run parallel; overlapping sets serialize.
- **No union-find.** Partitions are user-declared and *static* (don't migrate with topology) → DELETE the entire production tax that existed only to recompute/validate connectivity-derived partitions: 4× `registry.lock()`, `find`/path-compression, `partition_wave_owner_lock_arc` retry-validate loop, epoch, `PARTITION_CACHE`, split/merge. Residual = "collect touched LockIds + ordered acquire" (inherent to correct multi-lock parallelism; a map lookup + sort, not a union-find query).
- **Safety invariant — STRICT (user-locked):** on `register`/`set_lock`, validate the node's dep-connected component is lock-consistent (all `None`, or all locked). Reject mixed with a clear error. The connectivity walk is at **topology-mutation time only** (rare), never on the hot path. Mixed component is rejected at declare time → no runtime race possible.

**Mandatory-vs-removable (the §-question answered):**
- *Mandatory regardless of threading* (the ~83 ns floor): node store, wave engine (`in_tick`, commit, queue_notify, drain/pickNextFire, flush, per-wave reset), equals-subst, DIRTY synthesis, refcount/release, children cascade, the `dyn BindingBoundary` FFI seam.
- *Pure thread-safety, removed by default-`None`*: all `Mutex`/`Arc`/`ReentrantMutex`, the entire D3 subsystem, and the defensive multi-phase re-lock structure in `commit_emission` (Phase-1 snapshot / Phase-3 re-lock / terminal re-checks collapse to one pass).
- *Survives even with user locks ("the batch ones")*: the wave engine itself + ordered multi-acquire for cross-lock cascades. Single-threaded these are no-ops.

**Next `/porting-to-rs` batch scope (user-locked):** single-threaded
substrate **and** the `Option<LockId>` contract together — one batch,
complete concurrency story. See `project_next_porting_batch.md`.
Possible side-benefit to flag (NOT decided): a sync single-threaded Core
may dissolve the D206/D070/D077 napi async-deadlock (that blocker was
Core-on-tokio-blocking-pool); revisit Q-S1/Option-C framing in light of
this.

## 5. Synthesis — the perf-value picture

The Rust port's performance case, as measured:

- **Rust-the-language is ~3.5× faster than the TS prototype** (§4b control: 67 vs 233 ns). The canonical-impl-in-Rust plan is sound *and* a performance win — the language is not the constraint.
- **The production dispatcher imposes a ~9.5× machinery tax** (67 → 634 ns) for thread-safety + D3 partitioning. Single-thread workloads (the common case) pay this tax in full and cannot use the parallelism it buys.
- **Parallelism (the thing the tax pays for): capped by the global `state.lock()`.** Disjoint state-emit is *slower* than serial and worsens with thread count (2.46× at 4t). The only genuine parallel win is expensive-fn disjoint workloads (+81% vs naive) — real but narrow.
- **No cheap lever recovers the tax** (§5b: collapsing lock cycles = 0% single-thread). The tax is the *aggregate* of the concurrency design, not any one hot acquisition.
- **The cross-impl value prop is unmeasurable through the shipped async-only napi artifact** (D206).

This is consistent with `CLAUDE.md`'s hedge that Rust-port perf is "a
secondary, workload-gated claim" with primary value = safety + canonical
impl — but it **strengthens** the canonical-impl case: Rust *can* be
much faster than pure-ts. **The actionable finding is that the current
concurrency architecture (locks-everywhere + union-find partitioning +
BatchGuard retry) is a ~9.5× tax that a redesign could remove; the
question is whether/when to rethink that model, not whether Rust is
worth it.**

## 5b. Cheap state-lock-relief lever — MEASURED, does not work

Hypothesis: the profile shows `state.lock()` 3+×/emit; collapsing the
redundant cycles is a cheaper lever than the deferred sub-slice 4.
Prototyped via throwaway `bench_state_collapse` feature — drops
`try_emit`'s standalone validation lock (redundant with
`commit_emission` Phase 1); hot-path acquire/release cycles 3 → 2.

| Workload | current | collapse | Δ |
|---|---|---|---|
| serial 8k (single-thread) | 4.97 ms | 5.03 ms | **~0% (no change, p=0.10)** |
| serial 16k (single-thread) | 9.85 ms | 10.15 ms | **+3.6% (slight regression)** |
| 4t-disjoint (contended) | 24.26 ms | 21.86 ms | **−10.6%** |

Verdict: **zero single-thread benefit** (uncontended mutex acquire is
~14 ns — the S1 lock_strategy finding holds at the dispatcher level;
acquisition *count* is not the single-thread cost). Modest
**contention-only** win (~10% at 4t — fewer acquisitions = less
cache-line bouncing) but it does NOT fix the regression (collapse 4t
still ~2.7× slower than its own serial) and does **NOT touch the pure-ts
gap at all** (single-thread unchanged). The 2.4–2.7× pure-ts gap is
structural — work done *under* the lock + Rust dispatcher machinery
(HashMap `require_node`, Arc, CoreState) vs V8-JIT'd plain-object
access — not lock-cycle count. **No cheap lever closes it.** (§4b
reframes "the gap": it is the *aggregate* concurrency-machinery tax —
~9.5× over a lean Rust impl — not any single hot acquisition; a lean
Rust dispatcher is ~3.5× *faster* than the TS prototype. The lever is
an architectural concurrency redesign, not micro-tuning; sub-slice 4
only trims the contended regime.)

## 6. Open questions for spec-owner (NOT decided here)

1. §4b shows a lean Rust dispatcher is ~3.5× *faster* than the TS prototype and the production slowness is a ~9.5× concurrency-machinery tax. Does this justify an architectural rethink of the concurrency model (single-writer / actor / RCU / lock-free read paths) so the canonical Rust impl realizes the language advantage — and on what horizon (pre-1.0? post-1.0)?
2. Is the state-mutex sharding (sub-slice 4) still the right next step, given it only trims the *contended* regime and leaves the dominant ~9.5× single-thread tax untouched? Or is it subsumed by a broader concurrency redesign per Q1?
3. Should `ffi-cost.bench.local.ts`'s legacy "Rust 2.3–3.4× faster" header + the Phase J disjoint framing be struck (they are not reproducible), and a correct async-aware napi throughput methodology be specced before any cross-impl perf claim?
4. Does the async-only napi surface (D206) need a batched/sync benchable path purely so the value prop can ever be measured?

## Artifacts

- `crates/graphrefly-core/examples/profile_disjoint_state_emit.rs` (committed-worthy profiling target; mirrors the existing `profile_disjoint_fn_fire.rs` pattern).
- Throwaway `bench_naive` + `bench_state_collapse` features: cfg edits in `Cargo.toml` / `node.rs` / `subgraph.rs` / `batch.rs`. Inert/opt-in (default build verified clean). **Revert before any release; do not build dependents.**
- Bench logs: `/tmp/grfly_bench_baseline.txt` (current), `/tmp/grfly_bench_naive.txt` (naive).
- Profiles: `/tmp/p_state2.json.gz` + `/tmp/attrib2.py` / `/tmp/stacks.py`.

## Cross-references

- `graphrefly-rs/docs/rust-port-decisions.md` D047 (drain-skip correction; "UNMEASURED" escalation — this doc is the requested measurement).
- `graphrefly-rs/docs/porting-deferred.md` Phase J CORRECTION + "Per-partition `nodes`/`children` shards (Sub-slice 4) DEFERRED".
- `archive/docs/SESSION-rust-port-d3-per-subgraph-parallelism.md` (the design this measures).
- `packages/pure-ts/src/__bench__/handle-core.bench.ts` (pure-ts side), `ffi-cost.bench.local.ts` (legacy claim, now contradicted).
