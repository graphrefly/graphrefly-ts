---
name: rust-review
description: "Post-implementation quality review for Rust port slices. Runs the audit-data extractor, then appends one structured row to reviews.jsonl + new rows to findings.jsonl + (if applicable) edits flowcharts.md. Output is data, not prose — every behavioral trace, simplification delta, and finding lands in the audit dashboard. Use after /porting-to-rs completes a slice, or standalone when you want to verify a Rust module's correctness without reading Rust."
argument-hint: "[module or slice name, e.g. 'batch coalescing' or 'M1 Slice C']"
---

You are executing the **rust-review** workflow. Output is **structured data**, never markdown prose. Every analytical artifact lands in JSONL files under `~/src/graphrefly-rs/docs/audit/data/`, which the audit dashboard at `http://localhost:8769/audit/site/` renders.

Target: $ARGUMENTS

---

## Phase 0: Refresh derived data

Re-run the extractor first so you start the review against current source state:

```bash
cd ~/src/graphrefly-rs && mise run audit-extract
# or directly:  python3 docs/audit/extract.py
```

This regenerates the **derived** files (overwritten on every run):
- `items.jsonl` — every public/crate-private item with `loc`, `attrs`, `rules_cited`
- `rules.jsonl` — canonical spec rules (262 today)
- `tests.jsonl` — every `#[test]` fn with `covers_rules` extracted from doc-comment + body
- `topology.jsonl` — crate-to-crate `use` and `ref` edges
- `locks.jsonl` — lock acquisition sites (`Mutex::lock`, `RwLock::read|write`, etc.)
- `flowcharts.jsonl` — Mermaid diagrams from `docs/flowcharts.md` with metadata + source

It does **not** touch `findings.jsonl` and `reviews.jsonl` — those are append-only, author-edited audit artifacts.

---

## Phase 1: Load context

Read in parallel:

- `~/src/graphrefly-rs/docs/migration-status.md` — what's claimed as landed
- `~/src/graphrefly-rs/docs/porting-deferred.md` — known gaps
- `~/src/graphrefly-rs/docs/flowcharts.md` — Rust-port-specific shape diagrams (canonical Mermaid source)
- `~/src/graphrefly-ts/docs/implementation-plan-13.6-canonical-spec.md` — sections relevant to $ARGUMENTS
- `~/src/graphrefly-ts/docs/implementation-plan-13.6-flowcharts.md` — TS spec semantics
- `~/src/graphrefly-rs/docs/rust-port-decisions.md` — locked decisions
- The Rust source files for the module (`~/src/graphrefly-rs/crates/<crate>/src/`)
- The Rust test files (`~/src/graphrefly-rs/crates/<crate>/tests/`)
- `~/src/graphrefly-rs/docs/audit/data/findings.jsonl` — open findings on $ARGUMENTS to avoid duplicating
- `~/src/graphrefly-rs/docs/audit/data/reviews.jsonl` — past reviews of nearby slices

Open the dashboard during the review:
```
mise run audit-serve              # background server
http://localhost:8769/audit/site/ # the live data view
```

---

## Phase 2: Behavioral traces

Author 2–5 traces covering: the happy path, the most complex edge case (diamond, pause interaction, terminal cross-cut), and any scenario the parity tests cover. Each trace is a structured object (not markdown). Schema:

```json
{
  "id": "T1",
  "title": "Pause-overflow ERROR synthesis",
  "rules": ["R1.3.8.c", "Lock 6.A"],
  "diagrams": ["11.1"],
  "steps": [
    {"step": 1, "event": "set_pause_buffer_cap(node, Some(2))", "internal": "NodeRecord.pause_buffer_cap = 2", "output": "—"},
    {"step": 2, "event": "...", "internal": "...", "output": "..."}
  ],
  "commentary": "Pre-Slice-F this was a silent drop. Now structured ERROR with {nodeId, droppedCount, configuredMax, lockHeldDurationMs}."
}
```

Build the trace objects in your head, hold them — they get embedded in the `reviews.jsonl` row in Phase 6.

---

## Phase 3: Simplification delta

For each public-facing change in the slice, capture a delta row:

```json
{
  "n": 1,
  "ts_pattern": "TS pause overflow: silent drop or implementation-defined",
  "rust_replacement": "Synthesized Error with structured diagnostic",
  "simpler": "same",                    // "same" | "yes" | "no" | "rust-harder"
  "notes": "Slice F A3 — closes documented divergence",
  "diagram": "11.1"                     // optional flowchart id
}
```

Flag `simpler: "no"` or `"rust-harder"` rows as potential over-engineering. If a row's complexity is justified (type safety, thread safety, etc.) put the justification in `notes`. If unjustified, plan to also emit a `kind:"opp"` finding in Phase 5.

---

## Phase 4: Deferred gap audit

For each `#[ignore]` test in the module, check it has a matching entry in `porting-deferred.md`. For each deferred-but-not-ignored item, plan a `kind:"limit"` finding in Phase 5. For each item that's silently depended on for correctness, plan a `kind:"bug"` finding.

---

## Phase 5: Findings

Each issue surfaced becomes one row in `findings.jsonl`. Re-use a draft authored via the dashboard's "+ New finding" drawer (fastest path — IDs auto-increment from the highest existing `F<NNN>`), or hand-author. Schema:

```json
{
  "id": "F011",
  "kind": "bug",                        // bug | limit | opp | note | complete-gap
  "severity": "major",                  // critical | major | minor
  "title": "Diamond resolution overflows at fan-in >32",
  "where": "crates/graphrefly-core/src/dispatcher.rs",
  "where_line": 142,
  "rule": "R5.8",                       // optional
  "slice": "M3 Slice F audit /qa D4",   // optional
  "evidence": "Reproducer: tests/wide_fanin.rs::T_diamond_w33. Bitmask is u32 → silently overflows.",
  "recommendation": "Lift bitmask to u128 for fan-in ≤128, fall back to Vec<u64> chunks above.",
  "status": "open",                     // open | closed | superseded | draft
  "opened_at": "2026-05-09",
  "closed_at": null,
  "supersedes": null,
  "source": "rust-review (slice F audit)"
}
```

**Authoring tips**:
- Use the dashboard's authoring drawer for any finding tied to a specific file — the `where` field gets autocomplete.
- One finding per issue. Don't bundle.
- For "Rust simpler than TS" wins worth surfacing, use `kind:"opp"`.
- For deferred-by-design items, use `kind:"limit"` and put the deferral reason in `evidence`.
- For missing parity scenarios, use `kind:"complete-gap"` and cite the `rule` it would test.

---

## Phase 6: Append the review row

When traces, deltas, and findings are all authored, build **one** `reviews.jsonl` row that ties them together and append it (no rewrites — the file is append-only):

```json
{
  "id": "rev-2026-05-09-slice-q",
  "review_date": "2026-05-09",
  "slice": "M3 Slice Q",
  "scope": "...",
  "sha": "<short hash from git rev-parse --short HEAD>",
  "tests_before": 438,
  "tests_after": 471,
  "premise": "<short why-it-matters paragraph>",
  "traces":  [ ... Phase 2 trace objects ... ],
  "deltas":  [ ... Phase 3 delta rows ... ],
  "findings_opened": ["F011", "F012", "F013"],
  "assessment": {
    "spec_fidelity": "very high",
    "over_engineering": "low",
    "correctness_holes": "none",
    "halt": "no",
    "summary": "<one-paragraph verdict>"
  },
  "source": "rust-review"
}
```

Use absolute dates (`2026-05-09`), not "today". `id` follows `rev-<YYYY-MM-DD>-<slice-slug>`. Append with:

```bash
echo '<the json>' >> ~/src/graphrefly-rs/docs/audit/data/reviews.jsonl
```

(One line, no trailing comma, valid JSON.)

---

## Phase 7: Maintain `flowcharts.md`

`~/src/graphrefly-rs/docs/flowcharts.md` is still the **canonical Mermaid source**. The extractor reads from it; the dashboard renders from `flowcharts.jsonl`.

For **each new public method, state machine, or distinctive pattern** you traced in Phase 2 that isn't already diagrammed:

1. Add a Mermaid block under the appropriate batch heading (`## Batch N — title`) with a `### x.y title` heading. The extractor will pick it up next time you run `mise run audit-extract`.
2. Cite the spec rule (`R<x.y.z>`) in the title or prose so `rules_cited` populates correctly.
3. Use existing conventions: 🟨 YELLOW for v1 limitations, 🟦 BLUE for Rust-specific simplifications, solid arrows for control flow, dashed for data flow.
4. Update the cross-reference tables at the end of the file (slice→diagram, spec rule→diagram, deferred→diagram).

**For diagrams that became stale**: edit in place, add a short "updated in Slice X" note in the prose, no new diagram needed.

**Mermaid syntax pitfalls** (verified to fail in mermaid v10):
- `;` in sequenceDiagram message text (use `,` or `—`)
- `:` inside stateDiagram-v2 state descriptions when followed by `{...}` (use `note right of <state>` blocks)
- Generics with `<T>` inside class/state diagrams — use `~T~`
- Stray `activate`/`deactivate` pairs across `alt`/`else` branches — close every branch
- Bracket labels `["…"]` containing parens or `::` — replace with `[…]` plain text

After Mermaid edits, **re-run the extractor** so `flowcharts.jsonl` updates:

```bash
mise run audit-extract
```

---

## Phase 8: Verify in the dashboard

1. `mise run audit-serve` (or `preview_start` with the `rust-audit` profile in `.claude/launch.json`).
2. Open `http://localhost:8769/audit/site/`.
3. Spot-check each tab:
   - **Reviews** → your new row sits at the top (newest first), expand it, confirm traces + deltas + findings render correctly.
   - **Findings** → new rows appear with the right `where` clickable to Repo Map.
   - **Flowcharts** → any new diagram appears in its batch group; click to render Mermaid.
   - **Spec ⇄ Impl** → if the slice changed citations, the matrix shows updated counts; rules touched by new findings have the bug indicator; flowchart-citing rules show the 📊 chip.
   - **Repo Map** → drill into any file you logged a finding on; verify the sidecar shows the new finding.
4. Note in the conversation any tabs that didn't update as expected.

---

## When to escalate

If during the review you find:
- A behavioral trace that **contradicts** the canonical spec → HALT, surface the contradiction, write a `kind:"bug" severity:"critical"` finding, do NOT append the review row until the user resolves.
- A delta row where Rust adds machinery that's NOT justified by a Rust-specific constraint → write a `kind:"opp"` finding with `recommendation:` listing the simpler shape.
- A deferred item the current code silently depends on for correctness → flag as `kind:"bug"` (not `limit`) — that's a hidden hole.
- A flowchart in `flowcharts.md` that contradicts current source (drift) → fix the diagram in Phase 7 and call out the drift in the review's `premise`.
- A Mermaid render failure you can't fix in two attempts → leave the diagram in but cite it in the review's `assessment.summary` so it gets followup attention.

---

## What changed from the old workflow

The pre-2026-05-09 SKILL wrote a markdown report (`reports-NNN-<slug>.md`) under `docs/review/`. Those files are **frozen historical artifacts** — leave them. New reviews go to `docs/audit/data/reviews.jsonl` only.

The Phase 6.5 directive vocabulary (`::: trace`, `::: finding`, …) used by the legacy report renderer is no longer used. The structured shape lives in JSONL fields directly.

The legacy site at `docs/review/site/` still renders the historical reports for read-only access. Do not extend it; do not edit the reports it serves.
