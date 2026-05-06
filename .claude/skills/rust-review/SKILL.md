---
name: rust-review
description: "Post-implementation quality review for Rust port slices. Produces behavioral trace, simplification delta, deferred gap audit, and parity test assessment. Use after /porting-to-rs completes a slice, or standalone when you want to verify a Rust module's correctness without reading Rust. Lighter than /qa — focuses on spec-fidelity and over-engineering detection."
disable-model-invocation: true
argument-hint: "[module or slice name, e.g. 'batch coalescing' or 'M1 Slice C']"
---

You are executing the **rust-review** workflow — a quality verification pass for a Rust port slice that does NOT require the user to read Rust.

Target: $ARGUMENTS

---

## Phase 1: Load Context

Read in parallel:

- `~/src/graphrefly-rs/docs/migration-status.md` — what's claimed as landed
- `~/src/graphrefly-rs/docs/porting-deferred.md` — known gaps
- `~/src/graphrefly-rs/docs/flowcharts.md` — Rust-port-specific shape diagrams (slice timeline, lock discipline, wave engine, refcount discipline). Read the diagrams matching $ARGUMENTS' slice; they're the fastest way to recall what's already in the impl.
- `docs/implementation-plan-13.6-canonical-spec.md` — sections relevant to $ARGUMENTS
- `docs/implementation-plan-13.6-flowcharts.md` — matching batch diagrams (TS spec semantics; pair with the Rust flowcharts for shape vs semantics)
- `docs/rust-port-decisions.md` — decisions already made
- The Rust source files for the module (`~/src/graphrefly-rs/crates/<crate>/src/`)
- The Rust test files for the module (`~/src/graphrefly-rs/crates/<crate>/tests/`)

---

## Phase 2: Behavioral Trace

For each public-facing behavior in the slice, produce a **behavioral trace table**:

```
Module: [name] (milestone)
Scenario: [1-line description]
Spec rules: R<x.y.z>, R<a.b.c>

Step | Event              | Internal state change        | Observable output
1    | ...                | ...                          | ...
```

Produce 2–5 traces per slice, covering:
- The happy path
- The most complex edge case (diamond, pause interaction, terminal cross-cut)
- Any scenario the parity tests cover

The user verifies these traces against the spec. If traces are correct, the impl is correct.

---

## Phase 3: Simplification Delta

Produce a table:

| # | TS pattern | Rust replacement | Simpler? | Notes |
|---|---|---|---|---|
| 1 | ... | ... | Yes/No/Same | ... |

Flag rows where Rust is MORE complex than TS as potential over-engineering.

For each "No" row, explain WHY it's more complex and whether that complexity is justified (type safety, thread safety, etc.) or unnecessary.

---

## Phase 4: Deferred Gap Audit

1. List all `#[ignore]` tests in the module's test files
2. Cross-reference against the deferred items in `porting-deferred.md`
3. Flag any deferred item that LACKS a corresponding `#[ignore]` test stub
4. Flag any deferred item that the current code may accidentally depend on (i.e., correctness hole)

---

## Phase 5: Parity Test Assessment

Check `packages/parity-tests/scenarios/`:
- Which scenarios cover this module's behavior?
- Which spec invariants from the module have NO parity scenario yet?
- Suggest 2–5 new parity scenarios that should be written (cite spec rule)

---

## Phase 6: Report

Present a summary:

### Behavioral Traces
[traces from Phase 2]

### Simplification Delta
[table from Phase 3]

### Deferred Gaps
- **Covered:** N items with `#[ignore]` stubs
- **Missing stubs:** [list]
- **Potential correctness holes:** [list or "none"]

### Parity Test Coverage
- **Existing:** N scenarios
- **Missing:** [suggested new scenarios with spec rule]

### Overall Assessment
- Spec-fidelity: [high/medium/low + why]
- Over-engineering risk: [high/medium/low + which rows]
- Recommended actions: [bullet list]

---

## Phase 7: Maintain `flowcharts.md`

`~/src/graphrefly-rs/docs/flowcharts.md` is the standing visual aid for the repo. After reporting, sync it with the slice you just reviewed.

For **each new public method, state machine, or distinctive pattern** you traced in Phase 2 that isn't already diagrammed:

1. Add a Mermaid diagram (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, or `classDiagram`) under the appropriate batch section. Diagrams should depict *Rust port shape* (lock discipline, RAII, refcount discipline, ownership) — NOT protocol semantics, which belong in the TS spec flowcharts.
2. Cite the canonical spec rule (`R<x.y.z>`) the diagram visualizes — don't restate the spec.
3. Use the file's existing conventions: 🟨 YELLOW for v1 limitations / deferred items (link to `porting-deferred.md` entry by name), 🟦 BLUE for Rust-specific simplifications vs TS, solid arrows for control flow, dashed for data flow, dotted for optional paths.
4. Update the **slice → diagram map**, **spec rule → diagram map**, and **deferred items by diagram** tables at the end of the file.

For **deferred items that resolved in this slice**: remove the 🟨 callout from the relevant diagram, add a "resolved in Slice X" note, and remove the row from the deferred-items table.

For **diagrams that became stale** (impl changed shape, e.g. a lock-held callback lifted to lock-released): update the diagram in place and note the slice that changed it.

Keep diagrams concise — one diagram per concept. If a diagram grows past ~30 nodes, split it.

---

## When to escalate

If during the review you find:
- A behavioral trace that CONTRADICTS the canonical spec → HALT, present the contradiction
- A simplification delta row suggesting the Rust impl added unnecessary machinery → suggest removal
- A deferred item that the current code depends on for correctness → flag as critical gap
- A flowchart diagram that contradicts the actual code (drift) → fix the diagram in Phase 7 and call out the drift in the report
