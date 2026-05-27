# SESSION — Handle-Dispatch Substrate (GraphReFly as topology + dispatcher; computation outsourced via handle IDs)

**Status:** 🌱 DRAFT — design session not started. This file records the **trigger**, the **shape of the proposal**, the **questions to lock**, and the **alignment with already-locked decisions**. No D-numbers minted. No implementation. Pre-design only.

**Opened:** 2026-05-26
**Trigger:** User-initiated discussion after `/research` on DE Agent Harness landscape (the trigger×task matrix post by an internal DE harness author).
**Related work already locked:**
- D080 / PART 13 three-siblings (`@graphrefly/pure-ts` | `@graphrefly/native` | `@graphrefly/wasm` deferred) — substrate-vs-presentation cleave
- D196 — `Impl` contract is the public substrate API; widening goes through `cross-track-ledger.md`
- D206 — `pure-ts` is the sync substrate; `@graphrefly/native` is honest async; Option B (async-everywhere presentation rebase) is deferred until consumer pressure
- DS-14 changesets — universal `BaseChange<T>` envelope, `mutate(act, opts)`, lifecycle-aware diff restore, worker-bridge wire B
- D293 / D292 — `@graphrefly/native` async lifecycle (close/dispose, FinalizationRegistry, panic-as-rejection)
- `base/composition/external-register.ts`, `worker-bridge` — already same-process worker dispatch
- Factory-isation (`spec.factory` / `factoryArgs` / `placeholderArgs`) — node identity has already been name-ised; inline fns are the residual

---

## 1. The proposal in one paragraph

GraphReFly becomes a **pure topology + dispatcher**. Node identities, dependency edges, and wave-protocol state live in the GraphReFly runtime. **Work functions and their inputs/outputs travel only as `HandleID`s** — opaque references resolved on the sandbox side. The dispatcher tells a broker: *"run factory `foo` with `factoryArgs = bar`, inputs = [handle-7, handle-8], context = handle-3"*. The broker schedules the work in whichever sandbox owns those handles (or fetches them across the wire), runs it, registers the result as `handle-9`, and emits `DATA(handle-9)` back to the dispatcher. Push-on-subscribe cache stores handles, not values. Wave coordination, DIRTY propagation, diamond resolution, COMPLETE-tier teardown all stay in the dispatcher. Computation never enters the GraphReFly runtime.

This collapses three persistent pain points at once:
1. **fn serialization** — solved by not serializing fns; sandbox-side factory registry resolves the name.
2. **value serialization** — solved by handle indirection; values stay where they are.
3. **cross-network persistence** — change-set wire (DS-14) + handle protocol = replayable distributed snapshot.

It also unifies several already-locked threads: worker-bridge wire B, `external-register`, factory-isation, the async substrate path (Option B / D080), the substrate-vs-presentation cleave.

---

## 2. Why this is a real opportunity (not just engineering)

### 2.1 Industry landscape gap

| System | Topology explicit? | Reactive wave? | Diamond fan-in coalesce? | Live rewire? | Mixed locality? |
|---|---|---|---|---|---|
| Temporal / Restate | implicit (workflow code) | no | no | no | no |
| Apache Beam | yes (DAG) | batch/stream only | no | no | partial (per runner) |
| Kafka Streams | compile-time DAG | no | no | no | no |
| Dapr Workflow | implicit | no | no | no | no |
| **GraphReFly (proposed)** | **yes** | **yes** | **yes (spec §1.4)** | **yes (D293-class)** | **yes (per-node)** |

The unfilled cell is `(reactive wave + live rewire + mixed locality)`. GraphReFly with handle-dispatch is the first system that fits there.

### 2.2 Alignment with the DE harness wedge

The DE harness segment (`/research` 2026-05-26) is **architecturally forced** into handle dispatch — warehouses hold 30TB+ of data that physically cannot be pulled into a Node process. Any serious DE harness must do "GraphReFly orchestrates; warehouse computes; results flow back as references." The handle-dispatch substrate is the **only viable form** for that segment, not just a nicer form. Two strategic directions (handle-dispatch substrate + DE harness wedge) collapse into one.

### 2.3 Promotes graphrefly-rs from "faster substrate" to "dispatcher kernel"

Today the Rust port competes on perf (D272+D273+D274 lean-cores). Under handle-dispatch, Rust is the natural **dispatcher kernel** — low-overhead, strong binding surface, zero-copy handle tables. The Rust port's value story upgrades from "3.5× faster" to "the only substrate that can be the cross-network dispatch kernel."

### 2.4 Multi-language parity story

`graphrefly-py` parity stops being a line-by-line port. Python becomes a **sandbox + factory registry** that speaks the change-set wire. Any language that can speak the wire becomes a peer. This is the path the rigor-infrastructure plan (Project 2: TS↔PY executable contract traces) was pointing toward — handle-dispatch generalises it.

---

## 3. Performance question — does async kill the advantage?

User-raised concern: "异步是不是就牺牲了很多性能呀？" / "kafka/pulsar 不就能做？"

### 3.1 vs Kafka/Pulsar

Kafka/Pulsar are **dumb transports**. They cannot:
- Know the DAG (so cannot do **selective dispatch** of only-dirty downstream nodes)
- Coalesce same-wave DIRTYs (spec §1.4 fan-in dedup)
- Implement push-on-subscribe DATA cache semantics (compacted topics approximate, but only per-key-latest, not per-node-wave-result)
- Support live topology rewire (Streams DAG is compile-time fixed)

**Correct integration**: Kafka/Pulsar/NATS as **change-set wire backends** (replacing or augmenting worker-bridge MessageChannel). The dispatcher still lives in GraphReFly. Wire B was designed exactly for this — abstract duplex pipe, backend-agnostic.

### 3.2 vs Temporal/Restate/Beam

| Scenario | GraphReFly local | GraphReFly + sandbox | Temporal | Beam | Kafka Streams |
|---|---|---|---|---|---|
| Single wave propagation | μs | ms (one RTT) | 10–100 ms (server roundtrip) | ms+ | ms |
| Re-subscribe / read latest | 0 (push-on-subscribe) | 0 (handle cache hit) | replay or query state store | side input lookup | retention-dependent |
| 1000-node full graph invalidation | sub-ms | ms (wave-batched) | n/a | seconds+ | seconds+ |

### 3.3 Three structural advantages that survive going async

1. **Mixed locality per node.** Same graph: hot reactive UI nodes stay in-process (sync, ns-μs); LLM/warehouse nodes dispatch to sandbox (ms). Beam/Temporal/Kafka force all-or-nothing.
2. **Wave-level batching.** Same-wave DIRTYs already coalesce. The dispatcher sends the **minimum work set** per wave, not one message per event.
3. **Push-on-subscribe with handle cache.** Re-subscribing reads cached handles without re-triggering upstream. Temporal/Restate require replay or state-store query.

**Conclusion**: latency overhead exists per-hop, but for the realistic workloads (LLM agent harness, DE warehouse pipelines) the dispatcher overhead is dominated by the work itself (LLM call: 100ms+; warehouse query: seconds). The advantage is preserved for those workloads and *kept entirely* via the sync local path for low-latency reactive workloads (market data, hot UI).

---

## 4. Open questions to lock (skeleton — fill in actual session)

> Each Q below is a placeholder. Real session must surface options A/B/C, evaluate trade-offs, and lock. Following the established 9-question pattern.

### Q1 — Wave semantics across the network
- **Option A:** Wave-id travels with every dispatch; sandbox echoes wave-id on result; dispatcher correlates back to the originating wave. Wave stays a dispatcher-side concept; sandbox is wave-naive.
- **Option B:** Wave-aware sandboxes — sandbox understands wave boundaries and can coalesce within a wave before replying.
- **Option C:** Per-node "is wave-significant" flag — only some nodes carry wave-id; others are fire-and-forget.
- Trade-off: A is simplest and keeps sandbox dumb; B opens optimizations but couples sandbox to protocol; C is a middle path but risks split-brain.

### Q2 — Handle lifecycle / GC
- **Option A:** Refcount + lease (TTL-renewed). Handle expires if not touched within TTL.
- **Option B:** Explicit `dropHandle(id)` instructions from dispatcher; sandbox holds until told.
- **Option C:** Wave-scoped (handles GC'd when their producing wave closes — except cached push-on-subscribe handles which are node-scoped).
- Concerns: replay scenarios; long-lived `state()` nodes; subscription churn.

### Q3 — Inline `node((ctx) => ...)` fns: dispatch-eligible or local-only?
- **Option A:** All work must come from registered factories. Inline fns disallowed in dispatch-capable graphs. Major DX impact.
- **Option B:** Inline fns allowed but pinned to dispatcher-local execution. Mixed graphs work; users can't accidentally dispatch a closure.
- **Option C:** Auto-register inline fns under a synthesized name + serialize their source. Works for pure fns; breaks on closure captures.
- This is the **single biggest DX call** in the entire proposal. Option B feels right by default.

### Q4 — ERROR / COMPLETE / sandbox-crash semantics
- Sandbox dies mid-compute: is the resulting message ERROR or COMPLETE?
- Network partition: dispatcher treats as ERROR-retryable or as silent timeout?
- Per-tier teardown: does dispatcher own teardown or does sandbox?

### Q5 — Re-subscription after handle invalidation
- Handle invalidated (sandbox restart, lease expiry). Pipeline subscribes again — should dispatcher auto-redispatch? Block? Emit ERROR?
- Tied to push-on-subscribe spec §2.2 semantics — the protocol guarantees DATA on subscribe, but what if the underlying handle is gone?

### Q6 — Backpressure across the wire
- Current `base/composition/backpressure` is in-process. Cross-process needs flow-control on the wire (Kafka/NATS-level credits, HTTP/2 stream backpressure, etc.).
- Should dispatcher know about sandbox queue depth, or treat sandbox as opaque?

### Q7 — `from*` source-vs-actuator placement
- Some sources are dispatcher-side by nature (`fromEvent`, `fromRaf`, `fromGitHook`, browser sources).
- Some are sandbox-side by nature (`kysely`, `prisma`, `clickhouse-watch`, warehouse adapters — they need to live where the DB driver lives).
- Some are ambiguous (`webhook`, `fromCron` — could go either way).
- Lock the rubric: which connectors are dispatcher-only, sandbox-only, or either-and-config-decides.

### Q8 — Inspection / observability across the wire
- `describe()` is already JSON-friendly. Does the dispatcher describe show synthetic sandbox-side nodes, or only the registered factory shape?
- `observe(path)` — does it follow handle indirection automatically, or stop at the dispatcher boundary?
- `harnessProfile` cross-process — open or punt?

### Q9 — Migration / coexistence with current sync substrate
- D206 says `pure-ts` is sync and presentation consumes sync. Handle-dispatch is async by definition. Does this force Option B (async-everywhere presentation rebase) as a prerequisite, or can handle-dispatch ship as a separate substrate arm without touching presentation?
- Answer probably: a third substrate sibling — `@graphrefly/remote` — that implements `Impl` with async-on-the-wire semantics. Presentation must already tolerate async per D080 design; this just makes async non-optional for that arm.

### Q10 — Where does the dispatcher itself live?
- In-process JS (Node runtime) — simplest, no new deploy unit.
- Standalone binary (Rust) — graphrefly-rs's promotion target.
- Embedded in user app vs operated as a service — both?
- Pre-1.0 lock probably: in-process JS first; Rust dispatcher kernel post-1.0 if consumer pressure appears.

---

## 5. Tensions / where this could go wrong

1. **Spec §5.8–5.12 invariants assume process-local tight control.** Push-on-subscribe, diamond bitmask, batch coalesce — all designed for sync wave coordination. Cross-network latency may break some assumed orderings. Need a careful spec amendment pass.
2. **Inline-fn DX trap.** Forcing all work to be registered factories would be a huge regression. The B-option (inline = local-only) preserves DX but introduces a hidden mode where some graphs "look the same" but can't be remoted. Diagnostics need to call this out clearly.
3. **Handle GC is hard.** Distributed refcount is famously tricky; lease-based has expiry foot-guns. Wave-scoped feels cleanest but interacts with long-lived `state()` cache semantics.
4. **`Impl` contract widening.** This is a D196-class widening — every change requires `cross-track-ledger.md` row + parity-scenario gate. Could easily double the parity-test surface.
5. **Pre-1.0 timing.** This is bigger than D080. Locking it pre-1.0 vs post-1.0 is itself a decision. Probably: **scope a minimal handle-dispatch arm pre-1.0** (proof of concept, single-sandbox, in-process JS dispatcher) and **defer full distributed forms post-1.0**.

---

## 6. Recommended next actions (when this session is run for real)

1. Run a 9-question design session against Q1–Q10 above. Lock A/B/C per question.
2. Mint D-numbers; add to `docs/rust-port-decisions.md` / `docs/decision-log.md` (whichever fits — the dispatcher kernel question may force a new track).
3. Add a `cross-track-ledger.md` §1 row for the `Impl`-widening implications.
4. Add `implementation-plan.md` entries — likely a new Phase or a sub-phase under the existing Phase 14 (DS-14 changesets) since wire B is the substrate.
5. Decide whether `graphrefly-rs` migration-status gets a new "Dispatcher Kernel" item (this would be a major scope expansion for the Rust track).
6. Consider whether the DE harness wedge demo (from `/research`) should be the first acceptance scenario for handle-dispatch.

---

---

## 6.bis Round-2 refinements (recorded 2026-05-26, same session)

User-initiated follow-up after Q1–Q10 skeleton landed. Surface six tightening locks and one new question (Q11). None of these mint a D-number; they sharpen the proposal so the eventual design session has a stronger starting frame.

### R1 — DE wedge is a side-effect, not a target

DE harness segment benefits structurally (warehouse data physically cannot enter Node process → handle dispatch is the only viable form). But product positioning does NOT chase DE. The structural play is `(reactive wave + live rewire + mixed locality)` — DE is one segment that happens to fit. Wave 2 narrative (`SESSION-DS-14.5-A-narrative-reframe.md`) does not pivot.

### R2 — TRIAGE decomposition under handle dispatch

Current harness TRIAGE does two things; under handle dispatch only one is absorbed:

| Sub-responsibility | Status under handle dispatch |
|---|---|
| (a) Route decision — which capability handles this message? | **Absorbed** into the LLM's tool-choice over the catalog. The classifier becomes implicit. |
| (b) Context assembly — what memory / history / prompts to load? | **Preserved** as a catalog-loader stage feeding the executor's progressive-disclosure scope. |

So TRIAGE doesn't vanish — it morphs from "hard-coded classifier node" to "catalog loader + executor invocation site." This is a real simplification of the harness loop.

### R3 — `describe()` observability stays intact (two-layer invariant)

A potential foot-gun was: if LLM dynamically summons factories, does `describe()` lose meaning? Answer: no, **as long as the catalog scope is declarative**.

| Layer | Recorded by | Audience |
|---|---|---|
| Static topology | `describe()` (existing) | Build/deploy-time reviewer |
| Static catalog scope | `executor.meta.catalog` (factories this executor MAY summon) | Same |
| Dynamic invocation log | `observe()` / `auditLog` / `harnessProfile` (existing) | Runtime debugger |
| Dynamic spawned sub-nodes | Executor spawns a temporary child node per invocation, teardown on completion | Same |

**Invariant:** an executor's catalog scope MUST come from a declared catalog (constructor arg, or a reactive `catalogNode` flowing in). LLM-fabricated factory-name strings outside that scope MUST be rejected at dispatch time. Without this invariant, `describe()` loses static dispatchability analysis. With it, the architecture is **more** observable than the current black-box tool-call pattern.

### R4 — Eliminates LLM-driven topology mutation

Pre-this-session, there was a parked design problem: "how does an LLM dynamically add/remove graph nodes for elasticity?" Handle dispatch makes this problem **disappear**:

- Topology stays stable (predictable, replayable, diffable, snapshot-restorable).
- Elasticity comes from **call patterns**, not topology mutation.
- "More iterations" = more executor calls, more handle IDs allocated.
- "Parallel experts" = fan-out of executor calls inside one wave.
- "Stronger model" = progressive-disclosure catalog gives the executor more entries.

This deletes a non-trivial chunk of speculative spec-amendment work that would have been needed for the topology-mutation path. **The setDeps/addDep/removeDep landed via D293-class is for system-level rewire (e.g., resharding), NOT for LLM-driven mutation — and now it doesn't need to grow into the LLM case.**

### R5 — User-impact assessment: lower than initial fear, IF local fast path stays

If the local fast path is preserved (inline `node((ctx) => ...)` does NOT go through the dispatcher), existing users feel three potential changes:

1. **Test timing.** Dispatch-using paths complete after a microtask hop. `flush()` / `awaitSettled()` must distinguish "graph quiescent" from "dispatcher drained." Likely fix: add a `dispatcher.idle()` await alongside the existing graph-quiescence wait.
2. **Error propagation shape.** Inline-fn `throw` is synchronous; dispatcher-routed errors arrive as ERROR messages. Tests asserting sync throw on dispatch-routed factories must migrate.
3. **API surface for async-aware consumers.** D080 / Option B (async-everywhere presentation rebase) re-enters the conversation. If a presentation API must remain sync-default while dispatcher work is async, two paths coexist in the type system. This is the central tension between "uniform dispatcher" and "preserve sync DX." Lock for design session: keep sync local fast path, accept two paths.

### R6 — Performance reality check: latency hierarchy + load-bearing benchmarks

Order-of-magnitude estimates (real numbers must come from bench, but the hierarchy decides API shape):

| Path | Latency |
|---|---|
| In-process sync fn | 10–50 ns |
| Resolved Promise + await | 500 ns – 1 μs |
| `queueMicrotask` roundtrip | 1–5 μs |
| Same-thread channel | 5–50 μs |
| Worker `postMessage` | 50–200 μs |
| IPC pipe | 10–100 μs |
| LAN RTT | 100 μs – 1 ms |
| Cross-region RTT | 10–100 ms |

Workload implications:
- **60fps reactive UI** (16 ms budget) — worker `postMessage` fits comfortably.
- **LLM agent harness** (100 ms+ per call) — dispatcher overhead invisible.
- **High-frequency reactive** (1M events/s) — only sync in-process works. **Must keep local fast path.**
- **DE / warehouse pipelines** (seconds) — dispatcher overhead invisible.

**Bench prerequisite — load-bearing for the design session decisions:**
1. Dispatch-NOP factory end-to-end latency (p50/p99) — must be < 5 μs in-process to claim "local fast path acceptable."
2. 1000-node full-fanout invalidation total time — must remain within ~2× of current pure-ts to claim "no perf regression on existing workloads."

These two benches gate the whole direction. Add to `graphrefly-rs` bench harness alongside the existing perf-investigation cases ([[project_rust_perf_value_investigation]]).

### R7 — Substrate choice: Rust holds; sandbox executors stay multi-language

Rust vs Go for the dispatcher kernel was raised. Verdict: Rust holds, but the right model is **Rust dispatcher kernel + any-language sandbox executors**.

| Dimension | Rust | Go |
|---|---|---|
| Local handle-resolve latency (no GC pause) | ✅ | ❌ GC spikes |
| Network dispatcher ergonomics | ⚖️ tokio mature | ✅ goroutines + net |
| Multi-language binding (napi/pyo3/wasm) | ✅ | ❌ CGO is painful |
| Zero-copy handle passing | ✅ | ❌ GC owns slices |
| Iteration speed | ❌ async Rust friction | ✅ |
| Reuse existing investment | ✅ graphrefly-rs in flight | ❌ from zero |
| Wasm path | ✅ | ❌ tinygo constraints |

Decisive factor: GraphReFly's identity is "low-overhead reactive substrate." GC pauses contradict that identity in high-freq reactive workloads (market data, 60fps UI). Rust holds.

But — **Go (and Python, JS) are first-class sandbox executor languages**. The wire format (change-set + handle protocol + factory-name resolution) is what matters cross-language, not the dispatcher implementation language. This gives Go's dev-velocity advantage on the user side (writing executors) without sacrificing Rust's latency floor on the dispatcher side.

### R8 (CORRECTION TO R5/R6/Q11) — Uniform handle-table model is sharper than the "two-path" framing

**This refinement supersedes the "local fast path bypasses dispatcher" framing in R5 and the four-option Q11 below. Recorded after user pushback 2026-05-26 same session.**

The earlier framing assumed the dispatcher was an *optional path* that some nodes opted into. User's actual proposal is a **uniform handle table** that all fns flow through — generalizing the napi `tsfn` pattern that `graphrefly-rs` already implements at the JS↔Rust boundary.

#### Model

```
Graph layer
  Node holds PoolRef = (pool_id, handle_id)  — not a fn directly
  Wave protocol unchanged (DIRTY / DATA / COMPLETE all preserved)
        │
        ▼  dispatcher.invoke(PoolRef, ctx)
Dispatcher (unified handle/pool registry)
  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
  │ LocalSync    │ │ LocalAsync   │ │ WorkerPool     │
  │ Vec<dyn Fn>  │ │ Vec<AsyncFn> │ │ postMessage    │
  │ direct call  │ │ Promise      │ │ + handle_id    │
  └──────────────┘ └──────────────┘ └────────────────┘
  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
  │ PyPool       │ │ RustPool     │ │ RemotePool     │
  │ pyo3 tsfn    │ │ in-proc      │ │ gRPC/Kafka     │
  └──────────────┘ └──────────────┘ └────────────────┘
```

- `node((ctx) => x + 1)` — at construction, registers fn into **LocalSync pool**, gets handle 7; Node stores `(LocalSync, 7)`.
- `node.async(async (ctx) => fetch(...))` — registers into **LocalAsync pool**.
- `node.via("py-warehouse", "queryFactory", args)` — registers into **PyPool**, handle resolved sandbox-side.
- `describe()` reads the handle table directly: `{node: "foo", pool: "LocalSync", handle: 7}`. The handle table IS describe's data source.

#### Why performance does not regress

LocalSync pool's `invoke` is:
```rust
fn invoke(&self, handle: HandleID, ctx: Ctx) -> Result {
    self.fns[handle](ctx)   // O(1) lookup + direct call
}
```

No microtask hop. No Promise allocation. No await. A single pointer indirection (sub-ns) inside the same wave tick. **Externally indistinguishable from `fn(ctx)`.** This is exactly how napi `tsfn` works: same V8 call stack, synchronous return.

So "dispatcher always participates, but LocalSync pool dispatch = pointer indirection" — these two statements do not conflict. R5's "local fast path bypasses dispatcher" was an unnecessary mitigation for a problem that doesn't exist.

#### Comparison vs the (now-superseded) two-path framing

| Dimension | Two-path (superseded) | Unified handle table (R8) |
|---|---|---|
| Runtime fn-call paths | 2 (inline-direct + factory-dispatcher) | 1 (always through dispatcher; pool diverges internally) |
| `describe()` consistency | inline fns in graph; factory fns in dispatcher — 2 registries | all fns in handle table — 1 registry |
| Observability / audit | inline fn calls invisible | every call routable through audit (opt-out, not opt-in) |
| Cross-boundary semantics | inline-vs-remote = different mechanisms | inline-vs-remote = same mechanism, different pool |
| Snapshot/restore | inline fn not serializable | inline fn serialized as `(LocalSync, 7)` PoolRef; restore requires local pool re-registration (mirrors napi reload semantics) |
| User-facing API | `node((ctx) => ...)` unchanged | `node((ctx) => ...)` unchanged |
| Relationship to `graphrefly-rs` current napi handle table | new layer on top | **direct generalization** of BenchCore's existing tsfn-handle registry |
| Q11 complexity | 4 options to lock | **dissolved** — no opt-in question; everything is in the dispatcher |

#### Q11 reformulation (REPLACES the four-option lock below)

The original Q11 ("how does a node opt into dispatcher?") is **dissolved by R8** — there is no opt-in/opt-out, all fns go through the dispatcher uniformly. The new question shape:

### Q11' (replaces Q11) — Pool-kind taxonomy and user-side selection mechanism

- **A:** User explicitly selects pool per node — `node(fn)` (default LocalSync), `node.async(fn)`, `node.via("py-warehouse", ...)`.
- **B:** Pool inferred from fn shape — `node(asyncFn)` auto-routed to LocalAsync, `node(syncFn)` to LocalSync. Remote-pool requires explicit (cannot infer).
- **C (recommended):** A + B hybrid — local sync/async auto-inferred (preserves current DX); remote pools always explicit (for safety, auditability, and so remote-vs-local boundary is grep-able).

Per-pool decisions still to make in the design session:
- What pool kinds ship pre-1.0? (LocalSync mandatory; LocalAsync probably; WorkerPool nice-to-have; PyPool / RustPool / RemotePool likely deferred.)
- Pool registration API — global at `Impl` creation? Per-graph? Pluggable adapter trait?
- Handle table lifecycle vs graph lifecycle — handles GC on graph teardown, or on pool teardown, or both?
- Snapshot/restore implications — restoring a graph requires the local pool's fns to be re-registered before replay. Mechanism?
- Reverse-RPC: can a remote pool call back into LocalSync via handle (napi-style)? Pre-1.0 lock probably: NO — local handles addressable only by local dispatcher.

#### Downstream effects (R8 consequences for earlier refinements)

- **R3 (describe two-layer) gets sharper:** catalog = an ACL view over the handle table. Progressive disclosure = filtered handle-table view. Same mechanism, different visibility.
- **R4 (no LLM-driven topology mutation) gets sharper:** LLM never touches the graph at all — it's just a caller into the dispatcher with a filtered handle table.
- **R5 needs editing:** the three "real seams" partially dissolve. Test-timing seam reduces to "async pool nodes need to be awaited" (which already exists in current code for async sources). Error-propagation seam stays for async pools, gone for LocalSync. Async-everywhere D080 question stays but is now **per-pool**, not graph-wide.
- **R6 bench targets get more concrete:** measure LocalSync-pool dispatch overhead vs current direct-fn-call (target: <50 ns per call; if higher, the indirection is too expensive). 1000-node fanout-invalidate within ~1.5× of pure-ts (tighter than the earlier 2× because there's no longer a "fast path" excuse).
- **R7 (Rust kernel) gets stronger:** dispatcher is now literally a handle table + pool router + dispatch table. Pure data-structure + branch. Rust is uniquely good at this (no GC means handle table reads are deterministic; sub-100ns invoke is achievable). Go's GC would jitter the handle-lookup path.
- **graphrefly-rs alignment:** `BenchCore` already holds a tsfn handle table for JS callbacks. R8 says: **extract that into a first-class `Dispatcher` struct, generalize handle types beyond `tsfn`, and add pluggable pool kinds.** This is not a new layer — it's an abstraction of what's already there.

#### Acknowledged design-thinking error to record

The four-option Q11 below was generated from an incorrect framing where I assumed uniform dispatch implied uniform async. User's clarification surfaced that **pool kind decides sync/async at the call site**, so uniform dispatch is compatible with sync semantics for the local-sync path. Recording this so the design session doesn't re-walk the dead-end branches.

---

### R9 — Wave-id dissolves; callback IS the wave; dispatcher.invoke stays sync void (validated by PoC 2026-05-26)

**This refinement collapses Q1 (cross-network wave semantics) the same way R8 collapsed Q11. Recorded after user pushback + PoC implementation 2026-05-26 same session.**

#### The wave-id question disappears

Earlier framing assumed cross-network handle dispatch would need a wave-id correlation protocol (Q1 options A/B/C). User's insight: **callback IS the wave**. No identifier needs to travel.

The current pure-ts "wave" exists only as the synchronous call stack of a propagation cycle. It serves two purposes:
1. **Diamond fan-in coalesce** — D fires fn once when both B's and C's DATA arrive.
2. **batch()** — multiple `state.set()` inside a batch produce one wave.

Both are handled by **node-local state**:
1. Diamond uses `_depDirtyFlags[i]` + `_depPendingCount` per node. No global wave-id needed.
2. batch() defers DIRTY+DATA emits until close — source-side coalescing, no wave-id needed.

So even in pure-ts today, **wave-id has no explicit existence** — it's just the implicit synchronous call stack. Once propagation goes asynchronous (cross-network, LocalAsyncPool, even existing producers like `fromPromise`), the wave dissolves into callback chains. The node-local dep flags continue working.

#### The uniform sync dispatcher.invoke contract

The dispatcher API stays:
```
dispatcher.invokeRouted(kind, poolId, handle, batchData, actions, ctx): void
```

Always sync. Always void. Pool kind is **a label documenting fn emit behavior**, not a different call mechanism:

| Pool kind | fn body shape | When does DATA flow? |
|---|---|---|
| LocalSync | `(deps, actions, ctx) => actions.emit(f(deps))` | Same tick (inside `_insideRunWave`) |
| LocalAsync | `(deps, actions, ctx) => { workAsync(deps).then(v => actions.emit(v)) }` | Later (after `_runWave` returned) |
| Remote | `(deps, actions, ctx) => { sendRPC(deps, v => actions.emit(v)) }` | After network RTT |

The `_insideRunWave` flag handles late emits: when `actions.emit` is called after `_runWave` returned (deferred async case), it automatically prepends DIRTY so downstream receives a well-formed (DIRTY, DATA) pair. Same emit method handles both sync and async cases.

#### What survives cross-network from the original Q1 list

Nearly all of Q1's options dissolve. What remains is **NOT graph-protocol concern**:

- **Request-response pairing ID** (per in-flight async call ticket — for switchMap-style cancellation when a new wave arrives mid-async). This is RPC-layer / per-node-policy concern, not wave-protocol.
- **ERROR / timeout / connection-loss** — expressed as message-tag in the same callback channel. Backward channel.
- **Handle GC across the wire** — RPC-layer resource problem, untouched by wave protocol.

Q1 options A/B/C (wave-id correlation strategies) are all retracted — there's no wave-id to correlate.

#### PoC validation — 7/7 tests pass (2026-05-26)

Empirical confirmation of the entire R8 + R9 model:

**Files (all in `packages/pure-ts/src/__experiments__/r8-poc/` + `__bench__/`):**
- `protocol.ts` — TinyNode base + wave protocol with `_insideRunWave` flag for late-emit DIRTY pairing
- `baseline.ts` — `BaselineNode<T>` stores `_fn` as member field (mirrors current pure-ts)
- `r8.ts` — `R8Node<T>` (LocalSync pool), `R8AsyncNode<T>` (LocalAsync pool), `R8RemoteNode<T>` (SimulatedRemotePool with setTimeout RTT), `Dispatcher` with `invokeRouted(kind, poolId, handle, ...)` uniform sync entry point
- `r8-poc.test.ts` — sync parity between Baseline and R8 (doubler chain + diamond fan-in): **2/2 pass, byte-identical outputs**
- `r8-async.test.ts` — R9 validation: dispatcher stays sync; async/remote emit-later works; mixed sync+async diamond coalesces correctly; back-to-back async pushes both flow through; 1000 sync invocations through dispatcher in < 5μs/call: **5/5 pass**
- `__bench__/r8-poc.bench.ts` — end-to-end perf, R8 vs Baseline on same protocol
- `__bench__/r8-dispatch-overhead.bench.ts` — single-call indirection microbench

**Bench results (R8 vs Baseline, same protocol, only fn-dispatch differs):**

| Workload | Baseline ns/op | R8 ns/op | Ratio |
|---|---:|---:|---:|
| state.set + subscriber | 30.9 | 33.8 | 1.09× |
| derived 1-dep | 76.2 | 81.5 | 1.07× |
| derived 2-dep | 87.2 | 88.8 | 1.02× |
| diamond | 191 | 206 | 1.08× |
| chain 5 | 283 | 297 | 1.05× |
| chain 10 | 518 | 554 | 1.07× |
| chain 20 | 974 | 1,020 | 1.05× |
| fanout 10 | 117 | 116 | 0.99× |
| fanout 100 | 892 | 906 | 1.02× |
| fanout 1000 | 8,732 | 8,427 | 0.97× |

**R6 #1 (single-call indirection):** array-index dispatch ~0 ns vs direct fn call (V8 IC inlines). R6 target was < 50 ns — **passed by ~50×**.

**R6 #2 (end-to-end protocol):** worst case state.set + subscriber at 1.09× baseline. R6 target was ≤ 1.5× — **passed with 41-percentage-point margin**. Chain workloads amortize even better (per-fn overhead ~2–5 ns).

**Async dispatch (LocalAsync / SimulatedRemote):** `dispatcher.invokeRouted` returns < 1μs even for async fns (measured 1000-call loop). Late-emit via callback works correctly with proper (DIRTY, DATA) pairing — diamond test with one sync + one 5ms-RTT remote leg fires the join fn exactly once.

#### R9 design-thinking errors recorded

- Earlier Q1 framing assumed wave-id correlation was needed cross-network. **Wrong** — wave-id has no explicit existence even locally; it's the implicit call stack. Once async, it dissolves into callback chains naturally.
- Earlier suggestion that LocalAsync pool would force the whole protocol async. **Wrong** — late emit pairs DIRTY+DATA via the same callback channel; dispatcher.invoke stays sync void; only the fn's body is async.

---

### R10 — FactoryRegistry as separate primitive (locked by user 2026-05-26 same session)

The R8/R9 collapse surfaces a clean architectural separation:

```
┌──────────────────────────────────────────────────────────────┐
│  Application code (any layer)                                │
└──────────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│  Catalog (filtered view of registry by tag/permission)       │  ← LLM-visible scope
└──────────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│  FactoryRegistry per language runtime                        │  ← separate primitive
│    .registerFactory(fn) → handleId                           │
│    .execute(handleId, args, forward, backward) → void        │
└──────────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│  GraphReFly Core (wave protocol + topology)                  │
│    Node holds handleId; provides forward/backward callbacks  │
└──────────────────────────────────────────────────────────────┘
```

#### Key locks

1. **FactoryRegistry is a separate concept from the graph.** Its sole job is "register a fn, get a handle; later call execute(handle) and route the result via forward/backward callbacks." It does NOT know about wave protocol, DIRTY/DATA, diamond resolution. The graph is a *consumer* of FactoryRegistry, not a part of it.

2. **`execute(handle, args, forward, backward)` is the registry's only execution entry.**
   - `forward(value)` — success / DATA callback
   - `backward(error)` — error / ERROR callback
   - Twin callbacks replace the single emit-with-ERROR-tag pattern at the registry boundary. Graph layer composes them: forward = `actions.emit`, backward = `actions.error` (or emit ERROR message).

3. **One FactoryRegistry per language runtime.** Browser/Node TS app → TS FactoryRegistry. Native binary → Rust FactoryRegistry. Python sandbox → Py FactoryRegistry. Each registry holds the factories *executable on that runtime*. Cross-runtime execution = registry-to-registry RPC bridge.

4. **Catalog = filtered subset of FactoryRegistry.** Tag + permission filters select which handles are visible to a given consumer (LLM executor, end-user code, untrusted subgraph). Progressive disclosure for LLMs is a filtered Catalog. R3's two-layer invariant (static catalog scope, dynamic audit) is enforced at the Catalog level — Catalog scope is declarative; runtime invocations are recorded.

5. **FactoryRegistry is RPC-shaped at its boundary** — `execute(handle, args, forward, backward)` is exactly the request/streaming-response pattern existing RPC libraries handle. Candidates (do NOT lock without survey):
   - Node: nothing perfect — possible: msgpack-rpc, grpc-js, or DIY over WebSocket/MessageChannel
   - Rust: `tarpc`, `tokio-tower`, `tonic` (gRPC), `napi` for in-process TS bridge
   - Python: `grpc`, `msgpack-rpc-python`
   - Cross-language: gRPC (heavy), Cap'n Proto RPC, NATS, or zero-dep WebSocket+JSON
   - **Open question:** does GraphReFly ship its own zero-dep wire, or compose with an existing RPC library? Trade-off: dep weight vs control over backpressure / cancellation / streaming semantics. **Defer to Q12.**

6. **Substrate placement is environment-determined, not user-chosen:**
   - **Browser** → TS core + TS FactoryRegistry (in-process pools only; no RPC layer ships).
   - **Machine (Node / native)** → Rust core + Rust FactoryRegistry (can RPC out to other machines / sandboxes).
   - User code lives at the patterns layer in whichever language gives the best DX for that domain (TS for web, Python for ML, etc.). Patterns talk to local Catalog → local FactoryRegistry → optionally RPC out.

#### What this clarifies on already-locked decisions

- **D080 three-siblings (`pure-ts` | `native` | `wasm`):** each sibling now has a clear identity = "core + FactoryRegistry for that runtime." `wasm` becomes obvious for browser+heavy-compute combo.
- **R8's "factories declare dispatchable":** that question is now scoped INSIDE FactoryRegistry. The graph just records a handle; FactoryRegistry decides what to do with it.
- **R7 (Rust kernel + multi-language sandbox executors):** "multi-language sandbox executor" is precisely "another runtime's FactoryRegistry, reachable via RPC."
- **DS-14 changesets:** the change-set wire is one specific use of the registry-to-registry RPC bridge — the wire format for distributing state and topology changes. Other use cases (handle execution requests, forward/backward results) reuse the same bridge.

#### Q12 (NEW) — Wire format / RPC dependency strategy

- **Option A:** Zero-dep — graphrefly ships its own minimal binary wire (Cap'n Proto-flavored or JSON-over-WebSocket). Pro: no dependency on user's RPC choice. Con: maintenance burden, reinventing well-solved problems.
- **Option B:** Adapter pattern — abstract FactoryRegistry's RPC bridge behind a trait; ship reference adapters for gRPC, NATS, WebSocket; let user plug in their own. Pro: composable with existing infra. Con: API surface for adapter contract.
- **Option C:** Pick one canonical RPC backend (e.g. tarpc on Rust side, msgpack-rpc on TS side) and standardize. Pro: simple. Con: forces user dep choice; harder to integrate into existing systems.

Recommended **B** as default but defer the lock until the first real cross-language consumer surfaces — the actual constraints (transport, backpressure, streaming, observability hooks) will be clearer with one concrete use case.

#### Q13 (NEW) — Catalog mechanics

- How is "tag" / "permission" expressed on a registered factory? Static metadata at registerFactory time? Runtime-evaluated predicate?
- Can a Catalog be reactive (a Node whose value is the visible-handle set, changing as permissions/tags change)? R3 hinted yes — needs design.
- Multi-catalog: one runtime could expose different catalogs to different LLMs / subgraphs / users. Catalog ID flows through executor invocation.

---

### R11 — Pre-1.0 wedge lock: agentic memory + harness (locked by user 2026-05-26 same session)

After critical review of "is R8/R9/R10 the simplest thing? does it serve all 5 stated goals equally?" the user locked the pre-1.0 wedge:

**Wedge = agentic memory + harness.** Not "all five goals equally." Other goals (multi-agent comm, orchestration, messaging, DE) are served as fall-out from a strong wedge, NOT as primary pre-1.0 targets.

#### Why this wedge specifically

Both targets are **diamond-heavy by structural necessity** — which validates R8/R9/R10's choice to preserve DIRTY (see R12 below). They are NOT served by simpler alternatives because:

- **Agentic memory**: Mem0/LangMem cover single-process; nobody covers "multiple agents writing to shared reactive memory, downstream queries coalesce, cross-runtime sharing." The diamond pattern is structural — concurrent writes from N agents must coalesce before downstream consumers react.
- **Harness**: LangGraph covers single-agent imperative graph; nobody covers "TRIAGE routes to parallel capability pool (different sandboxes/latencies), VERIFY waits for all, REFLECT re-routes — all reactive." The harness loop's parallel-capability fan-in is diamond-shaped.

#### What this de-prioritizes (NOT cancels)

- Multi-agent comm — covered as a side-effect of memory + harness; full A2A-style federation deferred
- Orchestration as standalone — harness IS orchestration for the agent case; broader pipeline orchestration (DAG-of-services à la Airflow) deferred
- Messaging as standalone — Kafka/NATS not displaced; GraphReFly stays consumer of messaging
- Data engineering — `/research` 2026-05-26 lock retained (DE is side-effect, not target); R1 stays

#### Effect on R8/R9/R10 work plan

- R8/R9/R10 architectural locks (uniform handle table, callback-IS-wave, FactoryRegistry as separate primitive) stay. They are correct shape; wedge just narrows the design surface that needs LOCKING pre-1.0.
- Q12 (RPC wire choice) — narrow to "what does memory + harness actually need?" Likely: in-process napi for TS↔Rust; WebSocket+JSON for browser↔server; defer cross-machine RPC until consumer pressure.
- Q13 (Catalog mechanics) — **dissolved by user insight 2026-05-26 same session**: Catalog is a reactive derived Node over `registry.listHandles()` filtered by tags/perms. Not a foundational primitive. Drops layer count from 3 (Registry/Catalog/Graph) to 2 (Registry/Graph). Catalog ships as a userland pattern.
- Bench targets: extend the PoC to a memory-store-with-diamond workload + a parallel-capability-fan-in workload before declaring perf clean.

---

### R12 — DIRTY phase retained; in multi-dispatcher / multi-sandbox it is a CONSISTENCY primitive, not just a perf optimization (locked 2026-05-26 same session, retracts an earlier draft suggestion)

#### Design-thinking error recorded

In the round-3 critical review, the assistant suggested DIRTY could potentially be removed because "R9 says wave-id dissolves into callback chains, so maybe DIRTY too is over-engineered." **This was wrong.** R9 dissolved the global wave-id identifier; it did NOT dissolve the per-node mechanism that decides "when have all upstream contributors settled this propagation cycle?" These are two distinct concepts that the assistant conflated. Recording the slip so the design session does not retread it.

#### What DIRTY actually does (corrected understanding)

DIRTY is the per-node coalesce barrier. For A → B,C → D:

- **Without DIRTY:** A.emit → B computes, emits DATA to D → D fires fn with `(B_new, C_old)` (transient wrong intermediate) → C computes, emits DATA → D fires fn again with `(B_new, C_new)`. Two fn calls, one transient wrong emission.
- **With DIRTY:** A.emit emits DIRTY to B,C → both emit DIRTY to D → D registers "2 incoming" → DATA flows, D waits for both before firing. One fn call, no wrong intermediate.

#### Multi-dispatcher / multi-sandbox upgrades DIRTY's role

In a single in-process dispatcher with sync fn, DIRTY is primarily a **performance optimization** (saves a redundant fn call; the eventually-overwritten transient wrong value rarely causes user-visible damage).

In multi-dispatcher / multi-sandbox / cross-runtime, DIRTY becomes a **consistency primitive**:

```
              A  (dispatcher-1, local)
            /                       \
   B (sandbox-X, ~50ms)     C (sandbox-Y, ~200ms)
            \                       /
              D  (dispatcher-1, local)
```

Without DIRTY, D fires at t=50ms with `(B_new, C_old)` — and that `(B_new, C_old)` state might **trigger side effects** (write to memory, send message, etc.) before C ever returns. The transient inconsistency is no longer covered by "eventually overwritten" because side effects already happened.

With DIRTY, D's fn doesn't fire until both sandboxes return — the cross-runtime snapshot is consistent.

#### DIRTY across the RPC bridge — no new mechanism needed

DIRTY is just another message tag (`["DIRTY"]` vs `["DATA", v]`). RPC bridges forward it identically:

```
sandbox-X side of B:
  recv ["DIRTY"] from RPC (from A, dispatcher-1)
  → mark self dirty
  → emit ["DIRTY"] to local subscribers + reverse RPC to remote downstream
  ... compute ...
  → emit ["DATA", v] same path
```

The bridge doesn't interpret the message — DIRTY and DATA are equally opaque. So multi-dispatcher correctness is achieved without protocol invention; DIRTY just rides the same wire as DATA.

#### Wedge alignment

Both wedge targets (agentic memory + harness) are diamond-heavy, validating DIRTY's retention:

- **Memory**: multiple agents writing concurrently → downstream queries must coalesce before reacting → DIRTY enforces the coalesce window.
- **Harness**: TRIAGE → parallel capabilities → VERIFY → all capabilities run in different pools/sandboxes; VERIFY's fn must NOT fire until every capability path has settled, or VERIFY's verdict is built on partial information.

If we had locked the wedge differently (e.g., pure single-shot LLM proxy with no fan-in), the DIRTY question might have been more open. Locked-in wedge makes DIRTY's preservation a forced lock.

#### Q11' update — pool-kind taxonomy now must include "DIRTY-aware" routing

Cross-runtime DIRTY routing is part of the dispatcher's job. Specifically: when a dispatcher sees that a downstream subscriber is on a different runtime (across RPC bridge), DIRTY emissions must be forwarded over the bridge AT THE SAME PRIORITY as DATA. Implementation note: pool adapter for remote pools must implement both `emitDirty(handle)` and `emitData(handle, value)` callbacks.

---

### Q11 (HISTORICAL — superseded by Q11' above; kept for design record only)

This is the single biggest API-surface decision. Four options surfaced during the round-2 discussion:

**Option A — Single dedicated `remoteExecute` node**
- Pros: Crisp dispatch boundary in `describe()`; existing `core/extra/graph` API untouched.
- Cons: Two-paradigm mental model (reactive nodes vs dispatch nodes); cannot dispatch `derived` / `state` without rewriting as `remoteExecute`; collides with the factory-isation work that already exists.

**Option B — Existing API widening (every constructor takes `executor`/`dispatch` opts)**
- Pros: Uniform mental model.
- Cons: API surface bloat; inline-fn dispatch forces closure serialization (which doesn't work); `describe()` must read opts to compute dispatch boundaries (heavier static analysis).

**Option C (recommended underlying mechanism) — Factory declares dispatchability**
- `defineFactory("foo", { dispatchable: true | "local-only" | { pool: "x" }, build, factoryArgs })`
- Inline `node((ctx) => ...)` is **automatically local-only** because it has no name to resolve sandbox-side. This is a mechanic, not a convention, not a rule — it cannot be bypassed.
- `describe()` already records factory name + args; reading dispatch policy is zero-overhead static analysis.
- The progressive-disclosure catalog presented to an LLM executor IS the dispatchable-factory subset — **same mechanism, two views**.
- Reuses factory-isation investment (D202/D203 et al.).
- Existing users with no factory usage feel zero API change.
- Cost: factory authors take on a new decision (dispatch policy) at registration time.

**Option D — Subgraph-level dispatch scope**
- `subgraph({ executor: "py-pool" })` sets a default sandbox for everything inside.
- Pros: Natural fit for "harness EXECUTE stage all dispatches to the same pool."
- Cons: Too coarse standalone; mixing local + remote inside one subgraph gets awkward. Best as a **layered default** on top of Option C, not as the primary surface.

**Recommended composite (pending lock):**
- **Mechanism (mandatory):** Option C. Factory declares `dispatchable`. Inline fns are inherently local-only.
- **Convenience layer for 90% LLM/agent users (likely):** A canonical `executor()` / `agent()` factory that is itself `dispatchable: true` and whose work fn summons other dispatchable factories from a catalog (Option A *flavor*, sitting on top of Option C).
- **Optional scope default:** Option D as a subgraph-level default value for dispatch pool, overridable per-factory.

The three user tiers this serves:
| Tier | Surface they touch | Cognitive load |
|---|---|---|
| Reactive user (UI, state-management) | nothing — inline fns stay local-only automatically | zero |
| LLM/agent user | `executor()` / `agent()` factory + catalog | low — one convenience factory |
| Connector author / library writer | `defineFactory({ dispatchable })` directly | medium — registration-time decision |

Q11 lock IS the design session's deliverable. The composite above is the strawman to argue with.

---

## 7. Cross-references

- `archive/docs/SESSION-DS-14-changesets-design.md` — universal `BaseChange<T>` envelope (the wire format)
- `archive/docs/SESSION-DS-native-substrate-contract.md` — `Impl` contract + D080 + D206 (substrate-vs-presentation)
- `docs/cross-track-ledger.md` — the `Impl`-widening ledger (must be touched if this lands)
- `docs/implementation-plan.md` — Phase 14 (changesets) is the most natural home
- `docs/rust-port-decisions.md` — D080, D206, D272+, D292+, D293
- `archive/docs/SESSION-DS-14.5-A-narrative-reframe.md` — multi-agent subgraph ownership (L0–L3 staircase) interacts with handle ownership semantics
- `/research` 2026-05-26 — DE Agent Harness landscape + trigger×task matrix; segment that forces handle-dispatch
- `packages/parity-tests/impls/types.ts` — the `Impl` interface that would widen
