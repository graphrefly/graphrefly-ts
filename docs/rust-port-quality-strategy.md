# Rust Port Quality Strategy

How we ensure correctness, spec-fidelity, and idiomatic Rust without requiring David to read Rust.

---

## 1. Parity Test Suite (mechanized correctness)

**Principle:** Same behavioral scenarios, two implementations. If both pass on identical input→output, spec drift is caught mechanically.

**Architecture:**

```
packages/parity-tests/
├── scenarios/           ← impl-agnostic behavioral tests
│   ├── core/            ← M1: node, dispatcher, batch, message protocol
│   ├── graph/           ← M2: Graph container, describe, observe, snapshot
│   ├── operators/       ← M3: operators, sources, data structures
│   ├── patterns/        ← M4+: domain-layer factories
│   └── invariants/      ← cross-cutting spec invariants (§5.8–5.12)
├── impls/
│   ├── types.ts         ← Impl interface (widens per milestone)
│   ├── registry.ts      ← [pureTsImpl, rustImpl] when both active
│   ├── legacy.ts        ← @graphrefly/pure-ts arm
│   └── rust.ts          ← @graphrefly/native arm (activates when napi binding publishes)
└── traces/              ← (Phase 13.9.B) recorded message traces for replay
```

**Scenario design rules:**
- Each scenario tests ONE spec invariant (cited by section number)
- Scenarios assert observable behavior only (messages received, cache values, describe output)
- No impl internals leak into scenarios — only the `Impl` interface
- Scenarios grow per Rust milestone close (M1 → M2 → M3 → M4)

**Coverage targets for M1:**
- Push-on-subscribe (§2.2) ✓ (exists: `dispatcher.test.ts`)
- Batch defers DATA/RESOLVED, not DIRTY (R1.3.6.a)
- Diamond resolution (all deps settled before fn fires)
- First-run gate (fn does not fire until all deps emit DATA)
- Equals-substitution → RESOLVED (R1.3.3)
- PAUSE/RESUME buffering + replay
- ERROR propagation stops walk
- TEARDOWN auto-precedes COMPLETE (R2.6.4)

---

## 2. Spec-as-Oracle Reviews (semantic verification without Rust literacy)

**Process:** After each module lands, I produce a **behavioral trace table** like:

```
Module: batch coalescing (M1)
Scenario: 3 nodes dirty in single batch, 2 settle to same value

Step | Event              | Internal state change        | Observable output
1    | batch.open()       | frame created                | (none)
2    | node_a.set(10)     | DIRTY propagated immediately | sink sees [DIRTY]
3    | node_b.set(20)     | DIRTY propagated             | sink sees [DIRTY]
4    | batch.close()      | drain phase-2 begins         | —
5    | node_a fn fires    | cache: 10, equals: no change | sink sees [DATA, 10]
6    | node_b fn fires    | cache: 20                    | sink sees [DATA, 20]
7    | node_c fn fires    | equals(old, new) = true      | sink sees [RESOLVED]
```

**You verify:** Does this trace match what the spec says should happen? If yes, the Rust code implementing it is correct (because the parity tests also assert this trace).

---

## 3. Rust-Idiomatic Simplification Pass

After each module, I document a delta table:

| TS workaround | Rust replacement | Why it's simpler |
|---|---|---|
| `_pauseBuffer: Messages[] \| null` + 4 fields | `PauseState` enum | Impossible to access buffer when not paused |
| `const snapshot = [...this._sinks]` | Epoch iteration | Zero per-delivery allocation |
| `ResettableTimer` class + generation counter | `Drop` impl | Scope exit = cancel |

This lets you spot over-engineering: "wait, you added a trait + 3 impls for something that's a one-liner in TS?" → flag it.

---

## 4. Decision Log (inline questions, post-decision record)

**Process:**
- I ask you inline when a decision is needed (no silent assumptions)
- After you answer, I append to `docs/rust-port-decisions.md`

**Format:**

```markdown
### D001 — [short title]
- **Date:** 2026-05-XX
- **Context:** [what prompted the question]
- **Options:** A) … B) … C) …
- **Decision:** [what you chose]
- **Rationale:** [why]
- **Affects:** [which modules/milestones]
```

This gives us an audit trail and prevents re-asking the same question.

---

## 5. Deferred Items as Explicit Test Gaps

Each deferred item/limitation from the canonical spec gets a `#[ignore]` test:

```rust
#[test]
#[ignore = "deferred: R1.3.3.d wave-content runtime assertion (Lock 1.D)"]
fn wave_content_invariant_dev_mode_check() {
    // When implemented: assert that mixing tier-3 with multi-DATA
    // in a single wave emits a dev-mode diagnostic
}
```

**Why:** Makes gaps visible in `cargo nextest run` output. Prevents us from shipping code that accidentally depends on unimplemented behavior. You can see the gap count shrink over time without reading Rust.

### Current deferred items to track:

| # | Item | Spec ref | Milestone |
|---|---|---|---|
| 1 | Wave-content invariant runtime assertion | R1.3.3.d / Lock 1.D | post-M1 |
| 2 | `cfg.equalsThrowPolicy` branch | R1.3.2.c | M1 |
| 3 | `pauseBufferMax` overflow ERROR | R1.3.8.c / Lock 6.A | M1 |
| 4 | `replayBuffer: N` circular buffer | R2.6.5 / Lock 6.G | M2+ |
| 5 | Auto-COMPLETE-before-TEARDOWN in core | R2.6.4 / Lock 6.F | M1 |
| 6 | `maxFnRerunDepth` as config | R2.6.7 / Lock 2.F | M1 |
| 7 | `maxBatchDrainIterations` as config | R4.3 / Lock 2.F' | M1 |
| 8 | Cross-language handle-space composition | Open Q1 | post-1.0 |
| 9 | Async fn boundary interleaving | Open Q2 | M3+ |
| 10 | Refcount soundness formal model | Open Q3 | M1 audit |
| 11 | Custom-equals oracle symmetry/transitivity | Open Q4 | convention |
| 12 | INVALIDATE → status "sentinel" | R1.3.7.b / Lock 6.H | M1 |
| 13 | PAUSE buffer tier-3 + tier-4 coverage | R1.3.8.b / Lock 2.C' | M1 |

---

## Workflow Summary

```
For each Rust module:

1. I ask inline decisions (if any)          → you answer
2. I implement                              → you don't need to read
3. I produce behavioral trace table         → you verify against spec
4. Parity tests run (TS oracle vs Rust)     → mechanical correctness
5. I produce simplification delta table     → you spot over-engineering
6. I log decisions to rust-port-decisions   → audit trail
7. Deferred items stay as #[ignore] tests   → visible gap tracking
```

---

## When to Escalate to You

- Spec ambiguity (flowchart says X, prose says Y)
- Performance vs correctness tradeoff
- API shape visible to binding users
- Anything touching the handle protocol boundary (value registry, FFI calls)
- Deferred item that blocks a current module's correctness
