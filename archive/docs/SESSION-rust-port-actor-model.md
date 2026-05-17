# SESSION — Rust-port concurrency: the actor / work-stealing model (Slice B strategic re-decision)

**Date:** 2026-05-17
**Origin:** graphrefly-ts (cross-repo: graphrefly-rs substrate)
**Status:** DECISION LOCKED. Supersedes D218 B2/B3 and D220-EXEC's 155-site-triage prescription. Canonical decision record: `docs/rust-port-decisions.md` D221 (SPIKE EMPIRICAL FINDING + ROUTING + ROUTING AMENDED + this lock).
**Trigger:** the D221 bounded spike (B-2 Step 2c) proved lock-on-shared-`Core` is *structurally* whack-a-mole; the user reframed the design session from a "(P)-seam design" into a strategic re-decision, then drove it to a cleaner end state than the original a/b/c options.

---

## 1. Why this session

The Slice B perf goal (disjoint `SerializationGroupId` groups should parallelize cross-thread) had been RED across §5, D216, 2b-ii, and the D221 spike. The spike established empirically:

- Removing the per-`lock_state` `CoreShared` serialization **helped measurably** (disjoint +45% vs 2b-ii, separated 1.55× from the serialized control) — so parallelism is **physically real**, not blocked by causality.
- But disjoint **still regressed** with thread count — a *second* serializer remained (the `grouped_shards` map-lock), and by elimination there is a *series* of Core-global touchpoints per emit. **Lock-on-shared-`Core` is structurally whack-a-mole.**
- The naive dedicated `currently_firing` mutex **regressed the §7 single-thread floor ~25%**.
- Correctness was fully green (831/831) throughout.

The user's reframing question — *"are the causal chains just interlocked all the time, so we'd rather not have disjoint or any locks?"* — turned the session from "how to remove the next lock" into "what is the right concurrency model at all."

## 2. The reasoning chain (the load-bearing turns)

1. **Wave ordering is per-connected-component, NOT global.** A wave is a sequenced cascade (inherently serial — that's the protocol; you neither can nor should parallelize *within* a wave). But two *disjoint* components have **no ordering relationship**. The interlock observed in benchmarks is an **implementation artifact** (shared mutable `Core`), not inherent causality — proven by the spike measuring real separation.

2. **A "cross-group edge" is a contradiction in terms.** If an edge connects two groups, they *are* one connected component — one subgraph. So edges cannot force a shared `Core`; an edge *is* the thing that makes it one unit.

3. **The graph topology IS the concurrency model.** GraphReFly's whole purpose is decomposing work into subgraphs so that "where coordination is needed vs. not" is encoded in the topology itself. Two agents in the same subgraph *must* coordinate (one serial wave — correct semantics); in different subgraphs they are independent. The connected component = subgraph = ownership unit = parallelism unit = coordination boundary — these five are the same thing. It is the minimal unit; finer (wave/on-dep) fights causal order for zero gain.

4. **`SerializationGroupId` is NOT redundant — it is the cheap static substitute for the deleted union-find.** §7 (D208–D211) deliberately deleted the D3 union-find subsystem (runtime partition discovery was too expensive). The user-declared group is *how the system knows the independence partition without paying union-find*. It is not retired — it is **promoted** to "the user's declaration of an independently-schedulable unit." What is dead is the *lock machinery layered on it for in-`Core` parallelism*, not the group concept.

5. **The execution model is work-stealing / actor, not thread-pinned-to-group.** A pool of workers; a free worker *claims* a runnable group, drains it single-threaded and lock-free to quiescence, *releases* it, picks up the next runnable group. The group flows through the pool; it is not permanently bound to a thread. "At most one worker per group at any instant" is the lock-free guarantee — enforced by **ownership/exclusivity, not a runtime lock**.

6. **In Rust the correctness is pure ownership + `Send`; the scheduler is the host's.** Claim = move the `Send` group value out of the ready set into a worker (the borrow checker statically proves no other thread touches it — *the borrow checker is the lock; zero runtime lock; `Sync` not required*). Release = move it back. The concurrent ready-queue + worker pool + wake signal is a thin layer GraphReFly **delegates to the host runtime**, never builds in `Core`. Consistent with the locked invariant "no async runtime in `Core`": `Core`'s drain stays sync single-threaded; only the outer "this group is runnable" boundary touches the host executor.

7. **Run-to-quiescence, non-preemptive per group.** A worker drains a claimed group to quiescence before releasing; only *quiescent* state (no live `WaveState`) ever moves between workers — so `Send` suffices and thread-local drain-scratch stays valid within a single uninterrupted drain. Cost: one long group monopolizes its worker until quiescent — *correct* (a connected reactive cascade is inherently serial; preempting it is meaningless) and orthogonal to cross-group parallelism + load-balancing.

8. **Lazy default = safe default.** No `SchedulingGroupId` ⇒ one default group ⇒ the whole graph is one causal chain ⇒ one single-thread lock-free `Core`, fully serial. No accidental parallelism, no footgun; parallelism is opt-in via explicit boundary declaration. (Self-consistent with the existing `None → DEFAULT_SHARD`.)

9. **The "needs shared `Core`" set and the "disjoint" set are nearly disjoint.** Cases that force a shared `Core` (shared fact store / hub / `mount` / multi-agent shared substrate — the GraphReFly vision) are *connected* → one serial wave anyway (group-sharding buys nothing). Cases that are disjoint (independent sessions / rollouts / tenants) *don't need* a shared `Core` → run as independent `Core`s on a pool. The benchmark's "disjoint groups on a shared `Core`" is an artificial mechanism-probe, not a real usage shape.

## 3. The locked decision

> **No shared `Core`. No `LockedCell`.** The only state cell is **single-threaded, lock-free, `Send`**.
>
> **`SerializationGroupId` → `SchedulingGroupId`** — the user-declared boundary of an independently-schedulable reactive unit (the cheap static replacement for the deleted union-find). **No declaration ⇒ one default group ⇒ one causal chain ⇒ fully serial single-thread `Core` (safe default).**
>
> **Correctness = ownership `move` + `Send`** (the borrow checker is the lock; zero runtime lock; `Sync` not required). **Execution = run-to-quiescence, non-preemptive per group.**
>
> GraphReFly provides exactly: **the `Send` lock-free unit + a per-group "runnable" wake signal + a sync `drain`**. It does **NOT** provide a scheduler, and `Core` **never** introduces an async runtime.
>
> **Parallelism is driven by host-native concurrency**, not tokio: TS = `worker_threads`/Web Workers (one `Core` per worker); Python = `multiprocessing` (GIL) or a free-threaded thread pool; Go = goroutine + channel (the Go runtime *is* the scheduler); standalone Rust = any executor (a ~20-line `std::thread`+`crossbeam` pool, or tokio iff already in a tokio app — **tokio is an option, never a requirement**; GraphReFly may ship an optional default `std::thread`+`crossbeam` group pool). The binding-thread-affinity constraint (V8 isolate / GIL) *forces* host-native scheduling anyway and is therefore satisfied automatically.
>
> **M6** = wire the per-group wake signal to the host executor; one group serviced by one worker at a time. **Supersedes D218 B2 (per-shard mutex) / B3 (owner-thread-pinned overlay) and D220-EXEC's ~155-site triage.**

## 4. Cross-language scheduling

| Host | Parallelism mechanism | tokio? | Notes |
|---|---|---|---|
| pure-ts | none (single event loop) | — | groups give *logical* isolation only; execution serial. Honest: pure-ts = the local/single-thread substrate. |
| native TS | `worker_threads` / Web Workers, 1 `Core`/worker; app or a thin shipped helper distributes `SchedulingGroup`s | no | native-Rust runs sync single-threaded inside each worker. |
| Python (GIL) | `multiprocessing`, 1 `Core`/process | no | |
| Python (free-threaded) | `ThreadPoolExecutor`, 1 `Core`/thread | no | |
| Go | goroutine + channel per group | no | Go runtime *is* the work-stealing scheduler — cleanest target. |
| standalone Rust | any executor (`std::thread`+`crossbeam`, tokio, rayon…) | optional | tokio only if already present; optional default pool may ship. |

Two scheduling layers, neither needs tokio: **distribution** (which group → which worker) = the app's call (it knows its groups; round-robin; a thin helper can do it); **execution driving** (run a group's waves when it has work) = a host concurrency primitive calling `Core`'s sync `drain`.

## 5. Actionable substrate consequences (graphrefly-rs)

1. **Delete `LockedCell` + all shard/group-lock/owner machinery** (`grouped_shards`, `group_locks`, `global_wave`, the 2b-ii routing infra, owner-thread plumbing). One cell: single-thread lock-free, made `Send`.
2. **`SerializationGroupId` → `SchedulingGroupId`** (rename + reframe; keep as the static user-declared partition key; default-None = one serial unit).
3. **Scope `WaveState`/`IN_TICK`/`CURRENT_SHARD_KEY` to a single uninterrupted drain** (valid under run-to-quiescence-before-release; never spans a worker handoff).
4. **Add a per-group `Send` "runnable" wake signal** (one atomic / a channel-send) — the only cross-thread-visible bit; bridges to the host executor's waker/queue.
5. **Keep `Core`'s `drain` sync** (no async in `Core`); the executor lives entirely outside `Core` (binding/runtime layer).
6. **(F) floor restoration is now strategy-core**, not a side fix: cell-aware / drop `FiringGuard`'s `Core::clone` so the single-thread lock-free floor (the model's foundation) is never taxed. (`wip/b2-2c-spike-d221`'s (F) half = reference; its (P) half is moot.)
7. **M6**: bridge the wake signal to the host executor; one-worker-per-group exclusivity.

## 6. Open verification items (code checks — NOT spikes)

- The "claim → drain-to-quiescence → release; no mid-drain handoff" invariant: confirm no path violates it (so thread-local scratch is safe).
- `Core`/group state is genuinely `Send` (no `Rc`, no thread-local the group's *persistent* state depends on across a handoff).
- No process-global shared state in binding/registry/snapshot that would break "N independent `Core`s never interfere." `mount` requiring same-`Core` is *consistent* (mount = one logical graph = one `Core` by definition).

## 7. Binding-layer group executor — a GraphReFly deliverable (bindings / M6)

The "scheduler" splits into three layers. The host runtime (worker_threads / goroutine scheduler / thread/process pool / tokio) is **not** ours. `Core` is **scheduler-free** (locked). The **middle adapter** — between `Core`'s {`Send` unit + per-group runnable wake signal + sync `drain`} and the host runtime — **IS the project's deliverable, shipped per-binding** (user-locked 2026-05-17). It owns: the `SchedulingGroupId`-keyed ready-queue, wake→enqueue, dispatch-to-free-worker, claim/release lifecycle, one-worker-per-group + binding-thread-affinity. Without it a consumer gets only "a `Send` unit + a signal" and must hand-roll pool/queue/dispatch — a violation of the Phase 4+ developer-friendly-defaults principle.

**Shape = (ii), user-locked: a pluggable seam + a shipped default implementation.** The default is turnkey (round-robin `SchedulingGroup`→worker distribution, sensible pool); users may substitute their own distribution policy / pool / existing runtime (e.g., integrate into their own tokio app or worker pool). Not (i) a single fixed opinionated executor — (ii) preserves the project's "good defaults but no lock-in, composable" stance.

Homes:

| Binding | Executor adapter | Notes |
|---|---|---|
| pyo3 / Python | **M6** (`multiprocessing` GIL / `ThreadPoolExecutor` free-threaded) | the canonical M6 binding-executor deliverable |
| napi / TS | rides the `@graphrefly/native` binding work (`worker_threads`/Web Workers, 1 `Core`/worker) | may pull forward under D196 consumer pressure |
| standalone Rust | an **optional** `std::thread`+`crossbeam` default group pool, shipped as a `graphrefly-rs` feature | so embedders need neither hand-roll nor pull tokio |
| Go (if/when) | a tiny goroutine+channel adapter | the Go runtime *is* the scheduler |

This is added to **M6 scope** as a planning/scope record — still design-lock, not implementation.

## 8. Disposition

This is a design **lock**, not an implementation approval. The implementation (delete `LockedCell`/shard machinery, rename `SerializationGroupId`→`SchedulingGroupId`, `Send`-ify the cell, per-group wake signal, (F) floor restoration, the §7 per-binding pluggable group-executor + default impl, M6 wake bridge) is a future `/porting-to-rs` slice gated by explicit user go-ahead per `feedback_no_implement_without_approval`. `wip/b2-2c-spike-d221` stays as the (F) reference; its (P) half is obsolete under this model.
