---
SESSION: DS-14.5-adapter-abort-hookup
DATE: 2026-05-15
TOPIC: 9Q implementation-walk for the "Adapter AbortController hookup" Phase 14.5 blocker. Reconciles the 2026-04-28 §9 Phase-1 sketch (LLMAdapter.call(spec) → {stream,abort}) against what B9 (Phase 13.6.B) + Phase 13.E actually shipped (opts.signal: AbortSignal + abortCapable flag + valve.abortInFlight). Locks the residual gaps: switchMap/*Map abort affordance, valve ergonomics, contract finalization, recipe surface, composition-level test.
REPO: graphrefly-ts (TS-primary, presentation layer; binding-side, NOT a Rust substrate slice)
SUPERSEDES: SESSION-human-llm-intervention-primitives.md §9 Phase-1 step 4 (the `call(spec) → {stream,abort}` contract sketch) — superseded by the opts.signal approach below.
---

## CONTEXT

`SESSION-human-llm-intervention-primitives.md` §6 gap #1 / §3a flagged the highest-priority follow-up: closing a `valve` or superseding a `switchMap` cuts *propagation* but the in-flight LLM HTTP call keeps generating tokens (cost continues). `SESSION-rust-port-layer-boundary.md` (lines 871/933) classified this as **binding-side / presentation, NOT Rust substrate** — "needs its own design pass." This is that pass.

**Key reframe vs. the 2026-04-28 source:** B9 (Phase 13.6.B) + Phase 13.E already shipped most of the abort substrate. The §9 Phase-1 sketch's contract change (`LLMAdapter.call(spec) → { stream, abort }`) was **not** implemented; a cleaner `opts.signal: AbortSignal` + `abortCapable` flag approach landed instead. So this session is reconciliation + residual-gap-close, not greenfield.

**Source material:**
- [SESSION-human-llm-intervention-primitives.md](SESSION-human-llm-intervention-primitives.md) §3a/§6/§9 + Open Question #5
- [SESSION-rust-port-layer-boundary.md](SESSION-rust-port-layer-boundary.md) lines 871/933 (binding-side classification)
- B9 lock record: [docs/implementation-plan.md:1234](../../docs/implementation-plan.md:1234) (Lock 3.C / D2 / D3 / R2.5a)
- 9Q per-unit format: [SESSION-ai-harness-module-review.md](SESSION-ai-harness-module-review.md) §"Per-unit review format"

---

## CURRENT STATE (already landed — do NOT re-design)

| Capability | Site | Status |
|---|---|---|
| `LLMInvokeOptions.signal?: AbortSignal`; every provider threads into `fetch({signal})`/SDK on invoke+stream | [types.ts:243](../../src/utils/ai/adapters/core/types.ts:243); locked by `abort-propagation.test.ts` (~40 tests) | ✅ B9 |
| `LLMAdapter.abortCapable?: boolean` capability flag; `adapterWrapper` propagates through middleware | [types.ts:296](../../src/utils/ai/adapters/core/types.ts:296), [wrappers.ts:78](../../src/utils/ai/adapters/_internal/wrappers.ts:78) | ✅ B9 D3 — **dropped by D-AB1 below** |
| `withBudgetGate` auto-mints `AbortController`/call, combines caller signal, aborts in-flight on budget open→closed, `dispose()` aborts in-flight | [budget-gate.ts:271-343](../../src/utils/ai/adapters/middleware/budget-gate.ts:271) | ✅ Lock 3.C / D2 |
| `valve(source, control, { abortInFlight })` — truthy→falsy edge fires `controller.abort()` | [control.ts:464-471](../../packages/pure-ts/src/extra/operators/control.ts:464) | ✅ Phase 13.E — **ergonomics revised by D-AB3** |
| `_oneShotLlmCall` producer: mints `ac`, threads into invoke+fromAny, aborts on deactivate + `parentSignal` cascade | [_internal.ts:188-271](../../src/utils/ai/_internal.ts:188) | ✅ Tier 6.5 |
| `promptNode`/`streamingPromptNode` per-wave producer abort via `nodeSignal(opts.abort)` + `AbortController` | impl-plan:89 | ✅ Phase A |
| Tool handlers receive `opts.signal` on switchMap-over-toolCalls supersede | [types.ts:160](../../src/utils/ai/adapters/core/types.ts:160) | ✅ |
| Job-queue per-claim AbortController set drained on parent Graph TEARDOWN | job-queue R2.5a | ✅ |

---

## 9Q WALK — Unit: Adapter AbortController Hookup

**Q1 — Semantics/purpose/impl.** See Current State table. The unifying abstraction across the three existing instantiations (valve.abortInFlight, _oneShotLlmCall deactivate, budgetGate dispose) is **"a teardown edge that carries an abort."** This session makes that pattern uniform.

**Q2 — Residual gaps (the subject):**
- **G1** — generic `switchMap`/`exhaustMap`/`concatMap`/`mergeMap` have **no `abortInFlight` affordance** (only `valve` got it). `switchMap(editableInputs, p => adapter.invoke(p))` — the canonical steering / inline-edit / param-change / model-swap pattern (§3b/e/f) — drops the inner subscription on supersede but does NOT abort the in-flight call unless the projected inner is itself an abort-on-teardown producer. **Core unmet gap.**
- **G2** — `valve.abortInFlight` is one-shot + manual: spent after one truthy→falsy edge; a panic toggle (open→closed→open→closed) forces the caller to re-mint + re-thread every cycle.
- **G3** — adapter-contract reconciliation unlocked (source Open Question #5: "pre-1.0, just change it").
- **G4** — no public reactive-native "LLM call that aborts on teardown"; `_oneShotLlmCall` is internal, `promptNode` is cross-wave-transform-shaped.
- **G5** — composition-level end-to-end test missing: `abort-propagation.test.ts` locks the *leaf* (provider threads signal), not the *composition* (valve-close / switchMap-supersede → provider fetch aborts). Phase-1 step 6 unverified.

**Q3 — Invariants.** 🟢 `opts.signal` is invariant-clean (data-threaded boundary concern, not an imperative trigger in the reactive layer; spec §5.10). 🟡 `*Map.abortInFlight` is an imperative-controller affordance — acceptable under COMPOSITION-GUIDE-PATTERNS §44 because the operator already owns a teardown edge and the abort rides it. 🔴 A G4 *primitive* wrapping `adapter.invoke` and re-exposing `.abort()` would hit the `feedback_no_imperative_wrap_as_primitive` (§44) anti-pattern → recipe chosen over primitive.

**Q4 — Open items.** No dedicated `docs/optimizations.md` entry pre-existed; this session adds one (see "FILES CHANGED").

**Q5 — Right abstraction.** Make the "teardown edge carries abort" pattern uniform across the operator family rather than special-casing each. G1's affordance mirrors `valve.abortInFlight` exactly (same opt name, same edge semantics) → one mental model.

**Q6 — Long-term caveats.** `abortCapable` as an optional flag is a permanent foot-gun (new adapter silently omits it → cost burn-through with only a runtime warn). Pre-1.0 drop removes it forever; the one-time provider sweep is already done (all 5 providers thread signal, locked by tests).

**Q7 — Simplify/topology/perf.** `switchMap(promptInput, p => llmProducer(adapter, p))`: `describe()` → `promptInput → switchMap::output` with per-wave inner `llmProducer` (producer kind); supersede tears down inner subscription → inner producer deactivate fires `ac.abort()`. Zero extra allocation beyond the one `AbortController`/wave `_oneShotLlmCall` already pays. G1 adds one controller ref per active inner — negligible; no buffering, no hot-path cost.

**Q8 — Alternatives.** G1: (A) per-op `abortInFlight` mirroring valve / (B) generic `withAbortOnTeardown` wrapper / (C) recipe-only. G2: (A) factory form / (B) valve owns controller, exposes `.signal` / (C) keep one-shot. G3: (A) drop flag / (B) keep / (C) keep + build-time lint. G4: (A) tiny public `llmCall` producer / (B) recipe-only.

**Q9 — Recommendation & coverage:** G1→A, G2→A (factory), G3→A (drop), G4→B (recipe), G5→add test. Covers Q2 G1–G5 + Q3/Q6 caveats. User-locked below.

---

## DECISIONS LOCKED (2026-05-15)

| ID | Decision | Rationale | Affects |
|---|---|---|---|
| **D-AB1** | **Drop `LLMAdapter.abortCapable`.** Honoring `opts.signal` end-to-end is a hard adapter contract. Remove the flag, `adapterWrapper`'s propagation of it, and the `withBudgetGate` dev-warning ([budget-gate.ts:284-293](../../src/utils/ai/adapters/middleware/budget-gate.ts:284)). | Pre-1.0; all 5 shipped providers already comply (`abort-propagation.test.ts`); kills the silent-burn-through foot-gun permanently. Matches source Open Question #5 "just change it" lean. | `utils/ai/adapters/core/types.ts`, `_internal/wrappers.ts`, `middleware/budget-gate.ts`; doc sweep for `abortCapable` |
| **D-AB2** | **Mirror `valve.abortInFlight` on the `*Map` family** (`switchMap`, `exhaustMap`, `concatMap`, `mergeMap`). Inner-teardown / supersede fires `controller.abort()`. Same opt name + same truthy-edge/supersede semantics as `valve` — one uniform mental model. | Closes the core G1 gap for steering / inline-edit / param-change / model-swap (§3b/e/f). Substrate operator change in `@graphrefly/pure-ts` `extra/operators`. | `packages/pure-ts/src/extra/operators/higher-order.ts`, `control.ts` |
| **D-AB3** | **`abortInFlight` accepts a factory form `() => AbortController`** (in addition to a bare `AbortController`), minting a fresh controller per truthy→falsy / supersede edge. Applies to both `valve` and the `*Map` family. | Fixes the one-shot/re-mint-every-cycle ergonomics for panic toggles. Bare-controller form retained (back-compat-free pre-1.0, but the simple case stays simple). | `control.ts` (valve), `higher-order.ts` |
| **D-AB4** | **G4 = recipe in COMPOSITION-GUIDE-PATTERNS, NOT a primitive.** Document the abort-on-deactivate producer pattern (the `_oneShotLlmCall` shape: producer mints `ac` → threads into `adapter.invoke({signal})` + `fromAny({signal})` → deactivate fires `ac.abort()`). | A primitive wrapping `adapter.invoke` + re-exposing `.abort()` hits the §44 `feedback_no_imperative_wrap_as_primitive` anti-pattern. Recipe composes; primitive couples. | `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` new section |
| **D-AB5** | **Add a composition-level end-to-end abort test** asserting "close valve / supersede switchMap → in-flight provider `fetch` actually aborts" (not just the leaf-level provider-threads-signal contract). Closes Phase-1 step 6. | `abort-propagation.test.ts` only locks the leaf; the wiring (operator teardown → signal) is unverified, leaving the §6 gap #1 claim aspirational end-to-end. | new `src/__tests__/utils/ai/adapters/abort-composition.test.ts` |

---

## IMPLEMENTATION PHASING (gated on explicit user "implement" — per `feedback_no_implement_without_approval`)

1. **AB-1 — drop `abortCapable` (~0.5 day).** Remove field from `LLMAdapter` ([types.ts:296](../../src/utils/ai/adapters/core/types.ts:296)), `adapterWrapper` override + propagation ([wrappers.ts:66,78](../../src/utils/ai/adapters/_internal/wrappers.ts:66)), `withBudgetGate` dev-warning block ([budget-gate.ts:284-293](../../src/utils/ai/adapters/middleware/budget-gate.ts:284)). Sweep providers (anthropic/openai-compat/google/chrome-nano/webllm) to delete their `abortCapable: true` declarations. Doc sweep (`docs/implementation-plan-13.6-locks-draft.md` reference in the warning string, JSDoc on `types.ts:280-296`).
2. **AB-2 — `*Map.abortInFlight` (~1 day).** Add `abortInFlight?: AbortController | (() => AbortController)` to the higher-order operator opts; fire on inner-teardown/supersede mirroring `valve`'s [control.ts:464-471](../../packages/pure-ts/src/extra/operators/control.ts:464) edge logic. Factory form (D-AB3) for both valve + *Map.
3. **AB-3 — composition test (~0.5 day).** `abort-composition.test.ts`: mock-fetch capturing adapter behind valve + switchMap; assert the captured `RequestInit.signal` enters `aborted` state on valve-close / supersede.
4. **AB-4 — COMPOSITION-GUIDE-PATTERNS recipe (~0.25 day).** Document the abort-on-deactivate producer pattern (D-AB4) with the steering / inline-edit / panic worked examples from §3.

Total ~2.25 days. Worker-bridge / harness-closed-loop are out of scope (separate concerns per source §9).

## RUST-PORT ALIGNMENT

Entirely binding-side (presentation layer per `SESSION-rust-port-layer-boundary.md`). The `*Map` operators are in `@graphrefly/pure-ts` substrate, but `AbortController`/`AbortSignal` is a JS-runtime boundary primitive — the Rust core never sees it (handle-protocol cleaving plane: abort is a binding-side teardown concern threaded through the source/producer boundary, not a Core message tier). No `graphrefly-rs` change. The "teardown edge carries abort" pattern maps to Rust `Drop` on the inner subscription in a future M-port, but that's not in scope and not gated on this.

## FILES CHANGED (this session — documentation only)

- **New:** `archive/docs/SESSION-DS-14.5-adapter-abort-hookup.md` (this file)
- **Edit:** `docs/optimizations.md` — add Active-work-items entry for AB-1..AB-4 (cross-language decision tracking per skill rule)
- **Edit:** `archive/docs/design-archive-index.jsonl` — append index entry
- **Deferred to implementation phases (AB-1..AB-4):** `src/utils/ai/adapters/core/types.ts`, `_internal/wrappers.ts`, `middleware/budget-gate.ts`, provider files; `packages/pure-ts/src/extra/operators/{higher-order,control}.ts`; new `abort-composition.test.ts`; `COMPOSITION-GUIDE-PATTERNS.md` recipe

### Verification snapshot
- **✅ IMPLEMENTED + QA-passed 2026-05-15.** AB-1..AB-4 landed; QA added a mergeMap+concurrent caveat to the `abortInFlight` JSDoc (P11). Gates: pure-ts 1172/1172, root adapter/operator consumers green, biome-clean.
