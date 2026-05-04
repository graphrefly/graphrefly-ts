# Phase 13.6.A — Locked rules (draft)

*Draft output of the rules/invariants audit (Phase 13.6.A). Working file — NOT yet applied to spec / COMPOSITION-GUIDE / memory files. Review pass before finalize → handoff to Rust port agent.*

*Scope: TS only. PY parity dropped from this pass per user direction (2026-05-01).*

*Source: precursor inventory at `docs/implementation-plan-13.6-prep-inventory.md` (247 rules across 12 sources). This draft locks the resolutions for the 7 audit aspects identified in the dev-dispatch session.*

**Audit aspects (status):**
1. ✅ Hard contradictions / unresolved tensions (locks A–E below)
2. ✅ Semantic correctness — needs a hard look (locks A–F below)
3. ✅ Flaky-by-construction (locks A–C below)
4. ✅ Maintenance burden (locks A–D below; 4.B provisional, revisit at Rust port)
5. ✅ Simplification candidates (locks A–D below)
6. ✅ Performance / memory (locks A–E below; 6.B explicitly NOT pursued)
7. ✅ Process rules in the wrong document (lock A below)

**All 7 aspects locked. Ready for user review pass before finalize → Rust port handoff.**

---

## 1. Hard contradictions — locked resolutions

### Lock 1.A — Imperative boundary

**Locked rule:**

> **Default:** widen primitive options/methods to `T | Node<T>` so callers opt into reactive control without forcing the abstraction.
>
> **Wrap as primitive only when:** the underlying structure is reactive (map keys, list elements, topic log, queue cursor, audit cursor) AND the wrap *genuinely eliminates* an imperative call rather than shifting it elsewhere.
>
> **Abort criteria — "stop the work in vain":** if removing `someThing.imperativeMethod()` forces the caller into `someOtherThing.otherImperativeMethod()` upstream, the imperative call wasn't eliminated. Keep the original method; do not ship the wrap.
>
> **Coexistence with M.11 (remove unused imperative paths) and L2.35 (sanctioned imperative-controller-with-audit primitives):**
> - M.11: if a method has no consumer (grep), remove it pre-1.0.
> - L2.35: five primitives (`pipeline.gate`, `JobQueueGraph`, `CqrsGraph`, `saga`, `processManager`) currently expose imperative methods. They predate the abort criteria and **must be re-tested against it in 13.6.B**. Outcome per primitive: either lock the rationale (alternative is `producer.emit()` upstream → "stop the work in vain") or propose redesign.

**Source rules folded / cross-referenced:**
- L2.44 + L2.44-when-wrap + L2.44-vicious-cycle (kept; abort criteria added)
- M.10, M.11, M.12, M.13, M.13-vicious, M.13-structure (consolidate into single canonical entry referencing this rule)
- L2.35 (kept; cross-reference added re: 13.6.B retest)
- L2.34 `handoff` (kept; verify no method exposure during 13.6.B)

**Edit targets (apply later):**
- `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` §44 — extend with abort criteria.
- `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` §35 — add note re: 13.6.B retest.
- `~/.claude/projects/.../memory/feedback_no_imperative*.md` (3 files) — fold into single canonical entry.

**13.6.B audit sweep:**
- Retest `pipeline.gate`, `JobQueueGraph`, `CqrsGraph`, `saga`, `processManager` against §44 abort criteria.

---

### Lock 1.B — `=== undefined` is the canonical SENTINEL check

**Locked rule:**

> `=== undefined` / `!== undefined` is the **canonical SENTINEL check** across the codebase.
>
> **Sanctioned uses:**
> - `ctx.prevData[i] === undefined` → "this dep has never emitted DATA"
> - `ctx.batchData[i]?.length === 0 && ctx.prevData[i] === undefined` → "no DATA in this wave OR ever"
> - `node.cache === undefined` (at sanctioned boundary, see Lock 1.C) → "node has not produced a value yet"
>
> **`== null` (loose):** use only when conflating `null` and `undefined` is intentional (domain treats both as "no value").
>
> **Replaced rule:** `G.3-never-undefined` ("Never use `=== undefined` as reactive dep guard") was over-scoped — true for `data[i]` inside fn body (first-run gate makes that case dead code) but wrongly generalized to all SENTINEL detection. Retired.

**Source rules folded / cross-referenced:**
- M.5 (canonical wording above)
- G.3-never-undefined — **retired**
- G.3, G.3-sentinel, G.3-null-guard, G.3-partial — kept (still apply)
- G.3-companion-restriction, G.3-topicgraph-companion, G.3-reactiveLog-companion — kept (companion-pattern rules unaffected)
- M.4, M.21, M.21-upstream-fix, M.21-exception — kept (SENTINEL semantics unaffected)
- P.1, P.1a, P.1a-antipattern — kept

**Edit targets:**
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §3 — replace `G.3-never-undefined` block with the new canonical wording.
- `~/.claude/projects/.../memory/feedback_guard_patterns.md` — confirm M.5 wording; add note that G.3-never-undefined was retired in 13.6.A.

**13.6.B audit sweep:**
- Sweep `src/` for `=== undefined` / `!== undefined` inside reactive fn bodies guarding `data[i]` — these are dead code under first-run gate; remove.

---

### Lock 1.C — `.cache` read consolidation (three sanctioned categories)

**Locked rule:**

> `.cache` reads are sanctioned in **three contexts only**:
>
> **(1) Inspection** — outside any reactive fn. Includes `graph.observe`, dev tooling, debug prints, and **factory-time seed / wiring** (closure-mirror pattern). The reactive graph isn't currently running; cache is a stable artifact.
>
> **(2) Sole-writer scope** — inside a reactive fn IFF that fn is **lexically the only emit() call site** to the node being read. No stale-data risk: any value `.cache` returns was written by *this* scope. Lexical (not runtime) means: grep over `src/` shows exactly one `someNode.actions.emit(` / `.down(` call site, and it lives in this fn.
>
> **(3) Compat layers** — `autoTrackNode` dep discovery. The only sanctioned `.cache` read inside a reactive fn that does NOT meet (2). Documented carve-out for compat boundary (Signal.State, Jotai, Nanostores, Zustand bridges).
>
> **Anti-pattern:** reading a *foreign* dep's `.cache` inside a reactive fn outside (2)/(3). Use `withLatestFrom` or closure-mirror instead.

**Source rules folded / cross-referenced:**
- 2.5 ("read-only accessor for external consumers") — folded into (1).
- 5.12 ("data flows through messages, not peeks") — strengthened with the three-category list (replaces "no peeking" prose).
- M.3 ("sanctioned at external-observer boundary") — folded into (1).
- P.28 (factory-time seed pattern) — folded into (1) as wiring-time read; cross-reference left.
- P.22 (autoTrackNode compat) — folded into (3); cross-reference left.
- G.26 (compat layers expose backing node) — kept; cross-reference under (3).

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §5.12 — replace "no peeking" prose with three-category list.
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` §22 — fold to one-line cross-reference to spec §5.12 case (3).
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` §28 — fold to one-line cross-reference to spec §5.12 case (1).
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §26 — cross-reference under (3).
- `~/.claude/projects/.../memory/feedback_fire_and_forget.md` — update M.3 to point at spec §5.12.

**13.6.B audit sweep:**
- Sweep `src/` for `.cache` reads inside reactive fns; classify each against categories (1)/(2)/(3). Anything outside is an offender — fix or document as accepted exception.

---

### Lock 1.D — `actions.down(Messages[])` legality + multi-DATA semantics

**Locked rule:**

> `actions.down([msg1, msg2, ...])` is allowed — one call = one wave with multiple messages.
>
> **Wave content invariants** (P.41 strengthened):
> - Tier-3 slot is **either** ≥1 `[DATA, v]` **or** exactly one `[RESOLVED]`. Never mixed.
> - `[[DATA, v1], [RESOLVED]]` in a single delivery is **illegal** (protocol error).
> - Nested `batch()` producing both `node.down([[RESOLVED]])` and `node.emit(v2)` in the same wave is **illegal**.
>
> **Equals substitution:**
> - Applies **only to single-DATA waves**. The dispatcher rewrites `[DATA, v]` → `[RESOLVED]` when `equals(v, cache)` holds.
> - **Does not apply to multi-DATA waves.** Caller's choice to send multiple values signals "deliver each verbatim"; the dispatcher does not collapse mid-wave.
>
> **Enforcement:** documented as user contract. Runtime assertion deferred (filed in `optimizations.md`).

**Source rules folded / cross-referenced:**
- 1.3 (equals-substitution dispatch invariant) — strengthened with "single-DATA waves only" clarification.
- 1.11 (`actions.down/up` accept Message or Messages array) — kept; cross-reference to wave-content invariants.
- P.41 + P.41-protocol-error — kept; sync wording with spec §1.3.3.

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §1.3.3 — strengthen wording per locked rule.
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` §41 — sync with spec.

**Deferred (filed in `docs/optimizations.md`):**
- Dev-mode dispatcher assertion for mixed-tier-3 waves and equals-substitution attempts on multi-DATA waves.

---

### Lock 1.E — "No silent swallowing" carve-out for terminal-emission operators

**Locked rule:**

> Rule 5.3 / 2.4 ("nodes are transparent by default; no silent swallowing") governs **unrecognized message tuples** — operators must forward message types they don't handle.
>
> **Carve-out:** terminal-emission operators (`filter`, `take`, `skip`, `takeWhile`, `distinctUntilChanged`) implement **documented, opt-in DATA suppression** per their semantics. When an entire wave produces zero DATA, they emit `[RESOLVED]` (P.19), preserving wave shape.
>
> **Distinction:**
> - **Silent swallowing** (forbidden) = dropping unknown tuples without emission.
> - **Documented suppression** (sanctioned) = dropping DATA per operator's contract while preserving wave shape via RESOLVED.

**Source rules folded / cross-referenced:**
- 2.4, 5.3 (transparent by default; no silent swallowing) — kept; carve-out added.
- P.19 (terminal-emission operators emit RESOLVED on zero-DATA wave) — kept; cross-reference to carve-out.
- P.19-antipattern — kept.

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §5.3 — add carve-out paragraph.
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` §19 — add cross-reference line.

---

## 2. Semantic correctness — locked resolutions

### Lock 2.A — Equals-substitution check order

**Locked rule:**

> The dispatcher's equals-substitution (rule 1.3) checks in this order, short-circuiting on first match:
>
> 1. **Version check (preferred)** — if value is a `Versioned<T>` wrapper (G.4), compare `version` fields. O(1) regardless of payload size.
> 2. **Identity check** — `value === cache`. Cheap; catches reuse cases.
> 3. **Deep equals (opt-in)** — call user-provided `equals(value, cache)` only if the node was constructed with one.
>
> If none of the three matches, emit `[DATA, value]` verbatim (no substitution).
>
> **Equals throws inside dispatch — log-and-continue:**
> - **Dev mode:** dispatcher rethrows the error annotated with node id + wave context, surfacing the buggy `equals` to the developer immediately.
> - **Production:** dispatcher catches, logs once per node (rate-limited via central config), and proceeds as if equals returned `false` (emit DATA verbatim). Reactive graph stays alive; one bad equals doesn't kill the wave.
>
> **Applies only to single-DATA waves** (per Lock 1.D). Multi-DATA waves emit each value verbatim, no equals checks.

**Source rules folded / cross-referenced:**
- 1.3 (equals-substitution dispatch invariant) — strengthened with check order + throw policy.
- G.4 (Versioned wrapper for ReactiveMap) — referenced as the version-check input.
- Lock 1.D — cross-reference for "single-DATA waves only."

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §1.3.3 — add the three-step check order and throw policy.
- `src/core/config.ts` — likely add `equalsThrowPolicy: 'rethrow' | 'log-and-continue'` (default `'rethrow'` in dev, `'log-and-continue'` in prod); needs design pass.

---

### Lock 2.B — Meta TEARDOWN ordering test

**Locked rule:**

> Rule 1.10 ("Meta TEARDOWN fan-out fires at the top of `_emit` before parent's own state-transition walk") is a load-bearing ordering invariant. Add a **dedicated ordering test** in the core test suite that asserts the fan-out happens *before* the parent state transition, not just behavioral coverage that could pass by accident.

**Source rules folded / cross-referenced:**
- 1.10 (Meta TEARDOWN ordering) — kept verbatim.

**Edit targets:**
- `src/__tests__/core/` — add ordering test (specific file location TBD during 13.6.B).

**13.6.B audit task:**
- Write the dedicated ordering test asserting fan-out-precedes-state-transition.

---

### Lock 2.C — PAUSE-buffering replay (revised)

**Locked rule (replaces 1.7):**

> When `pausable: "resumeAll"` mode holds any lock, outgoing tier-3 deliveries are buffered as **`Messages[]`** — one entry per attempted wave, preserving the exact wave shape (single-DATA, multi-DATA, or single-RESOLVED).
>
> **On final-lock RESUME:** dispatcher replays buffered waves in order. Per-wave handling follows the standard wave invariants (Lock 1.D):
> - **Multi-DATA waves**: emit each verbatim, no equals substitution.
> - **Single-DATA waves**: equals substitution against cache; if matches, rewrite to `[RESOLVED]`.
> - **Single-RESOLVED waves**: emit verbatim.
>
> **Cache reference for equals substitution during replay:** the cache value as it was at the **end of the previous wave in the buffer** (not pause-start, not replay-time). Each wave in the buffer sees the cache shaped by all prior buffered waves having "happened" in the conceptual timeline.
>
> **Resolves ambiguity in prior 1.7 wording:** "duplicates collapse to RESOLVED" was vague about which cache reference applied. The revised rule makes it explicit and avoids equals-substitution surprises across the pause boundary.

**Source rules folded / cross-referenced:**
- 1.7 (PAUSE/RESUME tier-3 buffering) — **replaced** with revised semantics.
- 1.6 (PAUSE/RESUME lockId mandatory) — kept.
- 1.8 (unknown-lockId RESUME no-op) — kept.
- Lock 1.D (multi-DATA waves don't equals-substitute) — applied during replay.

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.6 (PAUSE/RESUME) — replace buffering description with revised semantics.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` v0.4.0 changelog reference — note the revision.

**13.6.B audit sweep:**
- Verify dispatcher buffer type is `Messages[]` (waves), not flattened `Message[]`. Refactor if currently flattened.
- Add tests covering: (a) multi-DATA wave during pause replays verbatim, (b) single-DATA wave that matches *prior buffered wave's emission* substitutes to RESOLVED, (c) single-RESOLVED wave during pause replays verbatim.

---

### Lock 2.D — Storage cross-tier atomicity (elevated to top-line invariant)

**Locked rule:**

> **Storage atomicity invariant** (top-line):
>
> Each storage tier owns its own transaction. **Cross-tier atomicity is best-effort** — if tier A succeeds and tier B fails, partial persistence results. Callers depending on cross-tier consistency must implement their own reconciliation (idempotent writes, version reconciliation on read, or compensating actions on read-side detection).
>
> Promoted from buried sub-rule (G.27-atomicity) to a top-line invariant alongside the main G.27 storage entry, because it is a **user-visible correctness risk** that the prior placement under-emphasized.

**Source rules folded / cross-referenced:**
- G.27-atomicity ("Cross-tier atomicity is best-effort") — **elevated** from sub-rule to top-line.
- G.27-transaction (per-tier transaction model) — kept under elevated invariant.
- G.27-debounce-deferred (debounce extends transaction window) — kept; cross-reference to atomicity invariant noting partial-persistence window grows with debounce.

**Edit targets:**
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §27 — restructure: move atomicity to the top of the tier-storage section (right after the "N-tier and free-form" intro), before the per-tier sub-rules.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — consider mirroring as a top-line storage invariant in the persistence section (TBD if a persistence section exists; check during 13.6.B).

---

### Lock 2.E — `_process_*` synthetic event prefix (reserve as documented convention)

**Locked rule:**

> Rule L2.36-synthetic ("reserve `_process_<name>_*` prefix for process-manager synthetic events") is **kept as documented user convention**. No runtime collision check added at this time.
>
> **Reserved**: future enforcement (runtime collision detection, typed namespace token) is a deferred consideration — file under `optimizations.md` if a real collision bug surfaces.

**Source rules folded / cross-referenced:**
- L2.36-synthetic — kept verbatim.

**Edit targets:**
- None at canonical-doc level. Kept as-is.

**Deferred:**
- Runtime collision detection or typed namespace token — not pursuing pre-1.0; revisit if collision bugs appear.

---

### Lock 2.F — `MAX_RERUN` as central config (replaces P.22-limit magic constant)

**Locked rule:**

> The `autoTrackNode` re-run depth limit is a **central configuration option** on the `GraphReFlyConfig` singleton (`src/core/config.ts`), default value `100`.
>
> Configurable via `configure((cfg) => cfg.maxAutoTrackRerun = N)` at app startup; isolated test instances may pass a custom value via `new GraphReFlyConfig({ maxAutoTrackRerun: N })`.
>
> When the depth counter exceeds the configured value, `autoTrackNode` emits `[[ERROR]]` with diagnostic context: `{ nodeId, currentDepth, configuredLimit, lastDiscoveredDeps }`. The error is propagated downstream per default error semantics (rule 1.4).
>
> **Replaces:** P.22-limit's hard-coded `MAX_RERUN=100` magic constant.

**Source rules folded / cross-referenced:**
- P.22 (autoTrackNode for compat layers) — kept.
- P.22-limit (re-run depth limit) — **replaced** with config-singleton version.

**Edit targets:**
- `src/core/config.ts` — add `maxAutoTrackRerun: number` field (default `100`).
- `src/extra/auto-track.ts` (or wherever `autoTrackNode` lives — verify during 13.6.B) — replace constant with config read.
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` §22 — update P.22-limit wording to reference the config.

**13.6.B audit sweep:**
- Locate current `MAX_RERUN` constant; verify only one definition exists; replace with config read.
- Verify error diagnostic shape carries the four context fields.

---

## 3. Flaky-by-construction — locked resolutions

### Lock 3.A — `awaitSettled` subscribe-before-kick (callback + sync-subscribe hybrid)

*Lock scope (per F6 review): **test-helper / process-only lock** — no canonical-spec rule reference. The `awaitSettled` helper is a TS-side test/scaffolding utility; its reshape doesn't appear in `canonical-spec.md` rule bodies. 13.6.B implements directly against this lock. Rust port may rebuild from scratch with native async semantics.*

**Locked rule:**

> `awaitSettled` accepts an optional `kick` callback in opts. When provided, helper subscribes synchronously, fires `kick()` after subscribe is in place, returns the settle Promise. When omitted, helper subscribes synchronously inside the function body (not inside the Promise executor) and returns the settle Promise — caller responsible for triggering the kick after the call returns.
>
> **Signature:**
> ```ts
> function awaitSettled<T>(
>   node: Node<T>,
>   opts: { skipCurrent?: boolean; kick?: () => void }
> ): Promise<T>
> ```
>
> **Caller patterns:**
>
> *Common case (kick provided — ordering impossible to misuse):*
> ```ts
> const result = await awaitSettled(node, {
>   skipCurrent: true,
>   kick: () => node.actions.emit(value),
> });
> ```
>
> *Rare case (no kick — external trigger):*
> ```ts
> const settled = awaitSettled(node, { skipCurrent: true });
> // ... external event arrives, fires emit ...
> const result = await settled;
> ```
>
> **Replaces:** the load-bearing-comment pattern (M.20-load-bearing) where ordering was enforced by prose. Sync-subscribe alone (no microtask deferral inside Promise executor) eliminates the silent-regression risk in the no-kick path; callback form makes misordering structurally impossible in the kick path.

**Source rules folded / cross-referenced:**
- M.20, M.20-reason, M.20-load-bearing — **replaced** by API reshape.

**Edit targets:**
- Locate current `awaitSettled` (likely in `src/extra/` or `src/__tests__/helpers/`) — refactor to new signature.
- All call sites — migrate to callback form where applicable; keep no-kick form for external-trigger cases.
- `~/.claude/projects/.../memory/feedback_subscribe_before_kick.md` — note the API reshape; mark as historically informative but no longer load-bearing.

**13.6.B audit sweep:**
- Sweep `src/__tests__/` for `awaitSettled` callers; migrate to callback form where the kick is co-located.
- Verify the implementation subscribes synchronously inside the function body, not inside `new Promise(...)` executor.

---

### Lock 3.B — DIRTY-precedes-terminal-DATA test helper

*Lock scope (per F6 review): **test-helper / verification-only lock** — no canonical-spec rule reference. The `assertDirtyPrecedesTerminalData` helper is a TS test utility; verification appendix (canonical-spec §11 Appendix E) covers the broader fast-check + TLA+ verification approach. 13.6.B implements directly against this lock. Rust port verification suite would build an analogous helper if needed.*

**Locked rule:**

> Ship `assertDirtyPrecedesTerminalData(messages: Messages)` as a public test helper.
>
> Replaces ad-hoc test assertions like "DIRTY precedes any DATA globally," which fail for accumulating operators where the initial activation `[RESOLVED]` has no preceding DIRTY (P.25).
>
> Helper checks: for every **terminal-emission DATA** (the last DATA of a wave settling the operator's value), there exists a `[DIRTY]` earlier in the message sequence within that wave's preamble. Skips initial-activation `[RESOLVED]` (P.25 ceremony).
>
> Encoding the rule in a helper means tests can't accidentally write the wrong predicate.

**Source rules folded / cross-referenced:**
- P.25 (START handshake exempts first emission from DIRTY requirement) — kept.
- P.25-test (don't check "DIRTY precedes any DATA globally") — kept; cross-referenced by helper docstring.

**Edit targets:**
- `src/testing/assertions.ts` (new file or merge into existing testing surface) — add `assertDirtyPrecedesTerminalData`.
- Public testing export at `@graphrefly/graphrefly/testing` (per Phase 14.5.3 plans).
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` §25 — reference helper instead of restating predicate.

**13.6.B audit sweep:**
- Sweep `src/__tests__/` for hand-rolled "DIRTY precedes DATA" assertions; replace with helper.

---

### Lock 3.C — `withBudgetGate` auto-wires adapter abort

**Locked rule:**

> When the LLM/tool adapter passed to `withBudgetGate` exposes an abort signal (e.g. `adapter.abort: NodeInput<void>` or equivalent in the adapter contract), `withBudgetGate` **automatically wires the gate's denied-state to fire abort**, cancelling in-flight calls when the budget is exhausted.
>
> When the adapter does **not** expose abort, `withBudgetGate` falls back to the current behavior (gate cuts propagation; in-flight call's tokens still burn until natural completion). A dev-mode warning logs once per adapter at wire-time noting that honest cost control requires the adapter to support abort.
>
> Encodes L2.42-honest-cost's "two pieces needed" rule into the primitive itself: observability bubble (already shipped) plus auto-wired abort. No more manual hookup required.

**Source rules folded / cross-referenced:**
- L2.42 (cost-bubble recipe) — kept; auto-wire is the implementation detail that fulfills (2) of L2.42-honest-cost.
- L2.42-honest-cost — kept; updated to note auto-wire makes (2) automatic when adapter supports it.

**Edit targets:**
- `src/extra/budget-gate.ts` (or wherever `withBudgetGate` lives — verify during 13.6.B) — detect adapter abort capability; auto-wire if present; log warning if absent.
- Adapter contract (likely `src/patterns/ai/` or similar) — document `abort: NodeInput<void>` as the recognized capability shape.
- `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` §42 — update L2.42 to note auto-wire behavior.

**13.6.B audit sweep:**
- Locate all current adapters; verify which expose abort; document gaps.
- Update demo / test code that currently hand-wires the abort hookup; remove the manual wiring.

---

## 4. Maintenance burden — locked resolutions

*General principle (per user direction 2026-05-03):* keep documenting items even when the immediate fix is heavy; the Rust port may mitigate some maintenance burdens by encoding invariants at the type level that TS cannot.

### Lock 4.A — G.20 cleanup hook shape (named hooks only)

**Locked rule:**

> Cleanup returned from a node's compute fn is a **named-hook object** with optional slots:
>
> ```ts
> type Cleanup = {
>   onRerun?: () => void;       // before next fn run within the same activation
>   onDeactivation?: () => void; // when subscriber count drops to zero
>   onInvalidate?: () => void;   // on incoming [[INVALIDATE]] message
> };
> ```
>
> **Removes the dual-shape API.** The previous `() => void` shorthand (which fired on all three) is **eliminated** — pre-1.0 freedom (M.15). Each lifecycle event has its own slot; intent is explicit at the call site.
>
> **Replaces:** G.20-cleanup-default (`() => void` fires on rerun + deactivation + invalidate) and G.20-cleanup-deactivation (`{deactivation: () => void}` fires only on deactivation).
>
> Slots are independent. Returning `{}` (or no cleanup at all) is valid — common case. Returning all three slots covers every lifecycle event.

**Source rules folded / cross-referenced:**
- G.20 (ctx.store) — kept; cross-reference noting cleanup is now named-hook only.
- G.20-cleanup-default — **replaced** by `onRerun + onDeactivation + onInvalidate` (explicit).
- G.20-cleanup-deactivation — **replaced** by `onDeactivation` slot.
- 1.9 (function-form cleanup fires on INVALIDATE) — **replaced** by `onInvalidate` slot in named hooks.

**Edit targets:**
- `src/core/node.ts` — change cleanup type signature from `void | (() => void) | { deactivation: () => void }` to the named-hook object.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` v0.4.0 changelog reference — note the API reshape.
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §20 — replace G.20-cleanup-default and G.20-cleanup-deactivation with the named-hook description.

**13.6.B audit sweep:**
- Sweep `src/` for cleanup returns; migrate every `() => void` and `{ deactivation }` shape to the named-hook object. Many call sites — not trivial; budget accordingly.

---

### Lock 4.B — L2.35 rollback closure-state hazard (A+B+C combination, provisional)

**Locked rule (provisional — revisit during Rust port):**

> Closure-state mutations inside `wrapMutation` do not roll back automatically. Three complementary mechanisms cover the hazard:
>
> **(A) Explicit `compensate` hook on `wrapMutation`:**
> ```ts
> wrapMutation(args, fn, {
>   compensate: () => {
>     myMap.delete(key);
>     counter--;
>   }
> });
> ```
> Use when the rollback is bespoke or the mutated state isn't worth wrapping.
>
> **(B) `registerMutable(node, value)` opt-in auto-snapshot:**
> Extends the `registerCursor` / `registerCursorMap` family. Snapshots the registered value at batch entry; restores on throw. Use for common collections (Map, Set, primitive counters) where snapshot cost is acceptable.
> ```ts
> const map = registerMutable(node, new Map());
> const counter = registerMutable(node, 0);
> wrapMutation(args, fn);  // snapshot/restore automatic
> ```
>
> **(C) Dev-mode detection (safety net):**
> In dev mode, `wrapMutation` wraps common collection types (`Map`, `Set`, `Array`) with a Proxy that logs unregistered mutations during the transaction. Production no-op (zero overhead). Catches slips at test time.
>
> **NOT pursued:** deep-clone-everything (Option D, too blunt) and forbid-closure-state (Option E, runtime introspection unreliable).
>
> **Rust-port note:** Rust's ownership model and `Drop` trait may enable structurally stronger guarantees (e.g. transactional containers that auto-rollback via RAII). Revisit the decision when the Rust port lands — the TS combination may be too elaborate for what Rust can solve at the type level.

**Source rules folded / cross-referenced:**
- L2.35 (imperative-controller-with-audit shape) — kept; auto-rollback boundaries clarified.
- L2.35-rollback-layers — kept (helper-level vs spec-level); A/B/C address the closure-mutation gap.
- L2.35-rollback-scope — kept; the documented "what rollback does NOT cover" gap is now addressable via A/B/C.
- L2.35-cursor (registerCursor / registerCursorMap) — kept; extended by `registerMutable` (B).

**Edit targets:**
- `src/extra/mutation/index.ts:379` (canonical `wrapMutation` location — verified) — add `compensate` opt; add `registerMutable` to the registration family; add dev-mode Proxy detection on common collection types. Callers via `src/patterns/cqrs/index.ts:23`, `src/patterns/orchestration/pipeline-graph.ts:25`, `src/patterns/job-queue/`, etc.
- `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` §35 — document A/B/C; flag as "TS provisional, revisit at Rust port."

**13.6.B audit sweep:**
- Sweep `src/patterns/` for closure-state mutations inside `wrapMutation` callers; migrate to `registerMutable` (B) or `compensate` (A) per case.
- Verify dev-mode detection doesn't false-positive on legit non-rollback mutations.

---

### Lock 4.C — Versioning rules reframed around `setVersioning`

**Locked rule:**

> User-facing versioning surface is **`Graph.setVersioning(level)`** (graph.ts:1698) and **`config.defaultVersioning`** for new nodes. The underscore-prefixed `_applyVersioning(level)` on `NodeImpl` is the internal mechanism that `setVersioning` iterates over; users do not call it directly.
>
> **Existing rules 2.9, 2.10, 2.11 reframed:**
>
> - **2.9 (was: `_applyVersioning` monotonic upward only):** `setVersioning(level)` and `_applyVersioning` are monotonic; downgrade is a no-op. Either nodes are at or below the requested level (upgrade applied) or already above (untouched).
> - **2.10 (was: `_applyVersioning` rejected mid-wave):** `setVersioning` and `_applyVersioning` throw if invoked mid-wave. Safe call points: setup time before subscribers attach (recommended), or between externally-driven `down()`/`emit()` calls at quiescent boundaries.
> - **2.11 (was: V0→V1 produces fresh history root):** unchanged — the V0→V1 upgrade produces a fresh history root with `cid = hash(currentCachedValue)` and `prev = null`, regardless of which surface (`setVersioning` or `_applyVersioning`) triggered it.
>
> **Marking `_applyVersioning` as `@internal`** in JSDoc clarifies the public/private split without removing functionality. Rust port may collapse to a single internal method on `NodeImpl` analog with `setVersioning` as the only exposed surface.

**Source rules folded / cross-referenced:**
- 2.9, 2.10, 2.11 — kept semantics; reframed surface to point at `setVersioning` first.
- Roadmap §6.0 (versioning levels) — kept.

**Edit targets:**
- `src/core/node.ts:828` — add `@internal` JSDoc tag on `_applyVersioning`.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §7.2 — reframe the rules to lead with `setVersioning`; mention `_applyVersioning` as the internal iterator.

**13.6.B audit:**
- Verify no production code (outside `Graph.setVersioning` and tests) calls `_applyVersioning` directly. Confirmed during audit prep — only `Graph.setVersioning` and tests call it.

---

### Lock 4.D — G.27 storage tier rules consolidation (defaults + deviations)

**Locked rule:**

> Storage tier configuration consolidates around a `defaultTierOpts` constant. Tier-specific rules document only **deviations from defaults**; common behavior is described once.
>
> **`defaultTierOpts`:**
> ```ts
> const defaultTierOpts: TierOpts = {
>   debounceMs: 0,             // sync flush at wave-close
>   compactEvery: undefined,    // no forced flush cap
>   filter: undefined,          // save everything
>   codec: jsonCodec,           // built-in JSON
>   keyOf: undefined,           // primitive-default keyOf
> };
> ```
>
> **Per-tier transaction model and atomicity (Lock 2.D)** apply uniformly across all tiers; described once in the section header, not restated per sub-rule.
>
> **Sub-rules collapse:**
> - G.27-read-order — kept (semantics, not deviation).
> - G.27-per-tier — kept (semantics).
> - G.27-debounce-independent — folded into `debounceMs` description in defaults.
> - G.27-filter-wholesale — folded into `filter` description in defaults.
> - G.27-compactEvery — folded into `compactEvery` description in defaults.
> - G.27-transaction — kept; cross-reference Lock 2.D for atomicity.
> - G.27-debounce-deferred — kept (transaction-window extension).
> - G.27-codec — folded into `codec` description in defaults.
> - G.27-keyOf-recommended — folded into `keyOf` description in defaults.
>
> **Reads as ~10 sub-rules → ~3 main rules + a defaults table.**

**Source rules folded / cross-referenced:**
- G.27 (top-line) — kept.
- G.27-read-order, G.27-per-tier, G.27-transaction, G.27-debounce-deferred — kept as semantics.
- All other G.27-* — folded into defaults table.

**Edit targets:**
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §27 — restructure: top-line atomicity (Lock 2.D) → defaults table → kept semantic sub-rules → cross-references for folded-into-defaults rules.
- `src/extra/storage.ts` (or wherever tier opts live — verify during 13.6.B) — confirm/add `defaultTierOpts` constant; ensure tier types reference it.

---

## 5. Simplification candidates — locked resolutions

### Lock 5.A — SENTINEL family collapse (~13 rules → 2 rules + RESOLVED dual-role note + reactiveLog cleanup)

**Locked rules (canonical):**

> **(1) SENTINEL = `undefined`. Valid DATA = `T | null`.** `undefined` is reserved globally as the "never-sent" sentinel; valid DATA payloads are `T | null` only. Applies uniformly across all primitives — no per-primitive exceptions.
>
> **(2) First-run gate blocks fn until all deps deliver real DATA.** A compute node (derived/effect/dynamic) does not run its fn until every declared dep has emitted at least one real value (DATA). SENTINEL on any dep keeps the fn pending.

**Companion clarification — RESOLVED has two roles:**

> RESOLVED carries two protocol roles, both valid:
> - **(R1) Equals-substituted DATA** (rule 1.3 / Lock 2.A): dispatcher rewrites `[DATA, v]` → `[RESOLVED]` when value matches cache. Means "value emitted, equals matched, no real change."
> - **(R2) No-DATA wave settle** (P.19, reactiveLog empty-log path): operator settles a wave that produced no DATA. Means "wave closed, nothing to advertise as latest."
>
> Both shapes appear identical on the wire (`[[RESOLVED]]`). The dual role is **load-bearing** — terminal-emission operators (`filter` / `take` / etc.) and empty-state primitives (`reactiveLog.lastValue` on empty log) rely on R2 to keep wave shape valid without violating M.4.

**`reactiveLog` exception elimination:**

> `reactiveLog<T>` no longer permits `T` to include `undefined`. Concrete changes:
> - `reactiveLog.lastValue` becomes `Node<T>` (was `Node<T | undefined>`).
> - `reactiveLog.append(undefined)` becomes a runtime guard rejection.
> - `reactiveLog.hasLatest` companion node is **removed** (redundant — empty vs non-empty unambiguous from R2 RESOLVED vs DATA).
> - Empty-log path still emits `[[RESOLVED]]` (R2 use, unchanged).
>
> Migration: any caller with `reactiveLog<X | undefined>` switches to `reactiveLog<X | null>`.

**Source rules folded / cross-referenced:**
- M.4 — kept as canonical rule (1).
- SPEC §2.2, P.1 — folded into rule (2).
- P.1a, P.1a-antipattern, M.21, M.21-upstream-fix — kept as cross-references / examples under (1)+(2).
- G.3, G.3-sentinel, G.3-null-guard, G.3-partial — kept (still apply for guard patterns).
- G.3-never-undefined — already retired in Lock 1.B.
- G.3-companion-restriction, G.3-topicgraph-companion, G.3-reactiveLog-companion, M.21-exception — **retired** (reactiveLog cleanup).

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §1.3.3 — add the RESOLVED dual-role paragraph.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.2 — confirm rules (1)+(2) wording is canonical.
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §3 — retire the three G.3-companion rules; cross-reference rules (1)+(2).
- `src/extra/data-structures/reactive-log.ts` — narrow `T` constraint (exclude `undefined`); remove `hasLatest` from `ReactiveLogBundle`; add `append` runtime guard.
- `~/.claude/projects/.../memory/feedback_use_prevdata_for_sentinel.md` — retire M.21-exception.

**13.6.B audit sweep:**
- Grep `src/` for any `reactiveLog<… | undefined>` call sites; migrate to `… | null`. Expected zero or near-zero per inventory analysis (exception was preventive, not used).
- Grep for `.hasLatest` callers on reactiveLog bundles; migrate or remove.

---

### Lock 5.B — "Messages carry data, no peeks, transparent forward" (4 rules → 1)

**Locked rule (canonical):**

> **Data flows through messages, not through peeks.** Nodes are transparent by default — unrecognized message tuples are forwarded, never swallowed (Lock 1.E carve-out for documented operator suppression). `.cache` reads are sanctioned only at the three boundaries listed in Lock 1.C.

**Source rules folded / cross-referenced:**
- 2.4, 5.3, 2.5, 5.12 — collapse into the single canonical rule above (cross-references retained pointing here).
- Lock 1.C (cache read sanctioned boundaries) — referenced.
- Lock 1.E (operator suppression carve-out) — referenced.

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §5.3 — collapse §2.4 + §2.5 + §5.3 + §5.12 into one canonical paragraph; cross-reference Lock 1.C and Lock 1.E.

---

### Lock 5.C — Wiring-order family (4 rules → 1 diagram + 1 checklist)

*Lock scope (per F6 review): **documentation-consolidation-only lock** for COMPOSITION-GUIDE-PROTOCOL.md §5. No canonical-spec rule reference (canonical §3.4 + §5 cover composition without a dedicated wiring diagram). 13.6.B applies the 4→1 collapse to the source guide directly. Diagram + checklist content lives in COMPOSITION-GUIDE-PROTOCOL.md after edit lands.*

**Locked structure:**

> **COMPOSITION-GUIDE-PROTOCOL §5 reorganized as:**
>
> **Diagram — factory wiring lifecycle:**
> ```
> create state nodes (TopicGraph, state())
>   ↓
> create derived/effect (declare deps)
>   ↓
> subscribe / keepalive (activate computation chain)
>   ↓
> mount subgraphs
>   ↓
> return controller
> ```
>
> **Checklist — 5 ordering invariants:**
> 1. Subscribe before emit (P.2 — fire-and-forget sources lose late subscribers).
> 2. Keepalive activates the chain (P.5-keepalive — first subscriber triggers dep connection; deps push cached values).
> 3. `TopicGraph.retained()` for buffered late-subscriber catch-up (P.2-topicgraph escape hatch).
> 4. `SubscriptionGraph` cursor for stream-position catch-up (P.2-topicgraph escape hatch).
> 5. Mount subgraphs last (P.5 — ensure stage N+1 wired before stage N emits).

**Source rules folded / cross-referenced:**
- P.2, P.5, P.5-keepalive, P.2-topicgraph — collapse into the diagram + checklist above.

**Edit targets:**
- `~/src/graphrefly/COMPOSITION-GUIDE-PROTOCOL.md` §5 — replace four sub-rules with diagram + checklist.

---

### Lock 5.D — `T | Node<T>` widening family (declared done by Lock 1.A)

*Lock scope (per F6 review): **administrative pointer lock** — no independent rule body. All semantic content has been absorbed into Lock 1.A (imperative boundary). Retained as a stable cross-reference target for memory feedback files (M.13 family). 13.6.B treats this as a no-op; just confirm no orphaned references in source code.*

**Locked rule:**

> The `T | Node<T>` widening rule and its abort-criteria nuance are fully captured in **Lock 1.A** (imperative boundary). The L2.44 family (L2.44, L2.44-when-wrap, L2.44-vicious-cycle) and the M.13 family (M.13, M.13-vicious, M.13-structure) collapse into Lock 1.A.

**Source rules folded / cross-referenced:**
- L2.44 + sub-rules — folded into Lock 1.A.
- M.13 + sub-rules — folded into Lock 1.A.

**Edit targets:**
- Per Lock 1.A edit targets (no additional changes here).
- Memory files M.10 / M.11 / M.12 / M.13 family — consolidate to single canonical entry referencing Lock 1.A.

---

## 6. Performance / memory — locked resolutions

### Lock 6.A — PAUSE buffer cap (config singleton)

**Locked rule:**

> The PAUSE-replay buffer (Lock 2.C `Messages[]`) gains a configurable cap on `GraphReFlyConfig`:
>
> ```ts
> // src/core/config.ts
> pauseBufferMax: number;  // default: 10_000 waves; configurable per-instance
> ```
>
> **On overflow:** dispatcher drops oldest waves and emits `[[ERROR]]` once per overflow event with diagnostic `{ nodeId, droppedCount, configuredMax, lockHeldDurationMs }`. The error propagates downstream per default error semantics (rule 1.4).
>
> **Rationale:** unbounded buffer is a real OOM risk if a lock is held for minutes under high emit rate. Loud-fail-with-drop is preferable to silent bloat or process kill.
>
> **Configurable via:** `configure((cfg) => cfg.pauseBufferMax = N)` at app startup; isolated test instances pass `new GraphReFlyConfig({ pauseBufferMax: N })`.

**Source rules folded / cross-referenced:**
- 1.7 — already replaced by Lock 2.C; this lock adds the cap.
- Lock 2.C (PAUSE buffer as `Messages[]`) — extended with cap.

**Edit targets:**
- `src/core/config.ts` — add `pauseBufferMax: number` (default `10_000` waves).
- Dispatcher PAUSE/RESUME path (verify location during 13.6.B) — implement overflow drop + error emission.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.6 — note the cap as part of pause-buffering semantics.

---

### Lock 6.B — Batch-coalescing default (NOT PURSUED)

**Decision:** keep current P.9a / P.12 model unchanged.

> The proposed "coalesce-to-latest-only by default" change for non-accumulating derived nodes is **not pursued**. Rationale (per user direction 2026-05-03): avoid creating that many special cases. Single behavior across all derived nodes (full batch via `batchData`, helper `batch.at(-1) ?? ctx.prevData[i]` for last-only consumers) is preferred over per-derived special casing.
>
> Existing P.12 sugar (`batch.at(-1)`) remains the canonical pattern for last-only consumers. Memory cost of intermediate batch values is accepted as the tradeoff for protocol uniformity.

**Source rules folded / cross-referenced:**
- P.9a, P.12, P.12-raw — kept as-is, no changes.

**Edit targets:**
- None. No change.

---

### Lock 6.C — dynamicNode `partial: true` documentation visibility

**Locked rule (initial decision — superseded by Lock 6.C′ amendment for `dynamicNode`/`autoTrackNode` defaults):**

> dynamicNode's first-run gate behavior is correct as-is and the `partial: true` opt is the canonical answer for wide-superset cases:
>
> - **Default (`partial: false`):** fn waits for **every declared dep to deliver real DATA** before first run (spec §2.7 first-run gate). Once fn runs once, INVALIDATE on a dep does not re-gate.
> - **`partial: true`:** fn may run before all declared deps have delivered. Untracked / not-yet-delivered deps return `undefined` via `track()`; user fn must handle explicitly.
>
> **Documentation surface change in COMPOSITION-GUIDE-PATTERNS §11; mechanism change for `dynamicNode`/`autoTrackNode` defaults via Lock 6.C′ amendment** (post-deep-read, after verifying that both sugars currently inherit the raw-node default of `false`, which doesn't fit selective-deps / runtime-discovery semantics). See Lock 6.C′ for the actual default flip.

**Source rules folded / cross-referenced:**
- L2.11, L2.11-gate, L2.11-equals — kept; L2.11 docstring updated to surface `partial: true`.

**Edit targets:**
- `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` §11 — add a paragraph: "for wide-superset cases where some deps may rarely or never deliver, pass `{ partial: true }` to skip the first-run gate; `track()` returns `undefined` for not-yet-delivered deps."
- `src/core/sugar.ts` — verify the JSDoc for `dynamicNode` mentions `partial: true` (autoTrackNode JSDoc already covers it; check dynamicNode doesn't lag).

---

### Lock 6.D — `ctx.store` default flips to preserve-across-deactivation

**Locked rule:**

> `ctx.store` **persists across deactivation→reactivation** by default. Rationale: many operators legitimately want store survival (long-running counters, parser state, persistent caches), and explicit cleanup via Lock 4.A's `onDeactivation` hook is the cleaner mental model.
>
> **Flips the prior G.20 default** (which wiped on deactivation). Operators relying on auto-wipe must explicitly clean in `onDeactivation`. **Capture `ctx.store` at first call so the cleanup closure references the underlying `_store`** — `ctx` itself is rebuilt per fn invocation, but `ctx.store === node._store` is reference-stable for the lifetime of the activation cycle:
> ```ts
> // Selective key clear — preferred
> let cleanup: { onDeactivation: () => void } | undefined;
> return node<T>(
>   [src],
>   (data, a, ctx) => {
>     if (cleanup === undefined) {
>       const store = ctx.store; // capture stable reference
>       cleanup = {
>         onDeactivation: () => {
>           delete store.taken;
>           delete store.done;
>         },
>       };
>     }
>     // ...
>     return cleanup;
>   },
> );
> ```
> Or wipe every key (preserves the underlying `_store` reference; reassigning the `ctx.store` local does NOT replace `_store`, so the wipe MUST iterate keys):
> ```ts
> if (cleanup === undefined) {
>   const store = ctx.store;
>   cleanup = {
>     onDeactivation: () => {
>       for (const k of Object.keys(store)) delete store[k];
>     },
>   };
> }
> ```
>
> **QA D1 (Phase 13.6.B QA pass) — multi-sub-stayed terminal-resubscribable case.** `onDeactivation` fires on `_deactivate` (last-sink-detach / TEARDOWN) only. The other "fresh lifecycle" path is `_resetForFreshLifecycle` (subscribe-after-terminal-resubscribable; INVALIDATE on a terminal-resubscribable). For one-shot store-flag operators (`frozenContext.emitted`, `take.completed`, etc.) that need to clear their flag whenever the node enters a fresh lifecycle, also install **`onResubscribableReset`** to cover the multi-sub-stayed case where `_deactivate` never runs:
> ```ts
> cleanup = {
>   onDeactivation: () => { delete store.emitted; },
>   onResubscribableReset: () => { delete store.emitted; },
> };
> ```
>
> **Migration scope (not trivial — budget accordingly in 13.6.B):**
> - `src/extra/operators/take.ts` — `taken`, `done`, `completed` (restart-from-zero on resubscribe is the expected semantic for `take(n)`).
> - `src/extra/operators/transform.ts` — `acc`, `prev`, `hasPrev` for `scan` / `reduce` / `distinctUntilChanged` / `pairwise` (restart-from-seed on resubscribe is the expected semantic).
> - `src/extra/operators/time.ts` — counter `n` (line 377-380).
> - `src/extra/sources/async.ts` — `buf` buffer (line 368-369).
> - `src/extra/io/csv.ts` — parser `buffer`, `headers` (lines 159-163).
> - **All other `ctx.store` users in `src/`** — sweep + decide per case (preserve = no change; auto-wipe = add `onDeactivation` cleanup).

**Source rules folded / cross-referenced:**
- G.20 (ctx.store) — **flipped default** from wipe-on-deactivation to preserve-across-deactivation.
- Lock 4.A (named cleanup hooks) — `onDeactivation` is the migration path for operators wanting auto-wipe.
- Rule 2.7 (Compute nodes are RAM — cache clears on deactivation) — **`ctx.store` is now decoupled from the cache-clearing rule**; cache still clears on deactivation per Rule 2.7, but `ctx.store` survives. Worth a SPEC clarification.

**Edit targets:**
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §20 — flip the default in G.20 wording; document migration via `onDeactivation`.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.7 (or wherever Compute-nodes-are-RAM lives) — add note that `ctx.store` is decoupled from cache lifecycle (cache wipes; store survives by default).
- All operator files listed in migration scope — add `onDeactivation` cleanup to preserve current restart-on-resubscribe semantics.

**13.6.B audit sweep:**
- Comprehensive grep `ctx.store` across `src/`. For each user: classify as (a) wants preserve (no change needed after flip), (b) wants auto-wipe (add `onDeactivation` cleanup), (c) ambiguous (decide per case + add a test).
- Add tests verifying restart-on-resubscribe semantic for migrated operators.

**Related dev-mode warning (deferred to optimizations.md):**
- Dev-mode size threshold warning when `ctx.store` exceeds N bytes serialized — useful safety net once preserve-by-default lands. Not blocking.

---

### Lock 6.E — Debounce flush cap on every debounced tier

**Locked rule:**

> `compactEvery: number | undefined` is added to **`defaultTierOpts`** (per Lock 4.D). Every debounced storage tier exposes the cap; default `undefined` (no cap) preserves current behavior; users opt in per tier.
>
> **Effect:** debounced tiers (e.g. `debounceMs: 500`) gain a uniform overflow guard. When in-flight buffer reaches `compactEvery` entries, dispatcher forces flush regardless of debounce timer.
>
> **Replaces:** `compactEvery` was previously a per-primitive opt; now it's part of the universal tier defaults.

**Source rules folded / cross-referenced:**
- G.27-compactEvery — kept; lifted to defaults table per Lock 4.D.
- Lock 4.D (storage tier consolidation) — `compactEvery` is part of the defaults table.

**Edit targets:**
- `src/extra/storage.ts` (or wherever tier types live — verify during 13.6.B) — add `compactEvery: number | undefined` to `TierOpts`; default `undefined`.
- All debounced tier implementations — implement the flush-on-overflow check.
- `~/src/graphrefly/COMPOSITION-GUIDE-GRAPH.md` §27 — `compactEvery` in defaults table per Lock 4.D.

---

## 7. Process rules in the wrong document — locked resolution

### Lock 7.A — Move agent-process rules out of canonical invariants

**Locked rule:**

> The following rules are **agent operating procedure**, not invariants of the reactive graph protocol. They are removed from the canonical invariants set (`GRAPHREFLY-SPEC.md` / COMPOSITION-GUIDE) and live in agent operating instructions only (`CLAUDE.md`, `.claude/skills/dev-dispatch/`, `.claude/skills/qa/`, and the `~/.claude/projects/.../memory/feedback_*.md` files):
>
> - **M.7** — "When spec ↔ code conflict arises, STOP and raise flag with options."
> - **M.8** — "Shape preservation during migrations: require explicit lock, not autonomous decision."
> - **M.9** — "Don't rename local variables, reshape test patterns, or introduce helpers 'just to make tests green' without approval."
> - **M.14** — "Do not proceed to implementation after locking decisions unless user explicitly says to implement."
> - **M.18** — "Always read COMPOSITION-GUIDE and test-guidance before implementing composition fixes or factory changes."
> - **M.19** — "CLAUDE.md is pointer file, never duplicate content; maintain exactly one source of truth per topic."
>
> **Stays in canonical invariants set:**
> - **M.16** — "Change function signatures freely; update all call sites, tests, docs in same pass." Refactoring discipline applies at the code level; Rust port also needs to honor it (no backward compat, change all sites atomically).
>
> **Rationale:** the locked invariants set should be pure code rules — properties of the reactive graph that hold across implementations (TS, Rust, future ports). Agent-process noise filters out so the Rust port agent isn't confused by "stop and raise flag with options" as if it were a runtime invariant.
>
> Memory feedback files already serve as the persistent agent context for these rules — no new home needed; just confirm they're not duplicated into spec/guide.

**Source rules folded / cross-referenced:**
- M.7, M.8, M.9, M.14, M.18, M.19 — **moved out** of canonical invariants set; remain in memory feedback files as agent context.
- M.16 — **kept** in canonical invariants set.

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — verify no rule body restates M.7 / M.8 / M.9 / M.14 / M.18 / M.19; remove if found.
- `~/src/graphrefly/COMPOSITION-GUIDE-*.md` — same verification.
- `CLAUDE.md` (this repo) — verify the agent-process rules are referenced from here (not duplicated).
- `.claude/skills/dev-dispatch/*.md` — verify M.14 in particular is restated here (it's central to dev-dispatch's Phase 2 → Phase 3 boundary).
- `~/.claude/projects/.../memory/feedback_*.md` — keep as authoritative source for these rules.

**13.6.B audit task:**
- Cross-check that none of the moved rules are restated in spec / guide rule bodies. If any are, remove from spec / guide and reference the memory file.

---

## Summary of locks

| Aspect | Locks | Notes |
|---|---|---|
| 1. Hard contradictions | 1.A–1.E | All locked. |
| 2. Semantic correctness | 2.A–2.F | All locked. |
| 3. Flaky-by-construction | 3.A–3.C | All locked. |
| 4. Maintenance burden | 4.A–4.D | 4.B provisional — revisit at Rust port. |
| 5. Simplification | 5.A–5.D | All locked. |
| 6. Performance / memory | 6.A–6.E | 6.B explicitly NOT pursued (no special cases). |
| 7. Process rules placement | 7.A | All locked. |

**Total locks (originals only, this section): 28 (one provisional, one not-pursued). See post-deep-read amendments section for the 11 amendments — overall total = 39.**

## Aggregate edit targets (for finalization pass)

**Spec (`~/src/graphrefly/`):**
- `GRAPHREFLY-SPEC.md` — §1.3.3, §2.2, §2.6, §2.7, §5.3, §5.12, §7.2, v0.4.0 changelog refs.
- `COMPOSITION-GUIDE-PROTOCOL.md` — §5, §19, §22, §28, §41.
- `COMPOSITION-GUIDE-GRAPH.md` — §3, §20, §26, §27.
- `COMPOSITION-GUIDE-PATTERNS.md` — §11, §35, §42, §44.

**Repo (`graphrefly-ts`):**
- `src/core/config.ts` — `maxFnRerunDepth` (Lock 2.F′), `maxBatchDrainIterations` (Lock 2.F′ extended per F7), `pauseBufferMax` (Lock 6.A, default `10_000`), `equalsThrowPolicy` (Lock 2.A, dev `'rethrow'` / prod `'log-and-continue'`).
- `src/core/node.ts` — cleanup hook signature; `_applyVersioning` `@internal` tag.
- `src/extra/data-structures/reactive-log.ts` — narrow `T`, remove `hasLatest`, append guard.
- `src/extra/storage.ts` (or equivalent) — `defaultTierOpts` constant; `compactEvery` in defaults.
- `src/extra/budget-gate.ts` (or equivalent) — auto-wire adapter abort.
- `src/extra/operators/take.ts` / `transform.ts` / `time.ts`, `sources/async.ts`, `io/csv.ts` — `onDeactivation` cleanup migrations for `ctx.store`.
- `src/extra/composition/composite.ts` (autoTrackNode location) — `MAX_RERUN` → config read.
- `src/patterns/cqrs/index.ts` (or equivalent `wrapMutation` location) — `compensate` opt, `registerMutable`, dev-mode Proxy detection.
- `src/testing/assertions.ts` (new) — `assertDirtyPrecedesTerminalData` helper.
- `awaitSettled` location (TBD) — reshape signature.
- `docs/implementation-plan.md` §13.6.B — bullet the audit sweeps.
- `docs/optimizations.md` — file deferred items (D-deferred dispatcher assertion; B-audit / C-audit / A-audit sweeps; ctx.store size warning).

**Memory (`~/.claude/projects/.../memory/`):**
- `feedback_no_imperative*.md` — consolidate to single canonical entry.
- `feedback_guard_patterns.md` — confirm M.5 wording; note G.3-never-undefined retired.
- `feedback_fire_and_forget.md` — point at spec §5.12 three-category list.
- `feedback_use_prevdata_for_sentinel.md` — retire M.21-exception.
- `feedback_subscribe_before_kick.md` — note API reshape; mark historically informative.
- M.7 / M.8 / M.9 / M.14 / M.18 / M.19 entries — confirm canonical home is here, not spec.

---

## Post-deep-read amendments (2026-05-03)

After Phase 13.6.A locks were drafted, a deep code read against `src/core/node.ts` and `src/core/sugar.ts` surfaced multiple spec/code drift items. The locks below either **amend an existing lock** or **add a new lock** to address those findings. Apply alongside the original 24 locks.

### Lock 2.C′-pre — PAUSE buffer scope amendment (extends Lock 2.C; refines wave-content scope from Lock 1.D)

*Originally numbered Lock 1.D′; renamed per F8 (correct semantic attribution — this amendment extends Lock 2.C's PAUSE buffer model, not Lock 1.D's wave-content rules).*

> The PAUSE-replay buffer (Lock 2.C `Messages[]`) holds **both tier-3 (DATA / RESOLVED) and tier-4 (INVALIDATE)** outgoing waves while any lock is held — the full "settle slice" per spec §2.6 / DS-13.5.A Q7.
>
> Current code (`_emit` line 2126-2136) only buffers tier-3 (`if (tier === 3) { _pauseBuffer.push(m); }`). Refactor to: `if (tier === 3 || tier === 4) { ... }`. Tier-5 (COMPLETE/ERROR) and tier-6 (TEARDOWN) continue to dispatch synchronously while paused (must reach observers regardless of leaked controllers).
>
> The `cfg.pauseBufferMax` cap (Lock 6.A) counts both tier-3 and tier-4 entries.

**Edit targets:**
- `src/core/node.ts` `_emit` line 2126-2136 — extend tier check.
- Sweep `_emit` comment block (lines 2113-2125) — uses old tier numbering ("tier 4 (COMPLETE/ERROR)", "tier 5 (TEARDOWN)") that predates DS-13.5.A. Rewrite using current tier table (R1.3.7).

---

### Lock 2.F′ — Central rerun + drain caps on `GraphReFlyConfig` (extends Lock 2.F; per F7 also covers `MAX_DRAIN_ITERATIONS`)

> Two parallel module-level magic constants currently exist in core; both should move to central config under the same naming pattern:
>
> **(1) `MAX_RERUN_DEPTH = 100`** at `src/core/node.ts:83` — gates every fn re-run path in `_execFn` (`_pendingRerun` chains: re-entrance, dep delivery during fn execution, autoTrackNode discovery loop). Lock 2.F's field name `cfg.maxAutoTrackRerun` was misleadingly autoTrack-specific. **Renamed to `cfg.maxFnRerunDepth`.**
>
> When `_rerunDepth > cfg.maxFnRerunDepth`, `_execFn` emits `[[ERROR, { nodeId, currentDepth, configuredLimit, lastDiscoveredDeps? }]]` and resets `_rerunDepth := 0`. The `lastDiscoveredDeps` field is populated only when the rerun chain originated from autoTrackNode discovery (omit otherwise).
>
> **(2) `MAX_DRAIN_ITERATIONS = 1000`** at `src/core/batch.ts:31` — gates the batch drain loop. Same anti-pattern. **Add `cfg.maxBatchDrainIterations`** (default `1000`).
>
> When iterations exceed `cfg.maxBatchDrainIterations`, drain throws with diagnostic `{ phase, queueSizeAtThrow, configuredLimit }` (broaden from current vague `'reactive cycle'` string).

**Edit targets:**
- `src/core/config.ts` — add `maxFnRerunDepth: number` (default `100`) AND `maxBatchDrainIterations: number` (default `1000`).
- `src/core/node.ts:83` — remove module-level `MAX_RERUN_DEPTH` constant.
- `src/core/node.ts:1819-1828` — read from `this._config.maxFnRerunDepth`; broaden diagnostic shape.
- `src/core/batch.ts:31` — remove module-level `MAX_DRAIN_ITERATIONS` constant.
- `src/core/batch.ts:165-171` — read from `cfg.maxBatchDrainIterations` (note: `batch()` doesn't have direct config access today; may require threading or a per-`drainPending` config-getter helper); broaden error diagnostic.

---

### Lock 4.A′ — Cleanup hook field rename (extends Lock 4.A)

> Lock 4.A's named-hook object `{ onRerun?, onDeactivation?, onInvalidate? }` requires renaming the **current** field names in `NodeFnCleanup` (node.ts:162-168):
>
> | Current field | New field |
> |---|---|
> | `beforeRun` | `onRerun` |
> | `deactivate` | `onDeactivation` |
> | `invalidate` | `onInvalidate` |
>
> Plus removal of the `() => void` shorthand form (Lock 4.A core decision).

**Edit targets (call sites that need updating beyond the type def):**
- `src/core/node.ts:162-168` — type definition.
- `src/core/node.ts:1722-1751` — `_execFn` cleanup-firing branch (handles current `beforeRun` and `() => void`).
- `src/core/node.ts:2319-2336` — `_updateState` INVALIDATE branch (handles current `invalidate` and `() => void`).
- `src/core/node.ts` `_deactivate` body — handles current `deactivate` hook firing.
- `src/core/node.ts:1789-1806` — `_execFn` cleanup-storage branch (validates returned object shape).
- All operator/extra files returning cleanup — sweep `src/extra/`, `src/patterns/`.

---

### Lock 4.E (NEW) — Drop `latestData`; canonical name is `prevData`

> `FnCtx` (node.ts:192-196) has only **`prevData`**, `terminalDeps`, `store`. There is no `latestData` field. Spec §2.4 documents `latestData[i]` and uses it in code examples — this is a **stale name** that never existed in code.
>
> Refactor: spec-only — rename all `latestData` references in `GRAPHREFLY-SPEC.md` and `COMPOSITION-GUIDE-*.md` to `prevData`. No code change.

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.4 — replace `latestData` with `prevData` throughout the rule body and examples.
- Any other doc reference (grep `latestData`) — replace.

---

### Lock 6.C′ — `dynamicNode` and `autoTrackNode` override `partial: true` (extends Lock 6.C)

> Code today: raw `node()` defaults `partial: false` (gate ON, line 682). `dynamicNode` (sugar.ts:75-99) and `autoTrackNode` (sugar.ts:162-230) **inherit the default** — both currently `partial: false`.
>
> Refactor: both sugar wrappers explicitly override `partial: true` because their use cases (selective deps, runtime discovery) don't fit gate-all-deps semantics:
>
> ```ts
> // dynamicNode
> return node<T>(allDeps, wrapped, { describeKind: "derived", partial: true, ...opts });
>
> // autoTrackNode
> implRef = new NodeImpl<T>([], wrappedFn, { describeKind: "derived", partial: true, ...opts });
> ```
>
> User can still pass `partial: false` to opt into gate semantics. Default flips for these two sugars only.

**Edit targets:**
- `src/core/sugar.ts:98` (dynamicNode) — explicit `partial: true`.
- `src/core/sugar.ts:225-228` (autoTrackNode) — explicit `partial: true`.
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §2.5 — fix `partial` default table: raw node `false`, sugar `derived/effect` `false` (inherit), sugar `dynamicNode/autoTrackNode` `true` (override).
- `~/src/graphrefly/COMPOSITION-GUIDE-PATTERNS.md` §11 — update L2.11 to note the dynamicNode default change.

---

### Lock 6.F (NEW) — Q16 implement (auto-COMPLETE-before-TEARDOWN)

> Spec §2.6 (lines 747-777, DS-13.5.A Q16) describes synthetic `[COMPLETE]` prefix on `[[TEARDOWN]]` when node not yet terminal. **Not implemented in core today** (`_emit` and `_updateState` have no synthesis logic; only `patterns/process/index.ts:1285` does it at the pattern layer).
>
> Implementation approach (file as 13.6.B task):
> - Add `_teardownProcessed: boolean` flag to `NodeImpl` for idempotency.
> - In `_emit`, after PAUSE/RESUME bookkeeping and before Meta TEARDOWN fan-out: detect `[[TEARDOWN]]` in wave; if `!_teardownProcessed && !_isTerminal && !wave.some(m => m[0] === COMPLETE || m[0] === ERROR)`, prepend `[COMPLETE]` to the wave.
> - Set `_teardownProcessed := true` on first TEARDOWN encountered.
> - Subsequent TEARDOWN waves at the same node skip synthesis (idempotency).
>
> Sentinel-status nodes also get the synthetic COMPLETE per spec.

**Edit targets:**
- `src/core/node.ts` `NodeImpl` class — add `_teardownProcessed` field.
- `src/core/node.ts` `_emit` body — add Q16 synthesis between PAUSE/RESUME bookkeeping (line 1996) and Meta TEARDOWN fan-out (line 2073).
- Tests — add Q16 ordering test (sentinel-status TEARDOWN, dirty-status TEARDOWN, idempotency under double TEARDOWN).

---

### Lock 6.G (NEW) — `replayBuffer: N` implement

> Spec §2.5 documents `replayBuffer: N` as if implemented. **Not implemented** — `_invariants.ts:4857` confirms: "§2.5 `replayBuffer: N` is not implemented in the TS runtime yet."
>
> Implementation approach (file as 13.6.B task):
> - Add `_replayBuffer: T[] | null` field to `NodeImpl`, allocated at construction when `opts.replayBuffer != null`.
> - Capacity = `opts.replayBuffer` (number); circular buffer.
> - On every outgoing DATA delivery (in `_updateState` after equals substitution succeeds and `_cached` advances), push the value into `_replayBuffer` (drop oldest if full).
> - On `subscribe`, after START handshake, deliver buffered DATAs to the new sink: `[[DATA, v0], [DATA, v1], ..., [DATA, vN-1]]` as one `Messages` wave.
> - Document interaction with `equals` substitution (RESOLVED entries are NOT buffered — only DATA).
>
> Cross-check with `_pauseBuffer`: separate buffer; replayBuffer is for late-subscriber catch-up, pauseBuffer is for paused-state replay.

**Edit targets:**
- `src/core/node.ts` `NodeImpl` class — add `_replayBuffer` field + `_replayBufferCapacity`.
- `src/core/node.ts` constructor — allocate buffer when `opts.replayBuffer != null`.
- `src/core/node.ts` `_updateState` DATA branch — push to buffer.
- `src/core/node.ts` subscribe path — replay after START.
- Tests — late-subscriber replay; capacity overflow; interaction with `_pauseBuffer`; interaction with `equals` substitution.

---

### Lock 6.H (NEW) — INVALIDATE status fix: `"sentinel"` not `"dirty"`

> Spec R1.3.7.b (DS-13.5.A) explicitly says: "The emitting node's status transitions to `'sentinel'` ('no value, nothing pending') — NOT `'dirty'` ('value about to change')". Code (`_updateState` line 2312) sets `this._status = "dirty"`. **Direct contradiction; code is wrong.**
>
> The spec rationale is load-bearing: `defaultOnSubscribe`'s push-on-subscribe sends only `[[START]]` (not `[[START, DIRTY]]`) to subsequent subscribers when status is `"sentinel"`, preventing phantom dirty count inheritance. Setting `"dirty"` defeats this.
>
> Refactor (code change):
>
> ```ts
> } else if (t === INVALIDATE) {
>   ...
>   this._cached = undefined;
>   this._status = "sentinel";  // was "dirty"
>   ...
> }
> ```

**Edit targets:**
- `src/core/node.ts:2312` — change `this._status = "dirty";` to `this._status = "sentinel";`.
- Tests — verify push-on-subscribe sends only `[[START]]` after INVALIDATE; verify subsequent subscribers don't inherit phantom dirty count.

---

### Lock 2.A′ — Equals-throw current behavior delta

> Lock 2.A locks the **target** behavior: dev rethrow / prod log-and-continue. **Current code does neither**: `_updateState` line 2215-2222 catches the throw, aborts the wave walk at the throw point, delivers the successfully-walked prefix to sinks, then `_emit` (line 2145-2147) emits `[[ERROR, equalsError]]` as a separate recursive wave.
>
> Refactor scope: Lock 2.A is a real behavior change, not just config wiring.

**Edit targets:**
- `src/core/node.ts` `_updateState` line 2215-2222 — branch on `cfg.equalsThrowPolicy`.
- Same — wire dev mode default to `'rethrow'`, prod to `'log-and-continue'`.
- Document the behavior change in `optimizations.md` since it has user-facing impact (current behavior is "fault-tolerant" — throw produces ERROR, doesn't crash; dev rethrow CRASHES the process in dev).

---

### Lock 2.C′ — `_pauseBuffer` type refactor (extends Lock 2.C)

> Lock 2.C target: `_pauseBuffer: Messages[]` (array of waves). **Current code:** `_pauseBuffer: Message[] | null` (flat) at node.ts:603. Replay at line 2049-2051 drains the entire flat array as a single `_emit(drain)` call — meaning N buffered DATAs replay as ONE wave, losing the original wave-shape semantics that Lock 2.C requires.
>
> Refactor:
> - Field type: `Messages[] | null`.
> - In `_emit` line 2126-2136 (extended per Lock 2.C′-pre), push each `wave` (the `finalMessages` Messages object) into `_pauseBuffer` as one entry per wave.
> - In RESUME drain (line 2048-2052): iterate buffered waves, call `_emit(wave)` for each one separately.
> - Cap (Lock 6.A) counts waves, not messages.

**Edit targets:**
- `src/core/node.ts:603` — type `Messages[] | null`.
- `src/core/node.ts:2019-2020` — `_pauseBuffer = []` (empty Messages[]).
- `src/core/node.ts:2048-2052` — per-wave replay.
- `src/core/node.ts:2126-2136` — push wave (not per-message).

---

### Lock 4.F (NEW) — Document `_versioning` vs `_versioningLevel` split

> Code maintains **two parallel versioning fields** (intentional design):
>
> - `_versioningLevel: VersioningLevel | undefined` — explicit V0/V1/null enum, used for monotonicity checks and future v2/v3 extensions
> - `_versioning: NodeVersionInfo | undefined` — runtime metadata (cid, prev, etc.)
>
> Mutated in lockstep by constructor (lines 701-710) and `_applyVersioning` (line 828).
>
> Spec §7 today doesn't fully document this split. Add a brief implementation note pointing at the two fields. Rust port may collapse to a single struct with the level as a discriminant; the **roles** must be preserved (one for monotonicity comparison, one for runtime metadata).

**Edit targets:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §7 — add implementation note documenting the two-field split (TS-specific) and the role separation (cross-language).

---

## Updated lock summary (post-deep-read)

Notation: `X.Y′` = amendment to existing lock; `(NEW: X.Y)` = brand-new lock added post-deep-read.

| Aspect | Locks | Notes |
|---|---|---|
| 1. Hard contradictions | 1.A–1.E | All originals; no amendments here. (Lock 2.C′-pre formerly listed as "1.D′" — moved to aspect 2 per F8 rename.) |
| 2. Semantic correctness | 2.A–2.F + 2.A′ + 2.C′ + 2.C′-pre + 2.F′ | Four amendments capture current-vs-target deltas (2.C′-pre extends 2.C with PAUSE tier-4 buffer scope; 2.F′ extended per F7 to also cover `cfg.maxBatchDrainIterations`). |
| 3. Flaky-by-construction | 3.A–3.C | All originals; 3.A and 3.B noted as test/process-only locks (no canonical-spec impact — see F6). |
| 4. Maintenance burden | 4.A–4.D + 4.A′ + (NEW: 4.E, 4.F) | 4.A′ field-rename details; 4.E latestData→prevData; 4.F versioning two-field doc. |
| 5. Simplification | 5.A–5.D | All originals; 5.C and 5.D noted as documentation-only locks (no canonical-spec rule reference — see F6). |
| 6. Performance / memory | 6.A–6.E + 6.C′ + (NEW: 6.F, 6.G, 6.H) | 6.C′ overrides defaults; 6.F Q16 implement; 6.G replayBuffer implement; 6.H INVALIDATE status fix. |
| 7. Process rules placement | 7.A | Unchanged. |

**Total: 28 original locks + 11 amendments (4 prime + 5 NEW + 2 process-only standalones) = 39 lock entries.**

---

## Notes for Rust port agent (handoff context)

- This draft locks the **resolution** of TS-side audit items, not the source rules themselves. Read the precursor inventory at `docs/implementation-plan-13.6-prep-inventory.md` for full rule context (247 rules across 12 sources).
- "Edit targets" sections name files in the **TS spec/guide repos** (`~/src/graphrefly/`) and **TS source** (`src/`) where the locked text would be applied. The Rust port should mirror the spec text once spec edits land.
- "13.6.B audit sweep" items are TS-side cleanup tasks **not yet executed**. Rust port can use them as analogous targets in the Rust codebase, or skip if Rust's type system makes them moot.
- TS-specific code conventions (`ctx.prevData`, `ctx.batchData`, `=== undefined`, `actions.down/emit`) translate to Rust idioms preserving **semantics**, not syntax.
- **Lock 4.B (rollback closure-state hazard)** is explicitly flagged as TS provisional — Rust's ownership model and `Drop` may enable structurally stronger guarantees. **Revisit during Rust port design.**
- **Lock 7.A** confirms the locked invariants are **pure code rules**. Agent-process noise (M.7 / M.14 / M.18 etc) does not enter the Rust spec.
- **Lock 1.A** abort criteria for `T | Node<T>` widening assumes "imperative" means a synchronous mutation method. Rust's `&mut self` mutation is the analog; the abort criteria translate directly.
- **Implementation Delta #18 (sugars on Graph in TS):** Rust port should put `state` / `producer` / `derived` / `effect` BACK into core alongside `dynamic_node` / `auto_track_node` (per user directive 2026-05-03). Standalone returns `Node<T>`; Graph methods become thin wrappers (`graph.state(name, ...) → graph.add(name, state(...))`). Aligns with the JSDoc-example mental model and reduces the surface-area split.

