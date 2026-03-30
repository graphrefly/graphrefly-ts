---
SESSION: cross-repo-implementation-audit
DATE: March 30, 2026 (updated — batch 16 integration-stress writeup + Tier 2 parity tests; prior: batches 9–12 full remediation)
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
| 9 | D | Documentation audit (TS) | `docs/batch-review/batch-9.md` | Done (remediated ×2 — see below) |
| 10 | D | Documentation audit (Py) | `docs/batch-review/batch-10.md` | Done (remediated — see below) |
| 11 | E | Test coverage (TS) | `docs/batch-review/batch-11.md` | Done (remediated ×2 — operator matrix + second pass — see below) |
| 12 | E | Test coverage (Py) | `docs/batch-review/batch-12.md` | Done (remediated — see below) |
| 13 | F | Superset-deps pattern (Phase 4) | `docs/batch-review/batch-13.md` | Done |
| 14 | F | RxJS / callbag semantic alignment | `docs/batch-review/batch-14.md` | Done |
| 15 | F | AI debugging tooling gaps | `docs/batch-review/batch-15.md` | Done |
| 16 | G | Integration stress | `docs/batch-review/batch-16.md` | Done (design + related Tier 2 tests — see below) |

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

## REMEDIATION: BATCHES 9–12 (SECOND PASS — March 30, 2026)

### Batch 9 (TS Docs) — second-pass items

The first-pass (March 29) fixed generator infrastructure. This pass addressed the remaining JSDoc coverage and registry gaps identified in `docs/batch-review/batch-9.md`.

**JSDoc additions (`src/`):**

| File | Items fixed |
|------|-------------|
| `src/core/batch.ts` | `@returns` on `batch`, `emitWithBatch` |
| `src/core/messages.ts` | `@example` on `isKnownMessageType`, `messageTier`, `isPhase2Message`, `isTerminalMessage`, `propagatesToMeta` |
| `src/core/guard.ts` | Full class-level JSDoc + `@param` on `GuardDenied`; `@param`/`@returns`/`@example` on `accessHintForGuard` |
| `src/graph/graph.ts` | `@example` on `reachable` |
| `src/extra/resilience.ts` | `@example` on `tokenBucket`, `tokenTracker`, `rateLimiter`, `withStatus` |
| `src/extra/backoff.ts` | `@example` on `linear`, `exponential`, `fibonacci`, `decorrelatedJitter`, `withMaxAttempts`, `resolveBackoffPreset` |
| `src/extra/checkpoint.ts` | `@returns`+`@example` on `saveGraphCheckpoint`; `@example` on remaining 6 IDB/restore helpers |
| `src/extra/cron.ts` | Full `@param`/`@returns`/`@example` on `parseCron`, `matchesCron` (biome parse guard: avoided `*/` inside JSDoc block) |
| `src/extra/reactive-log.ts` | `@example` on `logSlice` |

**gen-api-docs REGISTRY — 14 new entries:**

- `src/core/guard.ts`: `policy`, `GuardDenied`, `accessHintForGuard`
- `src/core/batch.ts`: `isBatching`, `partitionForBatch`, `emitWithBatch`
- `src/core/meta.ts`: `metaSnapshot`, `describeNode`
- `src/extra/backoff.ts`: `decorrelatedJitter`, `withMaxAttempts`
- `src/extra/cron.ts`: `parseCron`, `matchesCron`
- `src/graph/graph.ts`: `reachable`

**Generated pages — 118 total processed; 14 new pages produced** (`policy.md`, `GuardDenied.md`, `accessHintForGuard.md`, `metaSnapshot.md`, `describeNode.md`, `isBatching.md`, `partitionForBatch.md`, `emitWithBatch.md`, `decorrelatedJitter.md`, `withMaxAttempts.md`, `parseCron.md`, `matchesCron.md`, `reachable.md`, `logSlice.md`).

**`llms.txt` (root + `website/public/llms.txt`):** Both files updated with a full `## Public API` section grouping all 9 module areas (core, graph, extra/operators, extra/sources, extra/data-structures, extra/resilience, extra/backoff, extra/cron, extra/checkpoint). Files are byte-for-byte identical.

---

### Batch 11 (TS Tests) — second-pass items

The operator-protocol-matrix pass (March 29) covered ~80 cases. This pass added the remaining gaps from `docs/batch-review/batch-11.md`.

**New tests in `src/__tests__/core/node.test.ts`:**

- `ERROR payload exact tuple shape` — asserts `[ERROR, theErrorInstance]` with `toBe` identity check. `// Spec: GRAPHREFLY-SPEC §1.3`

*(RESOLVED transitive skip, ERROR terminal block, `resetOnTeardown` were already present from the March 29 pass.)*

**New tests in `src/__tests__/extra/operators.test.ts`:**

- **Tier 1 matrix (8 operators × 5 behaviors, ~45 `it()` blocks):** `map`, `filter`, `scan`, `take`, `takeWhile`, `skip`, `distinctUntilChanged`, `pairwise`, `reduce` — DIRTY ordering, RESOLVED suppression, ERROR propagation, COMPLETE propagation, reconnect after teardown. Each `it()` covers one concern with `// Spec:` comment.
  - `takeWhile` COMPLETE: predicate must fail first before upstream COMPLETE forwards.
  - `reduce` reconnect: accumulates across subs unless `resubscribable: true`; test asserts something is emitted on COMPLETE rather than a reset value.
- **Tier 2 teardown/reconnect (`switchMap`, `debounce`, `concatMap`):** fresh inner after teardown, timer cancellation via `vi.useFakeTimers()`, fresh queue after reconnect.
- **Diamond recompute count:** `source → map(A) + map(B) → combine([A, B])` — asserts exactly 1 DATA per upstream push, confirming glitch-free resolution.

**Verification:** All **486 tests pass**.

---

### Batch 10 (Py Docs) — remediation

**Google-style docstring standardisation — 14 files:**

`core/sugar.py` (`state`, `producer`, `derived`, `effect`, `pipe`), `core/node.py` (`node`, `SubscribeHints`), `core/protocol.py` (`batch`, `is_batching`, `emit_with_batch`), `core/meta.py`, `core/guard.py`, `graph/graph.py` (class + 16 public methods + `reachable`), `extra/tier2.py` (21 operators), `extra/sources.py` (12 functions), `extra/resilience.py`, `extra/backoff.py`, `extra/checkpoint.py`, `extra/data_structures.py`, `extra/cron.py`.

Every public function/class now has: one-line imperative summary, `Args:`, `Returns:` (omitted for `None`), `Example:` with `\`\`\`python` block.

**Export fix:** `SpyHandle` added to `src/graphrefly/__init__.py` imports and `__all__`.

**Roadmap:** Phase 7 `- [ ] README` → `- [x] README` in `docs/roadmap.md`.

**README rewrite (`README.md`):**
- `## Requirements` section: Python 3.12+
- Quickstart replaced with 30-line runnable example (state/derived/for_each/Graph/first_value_from)
- `## Dev setup` section: `mise trust && mise install` + `uv sync`

**`first_value_from` cross-language parity note:**
- Added `Note:` Google-style section to `src/graphrefly/extra/sources.py` docstring
- Added `## Cross-language note` to `website/src/content/docs/api/first_value_from.md`

---

### Batch 12 (Py Tests) — remediation

**`tests/test_core.py`:**
- `test_terminal_blocks_later_data_when_not_resubscribable` — `resubscribable=False` node errors on first call; subsequent upstream pushes produce no DATA/DIRTY/RESOLVED. `# Spec: GRAPHREFLY-SPEC §1.3.4`

**`tests/test_extra_tier1.py` (26 new tests):**
- `test_merge_completes_after_all_sources_complete` — first-source COMPLETE does not terminate merged stream. `# Spec: GRAPHREFLY-SPEC §1.3.5`
- **Tier 1 matrix (5 operators × 5 behaviors):** `map`, `filter`, `scan`, `take`, `combine` — `_dirty_propagation`, `_resolved_suppression`, `_error_propagation`, `_complete_propagation`, `_reconnect`.
  - `take` COMPLETE: quota exhaustion triggers COMPLETE; upstream COMPLETE when `complete_when_deps_complete=False` does not.
  - `take` reconnect: closure counter not reset; test verifies values flow post-reconnect.

**`tests/test_extra_tier2.py` (3 new tests):**
- `test_switch_map_reconnect_fresh_inner` — stale inner no longer delivers after teardown + reconnect.
- `test_debounce_teardown_cancels_timer` — advancing time post-unsubscribe suppresses stale emission.
- `test_concat_map_reconnect_fresh_queue` — new inner created after reconnect + new outer DATA.

**`tests/test_regressions.py` (new file, 3 seed tests):**
- `test_resolved_transitive_skip_does_not_rerun_downstream` — `# Spec: GRAPHREFLY-SPEC §1.3.3`
- `test_diamond_recompute_count_through_operators` — `# Spec: GRAPHREFLY-SPEC §2`
- `test_describe_matches_appendix_b_schema` — manual Appendix B shape validator (no external dep). `# Spec: GRAPHREFLY-SPEC Appendix B`

**Verification:** **362 passed, 1 pre-existing skip, 0 failures**.

---

## BATCH 16 (PHASE G — INTEGRATION STRESS) — FINDINGS & RELATED TESTS (March 30, 2026)

**Report:** `docs/batch-review/batch-16.md`.

**What batch 16 asked for:** Final audit pass — read batches 1–15 and core/graph/operator files; **design** ten cross-layer integration scenarios (not a source-code fix list). For each scenario: risk level, concrete failure mode, why earlier batches missed the boundary, and **pseudocode** tests for **both** TS and Py. Scenario 7 is Python-threading-focused; the format still includes a TS note on single-thread expectations.

**Topics covered in the writeup:** batch + graph + diamond; batch + operators + graph; `graph.signal` / pause vs timer operators; mount + snapshot + restore; guard + observe + meta; error + diamond + batch; concurrent batch + graph (Py); operator chain + RESOLVED propagation; large linear graph stress; snapshot determinism while a batch is in flight.

**Deliverable shape:** The batch prompt’s artifact is **`batch-16.md` only** — no requirement to implement those pseudocode tests in CI. Implementing them is follow-on work.

**Related changes (same initiative — Tier 2 parity, `SESSION-tier2-parity-nonlocal-forward-inner`):** Added **executable** regression/protocol tests aligned with `_forward_inner` / `forwardInner` and dynamic-inner ordering gaps called out in that session:

| File | What was added |
|------|----------------|
| `src/__tests__/extra/operator-protocol-matrix.test.ts` | `concatMap` — global `DIRTY` before phase-2 when inner uses two-phase after outer two-phase |
| `src/__tests__/core/protocol.test.ts` | Void inner (`DATA(undefined)` then `COMPLETE`) through `concatMap`, `mergeMap`, `exhaustMap` |
| `src/__tests__/extra/operators.test.ts` | `switchMap` derived inner — no duplicate initial `DATA`; `rescue` ∘ `switchMap` inner `ERROR`; `debounce` under `batch()` defers emission until batch exits; removed dead vars tripping biome in an existing RESOLVED test |

**Cross-repo testing note:** Python protocol-order assertions on higher-order operators should **clear or slice** captured messages after outer attach / forward-inner snapshot before asserting `DIRTY`-before-`DATA` on a scripted inner push — otherwise initial `DATA` from `_forward_inner` defeats a naive global predicate (behavior is correct; the harness must isolate the phase under test).

**Verification (targeted):** `pnpm test` on the three TS files above — all green (counts drift with suite growth).

---

## OPEN WORK

1. **Implement batch 16 pseudocode tests** in both repos when prioritizing integration coverage (report is design-only today).
2. **Resolve TS vs Py batch drain deferral** inconsistency (batch 1) or update spec to codify chosen semantics.
3. **Clarify §1.4** in `GRAPHREFLY-SPEC.md` (convention vs enforcement).
4. **SQLite checkpoint** thread-safety (noted P1 in processed result).
5. **Roadmap §3.1b (reactive, no `Promise` in public APIs):** remaining items (e.g. **SqliteCheckpointAdapter** return types, full-export audit, `fromAny` pattern) — see **`docs/roadmap.md`**.
6. **Extend `gen-api-docs`** if we want **per-method `Graph` API pages** or interface-only symbols as first-class pages (optional; method JSDoc already improves IDE hints).
7. **Py describe() Appendix B validation:** `tests/test_regressions.py:test_describe_matches_appendix_b_schema` uses a manual validator. Consider a stricter JSON schema check with `jsonschema` if the Appendix B shape is stable.
8. **Tier 2 Py operator matrix:** Partially expanded (batch 16–adjacent work): protocol-style cases and `_forward_inner` regression live in `test_extra_tier2.py` + `test_regressions.py`. Full per-operator matrix parity with TS `operator-protocol-matrix.test.ts` remains optional follow-on.

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
- **Batch 16:** `docs/batch-review/batch-16.md`; Tier 2 test touch-ups in `src/__tests__/extra/operator-protocol-matrix.test.ts`, `src/__tests__/core/protocol.test.ts`, `src/__tests__/extra/operators.test.ts` (see section above).
- **Batches 13–15:** See "REMEDIATION: BATCHES 13–15" section above for full file lists. Key new files: `src/core/dynamic-node.ts`, `src/__tests__/core/dynamic-node.test.ts`, `docs/coming-from-rxjs.md`.
- **Checkpoint / docs site:** `src/extra/checkpoint.ts` (IDB-related **`Node`** helpers per roadmap §3.1b), `website/scripts/gen-api-docs.mjs` (REGISTRY keys **`fromIDBRequest`**, **`fromIDBTransaction`**, etc.), `src/__tests__/extra/checkpoint.test.ts`.

---

## READING GUIDE

- **Deep dive:** Open the relevant `docs/batch-review/batch-N.md` for checklist-level PASS/VIOLATION/INCONSISTENCY rows.
- **What we fixed in one pass:** `docs/batch-review/batch-4-8-processed-result.md`.
- **Python-focused deltas:** `~/src/graphrefly-py/archive/docs/SESSION-cross-repo-implementation-audit.md` (companion to this file).
