# SESSION DS-2.7.A — §2.7 first-run-gate cross-port convergence

**Opened / locked:** 2026-05-19 (single-session walk).
**Trigger:** `docs/optimizations.md` ② (the "core SENTINEL-dep first-run-gate is order-dependent" item, opened 2026-05-18 from Phase 14.5.2 `toolInterceptor` /qa D2). **Premise was unreproducible at the bare-`node` level** — see "Evidence" below. The walk recast the real defect (a three-port parity divergence + a TS spec text that never caught up with its own Phase 10.5 impl truth) and locked a single canonical contract.
**Status:** L1–L3 + Q1–Q7 LOCKED. Doc artifacts shipped this session; TS impl + parity slice deferred to a follow-on `/dev-dispatch`.

## Scope

Lock ONE cross-port contract for `node`'s first-run gate (spec §2.7) across `@graphrefly/pure-ts`, `@graphrefly/native` (Rust), and `graphrefly-py`. Covers: what counts as "dep settled enough to release the gate" (DATA / RESOLVED / terminal), the `partial` flag's semantics, and the §2.7 spec amendment that captures the locked contract.

**Out of scope.** General §2.7 rewording beyond the gate predicate; the open/separate question of `partial:true` per-wave coalescing on *subsequent* waves (today's question is the **first-fire** contract); per-port implementation slices (TS lands next; Rust pre-conformant; PY explicitly carved out — Q4).

## Evidence (probes + in-tree author notes)

Three isolated repros (now in `TRASH/`) and one in-tree author note:

| Probe | Result | Interpretation |
|---|---|---|
| `node([calls, pred], fn)` `partial:false`, `pred` pure-SENTINEL — clean | **HELD** (`seen===[]`) | gate spec-correct |
| Same — after 3 prior SENTINEL-dep subscriptions, same module instance | **HELD** — identical | **②'s "non-deterministic across order" premise does NOT reproduce** |
| Same — after `pred.down([[COMPLETE]])` | **HELD** | terminal does *not* settle the TS gate in practice (contra spec line 399 "DATA or terminal") |
| `partial:false` + `pred` RESOLVED-only | **HELD forever** | the agentLoop ① near-miss; spec-consistent (RESOLVED ∉ {DATA, terminal}) |
| `partial:true` post-activation `calls.emit()`, `pred` SENTINEL | **HELD** (probe; `seen===[]`) | TS `partial:true` does NOT truly disable the gate (contra spec line 407) |

In-tree author note that closed the case: [`packages/pure-ts/src/extra/operators/combine.ts:80–106`](../packages/pure-ts/src/extra/operators/combine.ts:80) Phase 10.5 flip. Direct quote: *"RESOLVED does not release downstream first-run gates per core/node.ts:1651-1660"*. `withLatestFrom` was flipped `partial:true → partial:false` specifically because the prior `partial:true` shape silently dropped emissions. **This means TS already chose the impl contract; the spec just never caught up.**

Cross-port comparison (TS impl ↔ Rust impl ↔ PY impl):

| Behavior | TS | PY | Rust |
|---|---|---|---|
| **RESOLVED settles gate?** | ❌ No (gate predicate excludes RESOLVED) | ✅ Yes (`node.py:298–299` treats DATA + RESOLVED via same `_on_dep_settled`) | ❌ No (`prev_data != NO_HANDLE \|\| !data_batch.is_empty()`) |
| **Terminal settles gate?** | ✅ Yes (gate predicate: `terminal === undefined`) | n/a (no rearmable gate; bitmask first-fire only) | ❌ No for general ops (only `Reduce`-class — explicit terminal-aware opt-in) |
| **`partial:true` truly disables gate?** | ❌ No (per Phase 10.5 author lock; probe confirms HELD on never-contributing dep) | n/a (**no `partial` option exists**) | ✅ Yes (D011-locked, R2.5.3/R5.4: `if (!partial && has_sentinel_deps())`) |

All three ports answered "what is the §2.7 contract" *differently*. That is the real defect.

## Locks (L1–L3 — by evidence)

- **L1 — RESOLVED does NOT settle the §2.7 gate.** Grounded in TS impl predicate + the Phase 10.5 author note + Rust impl predicate. PY diverges; reconciliation tagged below.
- **L2 — `partial:false` is the correct default; `partial` is a *first-fire* relaxation, not a gate-disable.** Per Phase 10.5's `withLatestFrom` flip (the same author already wrestled this and chose `partial:false`).
- **L3 — PY has no `partial` flag today.** Status quo; reconciliation deferred (Q4).

## Locked questions Q1–Q7

### Q1 — Authority direction → **Rust contract is canonical** (user-locked)

Adopt Rust's lock as canonical for the cross-port spec. Spec §2.7 rewords to match. TS converges (per-op `partial:true` audit + `terminalAsRealInput` opt-in for Reduce-class). PY converges (carved out — Q4).

### Q2 — `partial:true` rule → **gate is OFF; fn body MUST guard SENTINEL** (user-locked, Recommended)

`partial:true` means "gate truly disabled — your fn body MUST handle `prevData[i] === undefined` for every dep, or the wrong-emission hazard is YOUR bug." Phase 10.5's `withLatestFrom` stays `partial:false` (it correctly wants gate-on); `valve` keeps `partial:true` (it correctly handles SENTINEL); `agentLoop.effFullDeny` (this session) keeps `partial:true` (handles SENTINEL via the `gatedBatch == null` check). COMPOSITION-GUIDE gets a dedicated §X "partial:true SENTINEL-pass-through" rule with the `valve` + `effFullDeny` examples.

### Q3 — Terminal-settling axis → **NO by default, Reduce-class opts in via `terminalAsRealInput: true`** (user-locked, Recommended)

Gate predicate becomes:

```text
isSettled(d) =
  d.dataBatch.length > 0          // real DATA this wave
  || d.prevData !== SENTINEL      // real DATA in a prior wave
// Terminal alone does NOT settle.
```

Reduce-class operators (TS `reduce`, `scan`, `last`) opt in via an explicit operator-side flag — `terminalAsRealInput: true` (chosen name; see Q6) — so they fire on upstream COMPLETE-without-DATA to emit the seed/accumulator. Spec §2.7 line 399 ("DATA or terminal") is rewritten to "real DATA" + the opt-in note.

### Q4 — PY reconciliation scope → **carve PY out of this DS entirely** (user-locked)

DS-2.7.A is TS+Rust only. PY divergence becomes a separate `optimizations.md` row (tagged `[py-parity-am]`) whenever PY parity returns under the rigor-infra umbrella. PY tests stay green in the interim (no PY consumer depends on the divergent behavior).

### Q5 — TS operator audit (investigation, not a vote)

Bounded: `reduce`, `scan`, `last` are TS's Reduce-class. All three already use `partial:true` (via `partialOperatorOpts`) → unaffected by the gate-predicate change since the gate is OFF for them anyway. The audit's actual risk surface is `partial:false` operators with a dep that COMPLETEs before DATA — appears empty in current operators but **needs a one-pass implementation-time confirmation** (the follow-on slice).

### Q6 — Opt-in flag name → **`terminalAsRealInput?: boolean`** on `NodeOptions`

Reads honestly at the call site; matches Rust's internal "terminal-aware operators" language; avoids ambiguity with `_autoComplete` / `terminal` (existing fields). Rejected: `terminalSettles` (ambiguous with §2.2 terminal-settling lifecycle rule); `gateAcceptsTerminal` (too gate-specific).

### Q7 — Spec §2.7 amendment text

```text
**First-run gate (§2.7) — authoritative (amended 2026-05-19, DS-2.7.A lock).**
A compute node does NOT run fn until every declared dep has contributed
at least one *real DATA* message — either in the current wave
(`d.dataBatch.length > 0`) or in a prior wave (`d.prevData !== SENTINEL`).

RESOLVED, INVALIDATE, START, and DIRTY messages do NOT settle the gate.
A dep that only ever emits RESOLVED holds the gate forever.

Terminal (COMPLETE / ERROR / TEARDOWN) does NOT settle the gate by
default. Reduce-class operators (`reduce`, `scan`, `last`, and any other
factory that needs to fire on upstream-COMPLETE-without-DATA to emit a
seed) opt in via `terminalAsRealInput: true` on the node options — when
set, `d.terminal !== undefined` is also a settled state for the gate.

The `partial` option (default `false`):

- `partial: false` — gate applies. fn does not fire until every dep has
  contributed real DATA (or terminal, if `terminalAsRealInput: true`).
  Multi-parent activation produces ONE combined initial wave
  `[[START], [DIRTY], [DATA, fn(init...)]]` after the last dep settles.

- `partial: true` — gate is OFF. fn fires as soon as `_dirtyDepCount === 0`,
  regardless of whether any dep is still SENTINEL. **The fn body MUST guard
  every dep slot for SENTINEL** (`ctx.prevData[i] === undefined`); failing
  to do so will read SENTINEL as `undefined` pass-through and is the
  operator author's bug, not a gate failure. Use for `valve`,
  control-stream operators that explicitly want partial-dep waves, and
  effects like `agentLoop.effFullDeny` that detect RESOLVED-only-on-one-dep
  diamonds.

Gate scope: applies only until fn has fired once in the current activation
(`_hasCalledFnOnce`). Subsequent waves, `_addDep`, and INVALIDATE do not
re-gate. Terminal reset on a resubscribable node (§2.2) clears
`_hasCalledFnOnce` and re-arms the gate for the next activation cycle.

**Cross-port lock (DS-2.7.A, 2026-05-19):** This contract is canonical
across all three ports. PY's reconciliation (add `partial`, exclude
RESOLVED from the settle-set, match the terminal contract above) rides
under the existing `[py-parity-am]` rigor-infra deferred umbrella per
docs/optimizations.md.
```

## Artifacts shipped this session

1. **This file** — canonical session record.
2. **`GRAPHREFLY-SPEC.md` §2.7** — replaced with Q7 text.
3. **`docs/cross-track-ledger.md`** — §1 row for `NodeOptions.terminalAsRealInput` symbol-add + behavior reconciliation (TS converges, Rust pre-conformant, PY deferred).
4. **`docs/optimizations.md`** — ② rewritten to point at this DS; original framing preserved below the supersede line for the design record.

## Follow-on (NOT this session)

- **TS impl slice (`/dev-dispatch`):** update `packages/pure-ts/src/core/node.ts` gate scan (remove `terminal === undefined` from the sentinel predicate), add `NodeOptions.terminalAsRealInput?: boolean`, audit `reduce`/`scan`/`last` to set the opt-in, add a one-shot grep for any `partial:false` operator that today fires on a COMPLETE-only dep, parity-tests scenario in `packages/parity-tests/scenarios/core/`.
- **Rust:** pre-conformant; only needs the spec-side parity scenario to assert it (no code change).
- **PY:** `optimizations.md` row tagged `[py-parity-am]` — reconciliation under the rigor-infra umbrella.

## Cross-refs

- `docs/optimizations.md` ② (now superseded — points here)
- `packages/pure-ts/src/extra/operators/combine.ts:80–106` (Phase 10.5 author note that already locked the TS impl truth)
- `packages/pure-ts/src/core/node.ts:2630–2645` (current gate scan)
- `packages/pure-ts/src/core/node.ts:985` (`_partial` default)
- `docs/cross-track-ledger.md` §1 row added this session
- `~/src/graphrefly-rs/crates/graphrefly-core/src/node.rs:1497–1512` (`has_sentinel_deps`)
- `~/src/graphrefly-rs/crates/graphrefly-core/src/batch.rs:1156–1159` (D011 / R2.5.3 / R5.4 `partial`-bypass)
- Phase precedent: R2.6.0 (pause/resume) was resolved the same way — spec amended to the impl-proven contract (`docs/optimizations.md` PAUSE/RESUME entry).
