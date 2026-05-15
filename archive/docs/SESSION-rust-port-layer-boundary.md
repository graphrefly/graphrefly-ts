# Session — Rust Port Layer Boundary: pure-ts ↔ native ↔ patterns substrate

**Date:** 2026-05-14
**Trigger:** During `/porting-to-rs next batch` (F18 / F20 / F24 / D171) the user surfaced a layering concern: "some part of the patterns also got into native but we have not separated them by the folders. I don't know where we are and it's hard for the users to commit to this library too if they don't see clear structures of dependencies." Concrete evidence: `ReactiveLog::view({ kind: 'fromCursor' })` ships in Rust core but the napi `BenchReactiveLog` doesn't expose `view`/`scan`/`attach` — F18 deferral is currently rationalized as "no JS consumer pressure," but the real reason is that the consumer (`patterns/messaging`) has no Rust counterpart yet.

**User-confirmed lock entering this session:**
> "We did decide that we port only core, extras, graph, and some lower part of the pattern `orchestration` and `messaging` into Rust."

So the *folder-level* layering is settled. What's NOT settled is:
- The **operational predicate** that says which symbol inside `extra/` or `patterns/{orchestration,messaging}` is substrate (→ Rust) vs presentation (→ binding-side).
- The **napi widening policy** for Rust-core surfaces whose consumers are pure-ts (the F18/FromCursor inconsistency).
- The **package-content story** for users installing `@graphrefly/native` vs `@graphrefly/pure-ts`.

**Precedent sessions:**
- `SESSION-rust-port-architecture.md` PART 5 — layered move-vs-stay recommendation (2026-05-03)
- `SESSION-patterns-extras-consolidation-plan.md` — extra/ folder split + naming conventions
- `SESSION-ai-harness-module-review.md` — **the 9Q per-unit review format used here**
- `SESSION-human-llm-intervention-primitives.md` — hub + envelope substrate; humanInput/approvalGate/tracker as sibling presets; "only two true primitives"
- `SESSION-DS-14.6-A-multi-agent-context-architecture.md` — tagged context pool at patterns/extras layer; actorPool / heterogeneousDebate presets; L10 lock: "data-not-closure"
- `SESSION-DS-14.7-reactive-fact-store.md` — static-topology `reactiveFactStore` at `patterns/ai/memory/`; "zero spec change, zero envelope change"; reactiveIndexedTable as parked v1.x extraction candidate

---

## Per-unit review format

Each unit answers Q1–Q9 then closes with a "Decisions locked (date)" block. Format mirrors `SESSION-ai-harness-module-review.md` § Per-unit review format (revised 2026-04-23).

1. **Semantics, purpose, scope** — what this unit decides, with file/symbol refs.
2. **Currently consistent?** — does today's de-facto state match the user-confirmed lock; surface drift.
3. **Design-invariant violations?** — against PART 5 layering lock + `feedback_single_source_of_truth.md` + `feedback_no_autonomous_decisions.md` (🔴/🟡/🟢).
4. **Open items** — link to `migration-status.md`, `porting-deferred.md`, `docs/optimizations.md`, surface new candidates.
5. **Right abstraction? More generic possible?** — is the rule at the right level; does it deserve narrowing/widening.
6. **Right long-term solution? Caveats / maintenance burden?** — what hurts 6 months from now under this rule.
7. **Simplify / composable + impact on parity-tests & cross-impl story + bundle/build cost.** — Concretely: which scenarios in `packages/parity-tests/` activate or become unnecessary; what build/CI cost (TSFN bridges, feature flags); what user-visible bundle deltas.
8. **Alternative implementations (A/B/C…)** — named alternatives with pros/cons.
9. **Recommendation** — which alternative, with a coverage table mapping it back to concerns in Q2/Q3/Q6.

**Locking a unit:** "Decisions locked (date)" block at the end captures user decisions + scope for the follow-on implementation slice.

---

## Unit ordering

| Unit | Subject | Why now |
|---|---|---|
| **Unit 1** | Operational layering predicate (substrate vs presentation) | Foundation — every later unit cites this rule |
| **Unit 2** | `patterns/messaging` substrate carve-out | User locked the *folder*; this unit picks the *symbols* |
| **Unit 3** | `patterns/orchestration` substrate carve-out | Same as Unit 2 for the other locked folder |
| **Unit 4** | napi widening policy (consumer pressure vs eager) | Directly answers the F18/FromCursor inconsistency |
| **Unit 5** | `extra/` ambiguous-row boundary slots | Closes 5 unspecified rows: io, composition, mutation, graph-sugar, sources/event |
| **Unit 6** | Package-content story for end users | Locks what's in `@graphrefly/native` vs `@graphrefly/pure-ts` at install time |
| **Unit 7** | Documentation surfaces + sequencing for the current implementation slice | Where the locks land in code/docs; what the in-flight slice actually ships |

---

## Unit 1 — Operational layering predicate

**Scope:** The rule that tells a future reader "given this new symbol, does it go in `graphrefly-rs` or stay binding-side?" Folder layering from PART 5 of `SESSION-rust-port-architecture.md` is locked. The predicate operates one layer down — at the symbol level.

#### Q1 — Semantics, purpose, scope

- PART 5 of `SESSION-rust-port-architecture.md` lists *folders* that move to Rust (core / graph / operators / storage / structures / "lower part of messaging+orchestration"). It does NOT give a symbol-level predicate.
- `feedback_single_source_of_truth.md` requires that the rule live in **one** canonical place — likely `~/src/graphrefly-rs/CLAUDE.md` cross-language invariants section, with backrefs from `migration-status.md` and graphrefly-ts `CLAUDE.md`.
- `feedback_no_autonomous_decisions.md` forces the question into the open: today, "is this symbol substrate or presentation?" is silently decided per slice.

#### Q2 — Currently consistent?

- 🟡 Drift between `extra/operators/` (fully Rust-ported) and `extra/composition/`, `extra/io/`, `extra/mutation/` (pure-ts only) is correct under PART 5's intent but never written down as a predicate. New contributors can't tell whether `extra/composition/stratify` is "substrate or presentation."
- 🟡 `extra/data-structures/` is split mid-feature: `ReactiveLog::view`/`scan`/`attach` are in Rust core but **only consumed by pure-ts patterns**. Without a predicate, the napi-widening question (Unit 4) has no principled answer.
- 🟢 Rust-side crate boundaries (`graphrefly-core`, `graphrefly-graph`, `graphrefly-operators`, `graphrefly-storage`, `graphrefly-structures`) are clean.

#### Q3 — Design-invariant violations?

- 🟢 PART 5 lock — not violated, just under-specified.
- 🔴 `feedback_no_autonomous_decisions.md` — every napi slice silently picks a side. F18 deferral rationale "no consumer pressure" is itself an unstated predicate.
- 🟡 `feedback_single_source_of_truth.md` — PART 5 lives in an archive session, not the active CLAUDE.md / migration-status.md surfaces. Drift risk.

#### Q4 — Open items

- `porting-deferred.md` § F18 — "consumer pressure" mentioned as deferral rationale; no link to a written predicate.
- `migration-status.md` § "Next batch candidates" — describes F18/F20/F24 in terms of "napi widening" with no predicate-driven scoping.
- New candidates for this session: a single predicate statement that subsequent slices cite.

#### Q5 — Right abstraction? More generic possible?

Three candidate predicates:

- **(a) Hot-path predicate.** "If the symbol executes on every emission / per-wave, port it. If startup-only / wiring-only / audit-only, stay binding-side."
- **(b) Substrate-vs-presentation predicate.** "If the symbol manages state, dispatch, mutation, or persistence, port it. If it composes substrate into domain shapes (graph-level sugar, observability surfaces, user-facing factories), stay binding-side."
- **(c) Cross-language sharability predicate.** "If JS and PY both need the same shape with the same semantics, port it. If the shape is language-idiomatic (Promise, async iter, NestJS, Pythonic context manager), stay binding-side."

These overlap on most symbols but disagree on:
- `extra/mutation/` (lightMutation, auditLog) — (a) marginal (executes per audited write), (b) substrate (state mutation infrastructure), (c) shared (PY uses the same pattern via wrap_mutation).
- `extra/composition/{verifiable,distill}` — (a) one-shot wiring, (b) presentation, (c) shared in shape.
- `patterns/messaging/topic` substrate (topic node + hub multicast) — (a) hot-path, (b) substrate, (c) shared.

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- **(b) plus (a) as tie-breaker** is the most discriminating combination: substrate-vs-presentation cleanly handles 90% of cases; hot-path resolves the marginal cases like `mutation/` (port — substrate + hot-path).
- **(c) is implied** by the user lock (port "lower part of orchestration + messaging") — both PY and JS host these patterns. Shouldn't be the primary predicate but it's a useful cross-check.
- Caveat: any predicate creates a "what about X?" backlog. Every new `extra/` subfolder or `patterns/<domain>` subdir needs to be classified once and recorded.

#### Q7 — Simplify + parity-tests impact + build cost

**Cross-impl story under (b)+(a):**
- All symbols ported to Rust must have `packages/parity-tests/scenarios/<layer>/<feature>.test.ts` parameterized via `describe.each(impls)`.
- Symbols staying binding-side never enter the `Impl` interface (`packages/parity-tests/impls/types.ts`).
- F18-style ambiguity disappears: a Rust-core surface either has a napi binding + parity scenario (because it's substrate), or it doesn't (because no JS consumer reaches it).

**Build/CI cost:**
- Each new substrate symbol = +1 napi method + ~50 LOC TSFN bridging + 1 parity scenario.
- Each new presentation symbol = +0 Rust footprint.

**Bundle delta:**
- `@graphrefly/native` ships ONLY substrate. Smaller binary.
- `@graphrefly/pure-ts` always ships everything — backstop.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Status quo.** Decide per-slice. Pros: zero docs upfront; flexible. Cons: silently violates `feedback_no_autonomous_decisions.md`; predicate drift; F18 stays ambiguous indefinitely.
- **(B) Hot-path predicate only.** Pros: simplest rule. Cons: misclassifies `mutation/` (one-write-per-fire is "hot path" but the surface is configuration-shaped); misclassifies `composition/verifiable` (registration-time + per-fire mix).
- **(C) Substrate-vs-presentation predicate, hot-path tie-breaker.** Pros: discriminates the cases (B) gets wrong; aligns with PART 5 spirit. Cons: requires writing it down + maintaining a classification table.
- **(D) Cross-language sharability predicate.** Pros: directly captures "PY + JS both need this." Cons: too coarse on its own (every pattern is "shared" in spirit until proven otherwise).

**Recommendation: (C)** — substrate-vs-presentation with hot-path tie-breaker; (D) as a cross-check.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3) | Covered by |
|---|---|
| Q2: `extra/composition/io/mutation/` drift (silent) | (C) — each symbol gets a substrate/presentation classification, recorded in `CLAUDE.md` table |
| Q2: F18/FromCursor ambiguity | (C) — `view` is substrate (state-management mechanism), porting it to napi is on-rule; FromCursor's *consumer* `patterns/messaging` is itself substrate (Unit 2), so consumer eventually arrives |
| Q3: `feedback_no_autonomous_decisions.md` | (C) — predicate makes the call explicit; per-slice "I picked (a) because…" disappears |
| Q3: `feedback_single_source_of_truth.md` | (C) + Q8 doc surface — predicate lives in graphrefly-rs `CLAUDE.md` cross-language invariants |

**Open question — requires user call:**
1. Lock predicate as **(C) substrate-vs-presentation w/ hot-path tie-breaker**, or pick (A)/(B)/(D)?
2. Predicate written down in `~/src/graphrefly-rs/CLAUDE.md` cross-language section, cross-linked from graphrefly-ts `CLAUDE.md` + `migration-status.md`?

#### Decisions locked (pending)

> Awaiting user lock on Q9.

---

## Unit 2 — `patterns/messaging` substrate carve-out (REVISED 2026-05-14 — honest review)

**Scope:** User confirmed `patterns/messaging` lower-part goes Rust. Honest symbol-level review reveals: **the "lower part" is already in Rust** (reactiveLog + reactiveList + state + derived + mutate). The user-visible classes in patterns/messaging are thin composition wrappers.

Public surface inventory (`packages/pure-ts/src/patterns/messaging/`):

| Symbol | What it actually IS at the substrate level |
|---|---|
| `TopicGraph<T>` (754 LOC class) | Graph subclass: `reactiveLog` + `derived(latest)` + `mutate(publish)` |
| `SubscriptionGraph<T>` (170 LOC class) | Graph subclass: `state(cursor)` + `reactiveLog.view({fromCursor})` + `mutate(ack/pullAndAck)` |
| `TopicBridgeGraph<TIn,TOut>` (100 LOC class) | `subscription` + derived(output) + effect(ackPump) |
| `TopicRegistry` + `MessagingHubGraph` | `Map<string, TopicGraph>` + reactive version counter + factory methods |
| `Message<T>`, `JsonSchema`, `STANDARD_TOPICS` | Pure types + constants |

#### Q1 — Semantics, purpose, scope

Every messaging symbol decomposes into existing Rust substrate. Zero new substrate primitives. The only Rust-side gap exposed: **`ReactiveLog::view({fromCursor})` ships in Rust core but lacks napi binding (F18)** — and `SubscriptionGraph` is its only TS-side consumer today.

#### Q2 — Currently consistent?

- 🟢 The substrate IS already in Rust. Patterns just need to call into it.
- 🟡 `ReactiveLog::view({fromCursor})` lacks napi binding (F18). Until F18 lands, patterns/messaging in pure-ts works fine; a *Rust-via-napi* re-implementation of patterns/messaging would lack `fromCursor`.

#### Q3 — Design-invariant violations?

- 🟢 PART 5 spirit preserved: patterns stay binding-side; substrate is shared.
- 🟡 Earlier draft proposed opening a `graphrefly-messaging` crate — that would have duplicated infrastructure already in `graphrefly-structures` + `graphrefly-graph`.

#### Q4 — Open items

- `~/src/graphrefly-rs/docs/porting-deferred.md` § F18 — open; activates when first messaging parity test lands per Unit 4 (B).
- `packages/parity-tests/scenarios/messaging/` — no scenarios yet. Authoring even one (e.g. `topic.publish-events.test.ts`) materializes F18 demand.
- New candidate: NONE. No new Rust work for messaging.

#### Q5 — Right abstraction? More generic possible?

- The current TS topic/subscription/bridge classes ARE the right abstraction at the binding layer. Pure-ts is 802 LOC; a PY rewrite would be similar.
- "More generic" would mean a shared substrate primitive — but the substrate IS the existing reactiveLog + reactiveList + Graph. Adding a `topic`-shaped Rust primitive would just duplicate.

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- Keep messaging classes binding-language (TS + future PY independently implement the same composition over Rust substrate).
- The only cross-language consistency surface: `Message<T>` envelope shape + topic-name constants. Both are data — stay in spec.
- Caveat: when PY ports patterns/messaging, the implementer should consult `packages/parity-tests/scenarios/messaging/` to ensure semantic parity with TS. That's the load-bearing spec.

#### Q7 — Simplify + parity-tests + build cost

**Parity-tests surface delta:**
- `Impl` interface adds `messagingHub(name): ImplMessagingHub` + `ImplTopic` + `ImplSubscription` interfaces.
- 3–4 new scenario files under `packages/parity-tests/scenarios/messaging/`.
- Pure-ts `Impl` impls — wrap existing classes (~50 LOC).
- Rust `Impl` impls — wrap existing napi `BenchReactiveLog` etc. + thin TS classes that compose them (~80 LOC). **Activates F18 napi binding need.**

**Build cost:**
- ZERO new Rust crates.
- F18 napi binding for `ReactiveLog::view({fromCursor})` — ~80 LOC + TSFN bridge for the `read_cursor` callback.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Open a `graphrefly-messaging` crate, port topic/subscription/jobQueue.** Wasteful duplication of structures crate.
- **(B) Open `graphrefly-flow` crate combining messaging+orchestration.** Same waste; bigger waste.
- **(C) NO new crate. Patterns stay binding-side. Bind F18 napi to unlock fromCursor cross-impl.** Honest answer.
- **(D) Stay strict — defer F18 until first non-pattern consumer.** Under Unit 4 (B), F18 activates the moment a parity scenario authors against `subscription`. So (C) and (D) converge.

**Recommendation: (C)** — no new Rust crate; bind F18 when parity scenarios for messaging substrate land. The user's earlier "port lower part" lock is satisfied by what's already in Rust core.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3) | Covered by |
|---|---|
| Q2: substrate gap (F18 napi) | (C) — Unit 4 (B) triggers F18 napi binding when first messaging parity scenario lands |
| Q3: avoid duplicating structures | (C) — no new crate |
| User lock satisfaction | (C) — "lower part" is already in Rust; the wrapper classes are presentation |

#### Q10 — Cross-reference with planning sessions (added 2026-05-14)

Three planning docs explicitly call out messaging substrate. All three confirm "hub + envelope is the substrate, presets are sibling-pattern presentation":

- **`SESSION-human-llm-intervention-primitives.md`** Core Principle: *"all human/LLM intervention modes are users of one substrate — the messaging hub plus a standard message envelope. Specialized factories (humanInput, approvalGate, tracker) are siblings on this substrate, not parent/child."* True primitives: **only two — `hub`+envelope and `valve`** (both already substrate today). Real gaps it flags that touch messaging:
  - `Message<T>` envelope gains `schema?: JsonSchema` field — TS type addition, no Rust impact.
  - Standard topic naming constants (`PROMPTS_TOPIC`, `RESPONSES_TOPIC`, `INJECTIONS_TOPIC`, `DEFERRED_TOPIC`) — already shipped (see `messaging/message.ts`).
  - `bufferWhen(notifier)` operator — **already covered** by Rust `buffer(source, notifier, pack_fn_id)` shipped in Slice U.
  - **Adapter AbortController hookup** — binding-side adapter contract concern, not Rust substrate.
- **`SESSION-DS-14.6-A-multi-agent-context-architecture.md`** L7 `actorPool()` builds on messaging hub: actor cursor reads from `todoTopic: TopicGraph<Todo>`; context flows through `contextTopic: TopicGraph<ContextEntry<unknown>>`. Confirms `tracker()` style cursor reads. **No new messaging substrate primitive.**
- **`SESSION-DS-14.7-reactive-fact-store.md`** uses topics (`ingest`, `outcome`, `query`, `answer`, `cascade`, `cascadeOverflow`, `review`) — all stock messaging topics over hub. **No new messaging substrate primitive.**

**Unit 2 verdict (C) holds.** None of the three planning docs add Rust-side messaging substrate.

**Open question — requires user call:**
1. Lock (C) — no new crate; F18 napi binding is the only Rust-side work, gated on parity tests?
2. Or push to (A)/(B) — open a crate anyway for symmetry / future expansion?

#### Decisions locked (pending)

> Awaiting user lock on Q9.

---

## Unit 3 — `patterns/orchestration` substrate carve-out (REVISED 2026-05-14 — honest review)

**Scope:** User confirmed `patterns/orchestration` lower-part goes Rust. Honest symbol-level review reveals: **same pattern as messaging.** Every orchestration export decomposes into substrate that's already in Rust.

Public surface inventory (`packages/pure-ts/src/patterns/orchestration/`):

| Symbol | What it actually IS at the substrate level |
|---|---|
| `PipelineGraph.task()` | `node()` factory + `Graph.add()` |
| `PipelineGraph.classify()` | `node()` factory wrapping a tagger → it's literally `stratify` with an extra error-tag branch |
| `PipelineGraph.combine()` | Keyed fan-in over `combine` operator |
| `PipelineGraph.approvalGate()` | Internal Graph with `state(pending)` + `state(isOpen)` + `derived(count)` + `reactiveLog(decisions)` + `mutate(approve/reject/modify/open/close)` + closure-mirror + reactive approver Node |
| `PipelineGraph.approval()` | Thin alias over `approvalGate({approver, maxPending:1})` |
| `PipelineGraph.catch()` | `node()` factory with `completeWhenDepsComplete:false` + `errorWhenDepsError:false` (existing Core node options) |
| `humanInput<T>()` | switchMap-shaped node + hub topic publish + correlationId response watch |
| `tracker<T>()` | `subscription` + topic + derived(total) — wrapper bundle |

#### Q1 — Semantics, purpose, scope

Every orchestration symbol decomposes into existing Rust substrate. `approvalGate` is the meatiest one (~150 LOC of state-machine logic) but its substrate is `valve` (Slice U) + `ReactiveList` (M5) + `reactiveLog` (M5) + `mutate` (binding-side audit decorator over reactiveLog). NO new Rust substrate primitive required.

#### Q2 — Currently consistent?

- 🟢 All substrate exists in Rust.
- 🟢 No napi gap from orchestration (it doesn't reach for `ReactiveLog::view({fromCursor})`).

#### Q3 — Design-invariant violations?

- 🟢 PART 5 spirit preserved.
- 🟡 `feedback_no_imperative.md` — `approvalGate.approve(n)` is imperative. This is a presentation concern (the imperative API can be widened to accept `Node<ApprovalCommand>` in the binding-language refactor). Not a Rust-port question.

#### Q4 — Open items

- `~/src/graphrefly-rs/docs/porting-deferred.md` — no orchestration entries needed.
- `packages/parity-tests/scenarios/orchestration/` — no scenarios yet. Authoring `pipeline-approval-gate.test.ts` is the load-bearing parity surface.
- New candidate: NONE. No new Rust work for orchestration.

#### Q5 — Right abstraction? More generic possible?

- `PipelineGraph` chainable methods ARE presentation ergonomics. They belong in the binding language because chainability is language-idiomatic.
- `approvalGate` state machine is non-trivial (queue + open/closed + drop-oldest + decisions audit + approver mirror) BUT every piece is substrate already in Rust. Re-implementing the state machine in each binding language (TS class, PY context manager) is ~150 LOC; FFI-ing it through napi/pyo3 buys nothing.

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- Keep orchestration classes binding-language. Cross-language consistency lives in parity tests + the `Decision<T>` audit-record schema.
- The "approval semantics" (open/closed/drop-oldest/audit) IS a domain spec — write it down in `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` (binding-agnostic).
- Caveat: PY's eventual port of `approvalGate` must satisfy the same parity scenarios — that's the receipt.

#### Q7 — Simplify + parity-tests + build cost

**Parity-tests surface delta:**
- `Impl` interface adds `pipelineGraph(name): ImplPipelineGraph` + `humanInput` + `tracker` factory wrappers.
- 4–6 new scenario files under `packages/parity-tests/scenarios/orchestration/`.
- Pure-ts `Impl` impls — wrap existing classes (~80 LOC).
- Rust `Impl` impls — wrap existing napi primitives + thin TS implementations of `PipelineGraph` etc. (~150 LOC), because the patterns themselves stay in TS.

**Build cost:**
- ZERO new Rust crates.
- Zero new napi bindings (orchestration consumes already-bound primitives).

#### Q8 — Alternative implementations (A/B/C)

- **(A) Open `graphrefly-orchestration` or `graphrefly-flow` crate.** Wasteful duplication.
- **(B) Port just `approvalGate` state machine as a Rust primitive.** Buys nothing; the state machine isn't shared between TS and PY at the implementation level (each language implements its own audit-decorator idiom).
- **(C) No new crate. Patterns stay binding-side. Parity scenarios are the cross-language spec.** Honest answer.

**Recommendation: (C)** — symmetric with Unit 2 (C).

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3) | Covered by |
|---|---|
| Q2: substrate gap | None — substrate is complete |
| Q3: avoid duplicating substrate | (C) — no new crate |
| User lock satisfaction | (C) — "lower part" is already in Rust |
| `feedback_no_imperative.md` (approve/reject imperative) | Separate concern — addressed in patterns/orchestration redesign, not Rust port |

#### Q10 — Cross-reference with planning sessions (added 2026-05-14)

- **`SESSION-human-llm-intervention-primitives.md`** explicitly catalogs orchestration substrate:
  - `humanInput<T>` — sibling preset on hub. Composition over `switchMap` + `fromAny` + topic publish + correlation-id watch. **No new substrate.**
  - `approvalGate` — sibling preset; "different role from humanInput but share substrate." Composition over `valve` + `ReactiveList` + `reactiveLog` + `mutate`. **No new substrate.**
  - `tracker` — cursor-based consumer of `deferred` topic. **No new substrate.**
  - Open gap: **adapter AbortController hookup** — closing a `valve` propagates to in-flight LLM HTTP call. Binding-side adapter contract concern (Phase 14.5 §6 in human-llm-intervention session). NOT a Rust substrate concern.
- **`SESSION-DS-14.6-A-multi-agent-context-architecture.md`** delta #3 ships `actorPool()` as patterns preset (Phase 14.5). Composition over context-pool + todo-list + hub + spawnable. Lives in `patterns/harness/presets.ts`. **No new substrate primitive** (L8 explicit).
- **`SESSION-DS-14.7-reactive-fact-store.md`** is a `patterns/ai/memory/fact-store.ts` factory (Phase 14.5). Static topology of ~12 nodes; "zero spec change, zero envelope shape change." All substrate already in Rust. **No new substrate primitive** (Q5 explicit: "premature to extract generic primitive").

**Unit 3 verdict (C) holds.** All three planning docs confirm orchestration-adjacent patterns compose over existing substrate.

**Open question — requires user call:**
1. Lock (C) — no new Rust crate; orchestration substrate is complete?
2. Confirm Units 2 + 3 collapse the "lower part of messaging+orchestration → Rust" promise to "substrate is already in Rust; binding-side wrappers stay TS/PY"?

#### Decisions locked (pending)

> Awaiting user lock on Q9.

---

## Unit 4 — napi widening policy (consumer pressure vs eager)

**Scope:** When does a Rust-core surface get a napi binding? The F18 / F20 questions in the current slice are instances of this. Today's de-facto policy is "defer napi work until consumer pressure surfaces"; never written down.

#### Q1 — Semantics, purpose, scope

- F18 (`ReactiveLog::view`/`scan`/`attach`/`attach_storage`), F20 (`ReactiveIndex::range_by_primary`), and similar future surfaces (every new Rust-core method) all hit this question: bind eagerly or wait for pressure?
- "Consumer pressure" today means: a TS-side test or pattern needs the surface. But pure-ts patterns reach Rust core ONLY via the napi binding — so the test of pressure is itself gated by the binding's existence. Chicken-and-egg.

#### Q2 — Currently consistent?

- 🟡 Inconsistent: structures crate has full Rust impls (`view`, `scan`, `attach`, `attach_storage` — Slice M5.B 2026-05-11) but napi exposes ONLY append/clear/at/trim_head. The Rust-side test surface exercises everything; the napi-side surface does not.
- 🟡 No written rule. Slice scopes pick eagerly or defer ad-hoc.

#### Q3 — Design-invariant violations?

- 🟡 `feedback_single_source_of_truth.md` — Rust core and napi binding diverge; "what does Rust ship" depends on which API surface you check.
- 🟡 `feedback_no_autonomous_decisions.md` — each slice silently picks.

#### Q4 — Open items

- `porting-deferred.md` § F18, F20, F24 — all gated on this policy.
- `migration-status.md` § "Next batch candidates" — premise of the candidate list rests on a policy not yet locked.

#### Q5 — Right abstraction? More generic possible?

Three candidate policies:

- **(a) Eager.** Every Rust-core surface gets a napi binding in the slice that ships it. Cons: doubles slice scope; some surfaces never get a JS consumer (waste).
- **(b) Consumer-pressure-driven, parity-test gated.** A Rust-core surface gets a napi binding when (i) a non-pattern consumer materializes, OR (ii) a parity scenario in `packages/parity-tests/scenarios/<layer>/` exercises it cross-impl. Default for substrate symbols.
- **(c) Per-milestone snapshot.** At each milestone close (M3, M4, M5), audit Rust-core public surface and bind the new symbols. Predictable cadence.

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- (b) is the only one that scales: the parity-test gate ensures bindings exist for everything users actually rely on, without forcing speculative TSFN-bridging for surfaces nobody calls.
- Caveat: someone has to author the parity scenarios. The "scenario IS the consumer" rule shifts the work from binding authors to scenario authors — which is fine because scenarios serve double duty (they're the test surface AND the pressure signal).

#### Q7 — Simplify + parity-tests + build cost

**Under (b):**
- Each slice that ships a new Rust-core surface ALSO ships a parity scenario IF the surface is in the substrate cohort (Unit 1 + Units 2/3).
- Surfaces in the presentation cohort never get napi (don't waste TSFN bridges).
- F18/F20 questions answer themselves: view/scan/attach/attach_storage and range_by_primary stay deferred until a parity scenario exists.
- F24 (structures rebuild) stays in scope: existing parity scenarios for log/list/map/index already exist — they just don't activate until `--features structures` rebuild lands.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Eager.** Every M5.B surface binds in M5.C. Linear scope inflation.
- **(B) Consumer-pressure-driven + parity-test gate.** Recommended.
- **(C) Per-milestone audit.** Predictable but creates "deferred snapshot" backlogs at milestone close.
- **(D) Hybrid: substrate ports eagerly bind; presentation ports never bind.** Same as (B) under Unit 1's predicate — substrate symbols by definition have parity-test demand.

**Recommendation: (B)** = (D) — substrate auto-binds per parity-test pressure; presentation never binds.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3) | Covered by |
|---|---|
| Q2: Rust-core ↔ napi binding divergence | (B) — gated on parity-test demand; scenarios are the receipts |
| Q3: silent autonomous slice decisions | (B) — explicit rule lives in `migration-status.md` |
| F18 / F20 deferral rationale | (B) — "no parity scenario yet" is the documented reason, not "no consumer pressure" |

**Open question — requires user call:**
1. Lock (B), or accept (A)/(C)/(D)?
2. Parity-scenario authoring requirement: does the slice that lands a new substrate Rust surface ALSO author the parity scenario (forcing the binding)? Or do scenarios accumulate separately?

#### Decisions locked (pending)

> Awaiting user lock on Q9.

---

## Unit 5 — `extra/` ambiguous-row boundary slots

**Scope:** PART 5 + user lock cover core/graph/extras/structures + patterns substrate. Inside `extra/` there are still 5 unspecified rows: sources/event, io, composition, mutation, data-structures graph sugar.

#### Q1 — Semantics, purpose, scope

| extra/ sub-folder | What it contains | Today |
|---|---|---|
| sources/event | `fromEvent`, `fromTimer`, `fromCron`, `fromRaf` | pure-ts only |
| io | `fromHTTP`, `toHTTP`, ws, sse, webhook, reactiveSink | pure-ts only |
| composition | `verifiable`, `distill`, `stratify`, `pubsub`, `backpressure`, `externalProducer` | pure-ts only |
| mutation | `lightMutation`, `wrapMutation`, `auditLog`, `tryIncrementBounded` | pure-ts only |
| data-structures graph sugar | `graph.log()`, `graph.list()`, `graph.map()`, `graph.index()` | pure-ts only (Slice U-napi S3 2026-05-12) |

Per Unit 1 predicate (C): classify each as substrate or presentation.

#### Q2 — Currently consistent?

- 🟡 None of these are in Rust. Consistent with PART 5's "stay-in-binding-language for extra/io etc."
- 🟡 `extra/sources/sync` (of, empty, fromIter) IS in Rust (Slice 3e/3f 2026-05-12) but `extra/sources/event` is not. Asymmetric within `sources/`.

#### Q3 — Design-invariant violations?

- 🟢 None — these rows are pure-ts by default. The question is whether to LOCK them as pure-ts vs reserve the right to port.

#### Q4 — Open items

- `~/src/graphrefly-rs/docs/porting-deferred.md` — no entries.
- `docs/optimizations.md` — no entries.
- New candidate: lock table in `CLAUDE.md` listing each row's classification.

#### Q5 — Right abstraction? More generic possible? (REVISED 2026-05-14 — honest review)

Honest symbol-level walk:

| Sub-folder symbol | Substrate? | Honest verdict |
|---|---|---|
| `sources/event/fromTimer` | substrate; **already in Rust** (`interval` shipped Slice T) | Done — surface the Rust `interval` as `fromTimer` binding-side |
| `sources/event/fromCron` | parser is data; substrate is `interval` | Cron parser stays binding-side; uses Rust `interval` for the timer |
| `sources/event/fromEvent`, `fromRaf` | runtime/DOM presentation | Stay binding-side |
| `io/{http,ws,sse,webhook,reactiveSink}` | network presentation; idiomatic libs per language | Stay binding-side |
| `composition/stratify` | substrate (classifier-routing operator) | **Port** — modest ~50 LOC into `graphrefly-operators`. Consumed by orchestration `classify` |
| `composition/{verifiable, distill, pubsub, backpressure, externalProducer}` | composable from `derived` + `filter` + `state` | Stay binding-side (composable) |
| `mutation/{lightMutation, wrapMutation, createAuditLog, tryIncrementBounded}` | decorator pattern over `reactiveLog` (already substrate); HOF in TS, context-manager in PY | Stay binding-side — language-idiomatic decorators |
| `data-structures/graph sugar` (`graph.log/list/map/index`) | ergonomic facade over substrate | Stay binding-side (Slice U-napi S3 confirmed) |

**Honest substrate adds for Unit 5: just `composition/stratify`.** Earlier draft proposed porting mutation/ — that was wrong on review. Mutation wrappers ARE the audit-log decorator, and the audit log itself is `reactiveLog` which is already substrate. The decorator is presentation.

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- Lock the table above. Single entry per symbol; never silently reclassified.
- The "decorator pattern around `reactiveLog`" lesson — when a TS surface looks like substrate, check if it's actually a decorator over already-existing substrate. If yes, presentation.

#### Q7 — Simplify + parity-tests + build cost

**Substrate-side ports (this slice or next):**
- `composition/stratify` → ~50 LOC into `graphrefly-operators/src/stratify.rs`. New napi binding `register_stratify`. 1 new parity scenario.

**Presentation-side stays binding-side:**
- All `io/*`, `composition/{verifiable,distill,pubsub,backpressure,externalProducer}`, `mutation/*`, graph sugar, `sources/event/{fromEvent,fromRaf}`.

**Already-in-Rust (no port needed):**
- `sources/event/fromTimer` (use `interval`).
- All of `core/`, `graph/`, `operators/`, `storage/`, `structures/`.

**Parity tests:**
- `stratify` scenario: classifier routes by tag, downstream branches activate per tag.
- That's the only new substrate scenario from Unit 5.

#### Q8 — Alternative implementations (A/B/C)

- **(A) Lock the table above (substrate = `stratify` only; rest stay binding-side).** Honest.
- **(B) Also port mutation/ as substrate.** Earlier rec; wrong on review (mutation wrappers are decorators over existing reactiveLog).
- **(C) Port nothing extra (skip stratify too).** stratify is genuinely substrate; skipping means classifier routing duplicates between TS + PY.

**Recommendation: (A)**.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3) | Covered by |
|---|---|
| Q2: `sources/{sync,event}` asymmetry | (A) — split documented (`fromTimer` already done, `fromEvent`/`fromRaf` permanent presentation) |
| Q3: drift risk | (A) — canonical table in `CLAUDE.md` |
| `mutation/*` misclassification | (A) — corrected to presentation |
| Total Rust scope from Unit 5 | (A) — ~50 LOC `stratify` only |

#### Q10 — Cross-reference with planning sessions (added 2026-05-14)

The three planning docs surface several new pattern factories. Classify each against Unit 1 (C):

- **`SESSION-DS-14.6-A` delta #2: `taggedContextPool` + `renderContextView` + `tierCompress` operator family** (Phase 14.5):
  - `taggedContextPool` — wraps a hub topic + retention + reactiveMap. **Presentation** — composes over existing substrate (topic + reactiveMap + retention).
  - `renderContextView` — per-view reactive rendering returning `Node<readonly RenderedEntry<T>[]>`. **Presentation** — composes over `derived` + `filter` + a tokenizer fn.
  - `tierCompress` operator family — applies CompressionRules (`evict` / `truncate` / `reference` / `llm-summary`). Rules ARE data (matches "Policy-as-data" lock from §10.17 + DS-14.6.A L10). The evaluator is a derived node; the `llm-summary` action fires an adapter call. **Presentation** — per-rule actions are either pure data manipulation (evict/truncate/reference) or adapter integration (llm-summary).
  - DS-14.6.A L10 explicit: *"patterns/extras layer, not core."*
- **`SESSION-human-llm-intervention-primitives.md`** flags `bufferWhen(notifier)` as a possible new operator. **Already covered** by Rust `buffer(source, notifier, pack_fn_id)` shipped in Slice U — `bufferWhen` is the same shape with notifier-triggered flush. Confirm at consolidation-plan §2 naming when patterns/extras consolidates.
- **`SESSION-DS-14.7-reactive-fact-store.md`** Q5: *"generalizes to a `reactiveIndexedTable<TRow, TKey>(config)` primitive ... but premature. Park as post-v1 extraction candidate."* If a second use case emerges, this becomes a candidate to port to `graphrefly-structures`. For now: presentation.

**Net new substrate candidates from planning docs: ZERO.** Everything proposed in DS-14.6.A / human-llm-intervention / DS-14.7 lives at `patterns/` or `extra/data-structures/` layer (already locked). The `tierCompress` operator family is the closest call, but DS-14.6.A L10 explicitly places it at patterns/extras, not core.

**Unit 5 verdict (A) holds.** Only Rust-side substrate add from this design session remains `composition/stratify` (~50 LOC).

**Open question — requires user call:**
1. Lock the corrected table verbatim?
2. `composition/stratify` port — bundle into the next napi-widening slice, or defer until orchestration parity tests author classifier scenarios?
3. `reactiveIndexedTable<TRow, TKey>` extraction candidate from DS-14.7 — confirm "park" status (revisit when a second consumer surfaces)?

#### Decisions locked (pending)

> Awaiting user lock on Q9.

---

## Unit 6 — Package-content story (REVISED 2026-05-14 — user-locked three-package model)

**Scope:** Lock the three-package shape and what each contains. User-directed model 2026-05-14: three explicit packages, with `@graphrefly/graphrefly` containing "only the parts that are outside of Rust" and depending on EITHER `@graphrefly/pure-ts` OR `@graphrefly/native`.

#### Q1 — Semantics, purpose, scope

| Package | Contains | Build artifact |
|---|---|---|
| `@graphrefly/pure-ts` | Full TS implementation of the Rust-portable substrate: `core/`, `graph/`, `extra/operators/`, `extra/sources/sync` + `fromTimer`, `extra/data-structures/`, `extra/storage/` (Node tiers), `extra/composition/stratify`. Self-contained. | TS only |
| `@graphrefly/native` | Rust impl of the same substrate via napi: core, graph, operators, structures, storage, stratify, fromTimer. Thin TS wrapper exposes the napi surface. | `.node` binary + TS wrapper |
| `@graphrefly/graphrefly` | The parts that **never go to Rust** — binding-side only. Contains: `patterns/messaging`, `patterns/orchestration`, `patterns/ai`, `patterns/harness`, `patterns/cqrs`, `patterns/reduction`, `patterns/inspect`, `extra/io/*`, `extra/composition/*` (except stratify), `extra/mutation/*`, `extra/sources/event` (`fromEvent`, `fromRaf`), browser sources, graph-sugar (`graph.log/list/map/index`), `compat/*`. | TS only |

Dependency arrow:

```
@graphrefly/graphrefly
       │
       │  peerDependencies: { @graphrefly/pure-ts | @graphrefly/native }
       │   (user picks which one to install alongside)
       ▼
┌──────────────────┐   ┌──────────────────┐
│ @graphrefly/     │   │ @graphrefly/     │
│ pure-ts          │   │ native           │
│ (TS substrate)   │   │ (Rust substrate) │
└──────────────────┘   └──────────────────┘
```

User installs one of two combinations:
- **All TS:** `npm i @graphrefly/graphrefly @graphrefly/pure-ts`
- **Hybrid (Node-only):** `npm i @graphrefly/graphrefly @graphrefly/native`

Both `@graphrefly/pure-ts` and `@graphrefly/native` expose the same public API surface (the substrate contract); `@graphrefly/graphrefly` imports from a `@graphrefly/substrate` indirection (via TS path mapping or peer resolution) and works with either.

#### Q2 — Currently consistent?

- 🔴 Today's reality: only `@graphrefly/graphrefly` and `@graphrefly/pure-ts` exist. The cleave landed Phase 13.9.A 2026-05-05 with root shim re-exporting `@graphrefly/pure-ts`.
- 🟡 `@graphrefly/graphrefly` today re-exports EVERYTHING from `@graphrefly/pure-ts` — not just the binding-only layer. Under the locked model, it must split.
- 🟡 `@graphrefly/native` not published yet.

#### Q3 — Design-invariant violations?

- 🟢 Unit 1 predicate (substrate vs presentation) maps cleanly to this three-package split: substrate → pure-ts/native; presentation → graphrefly.
- 🟡 `feedback_single_source_of_truth.md` — until the three packages exist with their content explicit, "where does feature X live?" remains ambiguous. The doc surfaces (Unit 7) close this gap.

#### Q4 — Open items

- `docs/implementation-plan.md` Phase 13 Deferred 1 — facade build is now CANCELED. The three-package model replaces it.
- `migration-status.md` § "Reference impl" — needs to reflect the three-package model.
- `~/src/graphrefly-ts/CLAUDE.md` § Layout — needs an "install-time model" subsection.
- New action: cleave `packages/graphrefly/` (the root shim) to ship the binding-only layer (patterns + io + composition non-stratify + mutation + browser sources + compat), not a blanket re-export.

#### Q5 — Right abstraction? More generic possible?

Three-package model maps 1:1 to the layering:

| Layer | Package | Substrate or presentation? |
|---|---|---|
| `core/` + `graph/` + Rust-portable `extra/*` | `@graphrefly/pure-ts` OR `@graphrefly/native` | substrate |
| `patterns/*` + binding-only `extra/*` + `compat/*` | `@graphrefly/graphrefly` | presentation |

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- Caveat 1: The two substrate providers MUST expose an identical public API. Drift is the maintenance burden. Mitigated by `packages/parity-tests/` — every published symbol on `pure-ts` AND `native` runs the same scenarios.
- Caveat 2: `@graphrefly/graphrefly` peer-dependency resolution. If a user forgets to install one of `pure-ts`/`native`, the import resolves to nothing. npm/pnpm warns on missing peers but doesn't fail at install. Doc the install combinations prominently.
- Caveat 3: Bundle split — `@graphrefly/graphrefly` is browser-safe; `@graphrefly/native` is Node-only (`.node` binary); `@graphrefly/pure-ts` is browser+Node. Browser users pick `pure-ts`; Node users with the toolchain pick `native`.

#### Q7 — Simplify + parity-tests + build cost

**Build/CI cost:**
- Existing `packages/graphrefly/` shim becomes the `@graphrefly/graphrefly` content (presentation layer).
- `packages/pure-ts/` already exists as the substrate impl.
- `packages/native/` (or `crates/graphrefly-bindings-js/`) ships the Rust napi wrapper.
- One PR re-wires `@graphrefly/graphrefly` exports: drop the substrate re-exports; keep the binding-only re-exports.

**Parity-tests:**
- The `Impl` interface in `packages/parity-tests/impls/types.ts` IS the substrate contract — both `pure-ts` and `native` must satisfy it.
- Patterns (in `@graphrefly/graphrefly`) get their own parity scenarios per Unit 4 (B), parameterized via the two substrate impls.

#### Q8 — Alternative implementations (A/B/C/D)

- **(A) Three independent packages, user picks substrate at install time** (USER-LOCKED 2026-05-14). Clean separation; one PR to cleave content.
- **(B) Re-export model (transitional).** Not chosen.
- **(C) Facade-only.** Not chosen — adds runtime fallback complexity without user-visible benefit.
- **(D) Single package with feature flags.** Webpack-time conditional imports. Bundle bloat; rejected.

**Recommendation = user lock: (A).**

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3) | Covered by (A) |
|---|---|
| Q2: today's blanket re-export | Cleave `@graphrefly/graphrefly` to binding-only layer |
| Q3: where does feature X live? | Three explicit packages; Unit 7 doc surface table |
| User UX for "I want feature X" | Install both: `@graphrefly/graphrefly` + your choice of substrate |
| Bundle split (browser vs Node) | Browser → `pure-ts`; Node-with-native → `native` |
| Substrate drift between pure-ts/native | `packages/parity-tests/` scenarios are the receipt |

#### Decisions locked (2026-05-14)

- **(A) three explicit packages: `@graphrefly/pure-ts`, `@graphrefly/native`, `@graphrefly/graphrefly`.**
- **`@graphrefly/graphrefly` contains ONLY the binding-side layer** (patterns + binding-only extra + compat). Depends on EITHER substrate package as peer.
- **Both substrate packages expose the same public API** (the Rust-portable surface: core/graph/operators/structures/storage + stratify + fromTimer).
- **No facade**. User picks substrate at install time.
- Implementation work: cleave existing root shim's exports per the table in Q1. Deferred to a later slice (this session is doc-only per Unit 7 γ).

---

## Unit 7 — Documentation surfaces + current slice resequencing

**Scope:** Where Units 1–6 locks land in code/docs, AND what `/porting-to-rs next batch` slice actually ships now (no-regret subset vs full bundle).

#### Q1 — Semantics, purpose, scope

Documentation surfaces affected by Units 1–6:

| Surface | What lands |
|---|---|
| `~/src/graphrefly-rs/CLAUDE.md` | Unit 1 predicate; Unit 5 row table; Rust crate ↔ TS extra/folder mapping |
| `~/src/graphrefly-ts/CLAUDE.md` | Cross-link to graphrefly-rs CLAUDE.md predicate; install-time model from Unit 6 |
| `~/src/graphrefly-rs/docs/migration-status.md` | Unit 4 napi widening policy; new "Layering" section pinning predicate + table |
| `~/src/graphrefly-ts/packages/parity-tests/README.md` | Unit 4 — "parity scenarios are the consumer pressure signal" |
| `~/src/graphrefly-ts/docs/optimizations.md` | One-line provenance entry pointing to this session |
| `~/src/graphrefly-ts/docs/rust-port-decisions.md` | D193+ entries logging Q9 locks per unit |

Current slice resequencing (`/porting-to-rs next batch` invocation):

- Original bundle (pre-design-session): F18 partial + F20 + F24 + D171.
- Under Unit 4 (B), F18 + F20 defer indefinitely (no parity scenarios exercise them).
- Under Unit 4 (B), F24 + D171 are in-scope (existing parity scenarios + clear substrate need).

#### Q2 — Currently consistent?

- 🟡 No doc surfaces today reflect Units 1–6 decisions (because they're pending).

#### Q3 — Design-invariant violations?

- 🟢 None — this unit is the cleanup pass.

#### Q4 — Open items

- Add to `docs/optimizations.md`: "Rust port layering predicate locked 2026-05-14 — see SESSION-rust-port-layer-boundary.md."
- Add to `archive/docs/design-archive-index.jsonl`: entry for this session.

#### Q5 — Right abstraction? More generic possible?

- The doc-surface table is right-sized. Six surfaces, each with a defined responsibility.

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- Predicate + classification table need to be re-read at every Rust-port slice. Sticky place: `~/src/graphrefly-rs/CLAUDE.md` (always loaded by Rust-port sessions).

#### Q7 — Simplify + parity-tests + build cost

**Slice scoping options:**

- **(α) Implementation-only slice this turn.** Ship F24 rebuild + D171 wiring + existing-surface parity scenarios. Doc updates as a separate /qa pass. Total: ~300 LOC + scenarios.
- **(β) Implementation + doc-update slice this turn.** Same code + write Unit 1–6 locks into the 6 doc surfaces. ~500 LOC + ~5 doc files.
- **(γ) Doc-only this turn; implementation slice next turn.** Write all locks first; let implementation be independent. Cleanest separation; one extra round-trip.

#### Q8 — Alternative implementations (A/B/C)

- **(A) α — narrow implementation.**
- **(B) β — implementation + docs.**
- **(C) γ — doc-only then impl.**

**Recommendation: (C) γ** — locking Units 1–6 in writing FIRST means the implementation slice in the next turn knows exactly what to build. Pre-1.0 timing — adding the doc-pass step is cheap and protects against silent drift.

#### Q9 — Does the recommendation cover the concerns?

| Concern | Covered by |
|---|---|
| Locks must be written down to survive | (C) γ — docs land first |
| Implementation slice can't drift | (C) γ — docs become the brief |
| User can verify locks before code lands | (C) γ — doc pass is reviewable independently |

**Open question — requires user call:**
1. (α) / (β) / (γ)? My rec: (γ).
2. If (γ), the next-turn implementation slice is F24 + D171 + parity-scenario authoring for existing-substrate napi surface. Confirm scope?
3. If you want to keep all 6 units pending and just do F24 + D171 today (a minimum-viable Unit 4 (B) lock with full design session deferred), say so explicitly.

#### Decisions locked (pending)

> Awaiting user lock on Q9.

---

## Unit 8 — `@graphrefly/graphrefly` folder structure (REVISED 2026-05-14 — 4-layer model)

**Scope:** Folder structure INSIDE `@graphrefly/graphrefly` (the binding-only layer). User's clarified framing 2026-05-14: **preserve consolidation-plan's "presets" vocabulary** (presets = opinionated compositions of building blocks); split "below presets" into two layers `base` + `utils`; add `solutions` on top.

#### Q1 — Semantics, purpose, scope

**4 strict layers + framework integrations, top-down imports only:**

| Layer | Charter | Examples |
|---|---|---|
| `base/` | **Domain-agnostic infrastructure.** Helpers with NO domain semantics. Pure utilities. | io (http/ws/sse/webhook), composition helpers (verifiable, distill, pubsub, backpressure, externalProducer), mutation wrappers (lightMutation, auditLog), worker bridge, browser/runtime sources (fromEvent, fromRaf, fromGitHook, fromFSWatch), meta (domainMeta, keepalive) |
| `utils/` | **Domain building blocks — orthogonal primitives per domain.** Single-purpose factories returning a Node or Graph. Was consolidation-plan's "building blocks" (`patterns/<domain>/index.ts`). | messaging (topic, subscription, hub, topicBridge), orchestration (pipelineGraph, approvalGate, humanInput, tracker, classify, catch), cqrs (eventStore, projection, processManager), reduction (feedback, funnel, scorer), memory (collection, vectorIndex, knowledgeGraph), ai/{prompts, agents, safety, extractors, adapters}, inspect (explainPath, auditTrail, policyGate), harness (stage types, evalSource, beforeAfterCompare) |
| `presets/` | **Opinionated compositions of utils.** Single-factory products that compose 3–10 utils into one packaged factory. Was consolidation-plan's "presets" (`patterns/<domain>/presets.ts`). | agentLoop, agentMemory, resilientPipeline, harnessLoop, refineLoop, spawnable, inspect (composite), guardedExecution, reactiveFactStore (DS-14.7), taggedContextPool (DS-14.6.A), heterogeneousDebate (DS-14.6.A), actorPool (DS-14.6.A) |
| `solutions/` | **User-facing packaged products.** Headline-products entry point — either curated re-exports of presets OR multi-preset vertical bundles (e.g., `solutions/customer-support-bot/` wires agentLoop + agentMemory + adapters + storage for a specific use case). **Semantics pending user confirmation** (see Q5). | TBD pending lock on (a)/(b)/(c) below |
| `compat/` | External framework adapters: NestJS, React, Vue, Solid, Svelte, ag-ui translator, a2ui | language- and framework-specific glue |

**Dependency rules (CI-enforced via Biome custom rule):**

```
substrate (@graphrefly/pure-ts | @graphrefly/native)
   ▲
   │
base/         (no domain semantics)
   ▲
   │
utils/        (domain building blocks)
   ▲
   │
presets/      (opinionated compositions of utils)
   ▲
   │
solutions/    (user-facing packaged products)
   ▲
   │
compat/       (external framework adapters)
```

Within a layer: free composition (`utils/orchestration/human-input.ts` imports `utils/messaging/topic.ts` — both utils). Cross-layer: strictly top-down. CI lint enforces; circular within-layer also rejected.

#### Q2 — Semantically correct?

- ✅ Vocabulary preserved: consolidation-plan's "presets" = opinionated compositions semantics stays identical.
- ✅ Only one rename: consolidation-plan's "building blocks" → "utils".
- ✅ Layer charters are precise — base has NO domain, utils has domain, presets composes utils, solutions composes presets.
- 🟡 `solutions/` semantics still need user lock (see Q5 — three candidate interpretations).

#### Q3 — Design-invariant violations?

- 🟢 Unit 1 (C) substrate-vs-presentation predicate honored: everything in `@graphrefly/graphrefly` is presentation; the 4-layer split is sub-classification WITHIN presentation.
- 🟢 Unit 6 three-package model honored: `@graphrefly/graphrefly` contains ONLY the binding-only layer.
- 🟢 Vocabulary churn minimized — single rename ("building blocks" → "utils"), no other renames.

#### Q4 — Open items

- `SESSION-patterns-extras-consolidation-plan.md` — minor vocabulary note: "building blocks → utils"; add cross-reference to this session.
- `~/src/graphrefly-ts/CLAUDE.md` — document the 4-layer + compat layering.
- Existing `patterns/_internal/` directory — content gets redistributed across base/ and utils/ per consolidation plan §1.
- `extra/composition/stratify` → promote to `extra/operators/stratify` in pure-ts (sub-folder boundary cleanup).
- Biome custom rule for layer-boundary enforcement.

#### Q5 — Right abstraction? More generic possible?

**Three candidate interpretations of `solutions/` — pending user lock:**

- **(a) Curated re-export layer (thin).** `solutions/` is the headline-products entry point. Each file is mostly a re-export of a single preset, possibly with ergonomic-default wrappers. E.g., `solutions/ai/agent-loop.ts` re-exports `presets/ai/agent-loop.ts`. Defines what users see at the top-level barrel.
- **(b) Vertical bundles / starter kits (thick).** Each "solution" wires multiple presets + adapters + storage tiers + sensible defaults into a fully-configured product. E.g., `solutions/customer-support-bot/` combines `agentLoop + agentMemory + ag-ui translator + storage tier + tool registry presets`.
- **(c) Both.** Top-level barrel `solutions/index.ts` re-exports presets (curated front door); domain-specific `solutions/<vertical>/` folders hold the multi-preset assemblies.

#### Q6 — Right long-term solution? Caveats / maintenance burden?

- **Long-term benefit:** new factories (e.g., `actorPool`, `heterogeneousDebate`, `reactiveFactStore`, `taggedContextPool`) get unambiguous homes per their composition complexity. base = no domain; utils = single-domain primitive; presets = multi-util composition; solutions = multi-preset vertical or curated re-export.
- **Caveat 1:** Layer placement decisions need a quick rubric. Proposed: "If it has zero domain — base. If it's a single-domain primitive returning Node/Graph — utils. If it composes ≥3 utils — preset. If it composes ≥2 presets or wires-in adapters/storage — solution."
- **Caveat 2:** strict layering CI lint needed. Biome custom rule (Q9 user-locked).
- **Caveat 3:** within-layer cross-domain coupling needs documented patterns ("utils/orchestration importing utils/messaging is fine; utils/inspect importing utils/orchestration is fine; circular within a layer is rejected").

#### Q7 — Simplify + parity-tests + build cost

**Migration cost (one-time, bundled into next-turn slice per Q9):**

- ~10 file moves (`patterns/_internal/imperative-audit.ts` → `base/mutation/`; `extra/adapters.ts` split → `base/io/`; `extra/composition/{verifiable,distill,pubsub,backpressure,externalProducer,observable}.ts` → `base/composition/`; etc.)
- ~20 file moves (`patterns/<domain>/index.ts` building blocks → `utils/<domain>/`)
- ~10 file moves (`patterns/<domain>/presets.ts` → `presets/<domain>/`)
- New top-level `solutions/` per Q5 lock.
- `compat/` stays as-is (already top-level).
- All import paths in pure-ts test suite update.
- Public API surface preserved via `index.ts` barrels at each layer.

**Parity-tests impact:** none. Parity-tests use `Impl` interface from `packages/parity-tests/impls/types.ts`; that contract is the substrate surface, independent of the `@graphrefly/graphrefly` layout.

**Build cost:** tsup `entry` config grows from ~10 entries to ~25 entries (one per layer/domain) for per-domain subpath imports. tree-shaking improves because cross-layer boundaries are explicit.

#### Q8 — Alternative implementations (A/B/C)

- **(A) 4-layer model: `base / utils / presets / solutions / compat`.** Recommended (user-aligned 2026-05-14).
- **(B) 3-layer model: `utils / presets / solutions / compat`.** Lumps base + utils into one fat utils folder; loses the no-domain-vs-domain distinction.
- **(C) Status quo (`extra/` + `patterns/_internal/` + `patterns/<domain>/{index,presets}.ts`).** No strict layering; loses dependency-direction discipline.

**Recommendation: (A)** — preserves consolidation-plan's "presets" vocabulary; adds precise charter to each layer.

#### Q9 — Does the recommendation cover the concerns?

| Concern (Q2/Q3) | Covered by (A) |
|---|---|
| Vocabulary preservation | (A) — consolidation-plan's "presets" semantics unchanged; single rename "building blocks → utils" |
| Dependency-direction drift | (A) + Biome custom rule (✅ Q9.2 locked) |
| Within-layer cross-domain coupling | (A) + documented patterns in CLAUDE.md |
| Layer placement rubric | (A) + Q6 4-criterion rubric ("zero domain → base; single-domain primitive → utils; ≥3 utils composition → preset; ≥2 presets or full vertical → solution") |
| New factory placement (actorPool, heterogeneousDebate, reactiveFactStore, taggedContextPool) | (A) — each goes in `presets/{harness,ai,memory,context}/` per its design doc (they're single-factory opinionated compositions per their respective Q5 specs) |
| Graph-sugar location (`graph.log/list/map/index`) | Stay as Graph class methods in pure-ts (zero migration cost) |
| `compat/` placement | Top-level alongside the 4 layers (external-framework dependencies distinguish it from solutions) |

**Decisions locked (2026-05-14):**

- **Q9.1:** **(A) 4-layer model `base / utils / presets / solutions / compat`.** Consolidation-plan's "presets" semantics preserved; "building blocks" renamed to "utils"; "solutions" is the new top layer.
- **Q9.2:** CI lint = **Biome custom rule** (no extra eslint dependency).
- **Q9.4:** Migration **bundled into the next-turn implementation slice** (Unit 7).

**Q9.5 locked 2026-05-14: (c) both.**

Concretely:
- `solutions/index.ts` (and `solutions/<domain>/index.ts` barrels) — curated headline-product re-exports of presets. This is what users see when they `import { agentLoop, harnessLoop, reactiveFactStore } from "@graphrefly/graphrefly"`.
- `solutions/<vertical>/` folders — multi-preset starter kits with adapters + storage tiers + sensible defaults wired in. E.g., `solutions/customer-support-bot/`, `solutions/code-review-agent/`, `solutions/research-assistant/`. Each vertical bundle is a runnable example or starter template.

Verticals beyond barrels add value when:
- The composition crosses ≥2 presets AND requires adapter wiring (LLM provider) AND requires storage configuration.
- The use case is concrete enough to ship sensible defaults that work out-of-the-box.

Verticals are deferred until specific use cases land (initial Phase 14.5 / Phase 15 scope = barrels only; verticals follow consumer pressure).

---

## Cross-session synthesis — three planning docs vs Unit 2/3/5 verdicts (added 2026-05-14)

User-flagged for explicit consideration: `SESSION-human-llm-intervention-primitives.md`, `SESSION-DS-14.6-A-multi-agent-context-architecture.md`, `SESSION-DS-14.7-reactive-fact-store.md`. Walking each session's substrate claims and mapping them onto Unit 2/3/5:

### `SESSION-human-llm-intervention-primitives.md` (2026-04-28) — the load-bearing receipt for Unit 2/3 (C)

**Core lock (§5):** *"True primitives (only two): `hub` + standardized `Message` envelope (with `schema`); `valve` (+ adapter abort hookup)."* Everything else — humanInput / approvalGate / tracker / boundaryDrain / steeringInjection — is **sibling presets on the substrate**.

| Item from this session | Substrate? | Where it lands | Status today |
|---|---|---|---|
| `hub` + `Message<T>` envelope | substrate | already in Rust (via `reactiveLog` + `Graph.state` + `mutate`) | shipped |
| `valve` (boolean gate) | substrate | already in Rust (Slice U) | shipped |
| `Message<T>.schema?: JsonSchema` field | data — TS type only | `patterns/messaging/message.ts:107` | **shipped** (verified 2026-05-14 — line 107 has `readonly schema?: JsonSchema`) |
| Standard topic constants (PROMPTS/RESPONSES/INJECTIONS/DEFERRED/SPAWNS) | data — constants | `patterns/messaging/message.ts:124–171` | shipped (5 constants in `STANDARD_TOPICS`) |
| `bufferWhen(notifier)` operator | substrate | already covered by Rust `buffer(source, notifier, pack_fn_id)` (Slice U) | shipped |
| `humanInput<T>(prompt, schema?)` | sibling preset | `patterns/orchestration/human-input.ts` | shipped pure-ts |
| `approvalGate` | sibling preset | `patterns/orchestration/pipeline-graph.ts:234` | shipped pure-ts |
| `tracker` | sibling preset | `patterns/orchestration/tracker.ts` | shipped pure-ts |
| `boundaryDrain` (recipe or factory) | usage pattern | open question #4 in session — lean recipe | OPEN, binding-side decision |
| **Adapter AbortController hookup (Phase 1)** | binding-side adapter contract | `patterns/ai/adapters/_internal` | **OPEN — highest-priority follow-up per the session** |
| AG-UI translator | integration | `compat/ag-ui/` or `patterns/integrations/ag-ui/` | OPEN, binding-side |

**Cross-check status of §6 "Real Gaps" against today's tree (verified 2026-05-14):**

| # | Gap | Today |
|---|---|---|
| 1 | Adapter AbortController hookup | **OPEN — binding-side adapter contract; highest-priority follow-up per the session.** Lives in `patterns/ai/adapters/_internal`; needs its own design pass. NOT in next-turn Unit 7 slice. |
| 2 | `Message<T>.schema?` field | **CLOSED** — `message.ts:107` has `readonly schema?: JsonSchema` |
| 3 | `bufferWhen(notifier)` operator | **CLOSED** — covered by Rust `buffer(source, notifier, pack_fn_id)` shipped in Slice U; equivalent shape under the new naming |
| 4 | Standard topic constants | **CLOSED** — `STANDARD_TOPICS` has PROMPTS/RESPONSES/INJECTIONS/DEFERRED/SPAWNS in `message.ts:124–171` |
| 5 | AG-UI translation adapter | OPEN — separate, `compat/ag-ui/` or `patterns/integrations/ag-ui/` |
| 6 | A2UI generative UI | OPEN — separate wave, lower priority |
| 7 | Harness closed-loop wiring | OPEN — separate concern (`project_harness_closed_loop_gap`) |

**Only one item from this session intersects our Rust-port boundary work:**

**Adapter abort path (§6 gap #1).** When a `valve` closes in Rust core, the binding-side LLM adapter must `abort()` the in-flight HTTP call so cost stops accruing. The valve-close signal is already substrate; the wire to adapter abort is **binding-side adapter contract** (per Unit 1 (C) — adapter is presentation). NOT a new Rust substrate primitive, but a real follow-on. Flag for a separate slice after the napi-widening one.

**Validation of Unit 2 (C) verdict:** This session is the explicit lock that "messaging is composition over substrate + Message envelope; everything else is sibling preset / usage pattern." Unit 2 (C) IS the substrate-vs-presentation predicate (Unit 1 (C)) applied to messaging — verbatim agreement.

**Validation of Unit 3 (C) verdict:** This session lists humanInput / approvalGate / tracker as sibling presets, NOT specializations. Each lives in patterns/orchestration as composition over substrate. Unit 3 (C) matches.

### `SESSION-DS-14.6-A-multi-agent-context-architecture.md` (2026-05-05)

**Core locks (L1–L10) relevant here:**
- **L2** subgraph-level write isolation — already enforced by per-subgraph `parking_lot::ReentrantMutex` in graphrefly-core (D108–D110 / Phase J bench).
- **L7** dual-track multi-agent topology — `spawnable()` (static, Phase 13 shipped) + `actorPool()` (dynamic, Phase 14.5 — new patterns preset). Both are patterns; neither adds new substrate.
- **L9** `heterogeneousDebate()` — patterns preset (`patterns/ai/debate/`). *"Pure composition over `agent()` + `topic` + `derived` — no new substrate primitive."*
- **L10** tagged context substrate at **patterns/extras layer, not core**. Schema (`ContextEntry`, `ContextView`, `CompressionRule`) is data, not closure (Rust port §10.17 Policy-as-data alignment).

| Delta from this session | Substrate? | Where it lands |
|---|---|---|
| `taggedContextPool` (delta #2) | presentation | patterns/extras (per L10) |
| `renderContextView` (delta #2) | presentation | patterns/extras |
| `tierCompress` operator family (delta #2) | presentation (rules are data; actions are pure fn or adapter call) | patterns/extras |
| `actorPool()` preset (delta #3) | presentation | `patterns/harness/presets.ts` |
| Multi-writer worked example (delta #4) | test | `__tests__/` |
| `heterogeneousDebate()` preset (delta #5) | presentation | `patterns/ai/debate/` |
| Wave 2 launch copy (delta #6) | docs | README + harness positioning |

**No new Rust substrate. Unit 2/3/5 verdicts confirmed.**

### `SESSION-DS-14.7-reactive-fact-store.md` (2026-05-13)

**Architectural pivot (PART 2):** NOT every fact = a reactive node. FactStore is a single columnar `state<FactStore>` (or sharded N). ~12 fixed operator nodes form a static topology; cascade is `batch()` recursion on a cascade topic.

| Topology element | Substrate? | Status |
|---|---|---|
| `state<FactStore>` (sharded) | substrate | already in Rust |
| `state<Map<FactId, FactId[]>>` (dependentsIndex) | substrate | already in Rust |
| `topic` (ingest/outcome/query/cascade/cascadeOverflow/review) | substrate | already in Rust (via reactiveLog) |
| `derived` (extract / queryOp / invalidationDetector) | substrate | already in Rust |
| `batch()` (cascadeProcessor) | substrate | already in Rust |
| `fromCron(REM schedule)` | substrate timer is in Rust; cron parser is binding-side data | parser stays binding-side per Unit 5 |
| `MemoryFragment<T>` shape | data convention, not spec primitive | pattern-only |

**Q5 lock:** *"generalizes to a `reactiveIndexedTable<TRow, TKey>(config)` primitive ... but premature. Park as a post-v1 extraction candidate."* If a second consumer emerges, this becomes a candidate to port to `graphrefly-structures`.

**PART 5 lock:** *"Spec: zero change. DS-14 envelope: zero shape change. Phase 14.6 storage WAL: compatible."*

**No new Rust substrate. Unit 5 verdict confirmed.** `reactiveFactStore` lives at `patterns/ai/memory/fact-store.ts` (presentation, Phase 14.5).

### Synthesis impact on Unit 7 (next-turn implementation slice)

Reading all three sessions together adds **one follow-up track** to the existing Unit 7 slice scope, NOT new substrate work:

| Item | Source | Where it lands | Effort |
|---|---|---|---|
| Adapter AbortController hookup track (Phase 1) | human-llm-intervention §6 gap #1 | `packages/pure-ts/src/patterns/ai/adapters/` + adapter contract | NOT this slice — needs its own design pass; flag as follow-up after the napi-widening slice |
| Architectural sanity-check items (`actorPool`, `heterogeneousDebate`, `reactiveFactStore` substrate audits) | DS-14.6.A + DS-14.7 | already confirmed: zero new substrate; document the predicate-match in CLAUDE.md | nil — already addressed by Unit 1 (C) doc pass |

**Net result after factoring all three sessions:** **zero new Rust substrate.** Most of `SESSION-human-llm-intervention-primitives.md`'s Phase 0 substrate fixes are already shipped (envelope schema, topic constants, bufferWhen-equivalent). The remaining open item — adapter abort path — is binding-side adapter contract, not Rust substrate.

Confirms Unit 7 (γ) doc-only this turn → next-turn implementation slice stays at F24 + D171 + parity-scenarios + `stratify` port. Adapter-abort track is **flagged as a separate follow-up design+implementation slice**, not absorbed into next-turn.

---

## Recommended locks (one-page summary — REVISED 2026-05-14 after honest review)

User locks (2026-05-14):
- **Unit 1 Q9.1:** (C) substrate-vs-presentation predicate, hot-path tie-breaker. ✅ locked
- **Unit 1 Q9.2:** Document in `graphrefly-rs/CLAUDE.md`; cross-link. ✅ locked
- **Unit 4 Q9.1:** (B) consumer-pressure-driven + parity-test gate. ✅ locked
- **Unit 5 Q9.1:** Lock the corrected table (substrate = `stratify` + already-shipped Rust; rest binding-side). ✅ locked
- **Unit 6:** **Three explicit packages — `@graphrefly/pure-ts`, `@graphrefly/native`, `@graphrefly/graphrefly`.** `@graphrefly/graphrefly` contains only the non-Rust-portable layer (patterns + binding-only extra + compat); peer-depends on EITHER substrate package. ✅ locked
- **Unit 8 Q9.1:** **4-layer model `base / utils / presets / solutions / compat`** inside `@graphrefly/graphrefly`. Preserves consolidation-plan's "presets" vocabulary; renames "building blocks" → "utils"; adds "solutions" as new top layer. ✅ locked
- **Unit 8 Q9.2:** CI lint = Biome custom rule. ✅ locked
- **Unit 8 Q9.4:** Migration bundled into next-turn implementation slice. ✅ locked
- **Unit 8 Q9.5:** `solutions/` semantics — **(c) both** — top-level barrel `solutions/index.ts` for curated headline-product re-exports; domain-specific `solutions/<vertical>/` folders for multi-preset / adapter-wired starter kits. ✅ locked
- **Unit 7 Q9.1:** (γ) doc-only this turn; implementation slice next turn. ✅ locked
- **Unit 7 Q9.2:** Next-turn implementation slice = F24 native rebuild + D171 storage debounce wiring + parity-scenario authoring + `stratify` port. ✅ locked

Pending user lock after honest review + planning-session cross-check (Q10 added 2026-05-14):

- **Unit 2 Q9.1:** **(C) no new Rust crate.** Confirmed by all three planning docs (human-llm-intervention "only two primitives = hub+envelope and valve", DS-14.6.A "actorPool composes over existing", DS-14.7 "zero spec change"). F18 napi binding for `ReactiveLog::view({fromCursor})` is the only Rust-side action item, gated on Unit 4 (B).
- **Unit 3 Q9.1:** **(C) no new Rust crate.** Same finding; all three planning docs confirm orchestration-adjacent patterns compose over existing substrate.
- **Unit 5 Q9.2:** `composition/stratify` = substrate; modest ~50 LOC port. Earlier draft proposed porting `mutation/` — corrected to presentation. Planning-doc cross-check confirms no new substrate candidates (`tierCompress` is patterns/extras layer per DS-14.6.A L10; `reactiveIndexedTable` parked v1.x).

**The meta-finding from honest review + planning-doc cross-check:**

The user's earlier folder-level lock ("port lower part of orchestration/messaging into Rust") is **already satisfied by what shipped through Slice W.** All substrate that messaging/orchestration consume — reactiveLog, reactiveList, state, derived, valve, mutate-via-reactiveLog, buffer-with-notifier, batch() recursion — is in Rust. The three planning docs (human-llm-intervention, DS-14.6.A, DS-14.7) add zero new Rust substrate primitives; everything they propose composes over existing Rust core.

Total Rust-side adds from this design session: **`stratify` operator (~50 LOC) + F18 napi binding (~80 LOC + TSFN bridge) gated on parity-scenario authoring.** Zero new crates.

Cross-language consistency for the patterns layer (the eventual PY port of `patterns/{messaging, orchestration, ai, harness, ...}`) is enforced via `packages/parity-tests/scenarios/<layer>/` scenarios, NOT via Rust substrate duplication.

---

## Related files

- `archive/docs/SESSION-rust-port-architecture.md` — PART 5 layer recommendation (locked 2026-05-03; this session refines at the symbol level)
- `archive/docs/SESSION-ai-harness-module-review.md` — 9Q per-unit review format precedent
- `archive/docs/SESSION-patterns-extras-consolidation-plan.md` — extra/ folder split, naming conventions
- `archive/docs/SESSION-DS-14.6-A-multi-agent-context-architecture.md` — tagged context pool placement at patterns/extras layer
- `~/src/graphrefly-rs/docs/migration-status.md` — milestone tracker (M1–M6)
- `~/src/graphrefly-rs/docs/porting-deferred.md` — F18, F20, F24, D171 entries
- `~/src/graphrefly-rs/CLAUDE.md` — cross-language invariants (Unit 1 predicate lands here)
- `~/src/graphrefly-ts/packages/parity-tests/README.md` — parity scenario schedule
- `~/src/graphrefly-ts/packages/parity-tests/impls/types.ts` — canonical public-API contract
- `~/src/graphrefly-ts/docs/rust-port-decisions.md` — D193+ entries land here as units lock
