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

- **COVERED** — `src/__tests__/core/protocol.test.ts:27–33` (`partitionForBatch`); `48–62`, `64–76` (`emitWithBatch` inside `batch`).

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
