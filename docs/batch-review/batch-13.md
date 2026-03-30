# Batch 13: Superset-Deps Pattern Verification for Phase 4

Verifying that GraphReFly's "declare superset deps, selectively read at runtime" pattern
(the design decision that replaced callbag-recharge's `dynamicDerived`) works correctly
for Phase 4 orchestration use cases.

---

## 1. SUPERSET PATTERN WORKS

**LIMITATION** — works but with unnecessary recomputes on irrelevant dep changes.

The bitmask tracks which deps sent DIRTY, not which deps `fn` reads. When any dep in the
superset fires DIRTY→DATA, the node recomputes — even if `fn` ignores that dep entirely.

**Evidence — `_runFn()` in `src/core/node.ts:651-694`:**

```ts
const depValues = new Array(n);
for (let i = 0; i < n; i++) depValues[i] = this._deps[i].get();
// Identity check: if ALL dep values unchanged, skip fn entirely
const prev = this._lastDepValues;
if (n > 0 && prev != null && prev.length === n) {
    let allSame = true;
    for (let i = 0; i < n; i++) {
        if (!Object.is(depValues[i], prev[i])) { allSame = false; break; }
    }
    if (allSame) { /* emit RESOLVED, skip fn */ return; }
}
// ... runs fn with ALL dep values
```

**Scenario:** `node([A, B, C], fn)` where `fn` reads A and B initially, then A and C.

- When C changes but `fn` only reads A and B: fn still runs because `depValues[2]` changed
  (identity check fails). fn computes the same result → `_emitAutoValue` emits RESOLVED.
  Correct outcome, but fn ran unnecessarily.

- When B changes but `fn` only reads A and C: same — fn runs, computes same result, RESOLVED.

**Mitigation:** The dep-value identity check (`_lastDepValues`) catches one case: when a dep
sends DIRTY→RESOLVED (value unchanged by reference), `get()` returns the same value, identity
check passes, fn is skipped entirely. This works well for RESOLVED cascade in diamonds but
not for value-changed-but-irrelevant deps.

**Contrast with `dynamicDerived` (`~/src/callbag-recharge/src/core/dynamicDerived.ts`):**
dynamicDerived tracks deps at runtime via a `get()` proxy, rewires connections when deps
change (`_maybeRewire()` at line 152), and only subscribes to actually-used deps. This
means it NEVER recomputes from irrelevant deps. GraphReFly's superset pattern trades this
precision for simplicity (no runtime tracking, no rewiring, no bitmask resize).

---

## 2. RESOLVED CORRECTNESS

**VERIFIED** — emits RESOLVED (not redundant DATA) when an ignored dep changes.

**Scenario:** deps [A, B, C]. B changes (DIRTY→DATA). fn reads A and C only. Computed
value is unchanged.

1. B fires DIRTY — `_onDepDirty(1)` sets dirty bit 1, node emits `[[DIRTY]]` downstream.
2. B fires DATA — `_onDepSettled(1)` sets settled bit 1. `covers` check passes (only bit 1
   was dirty). Masks reset. `_runFn()` called.
3. `_runFn` reads all dep values. `depValues[1]` changed → identity check fails → fn runs.
4. fn reads only A and C (unchanged), returns same value.
5. `_emitAutoValue`: `this._equals(cached, value)` → true → emits `[[RESOLVED]]`.

Downstream skips recompute entirely. Correct behavior per spec §1.3.3.

**Edge case — fn returns same value by coincidence (not by ignoring dep):** Also correctly
emits RESOLVED. The `equals` check (default `Object.is`) catches this.

---

## 3. DIAMOND WITH SUPERSET

**VERIFIED** — bitmask correctly cleared for all deps regardless of which fn reads.

**Scenario:** Diamond A→B, A→C, D has deps [B, C]. fn only reads B. A changes.

1. A fires DIRTY → B fires DIRTY → `_onDepDirty(0)` on D (bit 0 dirty, D emits DIRTY)
2. A fires DIRTY → C fires DIRTY → `_onDepDirty(1)` on D (bit 1 dirty, D already dirty)
3. B settles (DATA) → `_onDepSettled(0)` on D (bit 0 settled). `covers` check: settled=0b01,
   dirty=0b11 → 0b01 does NOT cover 0b11 → wait.
4. C settles (DATA or RESOLVED) → `_onDepSettled(1)` on D (bit 1 settled). `covers` check:
   settled=0b11, dirty=0b11 → covers → **both masks reset** → `_runFn()`.
5. fn reads only B. D recomputes once with both deps settled. Correct.

**Key:** `_depDirtyMask.reset()` and `_depSettledMask.reset()` at `node.ts:711-712` clear
ALL bits unconditionally — they don't care which deps fn read. The bitmask tracks dep
**settlement**, not dep **usage**. This is correct for the superset pattern.

Both TS and Python implementations use identical logic (`node.py:429-437`).

---

## 4. GRAPH.CONNECT AS ALTERNATIVE

**LIMITATION** — Graph.connect does NOT add deps at runtime; it only registers metadata edges.

**Evidence — `src/graph/graph.ts:421-424`:**

```ts
if (!toNode._deps.includes(fromNode)) {
    throw new Error(`... target must include source in its constructor deps ...`);
}
```

`connect()` validates that the source is **already** in the target's constructor deps array.
It cannot add new deps. It's a pure topology annotation for `describe()` output — no bitmask
modification, no subscription creation.

`disconnect()` similarly only removes the edge metadata — it does not unsubscribe the node
from the dep.

**Consequence for Phase 4:** Graph.connect/disconnect cannot be used to dynamically change
a node's dependencies at runtime. The deps array and bitmask are fixed at construction.
There is no API to resize the bitmask or modify `_deps` after construction.

---

## 5. SWITCHMAP AS ESCAPE HATCH

**LIMITATION** — covers the dynamicDerived use case partially, but breaks diamond resolution
across the boundary.

**How it works (`src/extra/operators.ts:1059-1117`):**

switchMap subscribes to `source` as a regular dep. When source emits DATA, `project(value)`
creates a new inner `Node`. The inner node is subscribed to via `forwardInner()`, which
forwards DATA/ERROR/COMPLETE from the inner node through `actions.down()`. The previous
inner subscription is torn down.

**What works:**
- Dynamic inner subscriptions: new inner nodes created per outer value. Covers the
  "different computation path per iteration" use case.
- Proper cleanup: previous inner is unsubscribed before new one starts.
- Lifecycle: COMPLETE/ERROR propagate correctly.

**What doesn't work:**
- **No diamond resolution across the boundary.** The inner node is not in the switchMap
  node's `_deps` array. If the inner node shares an upstream ancestor with a sibling of
  the switchMap node, the two-phase DIRTY→DATA protocol doesn't coordinate across them.
  The switchMap node's bitmask only tracks `[source]`, not the inner node.
- **No RESOLVED optimization.** If the inner node emits the same value as the previous
  inner, switchMap still emits DATA (it doesn't compare across inner boundaries).
- **Inner node is invisible to Graph.describe().** The dynamically created inner node
  is not registered in any Graph — it's ephemeral.

**Contrast with callbag-recharge `dynamicDerived`:** dynamicDerived's `_maybeRewire()`
disconnects from removed deps and connects to new deps, rebuilding the bitmask. The
rewired deps participate fully in diamond resolution. switchMap does not achieve this.

---

## 6. PHASE 4 READINESS

### 6a. pipeline() with conditional branches

**LIMITATION** — works but inefficient for large branch sets.

Pattern: `node([condition, branchAInput, branchBInput], ([cond, a, b]) => cond ? f(a) : g(b))`

- Correct: declares superset, fn selectively reads. RESOLVED emitted when irrelevant
  branch input changes but result is unchanged.
- Inefficient: if branchBInput changes frequently and condition is on branch A, fn runs
  every time even though it ignores branchBInput. For 2-3 branches this is fine. For 10+
  branches (e.g., a router with many possible destinations), the overhead grows linearly.
- Workaround: use switchMap for the conditional, accepting the diamond-resolution tradeoff.
  Or use the `equals` option for cheap result comparison.

### 6b. agentLoop() where available tools change per iteration

**GAP** — superset must be known at construction time.

If the set of possible tools/deps is open-ended (plugins, user-defined tools), the superset
cannot be declared upfront. Options:

1. **Fixed tool registry:** If all possible tools are known at construction, declare the
   full superset. fn reads only the relevant ones per iteration. Works but requires
   upfront knowledge.
2. **switchMap:** Create a new inner node per iteration with different deps. Loses diamond
   resolution and graph visibility.
3. **Missing: runtime dep modification.** Neither `node()` nor `Graph` provides an API
   to add/remove deps after construction. This is the gap that `dynamicDerived` solved
   in callbag-recharge.

### 6c. Orchestration with runtime routing

**GAP** — same as 6b. Runtime routing implies deps determined by data flow at runtime.

The superset pattern works when routing targets are a closed set known at construction.
For open-ended routing (e.g., "route to whichever agent is available"), the options are:

1. Declare all possible targets as deps upfront (if known).
2. Use switchMap/concatMap to dynamically subscribe to different targets.
3. Use Graph.add() to create new nodes and manually wire via state nodes as indirection
   (e.g., a state node acts as a mailbox, routed-to agent writes to it).

None of these achieve the full dynamicDerived capability of runtime dep tracking with
diamond resolution.

---

## 7. DOCUMENTATION GAP

**GAP** — the superset-deps design decision is not documented in user-facing materials.

**Where it exists:**
- `archive/docs/SESSION-graphrefly-spec-design.md:116` — one line in "REJECTED ALTERNATIVES":
  `"dynamicDerived as primitive — Python lesson: declare superset, track at runtime"`

**Where it's missing:**
- The spec (`GRAPHREFLY-SPEC.md`) — §2.1 says `node(deps?, fn?, opts?)` but doesn't
  explain the superset pattern or that deps are fixed at construction.
- No user-facing guide explains: "declare all possible deps upfront, selectively read
  them in fn based on runtime conditions."
- No documentation of the tradeoff: superset pattern = simpler but no dep-tracking
  optimization, vs dynamicDerived = complex but precise.

**Recommendation:** Add a section to the spec (e.g., §2.4.1 "Conditional Dependencies")
or a separate guide explaining:
1. The superset pattern and why it was chosen over dynamicDerived.
2. How to use it: declare all possible deps, selectively read in fn.
3. Performance characteristics: node recomputes on any dep change, RESOLVED cascade
   prevents downstream waste.
4. When to use switchMap instead (open-ended deps, accepting diamond-resolution tradeoff).
5. Known limitation: no runtime dep modification API.

---

## Summary

| # | Item | Verdict | Key Finding |
|---|------|---------|-------------|
| 1 | Superset pattern | LIMITATION | Works but recomputes on any dep change, not just read deps |
| 2 | RESOLVED correctness | VERIFIED | Correctly emits RESOLVED when ignored dep changes |
| 3 | Diamond with superset | VERIFIED | Bitmask clears all bits on settlement regardless of fn reads |
| 4 | Graph.connect | LIMITATION | Cannot add/remove deps at runtime; metadata-only |
| 5 | switchMap escape hatch | LIMITATION | Covers dynamic subs but no diamond resolution across boundary |
| 6a | Conditional branches | LIMITATION | Works for small closed branch sets; inefficient for large ones |
| 6b | Agent loop tools | GAP | No API for open-ended runtime deps |
| 6c | Runtime routing | GAP | Same gap; workarounds exist but none match dynamicDerived |
| 7 | Documentation | GAP | Superset pattern not in spec or user-facing docs |

### Phase 4 Recommendation

The superset pattern is **sufficient for Phase 4 use cases where the dep set is closed
and known at construction time** (most pipeline/orchestration scenarios). For open-ended
agent loops where tools/deps are truly dynamic, either:

1. **Accept the switchMap tradeoff** (no cross-boundary diamonds) — likely fine for agent
   loops where diamond resolution across tool boundaries is rare.
2. **Add a `dynamicDerived`-equivalent** to GraphReFly — a node variant with runtime dep
   tracking and bitmask rewiring. This would be a Phase 4+ addition, not a change to `node()`.
3. **Add a dep-modification API** to `node()` (e.g., `node.setDeps(newDeps)`) that resizes
   the bitmask. Simpler than full tracking but allows explicit runtime changes.

Option 1 is recommended for initial Phase 4 delivery. Options 2-3 can be evaluated based
on real-world usage patterns.

---

## Decision: Add `dynamicNode()` as a Dedicated Primitive

**Decision date:** 2026-03-29

Based on the gaps identified above (6b, 6c), the project will add `dynamicNode(trackingFn,
opts?)` as a second primitive alongside `node()`. This ports callbag-recharge's
`dynamicDerived` pattern to GraphReFly's protocol.

**Rationale:**
- The superset pattern on `node()` is sufficient for closed dep sets but cannot handle
  open-ended dynamic deps (agent loops, runtime routing).
- switchMap is an escape hatch but sacrifices diamond resolution across the boundary.
- `dynamicNode()` provides runtime dep tracking with full diamond resolution — the
  missing capability for Phase 4.

**Scope:**
- `dynamicNode(trackingFn, opts?)` — tracking `get()` proxy discovers deps at runtime
- Dep diffing + rewire after each recompute (reuse kept deps, connect new, disconnect removed)
- Bitmask rebuild on rewire
- Re-entrancy guard during rewire
- Full DIRTY/RESOLVED two-phase participation

**What does NOT change:**
- `node()` is unchanged — no code cleanup needed. The superset pattern was a usage
  recommendation, not a code feature. All node internals (bitmask, settlement, identity
  check) are required for basic multi-dep diamond resolution regardless of dynamic deps.
- `node()` remains the primary primitive for the vast majority of use cases.

**Roadmap:** Added as Phase 0.3b in `docs/roadmap.md`.
