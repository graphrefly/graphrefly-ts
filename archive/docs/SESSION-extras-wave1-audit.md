# SESSION: Extras Wave 1 Audit — Higher-Order Operators

**Date:** 2026-04-13  
**Status:** Active — switchMap deep-dive complete; exhaustMap/concatMap/mergeMap/withLatestFrom/firstValueFrom/firstWhere pending  
**Scope:** `src/extra/operators.ts`, `src/extra/sources.ts`, `src/extra/composite.ts`

---

## Context

Following completion of the foundation redesign (SESSION-foundation-redesign.md), this session
audits the `src/extra/` operators for semantic correctness, design invariant compliance, test
coverage, and composability. The session uses a phased "wave" structure; this document covers
**Wave 1: higher-order operators**.

Foundation redesign invariants in scope:
- **P2:** `onMessage` handles protocol, `fn` handles data only
- **P3:** No cross-node inspection — `.cache` / `.status` are external APIs; use protocol
- **P4:** START handshake disambiguates "no value yet"
- **P6:** Tier-based unification — reduce special cases

---

## Wave 1 Operator Set

| Operator | File | Current pattern |
|----------|------|----------------|
| `withLatestFrom` | operators.ts:703 | `node([primary, secondary])` + `ctx.dataFrom` |
| `switchMap` | operators.ts:1021 | `producer` + `forwardInner` |
| `exhaustMap` | operators.ts:1080 | `producer` + `forwardInner` |
| `concatMap` | operators.ts:1141 | `producer` + `forwardInner` + queue |
| `mergeMap` / `flatMap` | operators.ts:1234 | `producer` + raw inner subscribe |
| `firstValueFrom` | sources.ts:818 | Promise bridge + `queueMicrotask` |
| `firstWhere` | sources.ts:865 | Promise bridge + `queueMicrotask` |
| `forwardInner` | operators.ts:957 | shared inner-subscription helper |

---

## Bugs Found

### BUG-1: `mergeMap` — inner ERROR leaks subscription and inflates `active` count

**Location:** `operators.ts` `spawn()` function (~line 1262)

`spawn()` collects non-COMPLETE messages into `out` and forwards them, then only calls
`runStop()` / `active--` / `drainBuffer()` / `tryComplete()` on `sawComplete`. An inner ERROR
goes into `out` (forwarded correctly), but `sawComplete` stays false — so cleanup never runs.

**Consequences:**
1. Errored inner's `stop` fn stays in `innerStops` forever — memory leak
2. `active` inflated → concurrent limit wrong → buffered items behind the limit never drain
3. If all inners error, `tryComplete()` never satisfies `active === 0` → mergeMap never completes
   even after source completes

Contrast: `switchMap` / `exhaustMap` / `concatMap` all use `forwardInner` which correctly
calls `finish()` on ERROR (treating it as terminal).

**Fix (minimal):** track `sawError` in `spawn`, call `runStop(); active--; drainBuffer(); tryComplete()`
after forwarding the error — mirroring the `sawComplete` branch. Inner ERROR does NOT cancel
siblings (intentional isolation), just cleans up its own slot.

```typescript
// In spawn():
let sawComplete = false;
let sawError = false;
const out: Message[] = [];
for (const m of msgs) {
    if (m[0] === COMPLETE) sawComplete = true;
    else if (m[0] === ERROR) { sawError = true; out.push(m); }
    else out.push(m);
}
if (out.length > 0) a.down(out as unknown as Messages);
if (sawComplete || sawError) {
    runStop();
    active--;
    drainBuffer();
    tryComplete();
}
```

---

### BUG-2: `firstValueFrom` / `firstWhere` — `queueMicrotask` violates design invariant

**Location:** `sources.ts:827`, `sources.ts:876`

Both use `queueMicrotask(() => unsub())` to defer unsubscription. This is a "chicken-and-egg"
workaround: if the source pushes synchronously (e.g., `state(42)`), `unsub` isn't assigned
yet when the callback fires.

**Invariant violated:** §5.10 "No bare `queueMicrotask`, `setTimeout`, or `process.nextTick`
in the reactive layer."

**Fix — synchronous `shouldUnsub` pattern:**

```typescript
export function firstValueFrom<T>(source: Node<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        let shouldUnsub = false;
        let unsub: (() => void) | undefined;

        unsub = source.subscribe((msgs) => {
            for (const m of msgs) {
                if (settled) return;
                if (m[0] === DATA) {
                    settled = true;
                    resolve(m[1] as T);
                    if (unsub) { unsub(); unsub = undefined; }
                    else shouldUnsub = true;
                    return;
                }
                if (m[0] === ERROR) {
                    settled = true;
                    reject(m[1]);
                    if (unsub) { unsub(); unsub = undefined; }
                    else shouldUnsub = true;
                    return;
                }
                if (m[0] === COMPLETE) {
                    settled = true;
                    reject(new Error("completed without DATA"));
                    if (unsub) { unsub(); unsub = undefined; }
                    else shouldUnsub = true;
                    return;
                }
            }
        });
        if (shouldUnsub) { unsub?.(); unsub = undefined; }
    });
}
```

Same pattern for `firstWhere`.

---

### OPEN-1: `forwardInner` — P3 violation: `.status` and `.cache` post-subscribe reads

**Location:** `operators.ts:992–996` (tracked in `docs/optimizations.md` as P3 audit #1)

```typescript
if (!emitted && (inner.status === "settled" || inner.status === "resolved")) {
    a.emit(inner.cache as R);
}
if (inner.status === "completed" || inner.status === "errored") {
    finish();
}
```

These post-subscribe reads are a guard for "inner was already settled/terminal before
subscribe". But per the P4 START handshake, subscribe delivers `[[START]]` (no cache)
or `[[START], [DATA, cache]]` synchronously. If the first callback batch already
delivers DATA, `emitted = true` is set inside the callback, and the `.status`/`.cache`
checks at lines 992–996 see `!emitted = false` and short-circuit.

**Assessment:** The post-subscribe reads are likely **unreachable dead code** for any
node that delivers START+DATA synchronously in the first callback invocation (all current
nodes). The `.status === "completed"` guard handles already-terminal inners — but a
terminal node's subscribe delivers `[[START], [DATA, last], [COMPLETE]]` in one batch,
which sets `emitted = true` and calls `finish()` before the post-subscribe check runs.

**Decision pending:** Remove the post-subscribe reads and rely entirely on the START
handshake in-band delivery. Needs explicit verification that every node type delivers
all relevant state in the first subscribe batch.

---

## Test Gaps

| Missing scenario | Operators |
|-----------------|-----------|
| `firstWhere` — zero tests | `firstWhere` |
| Primary fires before secondary has any value | `withLatestFrom` |
| Outer COMPLETE while inner still active | `switchMap`, `exhaustMap`, `concatMap` |
| Source COMPLETE while inner still active, then inner completes | `switchMap` |
| Inner ERROR → fresh outer DATA creates new inner | `switchMap` |
| DIRTY propagated then inner switches mid-wave | `switchMap` |
| Source COMPLETE while inner still active | `exhaustMap` |
| Inner ERROR propagation | `exhaustMap`, `concatMap` |
| `maxBuffer` overflow drops oldest (not newest) | `concatMap` |
| Inner ERROR: slot cleaned up, active decremented, next completes correctly | `mergeMap` |
| Concurrent limit: drain after inner completes | `mergeMap` |
| Inner ERROR does not cancel siblings | `mergeMap` |
| mergeMap completes after all inners error + source complete | `mergeMap` |
| PAUSE/RESUME from downstream while inner is active | all `*Map` |

---

## switchMap Deep Dive

### Current implementation (A — producer pattern)

```
producer<R>((a) => {
    let innerUnsub     // handle to current inner; undefined when no active inner
    let sourceDone     // latched true on source COMPLETE

    attach(v):
        clearInner()   // synchronously tears down previous inner
        innerUnsub = forwardInner(fromAny(project(v)), a, () => {
            clearInner()
            if sourceDone → a.down([[COMPLETE]])
        })

    source.subscribe(msgs →
        DATA      → attach(v)
        ERROR     → clearInner() + forward error downstream
        COMPLETE  → sourceDone = true
                    if !innerUnsub → a.down([[COMPLETE]])
    )
    return teardown: srcUnsub() + clearInner()
})
```

`forwardInner` manages the inner subscription:
- Skips START
- DATA → `emitted = true; a.emit(v)`
- COMPLETE → `finish()` (calls `onInnerComplete`)
- ERROR → forward + `unsub()` + `finish()`
- else (DIRTY, RESOLVED) → `a.down([m])` — forwards wave signals to outer's downstream

The `else` branch forwards DIRTY and RESOLVED from inner through the outer producer node's
`a.down()` directly to its subscribers. This means the outer node participates in the inner's
wave without declaring the inner as a framework dep.

### RxJS / callbag differences

| Dimension | RxJS `switchMap` | GraphReFly `switchMap` |
|-----------|-----------------|----------------------|
| Settled inner replay | No concept | Yes — `forwardInner` replays `inner.cache` if already settled |
| Batch of outer values | Each item creates/destroys inner | Same — N outer DATAs in one batch → N attach() calls |
| RESOLVED forwarding | No concept | Yes — DIRTY/RESOLVED from inner forwarded for wave coherence |
| Source COMPLETE + active inner | Waits for inner | Same — `sourceDone` latch |
| Diamond coordination | N/A | Not provided by A (producer not a declared dep) |

### Alternative B — fn+closure: declare source as dep, use `node()`

From `docs/optimizations.md` (open item, proposed 2026-04-11).

```typescript
export function switchMap<T, R>(source, project, opts): Node<R> {
    let innerUnsub: (() => void) | undefined;
    let sourceDone = false;

    return node<R>(
        [source as Node],
        (data, a, ctx) => {
            // Framework runs fn once per settled wave.
            innerUnsub?.();  // previous cleanup fires via fn return (see below)
            innerUnsub = undefined;

            if (ctx.terminalDeps[0] === true) {
                sourceDone = true;
                if (!innerUnsub) a.down([[COMPLETE]]);
                // else: inner still active — wave closes without DATA emission.
                // For defensive correctness (sources that send [DIRTY, COMPLETE]):
                // a.down([[RESOLVED]]);
                return;
            }
            if (ctx.terminalDeps[0] !== undefined) {
                // Source errored — framework auto-forwards via autoError, OR
                // we forward explicitly if autoError is disabled.
                return;
            }

            if (!ctx.dataFrom[0]) {
                // Source sent RESOLVED — framework pre-fn-skip already handles
                // this case (fn never called). This branch is unreachable.
                return;
            }

            innerUnsub = forwardInner(fromAny(project(data[0] as T)), a, () => {
                innerUnsub = undefined;
                if (sourceDone) a.down([[COMPLETE]]);
            });

            // Cleanup returned to framework: called before next fn run.
            return () => { innerUnsub?.(); innerUnsub = undefined; };
        },
        {
            ...operatorOpts(opts),
            completeWhenDepsComplete: false,  // wait for inner
        }
    );
}
```

**Key insight on cleanup:** `node()` fn return is cleanup, not a DATA value (foundation
redesign §7). Returning `() => { innerUnsub?.() }` means the framework calls this cleanup
function before the next fn invocation. This replaces the `clearInner()` call at the top
of `attach()`.

### B's actual advantages vs A (corrected)

**Claimed in `docs/optimizations.md`:**
> "Wave batching — multiple outer DATAs in the same batch → fn runs once with the latest value."

**Correction:** This is NOT automatically provided by switching from producer to `node()`.
`_onDepMessage` processes messages one at a time. Each DIRTY→DATA pair is one wave. For N
DIRTY→DATA waves in one batch, fn runs N times, same as the producer runs `attach()` N times.
The "batch optimization" would require a framework-level wave-coalescing mechanism (not yet
implemented). See discussion in §"Framework-level batch optimization" below.

**Actual B advantages:**

| Benefit | Mechanism | Evidence |
|---------|-----------|---------|
| Pre-fn skip on source RESOLVED | `_maybeRunFnOnSettlement` line 1279 | `if (!_waveHasNewData && !_hasNewTerminal && _hasCalledFnOnce)` → `_emit(RESOLVED_ONLY_BATCH)` — fn not called |
| Diamond coordination | source declared as dep | Framework tracks wave across all topology paths to `switchMap` |
| Equals substitution via `a.emit()` | `_frameBatch` → `_updateState` | `a.emit(v)` runs equals check; same value → DATA substituted with RESOLVED automatically |
| Clean terminal handling | `ctx.terminalDeps[]` | No manual COMPLETE/ERROR branching in subscribe callback |
| Cleanup as fn return | framework calls cleanup before next fn | Replaces manual `clearInner()` at top of attach |

**B obligations vs A:**

| Case | A | B |
|------|---|---|
| Source RESOLVED | `for` loop: no branch hit, silent | Pre-fn skip: fn not called, framework auto-emits RESOLVED — write nothing |
| Source DATA, inner same value | `a.emit(v)` → `_updateState` equals | Same — `a.emit(v)` handles it |
| Source DATA, inner new value | `a.emit(v)` | Same |
| Source COMPLETE, inner active | `sourceDone = true; return` | `sourceDone = true; return` (RESOLVED defensive for DIRTY+COMPLETE sources) |
| Source COMPLETE, no inner | `a.down([[COMPLETE]])` | `a.down([[COMPLETE]])` |
| Source ERROR | `clearInner(); a.down([ERROR])` | `ctx.terminalDeps[0]` is error payload; forward if `autoError` disabled |

### RESOLVED propagation in chains (critical invariant)

**Question:** In `A → B → C`, if A sends RESOLVED to B, does B forward RESOLVED to C,
or swallow it?

**Answer:** B MUST forward RESOLVED to C. Confirmed by code:

From `_maybeRunFnOnSettlement` (node.ts:1276–1283):
```typescript
// Pre-fn skip: when no dep sent DATA this wave (all RESOLVED), skip
// fn and emit RESOLVED directly. Transitive-skip optimization — leaf
// fn is not re-run when a mid-chain node produces the same value.
if (!this._waveHasNewData && !this._hasNewTerminal && this._hasCalledFnOnce) {
    this._clearWaveFlags();
    this._emit(RESOLVED_ONLY_BATCH);   // ← B emits RESOLVED to C
    this._maybeAutoTerminalAfterWave();
    return;
}
```

From `_depSettledAsResolved` (node.ts:1223–1228):
```typescript
private _depSettledAsResolved(dep: DepRecord): void {
    if (dep.dirty) {
        dep.dirty = false;
        this._dirtyDepCount--;
    }
    // Does NOT touch latestData, terminal, or sentinelDepCount.
    // A dep that was sentinel stays sentinel — RESOLVED ≠ DATA.
}
```

**Full wave trace for A→B→C when A's value doesn't change:**

```
Wave open:
  A emits DIRTY → B._onDepMessage(DIRTY) → _depDirtied → _dirtyDepCount=1
                   B emits DIRTY_ONLY_BATCH → C._onDepMessage(DIRTY) → same

Wave settle (A value unchanged):
  A emits RESOLVED → B._onDepMessage(RESOLVED) → _depSettledAsResolved → _dirtyDepCount=0
                     _maybeRunFnOnSettlement → !_waveHasNewData → pre-fn skip
                     B emits RESOLVED_ONLY_BATCH → C._onDepMessage(RESOLVED) → same
                     C pre-fn skip → C emits RESOLVED to its sinks
                     B's fn: not called
                     C's fn: not called
```

**Why this matters for B's correctness:** When source declares itself as a dep of switchMap (B),
and source sends RESOLVED, the pre-fn skip fires at the switchMap node and auto-emits RESOLVED.
This closes the downstream wave without any explicit `a.down([[RESOLVED]])` in fn. This is the
"write nothing" case confirmed.

**Critical invariant:** RESOLVED must propagate to close waves opened by DIRTY. A node that
swallows RESOLVED would leave downstream nodes stuck with `_dirtyDepCount > 0`, blocking all
future waves on those nodes permanently.

**Sentinel note:** `_depSettledAsResolved` does NOT decrement `_sentinelDepCount`. A dep that
has never emitted DATA and then emits RESOLVED stays sentinel. The node's first-run gate
remains closed. RESOLVED means "I ran but nothing changed" — it does not mean "I have a value."

---

## Framework-Level Batch Optimization Discussion

### What optimizations.md claims

> "Wave batching — multiple outer DATAs in the same batch → fn runs once with the latest value.
> Fewer inner subscription churn for switchMap."

### What actually happens today

`_onDepMessage` is called once per message in the subscribe callback's `for (const m of msgs)`
loop. Each DIRTY→DATA pair triggers fn independently. For N rapid outer values:

```
msgs = [DIRTY, DATA(1), DIRTY, DATA(2), DIRTY, DATA(3)]
→ _onDepMessage(DIRTY) → _depDirtied → _dirtyDepCount=1
→ _onDepMessage(DATA(1)) → _depSettledAsData → _dirtyDepCount=0 → fn fires, data[0]=1
→ _onDepMessage(DIRTY) → _depDirtied → _dirtyDepCount=1
→ _onDepMessage(DATA(2)) → _depSettledAsData → _dirtyDepCount=0 → fn fires, data[0]=2
→ _onDepMessage(DATA(3)) ...
```

fn fires 3 times. Same inner churn as A. The "wave batching" optimization is NOT provided
by simply using `node()` instead of `producer()`.

### What would be needed for true batch optimization

To achieve "N DATAs in one batch → fn runs once with latest," the framework would need
one of:

**(Option W1) Wave-coalescing in `_onDepMessage`:** When multiple DIRTY→DATA pairs for
the same dep arrive in one `msgs` delivery, skip intermediate fn runs and only run fn
after the last DATA. Requires the subscriber loop to look ahead before calling
`_maybeRunFnOnSettlement`.

**(Option W2) Two-phase batch delivery guarantees:** If the batch system guarantees that
all DIRTY signals for a wave are delivered before any DATA signals (phase-1 = DIRTY,
phase-2 = DATA), and if multiple DATAs from the same dep accumulate in phase-2, then
only the last DATA triggers fn. This would require the batch system to coalesce per-dep
DATA deliveries.

**(Option W3) Dep-level deduplication:** Before calling `_onDepMessage` for DATA, check
if the dep already has a pending DATA from this batch (dep is not dirty because it was
already settled). If so, update `latestData` and skip re-firing `_maybeRunFnOnSettlement`.

None of these are implemented today. The claim in `optimizations.md` should be revised to
reflect that B's advantages are pre-fn-skip (RESOLVED case) + diamond coordination +
equals substitution — not wave batching for multiple DATAs.

**This is a separate framework-level optimization** that should be filed under the
"Framework primitive: wave-final state for multi-dep derived" item in `optimizations.md`.

---

## Decision

**Lean B (fn+closure) for all `*Map` operators.**

Rationale:
1. Pre-fn skip on RESOLVED eliminates silent drops of RESOLVED from source
2. Diamond coordination is correct for any topology where source feeds both a `*Map` and
   other nodes
3. Equals substitution via `a.emit()` eliminates explicit RESOLVED obligations in the
   common DATA case
4. `ctx.terminalDeps` is cleaner than manual COMPLETE/ERROR branching in subscribe callback
5. Cleanup-as-fn-return replaces boilerplate `clearInner()` pattern

**Not a reason to use B:** wave batching for multiple outer DATAs in one batch. That's a
separate optimization.

**Risk:** fn must correctly handle the terminal wave case (source COMPLETE while inner active)
— emit `a.down([[RESOLVED]])` defensively if a DIRTY wave was opened. Needs stress testing.

---

## Remaining Wave 1 Walk-throughs (pending)

- `exhaustMap` — same producer pattern as switchMap; simpler (no inner switch, just gate)
- `concatMap` — queue management + forwardInner; review buffer overflow semantics
- `mergeMap` — fix BUG-1 first; then B upgrade
- `withLatestFrom` — already uses `node()` + batch model (updated); audit secondary-unsettled scenario
- `firstValueFrom` / `firstWhere` — fix BUG-2; audit COMPLETE-before-DATA; add `firstWhere` tests
- `forwardInner` — P3 reads; START handshake coverage; DIRTY forwarding correctness

---

## Batch Input Model Update (2026-04-13)

All `node()` usages across `operators.ts` and `sources.ts` were migrated
from the old scalar `data[i]` format to the new batch-per-dep format
(`data[i]: readonly unknown[] | undefined`). See SESSION-foundation-redesign.md §11
for the full spec.

### Strategy for auditing extras under batch model

**D1 Option B (2026-04-13):** Operators must iterate the **full batch**, not just `.at(-1)`.
Each value in `batch0` produces an independent downstream wave. `ctx.latestData[i]` is a
fallback for secondary/side-channel deps only — never use it for primary source values.

When walking through an operator that uses raw `node()`, check for:

1. **Primary source reads** — iterate the full batch; emit one downstream wave per value:
   ```ts
   const batch0 = data[0];
   if (batch0 == null || batch0.length === 0) { a.down([[RESOLVED]]); return; }
   let emitted = false;
   for (const v of batch0) {
       // operator logic...
       a.emit(processedV);
       emitted = true;
   }
   if (!emitted) a.down([[RESOLVED]]);
   ```
   For operators that always emit per value (tap, scan), omit the `emitted` guard.

2. **`ctx.dataFrom[i]` checks** (old API) — "did dep i emit DATA this wave?". Replace with:
   ```ts
   batch0 != null && batch0.length > 0   // dep emitted new DATA
   batch0 == null || batch0.length === 0  // dep did NOT emit new DATA
   ```

3. **Secondary dep (latest-only semantics)** — e.g. `withLatestFrom`'s secondary, `valve`'s control.
   Use `ctx.latestData[i]` for the latest scalar value. The primary batch drives iteration;
   each value pairs with the same latest secondary.

4. **Producer nodes (`node([], fn)`)** — never receive batch data (no deps), `data = []`.
   These are subscription-factory nodes; they subscribe to sources manually and call
   `actions.emit()` / `actions.down()` directly. No migration needed.

5. **`node(eventNodes, fn)` with dynamic-length deps** — iterate `data.length`, skip if
   `data[i] == null || data[i].length === 0`. See `cqrs.ts` saga for the idiom.

6. **Terminal-only operators** (reduce, last) — use `.at(-1)` for accumulation target but
   iterate for fold (`reduce`) or keep `.at(-1)` for tracking latest (`last`).

### Operators migrated in this session

All operators below were first migrated to batch format (`.at(-1)` extract), then upgraded
to D1 Option B (full batch iteration) in the same session.

| Operator | D1 Option B behavior |
|----------|---------------------|
| `filter` | iterate batch, emit each passing value; RESOLVED if none pass |
| `scan` | iterate batch, fold+emit after each value |
| `reduce` | iterate batch, fold all values (no emit until COMPLETE) |
| `take` | iterate batch, count+emit, COMPLETE when count reached |
| `skip` | iterate batch, skip first N, emit rest; RESOLVED if all skipped |
| `takeWhile` | iterate batch, emit while predicate holds, COMPLETE on first false |
| `last` | keeps `.at(-1)` — accumulates latest value until COMPLETE (correct) |
| `tap` (fn form) | iterate batch, call fn+emit each; RESOLVED if empty |
| `tap` (observer form) | iterate batch, call obs.data+emit each; RESOLVED if empty |
| `distinctUntilChanged` | iterate batch, emit only values differing from prev; RESOLVED if all suppressed |
| `pairwise` | iterate batch, form+emit pairs; RESOLVED until second value seen |
| `withLatestFrom` | iterate primary batch, pair each with `ctx.latestData[1]` |
| `valve` | iterate source batch when control open, emit each; RESOLVED if closed or empty |
| `forEach` (sources.ts) | iterate batch, call fn for each value |
| `toArray` (sources.ts) | iterate batch, push each value to buffer |
| `cqrs.ts` saga | skip dep if batch null/empty; use `batch.at(-1)` for event array |
| `reactive-layout.ts` segmentsNode | batch0/batch1 `.at(-1)` extract (one layout value per wave) |
| `reactive-block-layout.ts` measuredBlocksNode | batch0/batch1 `.at(-1)` extract |
| `orchestration.ts` loop fn | batch0/batch1 `.at(-1)` extract (loop control value) |
| `orchestration.ts` task | changed `run: NodeFn` → `run: DerivedFn<T>`, sugar-wrapped |

---

## Related Open Items

- `docs/optimizations.md` — "Higher-order operators: fn+closure tier-1 upgrade (proposed 2026-04-11)"
- `docs/optimizations.md` — "P3 audit #1: operators.ts:994 — forwardInner reads inner.cache"
- `docs/optimizations.md` — "Framework primitive: wave-final state for multi-dep derived"
- `SESSION-foundation-redesign.md` §4 — operator categories table (switchMap in "fn+closure+inner sub" row)
- `SESSION-foundation-redesign.md` §7 Scenario 6 — switchMap rapid outer (batch churn not examined)
- `SESSION-foundation-redesign.md` Flag E — P3 audit (forwardInner .cache as exception)
