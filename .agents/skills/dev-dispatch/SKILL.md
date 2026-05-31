---
name: dev-dispatch
description: "Implement feature/fix with planning and self-test. Use when user says 'dispatch', 'dev-dispatch', or provides a task with implementation context. Supports --light flag for bug fixes and small changes. Run /qa afterward for code review and final checks."
argument-hint: "[--light] [task description or context]"
---

You are executing the **dev-dispatch** workflow for the **clean-slate GraphReFly** redesign.

This repo is **`@graphrefly/ts`** — the self-contained TypeScript implementation (D32). Clean-slate code lands in **`packages/ts/src/`**. The language-neutral authority (spec / decisions / plan / conformance / formal) lives in **`~/src/graphrefly`** (branch `clean-slate`) as jsonl — when this skill and that repo disagree, **that repo wins** (AGENTS.md). Sibling impls: `@graphrefly/rust` (`~/src/graphrefly-rs`), `@graphrefly/py` (`~/src/graphrefly-py`) — each self-contained; cross-language = wire bridge, never in-process (D32).

> **Stale-infra guard.** Do NOT reach for the retired port-model surfaces: `packages/pure-ts/**` (frozen read-only reference only, D41), `docs/implementation-plan.md`, `docs/optimizations.md`, `docs/roadmap.md`, `docs/test-guidance.md`, `docs/docs-guidance.md`, `GRAPHREFLY-SPEC.md`/`COMPOSITION-GUIDE.md` (migrated to `spec/rules.jsonl` + `guide/guide.jsonl`, B7), the `Impl`/facade/actor model / 3-digit D### port decisions. The clean-slate authority is the jsonl below.

The user's task/context is: $ARGUMENTS

### Mode detection
If `$ARGUMENTS` contains `--light`, this is **light mode**. Otherwise **full mode**. Differences are noted inline per phase.

### Workflow floor (non-negotiable)
- **decision-first**: any architectural lock needs a `D#` in `~/src/graphrefly/decisions/decisions.jsonl` BEFORE code (`/design-review` → user approval → append). Decisions locked ≠ implementation approved — wait for an explicit "implement".
- **spec-first** (F-NO-IMPL-DEFINED): any wave-protocol behavior change amends `spec/rules.jsonl` + `formal/*.tla` + `spec/conformance.jsonl` FIRST (`/spec-amend`), THEN code. Operators/sugar/inspection are per-language (D6/D24) — NOT spec, skip spec-amend.
- **no autonomous decisions**: surface spec↔code conflicts; don't silently pick. File-by-file review for multi-file rewrites.
- **verify premise**: design tables lag code — grep the named symbols + check landed markers (`plan/phases.jsonl` status/notes) before designing new surface; a stale premise is a HALT.
- **consistency gate**: after touching any `~/src/graphrefly` jsonl, run `node ~/src/graphrefly/dashboard/build.mjs --check` (non-zero on broken links / orphans).

---

## Phase 1: Context & Planning

Load context and plan in a single pass. **Parallelize all reads.**

Read in parallel (clean-slate authority):
- `~/src/graphrefly/AGENTS.md` — the single-source authority index (read FIRST).
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
- **Messages** `[[Type, Data?], ...]`; one array to `ctx.down`/`ctx.up` = one wave (R-msg-format). 10-type closed set, no user-defined types (R-msg-closed-set).
- **DIRTY before DATA/RESOLVED** in the same wave (R-dirty-before-data); two-phase glitch-free diamond (R-two-phase); a diamond/fan-in node recomputes exactly once after all changed deps settle (R-diamond). batch defers tier-≥3, not DIRTY.
- **`ctx.up` is control-tier only** (DIRTY/PAUSE/RESUME/INVALIDATE/TEARDOWN); DATA/RESOLVED/COMPLETE/ERROR are down-only (R-ctx-up, D8). A handle is pure data, no methods (D7).
- **No polling** (R-no-polling); **no imperative triggers** (R-no-imperative — reactive `ctx.up`/signals, not emitters/callbacks/timers+set; remove imperative paths when no caller depends); **no raw async** in the sync core (R-no-raw-async / F-SYNC-CORE — async lives only in sources / the pool / the wire bridge).
- **All fn through the dispatcher** (R-dispatch-all / F-DISPATCH-ALL — no inline-fn bypass). `dispatcher.invoke` is sync void (R-sync-core).
- **Data moves via messages** (R-data-not-peek — never peek a dep's `.cache` to seed compute; `.cache` is a read-only accessor for external consumers). SENTINEL = absence-of-DATA (R-sentinel); the canonical never-emitted detector is `ctx.prevData[i] === undefined`.
- **messageTier is a compile-time const table** (D18/D34/R-tier); the clock is **graph-local** (no global singleton, D26/R-clock); `onMessage`/`onSubscribe` are substrate-fixed, not user-replaceable (D19).
- **Primary-API clean** (R-primary-api-clean): protocol internals (DIRTY/RESOLVED/bitmask) never surface in value-level sugar (derived/effect/operator); ctx-level (node/producer) intentionally exposes tier as a power surface (DR-1). Sugar value-fn → ctx-fn wrapping happens in the graph layer (D27); a value-level `throw` becomes `[[ERROR,e]]` down (D30).
- **graph = single-thread causal/concurrency domain (D22 / R-graph-domain):** parallelism via pool callback or multi-graph + wire bridge; rewire is intra-graph only.
- **`ctx.state`** = per-node private cross-wave state (R-ctx-state); shared/observable state must be an explicit node + dep, not `ctx.state` (D23). A synchronous feedback cycle (a fn re-driving its own dep mid-wave) is a wave-level ERROR (D37/R-reentrancy), not iteration.
- **F-NO-WEDGE-CUT:** every primitive serves ≥2 segments (no LLM-only or single-segment wedge; F-NO-LLM-ONLY). **F-PERF:** budget every abstraction (thin node, default-off inspection).

**Targeting a sibling (py/rust):** if the task targets `@graphrefly/py` (`~/src/graphrefly-py`) or `@graphrefly/rust` (`~/src/graphrefly-rs`), read that package's local layout + its conformance arm status in `spec/conformance.jsonl`. The cross-language contract is **behavioral conformance (D24)**, not symbol parity. PY public APIs are synchronous (return `Node[T]`/`Graph`/value, no `async def`); async lives at the source/pool boundary only (F-SYNC-CORE).

Do NOT start implementing yet.

---

## Phase 2: Architecture Discussion

### Full mode — HALT

**HALT and report before implementing.** Present:

1. **Architecture assumptions** — how this fits the substrate (`node`/`dispatcher`/`ctx`/`protocol`/`batch`) vs graph-layer (`graph/`) split.
2. **New patterns** — any not yet in `packages/ts/src/`.
3. **Options considered** — alternatives with pros/cons.
4. **Recommendation** — preferred approach + why.

Prioritize (in order):
1. **Correctness** — matches `~/src/graphrefly/spec/rules.jsonl` + the floor.
2. **Completeness** — edge cases (errors, COMPLETE, reconnect/reactivate, diamonds, SENTINEL gate, PAUSE lockset).
3. **Consistency** — matches patterns already in `packages/ts/src/`.
4. **Simplicity** — minimal solution.

No backward compatibility (pre-1.0).

**Escalation routing** (don't silently pick — no-autonomous-decisions):
- Architectural lock → `/design-review` → user approval → append a `D#` to `decisions.jsonl`.
- Wave-protocol behavior change → `/spec-amend` (spec-first: rules + TLA+ + conformance, THEN code).
- Cross-runtime concern → `/conformance` (behavioral scenario, not structural diff).
- Deferred/open question with no answer yet → append to `~/src/graphrefly/plan/backlog.jsonl` (B# + trigger); a recurring anti-pattern → `plan/antipatterns.jsonl` (+ a `feedback_*` memory if generalizable).

**Wait for user approval before proceeding.**

### Light mode — Skip unless escalation needed

Proceed directly to Phase 3 **unless** Phase 1 reveals any of these:
- A change to **wave-protocol behavior** (tiers, wave semantics, diamond/equals/SENTINEL, batch, push-on-subscribe, ctx.up/down contract) → spec-first, escalate.
- A new architectural lock with no governing `D#`.
- Multiple viable approaches with non-obvious trade-offs.

If any apply: HALT and present findings as in full mode.

---

## Phase 3: Implementation & Self-Test

After user approves (full mode) or after Phase 1 (light mode, no escalation):

1. Implement the changes.
   - Treat `~/src/graphrefly/spec/rules.jsonl` as non-negotiable for behavior; if code drifts from a rule, align to the rule — or surface the conflict, don't silently pick.
   - Cite the governing R-id / D# in test expectations.
2. Create tests (per `guide/guide.jsonl` G-test — unit / property / conformance layering):
   - Put tests in the most specific existing file under `packages/ts/src/__tests__/`.
   - Use `graph.observe()` for live message assertions; assert at the node + message level otherwise. A behavioral-protocol change ALSO needs a `spec/conformance.jsonl` scenario (`/conformance`) before its rule flips `draft → active`.
3. Run checks:
   - **TS:** `pnpm --filter @graphrefly/ts test` (vitest) + `pnpm run lint` (biome + layer/typecheck gates) + `pnpm run build` (tsup) as relevant.
   - **PY (if targeted):** the `@graphrefly/py` package's own test/lint/type gates in `~/src/graphrefly-py`.
   - **jsonl touched:** `node ~/src/graphrefly/dashboard/build.mjs --check` (consistency gate).
4. Fix any failures.

If implementation leaves an **open architectural decision** (deferred behavior, parity caveat, "needs spec" item), append it to `~/src/graphrefly/plan/backlog.jsonl` (B# + trigger) — NOT a docs file. If it **lands or advances a CSP-* phase**, update that phase's `status`/`note` in `~/src/graphrefly/plan/phases.jsonl`, flip any conformance-backed `draft` rule to `active` once its scenario is green per arm, then run the consistency gate.

When done, briefly list files changed and new exports added. Then suggest running `/qa` for adversarial review and final checks.
