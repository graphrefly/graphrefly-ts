# Batch 11 Coverage Audit — graphrefly-ts

Scope: `docs/audit-plan.md` Batch 11 checklist and `docs/test-guidance.md`.

Reviewed files:

- `src/__tests__/core/node.test.ts`
- `src/__tests__/core/sugar.test.ts`
- `src/__tests__/core/protocol.test.ts`
- `src/__tests__/core/lifecycle.test.ts`
- `src/__tests__/core/on-message.test.ts`
- `src/__tests__/core/perf-smoke.test.ts`
- `src/__tests__/exports.test.ts`
- `src/__tests__/graph/graph.test.ts`
- `src/__tests__/graph/validate-describe-appendix-b.ts`
- `src/__tests__/extra/operators.test.ts`
- `src/__tests__/extra/sources.test.ts`
- `src/__tests__/extra/reactive-data-structures.test.ts`
- `src/__tests__/extra/reactive-map.test.ts`
- `src/__tests__/extra/resilience.test.ts`
- `src/__tests__/extra/checkpoint.test.ts`

---

## CORE PROTOCOL & NODE (§1, §2)

- **COVERED** — Message shape: emissions are arrays of tuples (no shorthand at API boundaries).  
  Evidence: `src/__tests__/core/protocol.test.ts:26`, `src/__tests__/core/protocol.test.ts:27`

- **COVERED** — DIRTY before DATA/RESOLVED in two-phase push.  
  Evidence: `src/__tests__/core/protocol.test.ts:44`, `src/__tests__/core/protocol.test.ts:53`, `src/__tests__/core/lifecycle.test.ts:97`

- **COVERED** — Batch defers DATA, not DIRTY.  
  Evidence: `src/__tests__/core/protocol.test.ts:32`, `src/__tests__/core/protocol.test.ts:33`, `src/__tests__/core/protocol.test.ts:68`

- **COVERED** — RESOLVED when value unchanged per equals; downstream skips recompute (counter asserted).  
  Evidence: `src/__tests__/core/node.test.ts:92`, `src/__tests__/core/node.test.ts:98`, `src/__tests__/core/node.test.ts:111`

- **COVERED** — Diamond: shared ancestor derived runs once per change; count and value both asserted.  
  Evidence: `src/__tests__/core/node.test.ts:50`, `src/__tests__/core/node.test.ts:66`, `src/__tests__/core/node.test.ts:67`

- **COVERED** — ERROR from fn emits `[[ERROR, err]]` downstream.  
  Evidence: `src/__tests__/core/node.test.ts:70`, `src/__tests__/core/node.test.ts:86`, `src/__tests__/core/node.test.ts:88`

- **COVERED** — COMPLETE/ERROR terminal: no further messages.  
  Evidence: `src/__tests__/core/node.test.ts:115`, `src/__tests__/core/node.test.ts:130`, `src/__tests__/core/node.test.ts:752`

- **COVERED** — Unknown types forward (forward-compat).  
  Evidence: `src/__tests__/core/node.test.ts:163`, `src/__tests__/core/protocol.test.ts:114`, `src/__tests__/core/on-message.test.ts:57`

- **COVERED** — Meta keys are subscribable nodes.  
  Evidence: `src/__tests__/core/node.test.ts:788`, `src/__tests__/core/node.test.ts:799`

- **COVERED** — onMessage: return true consumes, return false forwards, throw emits ERROR.  
  Evidence: `src/__tests__/core/on-message.test.ts:12`, `src/__tests__/core/on-message.test.ts:37`, `src/__tests__/core/on-message.test.ts:244`

- **COVERED** — Resubscribable: reconnection after COMPLETE.  
  Evidence: `src/__tests__/core/node.test.ts:143`, `src/__tests__/core/node.test.ts:155`

- **COVERED** — resetOnTeardown clears cached value.  
  Evidence: `src/__tests__/core/node.test.ts:134`, `src/__tests__/core/node.test.ts:139`

---

## GRAPH (§3)

- **COVERED** — add/remove/connect/disconnect.  
  Evidence: `src/__tests__/graph/graph.test.ts:23`, `src/__tests__/graph/graph.test.ts:61`, `src/__tests__/graph/graph.test.ts:68`

- **WEAK** — Edges are wires only (no transforms).  
  Current tests validate dep membership and connect behavior, but do not directly assert transform rejection/impossibility at the edge boundary.  
  Evidence: `src/__tests__/graph/graph.test.ts:91`

- **COVERED** — describe() matches Appendix B JSON schema.  
  Evidence: `src/__tests__/graph/graph.test.ts:1003`, `src/__tests__/graph/graph.test.ts:1015`, `src/__tests__/graph/validate-describe-appendix-b.ts:12`

- **COVERED** — observe(name?) message stream.  
  Evidence: `src/__tests__/graph/graph.test.ts:1027`, `src/__tests__/graph/graph.test.ts:1041`, `src/__tests__/graph/graph.test.ts:1158`

- **COVERED** — Mount and namespace resolution.  
  Evidence: `src/__tests__/graph/graph.test.ts:175`, `src/__tests__/graph/graph.test.ts:185`, `src/__tests__/graph/graph.test.ts:297`

- **COVERED** — signal() and destroy().  
  Evidence: `src/__tests__/graph/graph.test.ts:243`, `src/__tests__/graph/graph.test.ts:787`

- **WEAK** — Snapshot round-trip (same state -> same JSON).  
  Determinism and restore wiring are tested, but no explicit snapshot->restore->snapshot exact-equality assertion in one scenario.  
  Evidence: `src/__tests__/graph/graph.test.ts:815`, `src/__tests__/graph/graph.test.ts:826`, `src/__tests__/graph/graph.test.ts:1061`

- **COVERED** — fromSnapshot() constructs working graph.  
  Evidence: `src/__tests__/graph/graph.test.ts:862`, `src/__tests__/graph/graph.test.ts:1210`

- **COVERED** — Guard enforcement (implemented path).  
  Evidence: `src/__tests__/graph/graph.test.ts:890`, `src/__tests__/graph/graph.test.ts:911`, `src/__tests__/graph/graph.test.ts:922`, `src/__tests__/graph/graph.test.ts:982`

---

## OPERATORS

- **WEAK** — Tier 1 operator matrix completeness (happy path + DIRTY + RESOLVED suppression + error/complete propagation + reconnect for each operator).  
  Coverage is broad but not uniformly full-matrix per operator.  
  Evidence: `src/__tests__/extra/operators.test.ts:56`

- **COVERED** — merge: COMPLETE only after ALL sources complete (not ANY).  
  Evidence: `src/__tests__/extra/operators.test.ts:237`, `src/__tests__/extra/operators.test.ts:244`, `src/__tests__/extra/operators.test.ts:246`

- **WEAK** — Tier 2 matrix completeness including teardown (timers/inner subs), reconnect freshness, and races.  
  Good behavior tests exist, but explicit teardown-resource and reconnect-freshness assertions are sparse.  
  Evidence: `src/__tests__/extra/operators.test.ts:398`, `src/__tests__/extra/operators.test.ts:434`, `src/__tests__/extra/operators.test.ts:570`, `src/__tests__/extra/operators.test.ts:598`

- **WEAK** — Diamond resolution through operator chains.  
  Value output is tested, but recompute count assertion ("once per upstream change") is not explicit.  
  Evidence: `src/__tests__/extra/operators.test.ts:349`

---

## GENERAL

- **WEAK** — One concern per test.  
  Many tests are focused, but several combine multiple concerns in one `it()`.  
  Evidence: `src/__tests__/exports.test.ts:52`, `src/__tests__/graph/graph.test.ts:517`

- **COVERED** — Protocol-level assertions (message sequences, not only final values).  
  Evidence: `src/__tests__/core/protocol.test.ts:53`, `src/__tests__/core/node.test.ts:30`, `src/__tests__/graph/graph.test.ts:1049`

- **WEAK** — Regression tests with explicit spec references.  
  Present in portions of core/operators, but inconsistent across other suites.  
  Evidence: `src/__tests__/core/node.test.ts:92`, `src/__tests__/core/protocol.test.ts:20`, `src/__tests__/extra/operators.test.ts:57`, absence trend in `src/__tests__/extra/sources.test.ts`, `src/__tests__/extra/checkpoint.test.ts`

---

## Highest-Risk Gaps

1. Operator test matrix incompleteness for Tier 1/Tier 2 (DIRTY/RESOLVED/error/complete/reconnect per operator).
2. Tier 2 teardown and reconnect freshness under async races are not consistently asserted.
3. No strict snapshot->restore->snapshot equality test for graph state determinism.
4. Wire-only edge invariant lacks a direct negative assertion.
5. Operator-chain diamond tests do not assert recompute counts, only value correctness.
# Batch 11 — TypeScript test suite coverage audit

Audit of `graphrefly-ts` tests against `docs/test-guidance.md` checklists and `~/src/graphrefly/GRAPHREFLY-SPEC.md`. Files read: `docs/test-guidance.md`, spec (§1–2), and every test file listed in `docs/audit-plan.md` (lines 640–655). `src/__tests__/extra/edge-cases.test.ts` is **not** in that list but is cited where it clearly closes a gap (e.g. `merge`).

---

## CORE PROTOCOL & NODE (test-guidance §1–2)

### Message shape: emissions are arrays of tuples (no shorthand at API boundaries)

- **COVERED** — `src/__tests__/core/protocol.test.ts:22–25` (tuple array convention); pervasive `subscribe` + `down([[TYPE, …]])` usage across `node.test.ts`, `sugar.test.ts`, `on-message.test.ts`.
- **WEAK** — No test asserts that a subscriber never receives a “bare” single tuple vs `Messages[]` batch shape at the boundary (only symbolic type patterns).

### DIRTY before DATA/RESOLVED in two-phase push

- **COVERED** — `src/__tests__/core/lifecycle.test.ts:96–112` (derived ordering); `src/__tests__/graph/graph.test.ts:728–745` (`observe` on derived after `graph.set`); `src/__tests__/core/node.test.ts:18–31` (source two-phase).

### Batch defers DATA, not DIRTY

- **COVERED** — `src/__tests__/core/protocol.test.ts:27–33` (`partitionForBatch`); `48–62`, `64–76` (`downWithBatch` inside `batch`).

### RESOLVED when value unchanged per equals — downstream skips recompute (COUNTERS)

- **WEAK** — `src/__tests__/core/node.test.ts:33–47` asserts `RESOLVED` on the derived node itself; `419–439` asserts emission shape for optimized path, not a **dependent** node’s `fn` run count.
- **MISSING** — Fixture: `source → mid (equals unchanged) → leaf`; assert `mid` emits `RESOLVED` and **leaf `fn` runs do not increment** when `mid` resolves unchanged (per spec §1.3.3 transitive skip).

### Diamond: shared ancestor → derived runs once per change; assert count and value

- **COVERED** — `src/__tests__/core/node.test.ts:50–67`, `370–389`, `303–326`; `src/__tests__/extra/operators.test.ts:272–279` (operators + diamond).

### ERROR from fn → `[[ERROR, err]]` downstream

- **WEAK** — `src/__tests__/core/node.test.ts:70–85` checks `seen` contains `ERROR` and `errored` status, not that the payload is the thrown `Error` / full tuple shape.

### COMPLETE/ERROR terminal — no further messages

- **PARTIAL** — `src/__tests__/core/node.test.ts:697–709` (`COMPLETE` then dep updates: no recompute).
- **MISSING** — After `ERROR` from `fn` (or `down([[ERROR, …]])`), assert **no further** `DATA`/`DIRTY`/etc. on a **non–resubscribable** subscription (spec §1.3.4).

### Unknown types forward (forward-compat)

- **COVERED** — `src/__tests__/core/node.test.ts:108–123`; `src/__tests__/core/protocol.test.ts:91–104` (batch + unknown immediate).

### Meta keys as subscribable nodes

- **COVERED** — `src/__tests__/core/node.test.ts:733–882` (`meta` subscribe, `describeNode`, TEARDOWN to meta).

### onMessage: return true consumes, false forwards, throw → ERROR

- **COVERED** — `src/__tests__/core/on-message.test.ts` (e.g. `12–35` consume+emit, `37–55` forward, `244–268` throw→ERROR).

### Resubscribable: reconnection after COMPLETE

- **COVERED** — `src/__tests__/core/node.test.ts:88–106`.

### resetOnTeardown: cached value cleared

- **MISSING** — No test under `src/__tests__` references `resetOnTeardown` (implementation exists on `node` / operators per codebase). Need: node with `resetOnTeardown: true`, subscribe, `TEARDOWN` or graph remove, assert `get()` cleared / undefined per intended semantics.

---

## GRAPH (test-guidance §3)

### add/remove/connect/disconnect

- **COVERED** — `src/__tests__/graph/graph.test.ts:17–146`, `291–345`, meta path rejects `connect` `400–411`.

### Edges are wires only (no transforms)

- **WEAK** — Behavior is structural (edges register pairs); no explicit test that `connect` does not alter message payloads. Acceptable as implicit, or add a one-line “wire forwards same `DATA` value” check if you want documentation-by-test.

### describe() matches Appendix B JSON schema

- **COVERED** — `src/__tests__/graph/validate-describe-appendix-b.ts` + `graph.test.ts:690–712` (`assertDescribeMatchesAppendixB`).

### observe(name?) message stream

- **COVERED** — `graph.test.ts:413–428`, `458–470`, `714–746`, `845–858`.

### Mount and namespace resolution

- **COVERED** — `graph.test.ts:168–345`.

### signal() and destroy()

- **COVERED** — `graph.test.ts:237–264`, `474–489`, `766–785`.

### Snapshot round-trip (same state → same JSON)

- **COVERED** — `graph.test.ts:502–510` (`JSON.stringify` stable); `748–764` (wire round-trip). Not always literally “two snapshots byte-identical” but same graph state → stable serialization is exercised.

### fromSnapshot() constructs working graph

- **COVERED** — `graph.test.ts:549–560`, `897–907`, `762–764`.

### Guard enforcement

- **COVERED** — `graph.test.ts:577–685`, `787–833`, Phase 1.6 policy tests.

---

## OPERATORS

### Each tier 1 operator: happy path + DIRTY propagation + RESOLVED suppression + error/complete propagation + reconnect

- **WEAK / GAP** — `src/__tests__/extra/operators.test.ts` provides broad **happy paths** and some completion/error (`reduce`, `take`, `rescue`, `merge` COMPLETE, etc.) but **not** a systematic per-operator matrix. Most operators are never checked for `DIRTY` ordering vs upstream, `RESOLVED` suppression, or **reconnect** after teardown.
- **MISSING** — Tier-1 checklist as written would need either many focused `it()` blocks or a table-driven harness per operator.

### merge: COMPLETE after ALL sources (not ANY)

- **COVERED** — `src/__tests__/extra/operators.test.ts:180–187`; **also** `src/__tests__/extra/edge-cases.test.ts:203–216` (dedicated “merge ALL-complete semantics”).

### Each tier 2 operator: same + teardown + reconnect freshness + races

- **PARTIAL** — Tier 2 tests in `operators.test.ts:313–560` cover timers (`debounce`, `delay`, `timeout`, `throttle`, `audit`, `interval`), inner subscription behavior (`switchMap`, `concatMap`, `mergeMap`), `pausable`, `repeat`. **Reconnect freshness** and **race** scenarios are not comprehensively enumerated per operator; several cases live in `edge-cases.test.ts` (e.g. `switchMap` outer complete) rather than the audit-listed file set.

### Diamond resolution through operator chains

- **COVERED** — `src/__tests__/extra/operators.test.ts:272–279` (`map` ×2 + `combine`). Narrow: only one chain shape.

---

## GENERAL (test-guidance)

### One concern per test (no bundled scenarios)

- **WEAK** — `src/__tests__/extra/operators.test.ts:157–209` bundles `combine`, `zip`, `merge`, `concat`, `race` in one `it`; `128–155` bundles `takeUntil`, `distinctUntilChanged`, `pairwise`. Similar bundling appears elsewhere. Prefer splitting per checklist item.

### Protocol-level assertions (message sequences, not only final values)

- **MIXED** — Strong in `protocol.test.ts`, `on-message.test.ts`, parts of `node.test.ts` and `graph.observe` tests; many operator tests assert mainly final `get()` or flattened types without ordering constraints.

### Regression tests have spec references

- **MISSING** — `test-guidance.md` suggests `// Regression: … Spec: GRAPHREFLY-SPEC §x.x`. Almost no tests use that pattern; occasional inline comments cite the spec (`lifecycle.test.ts:17`, `graph.test.ts:690`, `validate-describe-appendix-b.ts`).

---

## Out of audit file list (FYI)

- `src/__tests__/core/dynamic-node.test.ts` and `src/__tests__/extra/edge-cases.test.ts` exist and add coverage (dynamic deps; operator edge cases). They were **not** in `audit-plan.md` lines 640–655; include them in future audit scopes or add to the plan.

---

## Summary table

| Area                         | Strong                         | Gaps                                                |
|-----------------------------|--------------------------------|-----------------------------------------------------|
| Batch / two-phase           | Yes                            | —                                                   |
| Diamond + Graph container   | Yes                            | “edges as wires” optional explicit test             |
| onMessage / meta / guards   | Yes                            | —                                                   |
| RESOLVED transitive skip    | Weak                           | Downstream counter test                             |
| ERROR terminal / tuple      | Weak / partial                 | Payload + no post-ERROR emissions                   |
| resetOnTeardown             | No                             | Dedicated test                                      |
| Tier 1 operators (matrix)   | Partial                        | DIRTY/RESOLVED/reconnect per operator               |
| merge ALL-complete          | Yes                            | (also in edge-cases)                                |
| Test style / regressions    | Weak                           | Split bundles; add regression+§ comments          |
