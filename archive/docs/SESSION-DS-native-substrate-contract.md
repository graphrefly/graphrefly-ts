---
SESSION: DS-native-substrate-contract
DATE: 2026-05-15
TOPIC: Reconcile the unresolved conflict between D080 (async-everywhere public API across all substrate siblings, explicitly deferred to near-1.0) and Q28/D198 (install-time `overrides` drop-in: redirect `@graphrefly/pure-ts` → `@graphrefly/native`, "locked 2026-05-14"). Surfaced while attempting cleave-/qa N1's "build the real @graphrefly/native wrapper": the drop-in is non-functional and not well-posed. Decide the sync-vs-async public substrate contract + sequencing before any native-wrapper effort.
REPO: graphrefly-ts (TS-primary; the conflict spans graphrefly-ts presentation + graphrefly-rs napi)
STATUS: DESIGN — NOTHING LOCKED. For user review. Recommendation = Option A; open questions Q-S1..Q-S4 await an explicit lock.
SUPERSEDES: nothing yet. If a lock is taken it will annotate Q28/D198 (CLAUDE.md "Three-package install-time model") and the D080 "Deferred 1" note in SESSION-rust-port-architecture.md.
---

## CONTEXT

The cleave-/qa N1 follow-up ("`@graphrefly/native` must expose the substrate symbols presentation imports from the peer") escalated, on the user choosing "build the real native wrapper now", into a feasibility investigation. Finding: **`@graphrefly/native` cannot be a drop-in substitute for `@graphrefly/pure-ts` as currently advertised, and the wrapper is not a well-posed build target.**

This session does NOT design the wrapper. It reconciles the contradictory decisions that make the wrapper ill-posed, and asks the human to lock the public substrate contract + sequencing.

**Source material:**
- D070 / D077 (async-everywhere parity contract; Core on tokio blocking pool) — `docs/migration-status.md` Phase E; `packages/parity-tests/impls/types.ts` header.
- D080 (async-everywhere **public API across all three siblings**; pure-ts `Promise.resolve()`-wrapped) — `archive/docs/SESSION-rust-port-architecture.md:1155/1177/1275-1283`. **Its facade + async-wrap is explicitly deferred ("Deferred 1", near-1.0, after M5).**
- Q28 = option (c) / D198 (install-time `overrides` drop-in; "No facade with runtime fallback") — `CLAUDE.md` "Three-package install-time model (Unit 6 D198, locked 2026-05-14)"; `src/index.ts:11-13`.
- napi async-only evidence — `~/src/graphrefly-rs/crates/graphrefly-bindings-js/src/core_bindings.rs:6-20`, `index.d.ts:80-85`, `docs/porting-deferred.md` (sync-call-deadlocks).
- Consumer-pressure ground truth — memory `project_memo_re_consumer.md`; `~/src/cognitive-buddy/documents/architecture.md` "§ Reactive Substrate Revision (2026-05-14)".
- D196 (parity scenarios = the consumer-pressure signal; native widening is consumer-gated) — `packages/parity-tests/README.md`.

---

## CURRENT STATE (verified 2026-05-15 — do NOT re-investigate)

| Fact | Evidence |
|---|---|
| Every Core-touching `@graphrefly/native` napi method is **async** (`Promise`): `registerStateInt`, `emitInt`, **`cacheInt` (the cache *read*)**, `subscribeWithTsfn` ("synchronous calling deadlocks"). Only pure value-registry ops (`internInt`/`derefInt`/`allocExternalHandle`) are sync. | `core_bindings.rs:6-20,1057,1252,1264`; `index.d.ts:80-85,243-258,386+` |
| Core runs sync inside `spawn_blocking`; the napi boundary is forced async so the JS thread can pump libuv for TSFN sink callbacks. A sync (non-await) call into the TSFN bridge **deadlocks** — the entire design forbids it. | `core_bindings.rs:6-20`; `porting-deferred.md` (Option-E rationale) |
| `@graphrefly/native` does **not** export `node`/`Graph`/`map`/`state` — its surface is the `Bench*` parity-harness classes. `package.json` has only `"main"`, no `exports` map, no `/core`·`/extra` subpaths. `index.js/.d.ts` are 100% napi-auto-generated. Sole consumer = `packages/parity-tests` via `rust.ts`. | native `package.json`; `index.js` header |
| `@graphrefly/pure-ts` public API is **sync**: `node()`/`state()`/`map()` return synchronously; `n.cache === 0` readable synchronously **at construction**; sync `.subscribe`/`.emit`/`.down`. | pure-ts `core/node.ts`; pervasive presentation usage |
| Presentation depends on the sync contract pervasively — not just leaf consumers but **operator/source authoring**: `src/base/sources/async.ts` builds nodes via sync `node(...)`, sync `src.subscribe()`→sync unsub, sync `a.emit/a.down`, reads `source.cache` sync to seed `initial`; `src/utils/resilience/adaptive-rate-limiter.ts:189/193/290` sync `.cache` + sync `emit`. | spot-checked |
| `RustNode.cache` is a JS-side mirror populated **only** inside the async TSFN sink (post-`await subscribe()` + ≥1 batch). `state(0).cache === 0` at construction is structurally impossible over the binding. | `rust.ts:210-231,248` |
| **Only concrete consumer (memo:Re) locked `@graphrefly/pure-ts` FOREVER for mobile (Hermes — native is napi/Node-only, won't load) and web; native is a future, post-M5/DS-14.7-napi, install-time-only, NON-blocking backend swap.** No consumer needs native today. | `project_memo_re_consumer.md:18-23,31-35` |
| D080 ("async-everywhere public API across all siblings") is the only documented coherent path AND is explicitly deferred near-1.0; never reconciled with the newer Q28/D198 framing. Q28/D198 (CLAUDE.md) presents the overrides drop-in as a working *locked* mechanism. | `SESSION-rust-port-architecture.md:1275-1283`; `CLAUDE.md` Unit 6 |

**The core contradiction:** the `Impl` contract a native wrapper must satisfy is async; the package it must substitute for (pure-ts public API, consumed by presentation) is sync; bridging them synchronously deadlocks. D080 says "make the public API async everywhere" but is deferred; Q28/D198 says "swap at install time" but that swap cannot work without D080. **There is no agreed target shape for the wrapper.**

---

## OPTION SPACE

### Option A — Retract the drop-in claim; `@graphrefly/native` = parity-test arm; defer real native consumption to a future async-contract milestone (RECOMMENDED)

`@graphrefly/pure-ts` is the only working substrate provider. `@graphrefly/native` stays exactly what it is today: the parity-test arm + the Rust-port correctness validator. Q28/D198's overrides snippet is marked **superseded/aspirational**, pointing forward to the (renamed/owned) D080 milestone. No native public surface is built. Native publish stays gated; if ever published pre-contract it must be a `0.0.x`/`-pre` with a description that says "parity/validation artifact, not a consumable substrate."

- **Cost:** ~0 code (doc-truth already applied this session). Closes the ill-posed work cleanly.
- **Consumer-pressure fit:** maximal. memo:Re locked pure-ts forever for mobile/web; native is a *non-blocking, post-M5, install-time-only* future backend swap. Under D196 there is **no current pressure** for native-as-drop-in. The D203 native-publish urgency premise ("a downstream is forced onto pure-ts") is itself weakened by `project_memo_re_consumer.md` (that downstream *chose* pure-ts and locked it).
- **Risk:** the "Rust substrate is consumable today" value-prop slips to the D080 milestone. Acceptable — it was never true; saying so is honest. Wave-2 narrative must not claim a usable native drop-in until then.
- **Revisit trigger (Q-S2):** memo:Re's premium-backend native swap becoming actually-blocking (post-M5 + DS-14.7-napi), OR a new Node-backend consumer with hard native perf pressure. That trigger opens Option B or C as its own design+impl session.

### Option B — Execute the deferred D080 now (async-everywhere public API), then build the wrapper

Rebase `@graphrefly/graphrefly` presentation onto an async substrate contract: every `node()/state()/map()/derived()/effect()`, every `.cache` read, every `.subscribe/.emit/.down`, AND the operator/source *authoring* model become `Promise`/`await`. `@graphrefly/pure-ts` is `Promise.resolve()`-wrapped to match. Then `@graphrefly/native` (already async) becomes a legitimate drop-in and the wrapper is well-posed.

- **Cost:** very high. Touches the entire presentation surface + the substrate-authoring ergonomics. Multi-session, near-1.0 scope (this is *why* D080 deferred it). Every preset/util/base/compat file + COMPOSITION-GUIDE + every example.
- **Risk:** sync ergonomics ("a reactive graph whose values you read synchronously, `n.cache`, `graph.observe`, run-and-see") is a **core value prop and the founding vision** (cf. memory `project_dynamic_graph_visualization`). Async-everywhere is a fundamental UX regression for the 100%-of-current-consumers who use pure-ts. Doing this with zero native consumer pressure inverts D196.
- **Verdict:** premature. Right *eventually* only if native consumption becomes load-bearing AND the async UX cost is accepted at the product level. Not now.

### Option C — Hybrid: ship a *separate* async `@graphrefly/native` public surface (NOT a pure-ts drop-in)

Build an async-shaped public API for `@graphrefly/native` (mirrors the `Impl` async contract — subpath exports + a hand-written TS layer over `Bench*`). It is **not** consumed by `@graphrefly/graphrefly` (presentation stays sync/pure-ts). It serves *new* async-tolerant Node consumers directly.

- **Cost:** medium (the wrapper the user originally wanted, but honestly typed async — ~1 file/symbol over `Bench*`, subpath `exports`, the full async `Impl` surface).
- **Risk:** two public substrate surfaces (sync pure-ts for presentation, async native for direct consumers) → divergence/maintenance; `@graphrefly/graphrefly` *still* can't use native (the drop-in promise stays false). Solves "native is publishable + usable by *someone*" without solving the drop-in. Partially re-introduces the PART-13 facade smell.
- **When this wins:** only if a concrete consumer wants native *directly* (not via `@graphrefly/graphrefly`) before D080. No such consumer exists today (memo:Re backend swap is via `@graphrefly/graphrefly/compat/nestjs` + install-time, i.e. it *wants the drop-in*, not a separate async API).

### Option D — Sync-blocking napi bridge into Core (REJECTED)

A sync napi fn that `block_on`s the Core thread so pure-ts's sync signatures are preserved over native.

- **Rejected by evidence:** documented to **deadlock** — the JS thread blocked in a sync call cannot pump libuv, so the TSFN sink never delivers; `subscribeWithTsfn`'s own docstring says "synchronous calling deadlocks", and Option-E exists specifically to forbid sync calls (`core_bindings.rs`, `porting-deferred.md`). Also incompatible with the per-subgraph-parallelism / subscribe-during-fire constraints (D3). Listed only to record that it was considered and why it fails.

### Option E — Out-of-scope deep alternatives (note only)

Worker-thread Core + `Atomics.wait` sync bridge; or a non-napi in-process embedding. Each is its own multi-week research track with its own deadlock/perf surface. Not proposed; flagged so a future session doesn't think they were missed.

---

## 9Q WALK — Unit: public substrate contract

**Q1 — Semantics / purpose.** "Which package(s) may legitimately provide the substrate `@graphrefly/graphrefly` runs on, and is that contract sync or async?" Today's *de facto* answer: pure-ts only, sync. The *advertised* answer (Q28/D198): pure-ts or native, install-time. The two disagree; this unit makes the de facto answer the *de jure* one (Option A) until a consumer forces otherwise.

**Q2 — Abstraction boundary.** The `Impl` parity contract is the substrate API boundary for *testing*. It is NOT (today) the boundary presentation consumes — presentation consumes pure-ts's concrete sync API. D080's intent was to *make* `Impl`-shaped async the presentation boundary. Option A keeps the boundary sync-pure-ts and treats `Impl` as a parity/validation contract only — coherent and already true. Option B promotes `Impl`-async to the presentation boundary (huge). Mixing them (status quo) is the bug.

**Q3 — Long-term shape.** The Rust substrate's value is realized at the *backend/server* tier (perf, native), never mobile/web (Hermes/browser keep pure-ts/wasm forever — locked). So the long-term shape is: **pure-ts is the universal default forever; native is a server-tier accelerator opted into when a server consumer's perf pressure justifies the async-contract cost.** That is Option A now → (B or C) when the trigger fires. Designing the async rebase before the server consumer exists optimizes for a hypothetical.

**Q4 — Reactive composability.** `n.cache` synchronous-at-construction and sync `subscribe`/`emit` are load-bearing for the reactive-composition ergonomics and the "run-and-see" founding vision. An async substrate changes how *every* factory is authored (operators/sources can't read `src.cache` to seed `initial` synchronously). This is not a mechanical wrap — it is a composition-model change. Strong reason not to do B speculatively.

**Q5 — Alternatives considered.** A/B/C/D/E above. D rejected on evidence. E noted. Real choice = A (now) vs C (if a direct async native consumer appears) vs B (only if the product accepts async-everywhere UX for native pressure).

**Q6 — Coverage / blast radius.** Option A blast radius ≈ docs only (done this session) + closing the wrapper task + (optional) renaming Q28/D198's status. Option B blast radius = entire presentation package + authoring model + guide + examples. Option C blast radius = a new native public surface + subpath exports + its own parity wiring; presentation untouched.

**Q7 — Sequencing.** A is immediately closable. The decision that gates B/C is *consumer-driven*: it should be re-opened **at** the memo:Re premium-backend native-swap point (post-M5 + DS-14.7-napi), as its own design+impl session, with that consumer's real requirements in hand — not now.

**Q8 — Migration cost / reversibility.** A is fully reversible (it's the truthful status quo + doc accuracy). B is effectively irreversible once presentation is async-rebased. C is additive but creates a second surface that's costly to later unify into B. Prefer the reversible, consumer-gated path.

**Q9 — Consumer pressure (decisive).** Per D196 the project gates substrate widening on real parity-scenario / consumer pressure. The only concrete consumer **chose pure-ts and locked it forever for mobile/web**; native is explicitly a *future, non-blocking, install-time* backend swap. Therefore current pressure for native-as-drop-in = **zero**. D196 logic ⇒ Option A. (This also means the D203 native-publish milestone's premise should itself be re-examined — see Q-S4.)

---

## RECOMMENDATION

**Option A.** Lowest cost, fully reversible, maximal D196/consumer-pressure fit, and it makes the docs tell the truth (already applied this session). Treat `@graphrefly/native` as the parity/validation arm; keep `@graphrefly/pure-ts` as the sole working substrate provider. Re-open the sync-vs-async public-contract decision (Option B vs C) as a dedicated consumer-driven session **when** the memo:Re premium-backend native swap becomes actually-blocking (post-M5 + DS-14.7-napi), not before.

Nothing here is locked. The following must be decided by the user.

---

## OPEN QUESTIONS (for the user to lock — nothing decided)

- **Q-S1 — Adopt Option A?** Or B (async-everywhere now) / C (separate async native surface)? Recommendation: A.
- **Q-S2 — If A, what is the explicit revisit trigger + owner?** Proposed: "memo:Re premium-backend native swap becomes blocking (post-M5 + DS-14.7-napi)" opens a dedicated `/design-review` → `/dev-dispatch` session. Confirm or set a different trigger.
- **Q-S3 — Decision-record bookkeeping.** Should Q28/D198 be (a) annotated "drop-in deferred — see this session" in CLAUDE.md (done provisionally) and a new D-number assigned recording the A lock + the D080↔Q28/D198 reconciliation, or (b) handled differently? Who assigns the D-number (`docs/rust-port-decisions.md` lives in graphrefly-rs).
- **Q-S4 — D203 native-publish premise.** D203 ("native-publish is an explicit user goal — a downstream is forced onto pure-ts") is partly contradicted by `project_memo_re_consumer.md` (memo:Re *chose* pure-ts; native is a future non-blocking swap). Does the native-publish milestone stay scheduled, get demoted to "publish a clearly-labeled validation artifact", or fold into the future async-contract session? This decides whether the gated publish ever happens pre-D080.

---

## WHAT WAS DONE THIS SESSION (no decisions taken)

- Doc-truth corrections (no-regrets, applied per user direction): `src/index.ts:11+` header, `@graphrefly/native` `package.json` description, `CLAUDE.md` install-time-model section, `docs/optimizations.md` "Native substrate contract" entry, `~/src/graphrefly-rs/docs/migration-status.md` item-8 block — all now state the drop-in is non-functional / design-pending and point here.
- This design doc authored for review. Native wrapper + native publish remain BLOCKED pending Q-S1.
