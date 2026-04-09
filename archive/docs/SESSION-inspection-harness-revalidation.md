# Session: Inspection Harness Revalidation

> **Date:** 2026-04-08  
> **Triggered by:** Post-consolidation revalidation — using new inspection tools to fix gate.modify tests and eliminate flaky tests.  
> **Prerequisite:** `SESSION-inspection-consolidation.md` (14+ tools → 9)

---

## Context

After the inspection tool consolidation (spy→observe, annotate+traceLog→trace, RxJS bridge→toObservable), this session:

1. Used the new tools (`harnessTrace`, `harnessProfile`, structured `TraceEvent`) to revalidate harness tests
2. Replaced all `_wait_for` polling with reactive composition
3. Fixed subscription-ordering bugs exposed by the replacement
4. Cleaned up inspection tool APIs (structural output, progressive disclosure, minimum defaults)
5. Updated dev-dispatch/qa/parity skills to mandate COMPOSITION-GUIDE.md for patterns/ work

---

## Key decisions

### 1. `_wait_for` polling → reactive composition, then → correct test patterns

**Problem:** `_wait_for` polled `.get()` in a loop — violates §5.8 (no polling).

**First attempt:** Replace with `first_where(node, predicate)` composing `filter → take(1) → first_value_from`. This was wrong for two reasons:

- **Operator chain bug:** The `filter → take(1)` composition breaks with synchronous sources — data flows through the chain during operator wiring, before `first_value_from` subscribes.
- **Fundamental misunderstanding:** In GraphReFly (like callbag/RxJS), data is fire-and-forget. `subscribe` receives only future emissions. There is no replay (unlike TC39 Signals). `first_where` subscribing AFTER data has flowed will never see it.

**Correct fix:** Applied per-test, based on the data flow timing:

| Scenario | Correct pattern |
|----------|----------------|
| Data already flowed (sync pipeline, `done.wait()` completed) | Use `.get()` / assert on collector directly |
| Data will flow from background thread in the future | Wire `subscribe` or `first_where` BEFORE the emission trigger |
| Need to wait for async status change | Wire `subscribe` with `threading.Event` before activating the producer |

### 2. `first_where` implementation: direct subscriber, not operator chain

Rewrote `first_where` to subscribe directly with an inline predicate check, instead of composing `filter → take(1) → first_value_from`. The operator chain version fails because intermediate nodes consume the data during wiring before the final subscriber attaches.

Both TS and PY `first_where` and `first_value_from` now have explicit docstrings warning: **future emissions only, wire before emit, use `.get()` for cached state.**

### 3. Structured `TraceEvent` with progressive detail levels

`harnessTrace` now returns `HarnessTraceHandle` with:
- `handle.events: TraceEvent[]` — structured events (no string parsing needed)
- `TraceEvent { elapsed, stage, type, summary?, data? }` — progressive disclosure
- Default detail: `"summary"` (minimum viable, like `describe()`)
- Logger option simplified (no `null` — defaults to `print`/`console.log`)

### 4. `firstWhere`/`first_where` earns its place

Valid use case: waiting for a future emission from a background thread (adapter tests with no `done.wait()`, async pipeline stages). It is NOT a replacement for `.get()` on already-settled nodes.

### 5. COMPOSITION-GUIDE mandate for patterns/ work

Updated dev-dispatch, qa, and parity skills to require reading COMPOSITION-GUIDE.md before any patterns/ modifications. Specifically: subscription ordering (§2), wiring order (§5), and testing composition patterns.

---

## Invariant violations found

### Category A: Protocol-level operators in patterns/ (move to extra/)

`reduction.stratify()`, `orchestration.valve()/for_each()/wait()` — general reactive primitives currently in `patterns/` because they were built for harness use cases. No domain-layer assumptions. **Roadmap item added.**

### Category B: Direct `.down([(MessageType.DATA, value)])` in patterns/

~30+ sites across TS and PY use `.down()` with raw MessageType instead of `.set()` sugar. Gate `approve()`/`reject()` already provide sugar for this boundary — accepted as reasonable. The remaining sites (mostly state node updates inside effects) should migrate to `.set()`. **Roadmap item added.**

### Resolved: §5.8 no polling

All `_wait_for` polling removed. Tests now use reactive patterns or direct `.get()`.

---

## Files changed

### TS
- `src/extra/sources.ts` — Added `firstWhere`, rewrote to direct subscriber (not operator chain), updated docstrings
- `src/patterns/harness/trace.ts` — `TraceEvent` structured events, progressive detail levels, default `"summary"`
- `src/core/meta.ts` — `@internal` JSDoc on `describeNode`, `metaSnapshot`
- `src/__tests__/patterns/harness.test.ts` — gate.modify test with harnessTrace stage ordering validation
- `.claude/skills/dev-dispatch/SKILL.md` — COMPOSITION-GUIDE mandate for patterns/
- `.claude/skills/qa/SKILL.md` — COMPOSITION-GUIDE verification check
- `.claude/skills/parity/SKILL.md` — COMPOSITION-GUIDE read for cross-repo patterns/

### PY
- `src/graphrefly/extra/sources.py` — Added `first_where`, rewrote to direct subscriber, updated docstrings
- `src/graphrefly/patterns/harness/trace.py` — `TraceEvent` dataclass, progressive detail levels
- `src/graphrefly/core/runner.py` — `is_runner_registered()` debug helper
- `src/graphrefly/patterns/harness/profile.py` — `runner_registered` field
- `tests/conftest.py` — `_ThreadRunner.__repr__` with pending counter
- `tests/test_patterns_harness.py` — Removed `first_where` (sync pipeline), used `.get()` for cached state
- `tests/test_adapters_ingest.py` — Removed redundant `first_where` after `done.wait()`, fixed terminal event tests
- `tests/test_extra_sources_http.py` — Wire status observer before producer activation

---

## Lessons learned

1. **GraphReFly is fire-and-forget like RxJS, not replay-on-subscribe like Signals.** Always check COMPOSITION-GUIDE §2 before wiring test assertions. Wire observers BEFORE emitters.

2. **`.get()` reads cached state; `.status` validates freshness.** For already-settled nodes, these are the correct tools — not subscription-based helpers.

3. **Mock adapters make pipeline processing synchronous.** With `MockLLMAdapter`, `switch_map` evaluates inline — the entire harness pipeline (intake → triage → queue → execute → verify → strategy) completes within `publish()`. No need to wait for background threads.

4. **Operator chain composition has ordering subtleties.** `filter → take(1) → first_value_from` fails when the source value flows through the chain during wiring before the terminal subscriber attaches. Direct subscriber implementations avoid this.
