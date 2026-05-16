# SESSION — Rust-port concurrency redesign (Slices A + B)

**Status:** Design LOCKED 2026-05-16 (decisions D217/D218/D219). Supersedes
the §7 perf rationale. Canonical handoff for the next `/porting-to-rs`
batches (Slice A first).

**Lineage:** §7 single-threaded substrate (D208–D215) shipped but its
perf thesis was **empirically refuted** by the D216 perf-verification
bench (`crates/graphrefly-core/benches/floor_compare.rs` +
`group_scaling.rs`):

- Real `Core<SingleThreadCell>` identity-dedup ≈ **627 ns** ≈ old pre-§7
  prod **634 ns** (§7 bought ~4%, not ~7.6×). The 83 ns / 7.6× is the
  lean `minimal_handle_core` *mirror* only. `RefCell` ≈ `Mutex`
  (~25 ns) ⇒ the lock is not the cost; the per-emit machinery under it
  is.
- Disjoint `SerializationGroupId` groups do **not** run in parallel
  (throughput regresses with thread count, = serialized controls).
  `LockedCell` wraps the *entire* `CoreState` in ONE mutex; the
  per-group `ReentrantMutex` sits on top ⇒ overhead, never parallelism.

Full data: `~/src/graphrefly-rs/docs/migration-status.md` § "§7
perf-verification"; D216 in `docs/rust-port-decisions.md`.

The refutation separates **two problems §7 conflated**: a
data-structure floor problem (Slice A) and a lock-granularity
parallelism problem (Slice B). They are independent and ordered **A
then B** — parallelizing 627 ns work is pointless.

---

## Slice A — dispatcher floor rewrite (D217)

**Goal:** real `Core<C>` hot path **< 150 ns** (user bar: "6xx ns does
not justify parallelism; <150 ns is fine"). The mirror at 83 ns is the
existence proof of the endpoint; the gap is representation, not
algorithm.

**Shape (D217 = A2 whole, staged + bench-gated, stop-early):** land the
levers in order, run `floor_compare.rs` after each, **stop as soon as
<150 ns is measured** (not all five may be needed):

1. **Slab/slotmap node store.** `nodes: HashMap<NodeId,NodeRecord>` →
   generational slab; `NodeId` becomes an opaque slab key (newtype
   opacity preserved — D-invariant 8; never a raw index across the
   binding). Kills N ahash lookups/emit. **Biggest single lever — land
   first as its own measurable step.**
2. **Colocated children.** Drop the global
   `children: HashMap<NodeId,HashSet<NodeId>>`; put
   `children: SmallVec<[NodeId;4]>` on `NodeRecord`. One index, no 2nd
   hash + set alloc per cascade.
3. **Kill the wave thread-local.** Pass `&mut WaveState` down the
   call chain instead of `with_wave_state(...)` thread-local lookups
   (the mirror is `&mut self`). Also collapses the §7 group-collect /
   `BatchGuard` indirection.
4. **Batch refcount.** Collect `release_handle` into a `SmallVec`,
   one drain at wave end; add a `const`/flag opt-out when the binding
   is refcount-free (skip the dyn FFI noop call/emit).
5. **§7-A — single-pass `commit_emission`.** Collapse the defensive
   Phase-1-snapshot / Phase-3-re-lock / terminal-re-check multi-phase
   into one pass. **Rides LAST**, under the parity arm + the
   now-fresh test coverage, for a measured target — never standalone
   (§5b/D216: ~0 % alone; it is §7's riskiest behavioral change, only
   justified as part of the holistic rewrite).

**Invariants Slice A must preserve:** `NodeId` newtype opacity;
`currently_firing` cross-thread visibility for the P13 set_deps
reentrancy check (/qa F2) — becomes per-shard under Slice B but the
cross-shard set_deps path still needs it visible. 6-month risk: low
(representation swap behind an unchanged public API; 304 core tests +
the parity arm are the safety net; behavioral risk isolated to lever 5).

**Acceptance:** `floor_compare.rs` < 150 ns on identity-dedup; all
tests green; parity arm green; clippy/fmt; `#![forbid(unsafe_code)]`.

---

## Slice B — true parallelism (D218 = B4)

**Model:** per-shard mutex core (B2) **+** owner-thread overlay (B3) as
an opt-in binding-affinity layer adopted at M6. The shard trait is
designed with the overlay seam **now, during Slice A** (D219).

### B2 — the substrate foundation (built in Slice B proper)

Replace `LockedCell(Mutex<CoreState>)` with a **shard-keyed `Mutex` per
`SerializationGroupId`**:

- `shards: HashMap<ShardId, Mutex<ShardState>>`; all-`None` → exactly
  **one** default shard (zero-regression invariant — single-domain
  common case = one mutex = Slice A's new floor, no channels).
- A wave locks only the shard(s) it touches. Disjoint groups → disjoint
  mutexes → **genuinely parallel** (the property the bench found
  missing). The static all-`None`/all-`Some` component invariant
  (already enforced) guarantees no intra-component cross-shard dep
  edges, so cross-shard contention is absent for the common topology.
- Slice A's representation work applies **per-shard unchanged**.
- **§7-C / §7-F fold in here** — B2 rewrites the exact group/lock layer
  the vestigial union-find symbols (`PartitionOrderViolation`,
  `*_or_defer`, `DeferredProducerOp`, the `Send+Sync` cliff) live in;
  deletion is free as a side-effect, not standalone 8-file
  `graphrefly-operators` churn.

**Residual: §7-B cross-shard ordering.** Meta/dynamic re-entry from a
fn into a *different* shard needs a defined lock order. Design a
**bounded ordered-acquire / acquire-or-defer-to-wave-end guard** (a
small mechanism — NOT the deleted union-find). Spec it in the Slice B
design pass; until then, co-emitting nodes stay in one component
(target shard already held, `ReentrantMutex`-style pass-through).

### B3 — the owner-thread overlay (deferred to M6, seam designed now)

The **deciding invariant:** napi V8 is one isolate per thread; pyo3 has
the GIL. A shard whose fns run JS/Python must run them on a *fixed*
binding thread. This — **not Rust parallelism** — is the real
justification for owner-threads+channels. For the pure-Rust substrate
B2 suffices; for the bindings (M6) B3 is load-bearing.

B3 = each shard gets an owner OS thread + crossbeam-channel inbox;
same-thread caller (owner) = direct call (preserves the floor),
cross-thread = message (clean cross-shard ordering, no ABBA). It is an
**additive overlay** the napi/pyo3 binding crates opt into — *not*
built until M6 needs it (consumer-pressure-gated, D196). Async /
goroutine-scale is explicitly a non-answer (a handful of static
serialization domains, not millions; no function-coloring, no async
hot path).

**D219 — design the seam during Slice A:** the shard abstraction
(`trait Shard` / `ShardState` ownership + the wave→shard routing) must
be shaped so the B3 owner-thread overlay slots in without retrofit.
Concretely: the shard trait owns its `ShardState` + a `dispatch(wave)`
entry; B2 impls it as `Mutex<ShardState>` + inline run; B3 impls it as
owner-thread + channel with a same-thread fast path — same trait, no
caller change. Locking this seam now is cheap; retrofitting later is
expensive.

---

## Locked decisions

| # | Decision |
|---|---|
| **D217** | Slice A = **A2 whole**: staged, bench-gated holistic floor rewrite (slab store → colocated children → kill thread-local → batch refcount → §7-A single-pass commit), stop-early at <150 ns; §7-A rides last under parity coverage. |
| **D218** | Slice B = **B4**: per-shard mutex (B2) substrate core + owner-thread+channel (B3) as an opt-in M6 binding-affinity overlay. Pure-Rust gets true parallelism + floor now with minimal machinery; B3 is the binding-affinity answer, not the foundation. §7-C/§7-F fold into B2. |
| **D219** | Order = **A then B**; B's shard-trait + B3-overlay seam is **designed during Slice A** so A's representation work slots into shards without retrofit. |

## What's next

The next `/porting-to-rs` batch = **Slice A step 1 (slab/slotmap node
store)**, with the B-shard-trait seam (D219) sketched alongside. Each
A2 lever is bench-gated by `floor_compare.rs`; `group_scaling.rs` is
the Slice B regression gate. Not consumer-pressure-gated — this is the
measured perf lever, scheduled directly.
