---
name: dev-dispatch
description: "Implement the requested feature or fix within project authority and verify affected behavior."
argument-hint: "[--light] [task description or context]"
---

You are executing the **dev-dispatch** workflow for the **clean-slate GraphReFly** redesign.

This repo is **`@graphrefly/ts`** — the self-contained TypeScript implementation (D32). Clean-slate code lands in **`packages/ts/src/`**. The language-neutral authority (spec / decisions / plan / conformance / formal) lives in **`~/src/graphrefly`** (branch `clean-slate`) as jsonl — when this skill and that repo disagree, **that repo wins** (CLAUDE.md). Sibling impls: `@graphrefly/rust` (`~/src/graphrefly-rs`), `@graphrefly/py` (`~/src/graphrefly-py`) — each self-contained; cross-language = wire bridge, never in-process (D32).

> **Stale-infra guard.** Do NOT reach for the retired port-model surfaces: `packages/pure-ts/**` (frozen read-only reference only, D41), `docs/implementation-plan.md`, `docs/optimizations.md`, `docs/roadmap.md`, `docs/test-guidance.md`, `docs/docs-guidance.md`, `GRAPHREFLY-SPEC.md`/`COMPOSITION-GUIDE.md` (migrated to `spec/rules.jsonl` + `guide/guide.jsonl`, B7), the `Impl`/facade/actor model / 3-digit D### port decisions. The clean-slate authority is the jsonl below.

The user's task/context is: $ARGUMENTS

### Mode detection
Use a focused workflow for routine fixes and a fuller plan for substantial changes. `--light` remains
supported. Neither mode requires another approval for work already authorized by the user; pause
for unresolved semantic/architectural decisions or an action outside the approved scope.

### Workflow floor (non-negotiable)
- **decision-first**: any architectural lock needs a `D#` in `~/src/graphrefly/decisions/decisions.jsonl` BEFORE code (`/design-review` → user approval → append). A design lock alone is not implementation approval; the current implementation request can supply that approval.
- **spec-first** (F-NO-IMPL-DEFINED): any wave-protocol behavior change amends `spec/rules.jsonl` + `formal/*.tla` + `spec/conformance.jsonl` FIRST (`/spec-amend`), THEN code. Operators/sugar/inspection are per-language (D6/D24) — NOT spec, skip spec-amend.
- **no autonomous decisions**: surface spec↔code conflicts; don't silently pick. Review affected boundaries for multi-file rewrites.
- **verify premise**: design tables lag code — grep the named symbols + check landed markers (`plan/phases.jsonl` status/notes) before designing new surface; correct stale premises from current evidence; ask only if the correction changes scope or a locked decision.
- **consistency gate**: after touching any `~/src/graphrefly` jsonl, run `node ~/src/graphrefly/dashboard/build.mjs --check` (non-zero on broken links / orphans).

---

## Phase 1: Context & Planning

Load context and plan in a single pass. **Parallelize all reads.**

Context index: read only the governing records and relevant implementation/tests below, reusing
material already loaded. Protocol/formal context is needed only when the changed behavior depends on it:
- `~/src/graphrefly/CLAUDE.md` — the single-source authority index (read FIRST).
- `~/src/graphrefly/spec/rules.jsonl` — the protocol 宪法 (R-* rules); deep-read the rules your change touches.
- `~/src/graphrefly/decisions/decisions.jsonl` — the unified D# log (or invoke `/decision-guard` to recall the governing D#/values/floor).
- `~/src/graphrefly/plan/phases.jsonl` — the CSP-* sequencer: find the phase this task belongs to, its `status` (done/impl/design), deps, and note. Read this FIRST among the plan files so you know whether you're on a ready phase or one still gated.
- `~/src/graphrefly/plan/backlog.jsonl` + `plan/antipatterns.jsonl` — deferred carries (B#) with triggers; anti-patterns to flag against.
- `~/src/graphrefly/spec/conformance.jsonl` — the behavioral scenarios (C-*) your change must keep green; check the `runtimes` status for the arm you target.
- `~/src/graphrefly/guide/guide.jsonl` — composition / test / docs / contribute guidance (G-composition / G-test / G-docs / G-contribute).
- `~/src/graphrefly/sessions/active/SESSION-clean-slate-redesign.md` (DS-1) — the L0–L6 design narrative + F-* constraints, when you need the why behind a lock.
- Any files the user referenced in $ARGUMENTS.
- The clean-slate source you'll modify: substrate = `packages/ts/src/{node,dispatcher,ctx,protocol,batch}/`; graph-layer = `packages/ts/src/graph/` (Graph + 8-verb sugar + operators + inspection describe/observe/profile).
- Existing tests: `packages/ts/src/__tests__/`.

**Frozen reference (D41):** `packages/pure-ts/**` and `~/src/callbag-recharge` are READ-ONLY prior art for analogous operator behavior / edge cases / test structure during a re-derive (D40 Catalog-first). Map concepts to the clean-slate substrate (`node`/`ctx.down`/`ctx.depRecords`/`Graph`, D39 `describe`/`observe`) — do NOT 1:1 port; the old substrate API and semantics differ. They are NOT the behavior authority — `spec/rules.jsonl` is.

While planning, validate proposed changes against the clean-slate floor (cite the rule/D#):
- **Sacred (L0.7):** topology declarative/serializable/inspectable · wave protocol is a public spec · wave protocol impl is **sync** · all fn go through the dispatcher.
- **8 verbs, closed (D4):** `node`/`graph`/`batch`/`state` + `producer`/`derived`/`effect`/`mount`. **Operators are `node` sugar (D6), not verbs** — per-language, never in parity (D24); real factory names show in `describe`. Adding a verb is a constitutional change.
- **Messages** `[[Type, Data?], ...]`; one array to `ctx.down`/`ctx.up` = one wave (R-msg-format). The closed message set is defined by R-msg-closed-set; do not duplicate its count here.
- **DIRTY before DATA/RESOLVED** in the same wave (R-dirty-before-data); two-phase glitch-free diamond (R-two-phase); a diamond/fan-in node recomputes exactly once after all changed deps settle (R-diamond). batch defers tier-≥3, not DIRTY.
- **`ctx.up`**: read the current control/demand boundary in R-ctx-up before changing its behavior. A handle is pure data, no methods (D7).
- **No polling** (R-no-polling); **no imperative triggers** (R-no-imperative — reactive `ctx.up`/signals, not emitters/callbacks/timers+set; remove imperative paths when no caller depends); **no raw async** in the sync core (R-no-raw-async / F-SYNC-CORE — async lives only in sources / the pool / the wire bridge).
- **All fn through the dispatcher** (R-dispatch-all / F-DISPATCH-ALL — no inline-fn bypass). `dispatcher.invoke` is sync void (R-sync-core).
- **Data moves via messages** (R-data-not-peek — never peek a dep's `.cache` to seed compute; `.cache` is a read-only accessor for external consumers). SENTINEL = absence-of-DATA (R-sentinel); the canonical never-emitted detector is `ctx.prevData[i] === undefined`.
- **messageTier is a compile-time const table** (D18/D34/R-tier); the clock is **graph-local** (no global singleton, D26/R-clock); `onMessage`/`onSubscribe` are substrate-fixed, not user-replaceable (D19).
- **Primary-API clean** (R-primary-api-clean): protocol internals (DIRTY/RESOLVED/bitmask) never surface in value-level sugar (derived/effect/operator); ctx-level (node/producer) intentionally exposes tier as a power surface (DR-1). Sugar value-fn → ctx-fn wrapping happens in the graph layer (D27); a value-level `throw` becomes `[[ERROR,e]]` down (D30).
- **graph = single-thread causal/concurrency domain (D22 / R-graph-domain):** parallelism via pool callback or multi-graph + wire bridge; rewire is intra-graph only.
- **`ctx.state`** = per-node private cross-wave state (R-ctx-state); shared/observable state must be an explicit node + dep, not `ctx.state` (D23). A synchronous feedback cycle (a fn re-driving its own dep mid-wave) is a wave-level ERROR (D37/R-reentrancy), not iteration.
- **F-NO-WEDGE-CUT:** every primitive serves ≥2 segments (no LLM-only or single-segment wedge; F-NO-LLM-ONLY). **F-PERF:** budget every abstraction (thin node, default-off inspection).

**Targeting a sibling (py/rust):** if the task targets `@graphrefly/py` (`~/src/graphrefly-py`) or `@graphrefly/rust` (`~/src/graphrefly-rs`), read that package's local layout + its conformance arm status in `spec/conformance.jsonl`. The cross-language contract is **behavioral conformance (D24)**, not symbol parity. PY public APIs are synchronous (return `Node[T]`/`Graph`/value, no `async def`); async lives at the source/pool boundary only (F-SYNC-CORE).


---

## Phase 2: Resolve material decisions

Proceed with authorized implementation when existing decisions govern the behavior. Explain material
assumptions and tradeoffs briefly. Ask only when an unresolved choice changes product semantics,
public contract, architecture, or authorization. Preserve spec-first amendments and owner-ledger
approval for new locks; a locked design alone does not authorize implementation when the user deferred it.

## Phase 3: Implementation & Self-Test

Once implementation is authorized and material decisions are resolved:

1. Implement the changes.
   - Treat `~/src/graphrefly/spec/rules.jsonl` as non-negotiable for behavior; if code drifts from a rule, align to the rule — or surface the conflict, don't silently pick.
   - Cite the governing R-id / D# in test expectations.
2. Add meaningful behavior tests where needed (per `guide/guide.jsonl` G-test — unit / property / conformance layering):
   - Put tests in the most specific existing file under `packages/ts/src/__tests__/`.
   - Use `graph.observe()` for live message assertions; assert at the node + message level otherwise. A behavioral-protocol change ALSO needs a `spec/conformance.jsonl` scenario (`/conformance`) before its rule flips `draft → active`.
3. Run checks:
   - **TS:** `pnpm --filter @graphrefly/ts test` (vitest) + `pnpm run lint` (biome + layer/typecheck gates) + `pnpm run build` (tsup) as relevant.
   - **PY (if targeted):** the `@graphrefly/py` package's own test/lint/type gates in `~/src/graphrefly-py`.
   - **jsonl touched:** `node ~/src/graphrefly/dashboard/build.mjs --check` (consistency gate).
4. Fix any failures.

If implementation leaves an **open architectural decision** (deferred behavior, parity caveat, "needs spec" item), append it to `~/src/graphrefly/plan/backlog.jsonl` (B# + trigger) — NOT a docs file. If it **lands or advances a CSP-* phase**, update that phase's `status`/`note` in `~/src/graphrefly/plan/phases.jsonl`, flip any conformance-backed `draft` rule to `active` once its scenario is green per arm, then run the consistency gate.

When done, briefly list files changed and new exports added. Then suggest running `/qa` for adversarial review and final checks.
