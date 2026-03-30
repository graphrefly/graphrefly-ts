---
SESSION: cross-repo-implementation-audit
DATE: March 29, 2026 (updated — batch 11 operator matrix complete, protocol § comments, checkpoint IDB + doc registry; batches 13–15; dynamicNode; RxJS; graph inspector)
TOPIC: Cross-repo compliance audit — spec invariants, API patterns, callbag-recharge lessons, docs/tests backlog, superset-deps, RxJS alignment, AI tooling gaps
REPO: graphrefly-ts (primary artifacts) + graphrefly-py (same checklist scope)
ARTIFACTS: docs/audit-plan.md, docs/batch-review/*.md
---

## CONTEXT

A structured **16-batch audit** was defined in `docs/audit-plan.md` (7 phases: A spec compliance, B API patterns, C callbag-recharge pitfalls, D documentation, E test coverage, F advanced patterns, G integration stress). Each batch is a self-contained prompt; findings are written under `docs/batch-review/`.

This session log **does not replace** the per-batch reports. It records **what was run**, **synthesized findings**, **remediation work**, and **how to read vague backlog phrases** so future readers can navigate the archive without re-reading every checklist line.

---

## BATCH STATUS (as of March 29, 2026)

| Batch | Phase | Topic | Report file | Status |
|-------|-------|-------|-------------|--------|
| 1 | A | Core protocol invariants (TS + Py) | `docs/batch-review/batch-1.md` | Done |
| 2 | A | Node primitive contract | `docs/batch-review/batch-2.md` | Done |
| 3 | A | Graph container | `docs/batch-review/batch-3.md` | Done |
| 4 | B | API patterns (TS) | `docs/batch-review/batch-4.md` | Done |
| 5 | B | API patterns (Py) | `docs/batch-review/batch-5.md` | Done |
| 6 | C | Core design lessons (callbag-recharge) | `docs/batch-review/batch-6.md` | Done |
| 7 | C | Operator edge cases | `docs/batch-review/batch-7.md` | Done |
| 8 | C | Data structures & resilience | `docs/batch-review/batch-8.md` | Done |
| — | — | **Roll-up: changes applied after batches 4–8** | `docs/batch-review/batch-4-8-processed-result.md` | Done |
| 9 | D | Documentation audit (TS) | `docs/batch-review/batch-9.md` | Done (remediated — see below) |
| 10 | D | Documentation audit (Py) | *(varies)* | Per-py batch review |
| 11 | E | Test coverage (TS) | `docs/batch-review/batch-11.md` | Done (full operator matrix, `operators.test.ts` split + § comments, `protocol.test.ts` § comments — see below) |
| 12 | E | Test coverage (Py) | *(not present)* | Not run |
| 13 | F | Superset-deps pattern (Phase 4) | `docs/batch-review/batch-13.md` | Done |
| 14 | F | RxJS / callbag semantic alignment | `docs/batch-review/batch-14.md` | Done |
| 15 | F | AI debugging tooling gaps | `docs/batch-review/batch-15.md` | Done |
| 16 | G | Integration stress | *(not present)* | Not run |

---

## REMEDIATION: BATCH 9 (TS DOCS) — FINDINGS & FIXES

**Report:** `docs/batch-review/batch-9.md` (executive verdict was NOT COMPLETE).

**Fixes applied (synthesis):**

1. **`website/scripts/gen-api-docs.mjs`**
   - **`flattenJSDocComment`** — `{@link …}` in JSDoc no longer becomes empty text in generated `.md` (uses `SyntaxKind` for link/text nodes).
   - **REGISTRY** — Replaced non-resolving keys (`CircuitBreaker`, `TokenBucket` interfaces, phantom `tokenTracker` before it existed) with **`circuitBreaker`**, **`tokenBucket`**, **`tokenTracker`**; removed **`PubSubHub`**; added **`dynamicNode`** and a first set of **`sources.ts`** entries.
   - **`export const Alias = target` aliases** — Resolver uses the **target function’s signature** and merges **alias JSDoc** where present (so RxJS names get generated pages).

2. **Stale / hand-edited API pages** — Removed orphan **`CircuitBreaker.md`**, **`TokenBucket.md`**, **`PubSubHub.md`** when registry stopped emitting them; regen produces **`circuitBreaker.md`**, **`tokenBucket.md`**, etc. *(If `TokenBucket.md` / `CircuitBreaker.md` reappear with **factory** content, that is intentional: filenames may still match historical Starlight links — prefer **`docs:gen` output** as source of truth.)*

3. **`examples/basic-counter.ts`** — Uses **`subscribe`**, **`DATA`**, and unsubscribes; no `.sinks` or numeric type codes.

4. **`docs/roadmap.md`** — Qualified paths described with **`::`**; resilience line lists **`tokenBucket` / `tokenTracker`**; **`llms.txt`** item checked when files exist.

5. **`llms.txt`** — Added at repo root and **`website/public/llms.txt`** (AI / crawler discovery).

6. **`website/astro.config.mjs`** — Sidebar aligned with new API slugs (Sources group, resilience renames, no PubSubHub page).

7. **`src/core/guard.ts` `policy()`** — Removed **duplicate contradictory** JSDoc blocks; documented **deny-wins; no match → `false`** (matches implementation and graphrefly-py).

8. **`src/extra/resilience.ts`** — **`tokenTracker()`** added as a thin wrapper over **`tokenBucket()`** for naming parity and doc-generator binding.

**Tier 1 JSDoc follow-up (same session, post–batch 9):**

- **`gate`**, **`window` / `windowTime` / `windowCount`**, RxJS **aliases** (`flatMap`, `combineLatest`, `debounceTime`, `throttleTime`, `catchError`, `shareReplay`) — structured blocks with `@param` / `@returns` / `@example` where missing.
- **`sources.ts`** — Tier‑1-style blocks on the main public sources/sinks (`fromTimer` through `firstValueFrom`, `share`/`replay`/`cached`, etc.).
- **Core** — `isBatching`, `partitionForBatch`, `isPhase2Message`, `describeNode`, `normalizeActor` tightened to checklist shape.
- **`Graph` public API** — `@param` / `@returns` (and overload notes for `observe`) on registry/container methods so IDE tooltips match `docs-guidance.md`.
- **`gen-api-docs.mjs`** — Resolves **`export const Alias = target`** in the same file so alias pages reuse the target signature but keep alias-specific prose/examples; new **REGISTRY** keys for the aliases and extra source helpers.

**Still not auto-generated:**

- **`Graph.md`** remains a **single class page** (no per-method sections) until the generator is extended.
- **Types-only exports** (large `type` tables, every `interface` field) are not required to match function Tier‑1 by `docs-guidance.md`.

**Hand-editing `website/src/content/docs/api/*.md`** — Discouraged; prefer JSDoc + `pnpm --filter @graphrefly/docs-site docs:gen`.

**Pitfall:** Inside a block `/** … */`, the substring `*/` ends the comment — avoid cron examples like `"*/5 * * * *"` in JSDoc (use a literal without `*` immediately before `/`, or document the pattern in prose outside a code string).

---

## REMEDIATION: BATCH 11 (TS TESTS) — FINDINGS & FIXES

**Report:** `docs/batch-review/batch-11.md`.

**Fixes applied (pre-matrix):**

- **`src/__tests__/core/node.test.ts`** — **`RESOLVED` transitive skip** (leaf `fn` run count), **ERROR terminal** (no further sink deliveries), **`resetOnTeardown`**, stronger **ERROR payload** assertion (`Error` + `.message`).

**Fixes applied (operator protocol matrix — March 29, 2026):**

A dedicated suite exercises **DIRTY ordering**, **RESOLVED** behavior, and **reconnect after unsubscribe** for **public `operators.ts` exports** (including buffer/window/gate/time operators and RxJS aliases). **`shareReplay`** lives in **`sources.ts`** — not duplicated in the operator matrix.

| Artifact | Role |
|----------|------|
| `src/__tests__/extra/operator-protocol-harness.ts` | `subscribeProtocol`, `globalDirtyBeforePhase2`, `batchHasDirtyBeforeData`, `sawResolved` |
| `src/__tests__/extra/operator-protocol-matrix.test.ts` | Per-operator `describe` blocks (**~80+ tests**): Tier 1 — map, filter, tap, scan, take, skip, distinctUntilChanged, pairwise, startWith, first, combine, zip, merge, race, concat, withLatestFrom, reduce, **takeUntil, takeWhile, find, elementAt, last, gate**; Tier 2 — switchMap, exhaustMap, concatMap, mergeMap, **flatMap**, debounce, delay, throttle, **sample, audit, buffer, bufferCount, bufferTime, windowCount, window, windowTime, timeout, pausable, rescue, repeat, interval**, plus **RxJS alias** identity checks (`combineLatest`, `debounceTime`, `throttleTime`, `catchError`) |
| `src/__tests__/extra/operators.test.ts` | Tier 1/2 **one-scenario-per-`it()`** where previously bundled; **`// Regression: GRAPHREFLY-SPEC §…`** on each test |
| `src/__tests__/core/protocol.test.ts` | **`// Regression: GRAPHREFLY-SPEC §…`** on batch / protocol tests (§1.1, §1.2, §1.3.4, §1.3.7, D4) |

**Core / operator fixes discovered while writing the matrix:**

1. **`NodeOptions.onResubscribe`** (`src/core/node.ts`) — Called when a **resubscribable** node clears **terminal** state on a new `subscribe()`. Lets operators reset **closure** state that `resetOnTeardown` / cache alone do not clear.
2. **`take` / `reduce`** (`src/extra/operators.ts`) — When **`opts.resubscribable === true`**, set `onResubscribe` to reset **`taken` / `done`** (take) and **`acc` / `sawData`** (reduce). Without this, **`first(..., { resubscribable: true })`** and a second **`reduce`** completion on the same node could not behave correctly.
3. **Reconnect test pattern** — A second push with the **same** value as the settled output often yields only **`RESOLVED`**, not **`DATA`**. The shared helper defaults to a **distinct** second value (e.g. **`[[DIRTY], [DATA, 99]]`**) unless a test overrides `pushSecond` (e.g. pairwise).
4. **`exhaustMap` DIRTY test** — **`state(0)`** triggers **`_runFn`** / inner attach on connect before the scripted two-phase push; use **`state<number | undefined>(undefined)`** so the first outer **`DATA`** is under test control.
5. **`delay` + fake timers** — Asserting **`DIRTY`** is clearer when **`DIRTY`** and **`DATA`** are sent in **separate** `down()` calls (DIRTY is synchronous; **`DATA`** is scheduled).
6. **`throttle` + fake timers** — Implementation uses **`Date.now()`** and **`lastEmit` starts at `0`**. If **`Date.now()`** is **`0`**, **`now - lastEmit >= ms`** fails for the **first** leading edge. Tests use **`vi.setSystemTime`** (e.g. start at **`10_000`**, advance to **`12_000`**) so spacing is meaningful.
7. **`timeout` / `pausable` / `rescue` + single-dep DIRTY skip** — When **`DIRTY`** and **`DATA`** are co-batched to the sink, **`DIRTY`** may be elided; **split** `source.down([[DIRTY]])` and `source.down([[DATA, …]])` in tests to assert **`globalDirtyBeforePhase2`** (same pattern as **`delay`**).

**Optional follow-up (batch 11):**

- **`sources.ts`**: add a small protocol or smoke test row for **`shareReplay`** / other sources if you want parity with the operator matrix style.

---

## ELABORATION: BATCH‑11 “OPERATOR MATRIX”, BUNDLED `it()`, SPEC COMMENTS

These phrases refer to **`docs/test-guidance.md`** style goals, not a failing CI.

### 1. Operator matrix (DIRTY / RESOLVED / reconnect)

**Meaning:** For **each** Tier‑1 (and Tier‑2) operator, the audit asks whether tests **independently** prove:

- **`DIRTY`** — Downstream sees a dirty phase (ordering vs upstream) when the operator forwards two-phase updates.
- **`RESOLVED`** — When upstream resolves unchanged, the operator does not spuriously emit **`DATA`** (or propagates **`RESOLVED`** correctly).
- **Reconnect** — After unsubscribe / teardown and a **new** subscription, behavior matches spec (no stale inner subscription, correct initial replay, etc.).

**Today:** `operator-protocol-matrix.test.ts` runs the **DIRTY / RESOLVED / reconnect** checklist for **operators.ts** exports; **`operators.test.ts`** uses **one primary `it()` per scenario** with **§** comments; **`protocol.test.ts`** documents batch semantics with **§** comments. The two suites are complementary (matrix = protocol invariants per operator; **operators.test** = behavioral smoke).

**Why it matters:** Catches bugs in **two-phase** and **subscription-lifecycle** edges that unit tests on final `.get()` values miss.

### 2. Splitting bundled `it()` blocks

**Meaning:** One test that asserts **`combine` + `zip` + `merge` + `concat` + `race`** in a single `it("…")` is hard to **name**, **debug**, and **map to the checklist**. **test-guidance** prefers **one concern per test** so failures point to a **single operator + single behavior**.

**Status:** **`operators.test.ts`** split completed (see Batch‑11 remediation table).

### 3. Spec-§ regression comments

**Meaning:** A short **comment above the test** tying the scenario to **`GRAPHREFLY-SPEC.md`** (e.g. `// Regression: GRAPHREFLY-SPEC §1.3.3 — RESOLVED transitive skip`). Helps **humans and LLMs** verify **why** the test exists and **when** it is safe to change behavior.

**Status:** Applied across **`operator-protocol-matrix.test.ts`**, **`operators.test.ts`**, and **`protocol.test.ts`** for the protocol-heavy tests; further optional polish on **`graph.test.ts`** / other files if desired.

---

## SYNTHESIZED FINDINGS (HIGH LEVEL)

### Phase A — Spec compliance (batches 1–3)

- **Batch 1:** Most §1.x invariants **PASS** in both repos. Two items need follow-up:
  - **§1.3.7 batch drain:** TS defers phase-2 while `flushInProgress`; Python’s `defer_when="depth"` does **not** match — see `batch-1.md` and `protocol.py` docstring accuracy.
  - **§1.4 directions:** Neither repo **enforces** up/down message direction; lifecycle forwarding contradicts a strict reading of the spec — **spec clarification** or implementation policy needed.
- **Batch 2:** Construction table, diamond behavior, and most of §2.x **PASS**; detailed line citations in `batch-2.md` (including sugar/operator naming notes).
- **Batch 3:** Graph container §3.x **PASS** for both repos; describe/snapshot cross-checks documented there.

### Phase B — API patterns (batches 4–5)

- Inconsistencies called out: curried vs direct operators, barrel leaks, class vs factory choices. Several items were **fixed** in the processed pass (see below).

### Phase C — callbag-recharge cross-check (batches 6–8)

- Output slot, two-phase push, RESOLVED memoization, batch nesting: largely **IMPLEMENTED** with file:line evidence in batch 6–8 reports.
- **Batch 7:** Identified operator edge-case **gaps**; TS gained a substantial `edge-cases.test.ts` suite; Python gained parallel tests with **xfail** markers where Py behavior still diverges (switchMap/concatMap/exhaustMap inner error and outer-complete semantics — see processed result).
- **Batch 8:** Data-structure and resilience gaps catalogued (TTL validation parity, LFU, checkpoint JSON warnings, IndexedDB tests, etc.).

### Phase F — Advanced (batches 13–15) — REMEDIATED

- **Batch 13:** Superset-deps pattern is **correct** for RESOLVED/diamond semantics but may **recompute** when an unused dep’s value changes. **Resolution:** `dynamicNode` (Phase 0.3b) added as the precision alternative — runtime dep tracking via `get()` proxy, dep diffing + rewire, full two-phase participation. Superset-deps docs deemed unnecessary with `dynamicNode` available.
- **Batch 14:** All identified divergences **fixed** in both TS and Py:
  - `merge`, `combine`, `zip`, `race` → **variadic** (TS) / **`*sources`** (Py)
  - `mergeMap` → **`concurrent` option** added
  - `tap` → **observer shape overload** (`{ data, error, complete }`)
  - **RxJS aliases** added: `combineLatest`, `debounceTime`, `throttleTime`, `shareReplay`, `catchError`, `flatMap`/`mergeMap`
  - `debounce` RESOLVED handler fixed (immediate forward, not delayed)
  - `scan`/`reduce` docstrings note seed is always required
  - `docs/coming-from-rxjs.md` migration guide written
- **Batch 15:** Graph inspector features **implemented** in both repos:
  - `describe()` → **filter option** (dict partial match or predicate)
  - `observe()` → **structured mode** returning `ObserveResult` accumulator
  - `Graph.annotate(path, reason)` + `Graph.traceLog()` ring buffer
  - `Graph.diff(a, b)` static structural diff
  - `Graph.inspectorEnabled` class-level toggle (off in production)

### Policy semantics (post–batch 9 doc fix)

- **`policy()`** implementation: **deny wins**; **no matching rule → `false`**. If product intent were **permit-by-default**, that would be an **implementation change**, not documentation only.

---

## WORK COMPLETED (POST BATCH 4–8)

Captured in `docs/batch-review/batch-4-8-processed-result.md`. Summary:

- TS: `Graph` docstring example (`add` vs `register`), **NodeImpl** no longer re-exported from core barrel, **PubSubHub** as interface + `removeTopic()`, **replay/cached** use real nodes, **reactive log** bounds + `appendMany` / `trimHead`, **retry** / **rateLimiter** direct-call API, **batch drain** guard parity concept (Py added max-iteration guard).
- Py: `remove_topic`, reactive log parity, resilience API alignment, **PEP 695** type aliases, **`__all__`** on `graph.py` and `cron.py`, **drain iteration guard** in `protocol.py`.
- Tests: expanded edge-case coverage; Py **xfail** documents remaining operator bugs.

Verification snapshot from that document: TS tests green; Py **291 passed, 1 skipped, 4 xfailed** (figures may drift as the codebase moves).

---

## REMEDIATION: BATCHES 13–15 (ADVANCED PATTERNS) — FINDINGS & FIXES

**Reports:** `docs/batch-review/batch-13.md`, `batch-14.md`, `batch-15.md`.

### Architectural decisions made

| # | Decision | Choice |
|---|----------|--------|
| 1 | Graph inspector API shape | **A** — options bag on `observe()` for structured/causal/timeline |
| 2 | `describe()` filter API | **C** — `describe({ actor?, filter? })` options bag (breaking change) |
| 3 | Superset-deps vs dynamic deps | **A** — tracking `get()` proxy via `dynamicNode`; superset-deps docs unnecessary |
| 4 | Variadic vs array for merge/combine/zip/race | **B** — switch to variadic |
| 5 | `mergeMap` concurrent option | **A** — add now (not deferred) |
| 6 | `tap` observer shape | **A** — extend with observer shape overload |

### TS fixes applied

1. **`src/extra/operators.ts`** — `combine`, `merge`, `zip`, `race` switched to variadic; `debounce` RESOLVED immediate forward; `tap` observer overload; `mergeMap` concurrent + buffer queue; `scan`/`reduce` docstring notes; RxJS aliases at end of file.
2. **`src/extra/sources.ts`** — `shareReplay = replay` alias.
3. **`src/graph/graph.ts`** — `DescribeFilter` type + filter logic in `describe()`; `ObserveOptions`/`ObserveResult`/`ObserveEvent` types + structured overload on `observe()`; `inspectorEnabled` class var; `annotate()`, `traceLog()` ring buffer, `Graph.diff()` static method; `TraceEntry`, `GraphDiffResult`, `GraphDiffChange` types.
4. **`src/graph/index.ts`** — New type exports.
5. **`src/core/dynamic-node.ts`** — Full `dynamicNode` implementation (Phase 0.3b): `DynGet` proxy, `DynamicNodeFn`, `DynamicNodeImpl` with dep diffing, bitmask rewire, re-entrancy guard, two-phase DIRTY/RESOLVED handling.
6. **`src/core/index.ts`** — `dynamic-node` re-export.
7. **`src/__tests__/core/dynamic-node.test.ts`** — 7 tests: tracking, conditional deps, dep set changes, RESOLVED, diamond resolution, cleanup, get().
8. **`src/__tests__/extra/edge-cases.test.ts`** — Updated to variadic API.
9. **`src/__tests__/extra/operators.test.ts`** — Updated to variadic API.
10. **`src/extra/reactive-map.ts`** — TTL `<= 0` validation.
11. **`src/extra/checkpoint.ts`** — `warnNonJsonValues()` before `JSON.stringify`.
12. **`docs/coming-from-rxjs.md`** — RxJS migration guide.
13. **`docs/roadmap.md`** — Phase 0.3b, Phase 3.3, RxJS compat section all marked complete.

### Py fixes applied

1. **`src/graphrefly/extra/tier2.py`** — **Architecture rewrite:** `switch_map`, `concat_map`, `flat_map`, `exhaust_map` converted from **producer pattern** (`node(start_fn)`) to **dep-based pattern** (`node([outer], compute_fn, on_message=handler)`), matching TS. Added `_forward_inner()` helper (matches TS `forwardInner`). `mergeMap` concurrent option. RxJS aliases.
2. **`src/graphrefly/extra/tier1.py`** — Variadic `*sources` for `combine`, `merge`, `zip`, `race`; `tap` observer dict overload; `distinct_until_changed` default `op.is_` → `op.eq`; `scan` default `op.is_` → `op.eq`; `combine_latest` alias.
3. **`src/graphrefly/extra/sources.py`** — `share_replay` alias.
4. **`src/graphrefly/extra/data_structures.py`** — TTL `<= 0` validation.
5. **`src/graphrefly/extra/checkpoint.py`** — `_check_json_serializable()` warning.
6. **`src/graphrefly/graph/graph.py`** — `describe()` filter, `observe()` structured mode, `annotate()`, `trace_log()`, `diff()`, `inspector_enabled`.
7. **`src/graphrefly/core/dynamic_node.py`** — Full `dynamic_node` implementation with dep tracking, rewire, two-phase handling.
8. **`tests/test_dynamic_node.py`** — 7 tests mirroring TS.
9. **`tests/test_edge_cases.py`** — 4 `xfail` markers **removed**; all tests pass.
10. **`tests/test_extra_tier2.py`** — Tests updated to account for dep-based initial value processing.

### Verification snapshot (post-remediation)

- **TS:** All **`pnpm test`** green (count drifts with new tests; operator matrix alone is **80+** cases); run **`pnpm run lint`** / **`pnpm run lint:fix`** after large edits.
- **Py:** 302 tests passed, 1 skipped, **0 xfailed** (figures may drift).

---

## OPEN WORK

1. **Run batches 12, 16** when ready (Py test coverage breadth, integration stress).
2. **Resolve TS vs Py batch drain deferral** inconsistency (batch 1) or update spec to codify chosen semantics.
3. **Clarify §1.4** in `GRAPHREFLY-SPEC.md` (convention vs enforcement).
4. **SQLite checkpoint** thread-safety (noted P1 in processed result).
5. **Roadmap §3.1b (reactive, no `Promise` in public APIs):** remaining items (e.g. **SqliteCheckpointAdapter** return types, full-export audit, `fromAny` pattern) — see **`docs/roadmap.md`**.
6. **Extend `gen-api-docs`** if we want **per-method `Graph` API pages** or interface-only symbols as first-class pages (optional; method JSDoc already improves IDE hints).

**Doc registry / checkpoint (post–batch 9):** **`website/scripts/gen-api-docs.mjs`** REGISTRY entries for **`fromIDBRequest`** / **`fromIDBTransaction`** (and related **`checkpoint.ts`** IDB primitives) keep generated API pages aligned with **`src/extra/checkpoint.ts`**.

---

## KEY INSIGHTS

1. The audit plan successfully **separates concerns** per batch; parallel sessions can own independent phases.
2. **Primary evidence stays in `docs/batch-review/`** — this session is the map and executive summary.
3. **Cross-repo parity** is strong on core protocol and Graph; **divergences cluster** around batch edge cases, minor API shapes, and observability ergonomics.

---

## FILES CHANGED (AUDIT-RELATED ONLY)

- `docs/audit-plan.md` — defines batches (living document).
- `docs/batch-review/batch-*.md` — findings and processed roll-up.
- `archive/docs/SESSION-cross-repo-implementation-audit.md` — this file.
- Implementation/test/docs edits for batches 9–11 are described in sections above (see git history for exact paths).
- **Batch 11 (matrix + tests):** `src/core/node.ts` (`onResubscribe`), `src/extra/operators.ts` (`take` / `reduce` resubscribe reset), `src/__tests__/extra/operator-protocol-harness.ts`, `src/__tests__/extra/operator-protocol-matrix.test.ts`, `src/__tests__/extra/operators.test.ts`, `src/__tests__/core/protocol.test.ts`.
- **Batches 13–15:** See "REMEDIATION: BATCHES 13–15" section above for full file lists. Key new files: `src/core/dynamic-node.ts`, `src/__tests__/core/dynamic-node.test.ts`, `docs/coming-from-rxjs.md`.
- **Checkpoint / docs site:** `src/extra/checkpoint.ts` (IDB-related **`Node`** helpers per roadmap §3.1b), `website/scripts/gen-api-docs.mjs` (REGISTRY keys **`fromIDBRequest`**, **`fromIDBTransaction`**, etc.), `src/__tests__/extra/checkpoint.test.ts`.

---

## READING GUIDE

- **Deep dive:** Open the relevant `docs/batch-review/batch-N.md` for checklist-level PASS/VIOLATION/INCONSISTENCY rows.
- **What we fixed in one pass:** `docs/batch-review/batch-4-8-processed-result.md`.
- **Python-focused deltas:** `~/src/graphrefly-py/archive/docs/SESSION-cross-repo-implementation-audit.md` (companion to this file).
